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
import { flagEnabled } from '../../../src/services/im/feature-flags';
import {
  buildPrintPartsHtml,
  PrintManual,
  PrintHtmlOptions,
  PrintPart,
} from '../../../src/services/im/im-print-html';
import {
  defaultTypographyFor,
  normalizePrintTypography,
  type PrintTypography,
} from '../../../src/services/im/im-print-typography';

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
  /** Required change note describing this generation; stored in im_print_renders.comment. */
  comment?: string;
  /** im_markets.code this booklet is produced for (from the dialog's market preset). */
  market?: string;
  /**
   * The global print typography (Admin → IM Print) the browser resolved for this template
   * type and page size: font family, body/heading point sizes, line spacing, page margins.
   * Optional — an absent or invalid set falls back to the built-in default for the
   * combination, which is what the renderer hardcoded before migration 122.
   *
   * NOT trusted as sent: it arrives from the browser, so every field is range-checked by
   * `resolveTypography` below before it reaches PDFShift.
   */
  typography?: PrintTypography;
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
    (r.typography === undefined || (typeof r.typography === 'object' && r.typography !== null))
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

/**
 * A failure that retrying cannot fix (bad input HTML, a part missing from storage,
 * an unpublished language). Handlers return 422 for these — 422 is NOT in the
 * client's transient-retry set, so the job fails immediately with the message
 * instead of burning time (and PDFShift credits) on doomed retries. Everything
 * else still maps to 502 (retryable).
 */
export class PermanentError extends Error {}

/**
 * The typography this request renders with — the browser-supplied global profile, every
 * field range-checked against the built-in default for the template type and page size.
 * Call this instead of reading `req.typography`: the request body is untrusted, and an
 * out-of-range point size or margin would otherwise reach PDFShift verbatim.
 */
export const resolveTypography = (req: RenderRequestBase): PrintTypography =>
  normalizePrintTypography(req.typography, defaultTypographyFor(req.templateType, req.pageSize));

export interface PageMargin { top: string; bottom: string; left: string; right: string; }

/**
 * Page margins for the PDF engine, in mm, from the resolved global typography.
 *
 * The bottom band has to stay generous enough to hold the stamped running footer and page
 * number (see render-print-merge.ts), and left/right should stay ≥ the ~7–8mm language edge
 * tab so content never runs under the stamped thumb-tab — both are enforced as ranges on the
 * setting itself (PRINT_SETTING_LIMITS) rather than re-derived here.
 */
export const marginFor = (typography: PrintTypography): PageMargin => ({
  top: `${typography.margins.top}mm`,
  bottom: `${typography.margins.bottom}mm`,
  left: `${typography.margins.left}mm`,
  right: `${typography.margins.right}mm`,
});

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
  if (!ordered.length) throw new PermanentError('None of the requested languages are published for this IM.');

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
    typography: resolveTypography(req),
    // Server-side flag (IM_PRINT_MERGE_TOC): saves a page per language by letting content
    // continue on the TOC page. Opt-in, because it trades away the clean "contents, then the
    // manual" separation — a judgement call about the printed artefact, not a free win.
    mergeTocIntoContent: flagEnabled(process.env.IM_PRINT_MERGE_TOC),
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
    const message = `Print engine failed (${res.status}): ${detail.slice(0, 300)}`;
    // 4xx from PDFShift (bad HTML, invalid options) will fail identically on every
    // retry — surface it as permanent. 408/429 stay retryable (timeout/rate limit).
    if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
      throw new PermanentError(message);
    }
    throw new Error(message);
  }
  return new Uint8Array(await res.arrayBuffer());
};

/** Storage path for a part's intermediate render — namespaced by a client-generated jobId
 *  so concurrent jobs (even for the same project) never collide, and cleanup is one prefix. */
export const tempPartPath = (projectId: string, templateType: string, jobId: string, index: number): string =>
  `tmp/${projectId}/${templateType}/${jobId}/part-${index}.pdf`;

export const tempJobPrefix = (projectId: string, templateType: string, jobId: string): string =>
  `tmp/${projectId}/${templateType}/${jobId}`;
