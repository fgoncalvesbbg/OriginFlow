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
 *
 * TWO entry points share that pipeline:
 *   - requestPrintPdf      — the production export of a PUBLISHED project IM. Recorded in
 *                            im_print_renders, stored permanently, gated on published
 *                            languages and on having no unresolved values.
 *   - requestDraftPrintPdf — a THROWAWAY render of a template being authored, with no
 *                            project in existence. Same builder and same house typography,
 *                            but fed from manuals the browser resolved, recorded nowhere,
 *                            and returned as a blob whose server-side copy is deleted
 *                            immediately. See its own section header at the bottom.
 */

import { auth, db, orEmpty, storage, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { generateUUID } from '../../utils';
import type { IMTemplateType } from '../../types';
import type { PrintTypography, PrintLeafletLayout } from './im-print-typography';
import { flagEnabled } from './feature-flags';

const BUCKET = 'im-print';
const FN_BASE = '/.netlify/functions';

/** Whether the print-PDF export feature is enabled (server secrets configured). */
export const isPrintExportAvailable = (): boolean =>
  flagEnabled(import.meta.env.VITE_PRINT_EXPORT_ENABLED as string | undefined);

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
  /**
   * Pages in this render, total and per language. NULL on rows written before migration 124,
   * which is why both are nullable — "not measured" must not read as zero pages. Comparing
   * these across two renders is the page-budget diff: it is how a template change that adds
   * pages across five languages becomes visible before the file reaches a print vendor.
   */
  pages: number | null;
  pagesByLanguage: Record<string, number> | null;
  createdBy: string | null;
  createdAt: string;
  /** Required change note captured when this PDF was generated. '' for legacy rows. */
  comment: string;
  /** im_markets.code this booklet was produced for (market preset), or null for ad-hoc. */
  market: string | null;
  /**
   * Which leaflet layout this PDF was set in — DERIVED from `storagePath`, never stored.
   *
   * im_print_renders has no layout column, and the render rows are immutable history, so
   * there is nothing to backfill: every row written before the compact layout existed reads
   * as 'classic', which is exactly what it is. See `layoutOfStoragePath`.
   */
  layout: PrintLeafletLayout;
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
  /** Required change note describing this generation; shown in the export history. */
  comment: string;
  /** im_markets.code this booklet is produced for (from the dialog's market preset). */
  market?: string;
  /**
   * The global print typography for this template type and page size (Admin → IM Print):
   * font family, body/heading point sizes, line spacing, page margins. Resolved by the
   * caller and passed through to every step of the pipeline so the cover, each language
   * body and the merged footer are all set identically. Omit to let the render functions
   * fall back to the built-in default for the combination.
   */
  typography?: PrintTypography;
  /**
   * Let the first content section continue on the table-of-contents page instead of
   * forcing a fresh sheet — saves one page per language (see im-print-html.ts,
   * mergeTocIntoContent). Off = the classic "contents, then the manual" separation.
   */
  mergeToc?: boolean;
  /**
   * Which layout to set a Warning Leaflet in — 'classic' (default) or 'compact2col', the
   * dense two-column A5 booklet. Ignored for full manuals. A layout is a render choice, not
   * a document type: same template, same content, same translations, same coverage issue.
   */
  leafletLayout?: PrintLeafletLayout;
  /**
   * The document code printed in the footer and used in the download filename, e.g.
   * `WL-RAN-ANGLED-8MJ-A5`. Built by `buildDocCode` (./im-doc-code) from the template's
   * category, which is why it is resolved here and not in the render functions — they have no
   * reason to load the category tree. Validated server-side before it reaches the PDF.
   */
  docCode?: string;
  /** Progress reporter — called as each part finishes, e.g. "Rendering DE (3/12)…". */
  onProgress?: (label: string, done: number, total: number) => void;
}

/**
 * Warn-only checks the merge step runs on the finished PDF. Nothing here blocks an export —
 * the operator gets the file plus the report, because a false positive must never stop
 * production. `nonEmbeddedFonts` being non-empty is the one that fails a print vendor's
 * preflight outright.
 */
export interface PrintPreflightReport {
  fonts: { name: string; embedded: boolean }[];
  nonEmbeddedFonts: string[];
  /** Distance from the trimmed edge to the lowest stamped ink, in mm; null for leaflets. */
  footerInkClearanceMm: number | null;
  minInkClearanceMm: number;
  bottomMarginTooThin: boolean;
  unsupportedStampCharacters: string[];
}

export interface PrintPdfResult {
  url: string;
  storagePath: string;
  bytes?: number;
  /** Total pages in the merged booklet, cover and back matter included. */
  pages?: number;
  /** Language code → pages in that language's body. The basis for the page-budget diff. */
  pagesByLanguage?: Record<string, number>;
  preflight?: PrintPreflightReport;
  render?: PrintRender | null;
  /** Non-fatal server-side problem (e.g. the history row could not be recorded). */
  warning?: string;
}

