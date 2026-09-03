/**
 * SKU attribute read API (Netlify Function) — the outbound half of the ProductToolkit
 * integration.
 *
 * ProductToolkit (or any consumer speaking Akeneo codes) asks OriginFlow what was actually
 * captured for a SKU:
 *
 *   GET /api/skus/{skuNumber}          (or /.netlify/functions/sku-attributes?sku=...)
 *   Authorization: Bearer <SKU_API_TOKEN>
 *
 *   200 { "skuNumber": "10035001", "matches": 1, "skus": [ {
 *          "skuNumber", "skuTitle", "categoryId", "categoryName",
 *          "isFinal", "pendingExport", "lastExportedAt", "updatedAt",
 *          "attributes": { "<akeneoCode>": "<value>", ... },
 *          "unmapped": [ { attributeId, name, reason } ]
 *        } ] }
 *   404 { "error": ..., "code": "SKU_NOT_FOUND" }
 *
 * WHY THIS IS AUTHENTICATED AND ProductToolkit's OWN API IS NOT
 * -------------------------------------------------------------
 * ProductToolkit is published only on the internal network, so "anyone who can reach it"
 * is already a small set. OriginFlow runs on Netlify — this endpoint is on the public
 * internet, and it serves unreleased product data (SKU numbers, titles, specifications,
 * the project they belong to). An unauthenticated version would publish all of it. The
 * bearer token is therefore REQUIRED: if SKU_API_TOKEN is unset the endpoint refuses every
 * request rather than falling open.
 *
 * `skuNumber` is NOT unique in OriginFlow (the same number can appear in several projects),
 * so the response is always a LIST. Returning one arbitrary row would silently hide the
 * others; `matches` makes a collision explicit for the consumer.
 *
 * Read-only by design: it never clears pending_export. Marking a SKU exported is a
 * different decision (it changes OriginFlow's own delta tracking) and does not belong on a
 * GET that any consumer may retry.
 *
 * "Captured" INCLUDES A SUPPLIER SUBMISSION A PM HASN'T REVIEWED YET
 * -------------------------------------------------------------------
 * project_skus.attribute_values only gets a supplier's answer once a PM opens the SKU in
 * ProjectDetail and saves it — until then it lives solely in project_attribute_requests.
 * That left this endpoint returning `attributes: {}` for SKUs a supplier had already filled
 * in, because nobody had reviewed them yet. This overlays each SKU's latest submitted
 * request (scoped by project_id, since sku_number is not unique) over its own stored values,
 * same "submitted wins over stored" rule as the in-app effective-value display
 * (getEffectiveSkuValue in src/services/project/project-sku.service.ts) — see
 * withLatestSubmission in sku-akeneo-payload.ts.
 *
 * Server-only env (set in Netlify, NOT VITE_-prefixed):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  — service role: project_skus is not readable by anon
 *   SKU_API_TOKEN              — shared secret the caller must present
 */

import { createClient } from '@supabase/supabase-js';
import {
  buildSkuAttributePayload,
  indexAttributes,
  withLatestSubmission,
  type AttributeLookupRow,
  type SkuRow,
  type StoredSkuValue,
} from '../../src/services/project/sku-akeneo-payload';

interface NetlifyEvent {
  httpMethod: string;
  path?: string;
  headers: Record<string, string | undefined>;
  queryStringParameters: Record<string, string | undefined> | null;
}

const json = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  body: JSON.stringify(payload),
});

/**
 * Constant-time-ish comparison so a wrong token cannot be discovered by timing the
 * response. Length is compared first because differing lengths cannot be equal anyway.
 */
const tokensMatch = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/** The SKU number from either /api/skus/{sku} or ?sku=. */
const readSkuNumber = (event: NetlifyEvent): string => {
  const fromQuery = event.queryStringParameters?.sku;
  if (fromQuery) return fromQuery.trim();
  const path = event.path ?? '';
  const m = path.match(/\/(?:api\/skus|sku-attributes)\/([^/]+)\/?$/);
  return m ? decodeURIComponent(m[1]).trim() : '';
};

