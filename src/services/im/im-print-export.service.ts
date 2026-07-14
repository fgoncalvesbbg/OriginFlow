/**
 * Print-export client — orchestrates the print-PDF render pipeline, which turns the
 * published ResolvedManual(s) into a combined, print-shop-ready PDF (A4/A5, vector
 * text, clickable TOC, page numbers) via a hosted print engine and uploads it to the
 * im-print bucket.
 *
 * The pipeline is split across FOUR Netlify Functions instead of one, because a
 * single function invocation has a hard wall-clock ceiling (Netlify's synchronous-
 * function limit — as low as 10s by default, capped around 26s even on paid plans).
 * A large manual (many languages and/or many pages) can easily exceed that in one
 * call even when parts render in parallel server-side. Splitting so no single
 * invocation does more than ONE PDFShift conversion removes that ceiling entirely —
 * book size is now bounded only by how long the whole (multi-call) job takes, not
 * by any single call's limit:
 *
 *   1. prepare — resolves the manifest, returns how many parts + their labels.
 *   2. part    — renders ONE part (called once per part, in parallel from here).
 *   3. merge   — downloads all rendered parts, stamps + merges, uploads, records.
 *   4. cleanup — deletes the job's temp part files (always runs, success or not).
 *
 * The functions need server-only secrets (PDFShift + Supabase service role). Since
 * the browser can't see those, the button is gated on the public flag
 * VITE_PRINT_EXPORT_ENABLED ("true"), which you set alongside the server secrets.
 * When unset the UI hides the feature (app unaffected). Rendering is decoupled from
 * publishing — this is called on demand, never as part of Generate.
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import { generateUUID } from '../../utils';
import type { IMTemplateType } from '../../types';

const BUCKET = 'im-print';
const FN_BASE = '/.netlify/functions';

/** Whether the print-PDF export feature is enabled (server secrets configured). */
export const isPrintExportAvailable = (): boolean =>
  (import.meta.env.VITE_PRINT_EXPORT_ENABLED as string | undefined) === 'true';

export interface PrintCoverInput {
  logoUrl?: string;
  coverImageUrl?: string;
  title?: string;
  /** Empty → the cover auto-fills "Instruction Manual" in every printed language. */
  subtitle?: string;
  markUrls?: string[];
  /** SKU / article numbers this manual covers (shown on the cover). */
  skus?: string[];
  /** The IM / manual name, shown in the cover footer. */
  imName?: string;
  companyName?: string;
  footerText?: string;
}

/** A historical print-PDF render of a project IM (one row per generation; never overwritten). */
export interface PrintRender {
  id: string;
  projectId: string;
  templateType: IMTemplateType;
  imVersion: number | null;
  languages: string[];
  pageSize: 'a4' | 'a5';
  storagePath: string;
  url: string;
  bytes: number | null;
  createdBy: string | null;
  createdAt: string;
}

export interface PrintBackInput {
  contentHtml?: string;
  logoUrl?: string;
  markUrls?: string[];
}

export interface RequestPrintPdfParams {
  projectId: string;
  templateType: IMTemplateType;
  /** Ordered subset of published languages to include in the combined booklet. */
  languages: string[];
  pageSize: 'a4' | 'a5';
  cover: PrintCoverInput;
  back: PrintBackInput;
  /** Publish version stamped into the footer (optional). */
  version?: number;
  /** Compact-leaflet typography (points), applied to ALL body text / headings. Leaflets only. */
  leafletTextPt?: number;
  leafletHeadingPt?: number;
  /** Progress reporter — called as each part finishes, e.g. "Rendering DE (3/12)…". */
  onProgress?: (label: string, done: number, total: number) => void;
}