/**
 * The layout a stored render was produced in, read back out of its storage path.
 *
 * The merge step writes `warning_leaflet-compact2col-<langs>-<size>-v<n>-<job>.pdf` for the
 * compact layout and leaves the classic name exactly as it always was, so this is a total
 * function over every row ever written — old rows have no token and are classic.
 *
 * Path-derived rather than a column on purpose: the alternative is a migration that has to be
 * applied before the feature works at all, against a table whose rows are append-only history
 * that would need no backfill anyway. Promote it to a real column when something needs to
 * QUERY by layout; reading it per row does not.
 */
export const layoutOfStoragePath = (storagePath: string | null | undefined): PrintLeafletLayout =>
  /\/warning_leaflet-compact2col-/.test(storagePath ?? '') ? 'compact2col' : 'classic';

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
  pages: r.pages ?? null,
  pagesByLanguage: r.pages_by_language ?? null,
  createdBy: r.created_by ?? null,
  createdAt: r.created_at,
  comment: r.comment ?? '',
  market: r.market ?? null,
  layout: layoutOfStoragePath(r.storage_path),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Render history for a project IM, newest first. */
export const getPrintRenders = async (
  projectId: string,
  templateType: IMTemplateType,
): Promise<PrintRender[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('im_print_renders', {
      where: { project_id: projectId, template_type: templateType },
      order: { column: 'created_at', ascending: false },
    }),
    '[im-print-export] getPrintRenders',
  );
  return rows.map(mapRender);
};

/** The newest print render's version/date, keyed `${projectId}::${templateType}`. */
export interface LatestRenderInfo {
  imVersion: number | null;
  createdAt: string;
}

/**
 * Newest render per manual, across ALL projects — the dashboard's print-freshness
 * signal ("printed v3, current v5" / "never printed"). One lean query; the map is
 * first-seen-wins over a created_at-descending scan.
 */