export const handler = async (event: NetlifyEvent) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiToken = process.env.SKU_API_TOKEN;

  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server.' });
  }
  // Fail closed: without a configured token there is no way to authenticate a caller, so
  // the endpoint must not serve data at all.
  if (!apiToken) {
    return json(500, { error: 'SKU_API_TOKEN is not configured on the server; this endpoint is disabled.' });
  }

  const auth = event.headers?.authorization ?? event.headers?.Authorization ?? '';
  const presented = auth.replace(/^Bearer\s+/i, '').trim();
  if (!presented || !tokensMatch(presented, apiToken)) {
    return json(401, { error: 'Missing or invalid bearer token.', code: 'UNAUTHORIZED' });
  }

  const skuNumber = readSkuNumber(event);
  if (!skuNumber) {
    return json(400, { error: 'Provide a SKU number: /api/skus/{skuNumber}', code: 'SKU_REQUIRED' });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const { data: skus, error: skuErr } = await supabase
    .from('project_skus')
    .select('id, project_id, sku_number, sku_title, category_id, attribute_values, is_final, pending_export, last_exported_at, updated_at')
    .eq('sku_number', skuNumber);

  if (skuErr) return json(500, { error: `Could not read SKUs: ${skuErr.message}` });
  if (!skus || skus.length === 0) {
    return json(404, { error: `No SKU with number "${skuNumber}".`, code: 'SKU_NOT_FOUND' });
  }

  // A supplier's latest submission is not written onto the SKU until a PM reviews and saves
  // it (see ProjectDetail.tsx), so it lives only in project_attribute_requests until then.
  // "What was actually captured" (the documented contract) includes it — pull the latest
  // submitted row per project, keyed by project_id since sku_number is not unique.
  const projectIds = [...new Set((skus as SkuRow[]).map((s: any) => s.project_id).filter(Boolean) as string[])];
  const submissionByProjectId = new Map<string, StoredSkuValue[]>();
  if (projectIds.length > 0) {
    const { data: submissions, error: subErr } = await supabase
      .from('project_attribute_requests')
      .select('project_id, submitted_data, submitted_at')
      .eq('sku_number', skuNumber)
      .eq('status', 'submitted')
      .not('submitted_data', 'is', null)
      .in('project_id', projectIds)
      .order('submitted_at', { ascending: true });
    if (subErr) return json(500, { error: `Could not read submissions: ${subErr.message}` });
    // Ascending order + overwrite-on-set keeps the LAST (latest submitted_at) row per project.
    for (const row of submissions ?? []) {
      submissionByProjectId.set((row as any).project_id, (row as any).submitted_data ?? []);
    }
  }
  const skusWithSubmissions: SkuRow[] = (skus as any[]).map(s => ({
    ...s,
    attribute_values: withLatestSubmission(s.attribute_values, submissionByProjectId.get(s.project_id)),
  }));

  // Resolve only the attributes these SKUs actually reference.
  const referencedIds = [
    ...new Set(
      skusWithSubmissions.flatMap(s => (s.attribute_values ?? []).map(v => v?.attributeId).filter(Boolean) as string[]),
    ),
  ];
  let attributeRows: AttributeLookupRow[] = [];
  if (referencedIds.length > 0) {
    const { data, error } = await supabase
      .from('category_attributes')
      .select('id, akeneo_id, name, group, data_type')
      .in('id', referencedIds);
    if (error) return json(500, { error: `Could not read attributes: ${error.message}` });
    attributeRows = (data ?? []) as AttributeLookupRow[];
  }
  const byId = indexAttributes(attributeRows);

  // Category names, for a payload that is readable without a second lookup.
  const categoryIds = [...new Set(skusWithSubmissions.map(s => s.category_id).filter(Boolean) as string[])];
  const categoryNames = new Map<string, string>();
  if (categoryIds.length > 0) {
    const { data } = await supabase.from('categories_l3').select('id, name').in('id', categoryIds);
    for (const c of data ?? []) categoryNames.set((c as any).id, (c as any).name);
  }

  const payloads = skusWithSubmissions.map(s =>
    buildSkuAttributePayload(s, byId, s.category_id ? categoryNames.get(s.category_id) ?? null : null),
  );

  return json(200, { skuNumber, matches: payloads.length, skus: payloads });
};
