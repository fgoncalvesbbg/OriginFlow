/**
 * Shared plumbing for the print-PDF render pipeline, which is split across four
 * Netlify Functions (prepare / part / merge / cleanup) instead of one monolithic
 * handler.
 *
 * WHY split: a single Netlify Function invocation has a hard wall-clock ceiling
 * (Netlify's synchronous-function limit — as low as 10s by default, capped around
 * 26s even on paid plans). The original single-call design rendered every part
 * (cover + one per language + back) via PDFShift IN PARALLEL inside one
 * invocation, then merged and uploaded — but for a large manual (many languages
 * and/or many pages) the total time for the slowest part, plus the merge/upload
 * work, routinely exceeded that ceiling with no way to configure it higher.
 *
 * Splitting so each invocation does AT MOST one PDFShift conversion removes that
 * ceiling as a limiting factor: the CLIENT (src/services/im/im-print-export.service.ts)
 * now orchestrates the job — call prepare once, call `part` once per part (in
 * parallel, from the browser), then call merge once, then cleanup. Book size is
 * bounded only by how long the whole (multi-call) job takes, not by any single
 * invocation's ceiling.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPrintPartsHtml,
  PrintManual,
  PrintHtmlOptions,
  PrintPart,
} from '../../../src/services/im/im-print-html';

export interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
  headers: Record<string, string | undefined>;
}

/** Fields common to every request in the pipeline (prepare / part / merge). */
export interface RenderRequestBase {
  projectId: string;
  templateType: 'im' | 'warning_leaflet';
  languages: string[];
  pageSize: 'a4' | 'a5';
  cover: PrintHtmlOptions['cover'];
  back: PrintHtmlOptions['back'];
  version?: number;
  /** Compact-leaflet typography (points), applied to ALL text / headings. Optional. */
  leafletTextPt?: number;
  leafletHeadingPt?: number;
}

export const BUCKET = 'im-print';
export const PDFSHIFT_ENDPOINT = 'https://api.pdfshift.io/v3/convert/pdf';

export const json = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

export const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed (${res.status}) for ${url}`);
  return (await res.json()) as T;
};

export const isValidBase = (b: unknown): b is RenderRequestBase => {
  const r = b as Partial<RenderRequestBase>;
  return (
    !!r &&
    typeof r.projectId === 'string' &&
    (r.templateType === 'im' || r.templateType === 'warning_leaflet') &&
    Array.isArray(r.languages) &&
    r.languages.length > 0 &&
    (r.pageSize === 'a4' || r.pageSize === 'a5') &&
    typeof r.cover === 'object' &&
    typeof r.back === 'object' &&
    (r.leafletTextPt === undefined || typeof r.leafletTextPt === 'number') &&
    (r.leafletHeadingPt === undefined || typeof r.leafletHeadingPt === 'number')
  );
};

/** Bearer-token auth shared by every function in the pipeline; throws on failure. */
export const authenticate = async (
  supabase: SupabaseClient,
  event: NetlifyEvent,
): Promise<string> => {
  const token = (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new AuthError('Authentication required.');
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) throw new AuthError('Invalid or expired session.');
  return data.user.email ?? data.user.id;
};

/** Thrown by `authenticate` — handlers catch this to return 401 instead of 502. */
export class AuthError extends Error {}

export interface PageMargin { top: string; bottom: string; left: string; right: string; }
/** Full-IM margins (footer + page numbers sit in the generous bottom band). */
export const IM_MARGIN: PageMargin = { top: '16mm', bottom: '18mm', left: '14mm', right: '14mm' };
/** Compact Warning Leaflet margins — narrower, but left/right ≥ the ~8mm edge tab so content
 *  never runs under the stamped thumb-tab (which alternates left/right per recto/verso). */
export const LEAFLET_MARGIN: PageMargin = { top: '8mm', bottom: '8mm', left: '10mm', right: '10mm' };
export const marginFor = (compact: boolean): PageMargin => (compact ? LEAFLET_MARGIN : IM_MARGIN);

/** Fetch the published manifest + each requested language's ResolvedManual JSON. */
export const fetchManifestAndManuals = async (
  supabaseUrl: string,
  req: RenderRequestBase,
): Promise<{ manuals: PrintManual[]; ordered: string[] }> => {
  const base = supabaseUrl.replace(/\/$/, '');
  const manifestUrl = `${base}/storage/v1/object/public/im-published/${req.projectId}/${req.templateType}/manifest.json`;
  const manifest = await fetchJson<{ languages: Array<{ lang: string; url: string }> }>(manifestUrl);
  const byLang = new Map(manifest.languages.map((l) => [l.lang, l.url]));

  const ordered = req.languages.filter((l) => byLang.has(l));
  if (!ordered.length) throw new Error('None of the requested languages are published for this IM.');

  const manuals: PrintManual[] = [];
  for (const lang of ordered) manuals.push(await fetchJson<PrintManual>(byLang.get(lang)!));
  return { manuals, ordered };
};

/** Build the booklet's HTML parts (cheap — no PDFShift calls) so every function in the
 *  pipeline agrees on part count/order/tabs without re-deriving the logic. */
export const buildParts = (
  manuals: PrintManual[],
  req: RenderRequestBase,
): { parts: PrintPart[]; compact: boolean } => {
  const compact = req.templateType === 'warning_leaflet';
  const parts = buildPrintPartsHtml(manuals, {
    pageSize: req.pageSize,
    cover: req.cover,
    back: req.back,
    version: req.version,
    compact,
    leafletTextPt: req.leafletTextPt,
    leafletHeadingPt: req.leafletHeadingPt,
  });
  return { parts, compact };
};

/** Render one standalone HTML part to PDF bytes via PDFShift. */
export const renderPartPdf = async (
  html: string,
  format: string,
  apiKey: string,
  margin: PageMargin,
): Promise<Uint8Array> => {
  const auth = Buffer.from(`api:${apiKey}`).toString('base64');
  const res = await fetch(PDFSHIFT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify({ source: html, format, use_print: true, margin }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Print engine failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return new Uint8Array(await res.arrayBuffer());
};

/** Storage path for a part's intermediate render — namespaced by a client-generated jobId
 *  so concurrent jobs (even for the same project) never collide, and cleanup is one prefix. */
export const tempPartPath = (projectId: string, templateType: string, jobId: string, index: number): string =>
  `tmp/${projectId}/${templateType}/${jobId}/part-${index}.pdf`;

export const tempJobPrefix = (projectId: string, templateType: string, jobId: string): string =>
  `tmp/${projectId}/${templateType}/${jobId}`;