export const getLatestRendersByManual = async (): Promise<Map<string, LatestRenderInfo>> => {
  const out = new Map<string, LatestRenderInfo>();
  if (!isLive) return out;
  const rows = await orEmpty(
    db.select<Row>('im_print_renders', {
      columns: 'project_id, template_type, im_version, created_at',
      order: { column: 'created_at', ascending: false },
    }),
    '[im-print-export] getLatestRendersByManual',
  );
  for (const r of rows as any[]) {
    const key = `${r.project_id}::${r.template_type ?? 'im'}`;
    if (!out.has(key)) out.set(key, { imVersion: r.im_version ?? null, createdAt: r.created_at });
  }
  return out;
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
  return storage.publicUrl(BUCKET, path);
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

/** What `render-print-prepare` reports back before any PDFShift credit is spent. */
interface PreparedJob {
  partsTotal: number;
  labels: string[];
  /** Advisory notes (draft renders only) — see render-print-prepare's token gate. */
  warnings?: string[];
}

/**
 * Run one render job end to end: prepare → part(s) → merge → cleanup.
 *
 * `afterMerge` runs INSIDE the try, i.e. BEFORE cleanup deletes the job's temp prefix —
 * which is what lets a draft render pull its throwaway PDF into a blob while the object
 * still exists. Shared by the production and draft entry points below so the two provably
 * agree on part ordering, retry policy and concurrency; only their inputs and what they do
 * with the merged result differ.
 */
const runRenderJob = async <T>(
  base: Record<string, unknown> & { projectId: string; templateType: IMTemplateType },
  token: string,
  jobId: string,
  onProgress: RequestPrintPdfParams['onProgress'],
  beforePrepare: (() => Promise<void>) | undefined,
  afterMerge: (merged: PrintPdfResult & { render?: unknown }, prep: PreparedJob) => Promise<T>,
): Promise<T> => {
  let cleanupNeeded = false;
  try {
    // A draft uploads its resolved manuals into the job prefix here — so cleanup must run
    // even if prepare never gets that far, hence the flag is set before the hook.
    if (beforePrepare) {
      cleanupNeeded = true;
      await beforePrepare();
    }

    // 1. Prepare — cheap; resolves the manifest and reports how many parts to render.
    onProgress?.('Preparing…', 0, 1);
    const prep = await postJsonWithRetry<PreparedJob>('render-print-prepare', base, token, 3, 20_000);
    if (!prep.partsTotal) throw new Error('Nothing to render for the selected languages.');
    cleanupNeeded = true;
    const total = prep.partsTotal;

    // 2. Render every part independently — small concurrency pool, so no single function
    // invocation ever has to do more than ONE PDFShift conversion (this is what removes the
    // per-invocation time ceiling that made large multi-language manuals fail before).
    let done = 0;
    const CONCURRENCY = 3;
    let cursor = 0;
    // Set as soon as ANY part fails for good: sibling workers stop picking up new parts,
    // so a doomed job doesn't keep spending PDFShift credits on output that cleanup will
    // delete. (Parts already in flight still finish — aborting them mid-request isn't
    // worth the plumbing; the point is not to START more.)
    let jobFailed = false;
    const renderOne = async () => {
      while (!jobFailed && cursor < total) {
        const index = cursor++;
        try {
          await postJsonWithRetry('render-print-part', { ...base, jobId, partIndex: index }, token, 3, 45_000);
        } catch (e) {
          jobFailed = true;
          throw e;
        }
        done += 1;
        onProgress?.(prep.labels[index]?.toUpperCase() ?? `part ${index + 1}`, done, total);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, renderOne));

    // 3. Merge — downloads the rendered parts, stamps page numbers/footers/edge tabs, uploads
    // the final PDF, and records the render.
    onProgress?.('Merging…', total, total);
    const merged = await postJsonWithRetry<PrintPdfResult & { render?: unknown }>(
      'render-print-merge', { ...base, jobId }, token, 2, 25_000,
    );
    return await afterMerge(merged, prep);
  } finally {
    // Always attempt cleanup once a job has left temp files behind, whether it
    // succeeded or failed — never let it block/throw on the caller's result.
    if (cleanupNeeded) {
      postJson('render-print-cleanup', { projectId: base.projectId, templateType: base.templateType, jobId }, token, 15_000)
        .catch((e) => console.warn('[print-export] Temp-file cleanup failed (non-fatal).', e));
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
  const session = await auth.getSession();
  const token = session?.accessToken;
  if (!token) throw new Error('You must be signed in to generate a print PDF.');

  const base = {
    projectId: params.projectId,
    templateType: params.templateType,
    languages: params.languages,
    pageSize: params.pageSize,
    cover: params.cover,
    back: params.back,
    version: params.version,
    comment: params.comment,
    market: params.market,
    typography: params.typography,
    mergeToc: params.mergeToc,
    leafletLayout: params.leafletLayout,
    docCode: params.docCode,
  };

  return runRenderJob(base, token, generateUUID(), params.onProgress, undefined, async (merged) => ({
    ...merged,
    render: merged.render ? mapRender(merged.render) : null,
  }));
};

// ===========================================================================
// Draft renders — "how does this template actually print?", before a project exists
//
// The template editor has an on-screen preview, but the thing that decides whether a
// template is publishable is the PRINTED page: where sections break, how tables set at
// 6pt, whether the leaflet still fits its sheet. That answer used to require creating a
// project, generating an IM, publishing it and exporting — so template work was tuned
// against the HTML preview and the surprises arrived at the end.
//
// A draft render is the SAME pipeline (same HTML builder, same global typography, same
// stamping and merging, same page size) fed from manuals the editor resolves in the
// browser instead of from a published manifest. What it deliberately does NOT do is
// persist: no im_print_renders row, no permanent object, no project. The PDF comes back
// as an in-browser blob and the server-side copy is deleted by the job's own cleanup.
// ===========================================================================

/** One language's resolved manual, serialized exactly as publish would have written it. */
export interface DraftManualInput {
  language: string;
  /** `JSON.stringify(resolveManual(...))` — the same artifact shape publish uploads. */
  json: string;
}

export interface RequestDraftPrintPdfParams {
  /**
   * The template being previewed. Only namespaces the throwaway job's storage prefix —
   * a draft never touches a project row, so no project id is needed or accepted.
   */
  templateId: string;
  templateType: IMTemplateType;
  /** Resolved manuals in booklet order; their languages become the booklet's languages. */
  manuals: DraftManualInput[];
  pageSize: 'a4' | 'a5';
  cover: PrintCoverInput;
  back: PrintBackInput;
  /** The global print typography (Admin → IM Print) for this template type + page size. */
  typography?: PrintTypography;
  /** Continue the first section on the TOC page (full manuals only). */
  mergeToc?: boolean;
  /** Leaflet layout to preview — 'classic' (default) or 'compact2col'. */
  leafletLayout?: PrintLeafletLayout;
  /** Document code for the footer + filename (see RequestPrintPdfParams.docCode). */
  docCode?: string;
  onProgress?: (label: string, done: number, total: number) => void;
}

export interface DraftPrintPdfResult {
  /**
   * Blob URL of the PDF, held only by this browser tab. The server-side object is already
   * gone by the time this resolves, which is the point — a draft is discardable by
   * construction rather than by remembering to delete it. Revoke it when done.
   */
  blobUrl: string;
  /** Filename to save it under — the same "SKU - Name - Instruction Manual.pdf" the real export uses. */
  filename: string;
  bytes: number;
  pages?: number;
  pagesByLanguage?: Record<string, number>;
  preflight?: PrintPreflightReport;
  /**
   * Advisory notes from the prepare step — chiefly the unresolved `{{tokens}}` a project
   * would fill in. These BLOCK a production export and only warn here: a bare template is
   * missing per-project values by definition, so refusing would refuse every draft.
   */
  warnings: string[];
}

/**
 * Storage namespace for a draft job. Not a project id — `draft-` prefixed so it can never
 * collide with the real `{projectId}/…` trees in this bucket, and so an orphaned temp file
 * is identifiable at a glance.
 */
const draftNamespace = (templateId: string): string => `draft-${templateId}`;

/**
 * Where the editor puts one language's manual for the render functions to read.
 *
 * MUST match `draftManualPath` in netlify/functions/lib/print-render-shared.ts — the two
 * sides never see each other's code, and a disagreement here fails every draft render with
 * a "draft manual is missing" that points nowhere useful. Exported so a test can hold the
 * two builders against each other; not part of the module's real API.
 */
export const draftManualStoragePath = (
  templateId: string,
  templateType: IMTemplateType,
  jobId: string,
  language: string,
): string => `tmp/${draftNamespace(templateId)}/${templateType}/${jobId}/manual-${language}.json`;

/** The `?download=` name the merge step attached, so a blob save keeps the real filename. */
const downloadNameFromUrl = (url: string, fallback: string): string => {
  try {
    return new URL(url).searchParams.get('download') || fallback;
  } catch {
    return fallback;
  }
};

/**
 * Render a throwaway print PDF of an unsaved/unpublished template. See the section header
 * above for why this exists and what it deliberately does not persist.
 *
 * Costs exactly what a real export costs (one PDFShift conversion per part) — callers must
 * say so in the UI rather than presenting it as free.
 */
export const requestDraftPrintPdf = async (
  params: RequestDraftPrintPdfParams,
): Promise<DraftPrintPdfResult> => {
  if (!params.manuals.length) throw new Error('Select at least one language.');

  const session = await auth.getSession();
  const token = session?.accessToken;
  if (!token) throw new Error('You must be signed in to generate a print PDF.');

  const jobId = generateUUID();
  const languages = params.manuals.map((m) => m.language);
  const base = {
    // Namespace, not a project — nothing is recorded against it (see RenderRequestBase.draft).
    projectId: draftNamespace(params.templateId),
    templateType: params.templateType,
    draft: true,
    jobId,
    languages,
    pageSize: params.pageSize,
    cover: params.cover,
    back: params.back,
    typography: params.typography,
    mergeToc: params.mergeToc,
    leafletLayout: params.leafletLayout,
    docCode: params.docCode,
  };

  // Upload the manuals into the job's own temp prefix, where cleanup will remove them
  // alongside the rendered parts. Sent via storage rather than in the request body on
  // purpose: a multi-language book's manuals would blow past the function's body limit,
  // and every step of the pipeline needs to read them, not just the first.
  const uploadManuals = async () => {
    params.onProgress?.('Uploading draft…', 0, params.manuals.length);
    let uploaded = 0;
    await Promise.all(
      params.manuals.map(async (m) => {
        const path = draftManualStoragePath(params.templateId, params.templateType, jobId, m.language);
        try {
          await storage.upload(BUCKET, path, m.json, {
            upsert: true,
            contentType: 'application/json',
            cacheControl: '0',
          });
        } catch (e) {
          throw new Error(`Could not stage the ${m.language.toUpperCase()} draft: ${(e as Error).message}`);
        }
        uploaded += 1;
        params.onProgress?.('Uploading draft…', uploaded, params.manuals.length);
      }),
    );
  };

  return runRenderJob(base, token, jobId, params.onProgress, uploadManuals, async (merged, prep) => {
    // Pull the bytes in NOW: this runs before the job's cleanup deletes the temp object,
    // and the blob is the only copy that outlives this call.
    params.onProgress?.('Downloading…', 1, 1);
    const res = await fetch(merged.url);
    if (!res.ok) throw new Error(`Could not download the draft PDF (${res.status}).`);
    const blob = await res.blob();
    const fallback = `${params.templateType === 'warning_leaflet' ? 'Warning Leaflet' : 'Instruction Manual'} (draft).pdf`;
    return {
      blobUrl: URL.createObjectURL(blob),
      filename: downloadNameFromUrl(merged.url, fallback),
      bytes: blob.size,
      pages: merged.pages,
      pagesByLanguage: merged.pagesByLanguage,
      preflight: merged.preflight,
      warnings: prep.warnings ?? [],
    };
  });
};