export interface PrintPdfResult {
  url: string;
  storagePath: string;
  bytes?: number;
  render?: PrintRender | null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapRender = (r: any): PrintRender => ({
  id: r.id,
  projectId: r.project_id,
  templateType: r.template_type,
  imVersion: r.im_version ?? null,
  languages: r.languages ?? [],
  pageSize: r.page_size,
  storagePath: r.storage_path,
  url: r.url,
  bytes: r.bytes ?? null,
  createdBy: r.created_by ?? null,
  createdAt: r.created_at,
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Render history for a project IM, newest first. */
export const getPrintRenders = async (
  projectId: string,
  templateType: IMTemplateType,
): Promise<PrintRender[]> => {
  if (!isLive) return [];
  const { data, error } = await supabase
    .from('im_print_renders')
    .select('*')
    .eq('project_id', projectId)
    .eq('template_type', templateType)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[im-print-export] getPrintRenders failed:', error.message);
    return [];
  }
  return (data ?? []).map(mapRender);
};

/**
 * Deterministic public URL of a previously rendered print PDF. Mirrors getPublishedManifestUrl —
 * no DB round-trip. Returns null off-line.
 */
export const getPrintPdfUrl = (
  projectId: string,
  templateType: IMTemplateType,
  languages: string[],
  pageSize: 'a4' | 'a5',
): string | null => {
  if (!isLive) return null;
  const name = `${templateType}-${languages.join('-')}-${pageSize}`;
  const path = `${projectId}/${templateType}/${name}.pdf`;
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
};

/** Thrown by `postJson` — carries the HTTP status so callers can decide whether to retry. */
class PrintApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const NOT_FOUND_MESSAGE =
  'Print render service not found (404). This feature runs as Netlify functions — run the app ' +
  'with `netlify dev` locally (plain `vite`/`npm run start` does not serve functions), or use the ' +
  'deployed site. To hide the button in this environment, set VITE_PRINT_EXPORT_ENABLED=false.';

const postJson = async <T>(name: string, body: unknown, token: string, timeoutMs: number): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(`${FN_BASE}/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // AbortSignal.timeout fires a TimeoutError; a dropped connection fires a plain AbortError/TypeError.
    if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new PrintApiError(408, `${name} timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw new PrintApiError(0, e instanceof Error ? `${name} request failed: ${e.message}` : `${name} request failed.`);
  }
  if (res.ok) return (await res.json()) as T;
  // A 404 means the function endpoint itself wasn't reached (the functions only ever
  // return 400/401/405/500/502/200) — the tell-tale sign the Netlify function isn't
  // being served, e.g. the app is running under plain `vite` (npm run start).
  if (res.status === 404) throw new PrintApiError(404, NOT_FOUND_MESSAGE);
  let message = `${name} failed (${res.status})`;
  try {
    const errBody = await res.json();
    if (errBody?.error) message = errBody.error;
  } catch {
    /* non-JSON error body */
  }
  throw new PrintApiError(res.status, message);
};

// Gateway/overload statuses worth retrying — including a Netlify function's own
// invocation-timeout response (502/504), which a heavy single part can still hit
// occasionally; 408/0 are this client's own timeout/network-drop markers.
const TRANSIENT_STATUSES = new Set([502, 503, 504, 522, 524, 529, 408, 0]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const postJsonWithRetry = async <T>(
  name: string,
  body: unknown,
  token: string,
  attempts: number,
  timeoutMs: number,
): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try {
      return await postJson<T>(name, body, token, timeoutMs);
    } catch (e) {
      const status = e instanceof PrintApiError ? e.status : -1;
      if (attempt >= attempts || !TRANSIENT_STATUSES.has(status)) throw e;
      const wait = 1000 * 2 ** (attempt - 1);
      console.warn(`[print-export] Transient error from ${name} (${status}) — retrying in ${wait / 1000}s (attempt ${attempt}/${attempts}).`);
      await sleep(wait);
    }
  }
};

/**
 * Ask the render pipeline to build a combined print PDF and return its public URL.
 * Throws if no language is selected or the render fails. See file header for the
 * prepare → part(s) → merge → cleanup pipeline this orchestrates.
 */
export const requestPrintPdf = async (params: RequestPrintPdfParams): Promise<PrintPdfResult> => {
  if (!params.languages.length) throw new Error('Select at least one language.');

  // The render functions require a valid session (they cost credits + write to storage).
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('You must be signed in to generate a print PDF.');

  const base = {
    projectId: params.projectId,
    templateType: params.templateType,
    languages: params.languages,
    pageSize: params.pageSize,
    cover: params.cover,
    back: params.back,
    version: params.version,
    leafletTextPt: params.leafletTextPt,
    leafletHeadingPt: params.leafletHeadingPt,
  };

  const jobId = generateUUID();
  let cleanupNeeded = false;
  try {
    // 1. Prepare — cheap; resolves the manifest and reports how many parts to render.
    params.onProgress?.('Preparing…', 0, 1);
    const prep = await postJsonWithRetry<{ partsTotal: number; labels: string[] }>(
      'render-print-prepare', base, token, 3, 20_000,
    );
    if (!prep.partsTotal) throw new Error('Nothing to render for the selected languages.');
    cleanupNeeded = true;
    const total = prep.partsTotal;

    // 2. Render every part independently — small concurrency pool, so no single function
    // invocation ever has to do more than ONE PDFShift conversion (this is what removes the
    // per-invocation time ceiling that made large multi-language manuals fail before).
    let done = 0;
    const CONCURRENCY = 3;
    let cursor = 0;
    const renderOne = async () => {
      while (cursor < total) {
        const index = cursor++;
        await postJsonWithRetry('render-print-part', { ...base, jobId, partIndex: index }, token, 3, 45_000);
        done += 1;
        params.onProgress?.(prep.labels[index]?.toUpperCase() ?? `part ${index + 1}`, done, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, renderOne));

    // 3. Merge — downloads the rendered parts, stamps page numbers/footers/edge tabs, uploads
    // the final PDF, and records the render.
    params.onProgress?.('Merging…', total, total);
    const merged = await postJsonWithRetry<PrintPdfResult & { render?: unknown }>(
      'render-print-merge', { ...base, jobId }, token, 2, 25_000,
    );
    return { ...merged, render: merged.render ? mapRender(merged.render) : null };
  } finally {
    // Always attempt cleanup once a job has left temp files behind, whether it
    // succeeded or failed — never let it block/throw on the caller's result.
    if (cleanupNeeded) {
      postJson('render-print-cleanup', { projectId: base.projectId, templateType: base.templateType, jobId }, token, 15_000)
        .catch((e) => console.warn('[print-export] Temp-file cleanup failed (non-fatal).', e));
    }
  }
};
