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
  type PrintLeafletLayout,
} from '../../../src/services/im/im-print-typography';
import { isValidDocCode } from '../../../src/services/im/im-doc-code';
import { assertUuid } from './http';

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
  /**
   * Which LAYOUT to set a Warning Leaflet in — 'classic' (the default, and what every leaflet
   * has printed in so far) or 'compact2col' (the dense two-column A5 booklet).
   *
   * Chosen per export in the print dialog. Like `mergeToc` this MUST be identical across the
   * prepare/part/merge calls of one job, which it is: the client sends one shared `base`.
   * Ignored for full IMs.
   */
  leafletLayout?: PrintLeafletLayout;
  /**
   * The document code (e.g. `WL-RAN-ANGLED-8MJ-A5`) — printed in the footer and used in the
   * download filename, so a leaflet on a pallet can be identified from the code plus the
   * version alone. Built in the browser by `buildDocCode` (src/services/im/im-doc-code.ts),
   * which needs the category's L2/L3 names that the render functions have no reason to load.
   *
   * NOT trusted as sent: it is stamped onto a safety document, so `resolveDocCode` below
   * range-checks it against DOC_CODE_RE and drops anything else rather than printing it.
   */
  docCode?: string;
  /**
   * Continue the first content section on the TOC page (saves a page per language).
   * Chosen per export in the print dialog; the IM_PRINT_MERGE_TOC env flag still
   * forces it on server-wide. MUST be identical across the prepare/part/merge calls
   * of one job (the client sends one shared base), or the parts would disagree on
   * page counts.
   */
  mergeToc?: boolean;
  /**
   * DRAFT mode — a throwaway render straight from the template editor, before any project
   * exists. Three things change; everything else (HTML builder, typography, stamping,
   * merging, page size) is byte-for-byte the production path, which is the whole point:
   *
   *   1. The manuals come from `manual-<lang>.json` files the editor uploaded into this
   *      job's tmp prefix, NOT from a published manifest (there is nothing published).
   *   2. `projectId` is a namespace string (`draft-<templateId>`), not a real project id.
   *      Nothing is written to im_print_renders, so it is never used as a foreign key.
   *   3. The merged PDF lands inside the job's tmp prefix, so the existing cleanup call
   *      deletes it — a draft leaves no artifact and no history row behind.
   *
   * Trusted from the client the same way `cover`/`typography` already are: this is an
   * internal, authenticated tool, and the only thing `draft` can do is produce a PDF that
   * is NOT recorded. It cannot read another project's data (the manuals are supplied, not
   * fetched) and it cannot overwrite a real render (tmp path).
   */
  draft?: boolean;
  /**
   * The client-generated job id. Carried on EVERY call in the pipeline — `part` and `merge`
   * have always needed it for their temp paths, and a draft `prepare` needs it too, since
   * that is where the uploaded manuals live. Still validated as required by part/merge.
   */
  jobId?: string;
}

export const BUCKET = 'im-print';
const PDFSHIFT_ENDPOINT = 'https://api.pdfshift.io/v3/convert/pdf';

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
    (r.typography === undefined || (typeof r.typography === 'object' && r.typography !== null)) &&
    (r.mergeToc === undefined || typeof r.mergeToc === 'boolean') &&
    (r.leafletLayout === undefined || r.leafletLayout === 'classic' || r.leafletLayout === 'compact2col') &&
    (r.docCode === undefined || isValidDocCode(r.docCode)) &&
    (r.draft === undefined || typeof r.draft === 'boolean') &&
    (r.jobId === undefined || typeof r.jobId === 'string')
  );
};

/**
 * Validate + classify a print-pipeline `projectId`. Two shapes are legal:
 *
 *   - a real project UUID (a production render) — `projects` carries PM-scoped RLS
 *     (db_migrations/81_pm_scoped_rls_v2.sql), so this is what `authorizeProject`
 *     (lib/http.ts) checks the caller against.
 *   - `draft-<uuid>` (see RenderRequestBase.draft above) — a storage NAMESPACE for a
 *     throwaway template-editor preview, never a row in `projects`. There is nothing to
 *     authorize a draft against beyond "is this caller signed in" (`im_templates` RLS
 *     already grants every authenticated account full access — db_migrations/46), which
 *     is why the four render-print-*.ts handlers call plain `authenticate` instead of
 *     `authorizeProject` for this shape.
 *
 * The shape is classified HERE from the string itself, deliberately NOT from the
 * client-supplied `draft` flag: a caller cannot claim `draft: true` while pointing
 * `projectId` at a real project's UUID to dodge `authorizeProject`, because that
 * shape is classified as a production id regardless of what `draft` says (and a
 * caller cannot claim a real project by putting its UUID after `draft-`, because
 * that string never equals a `projects.id`).
 */
export const assertRenderProjectId = (projectId: unknown): { value: string; isDraft: boolean } => {
  if (typeof projectId === 'string' && /^draft-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(projectId)) {
    return { value: projectId, isDraft: true };
  }
  return { value: assertUuid(projectId, 'projectId'), isDraft: false };
};

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
  // Layout-independent on purpose: both leaflet layouts are set from the operator's single
  // (warning_leaflet, page size) profile, so the compact layout can never drift to a different
  // size than the classic one and one admin change moves both.
  normalizePrintTypography(req.typography, defaultTypographyFor(req.templateType, req.pageSize));

/**
 * The leaflet layout this request renders in. `classic` for anything that is not a leaflet,
 * so the layout can never change a full manual.
 */
export const leafletLayoutOf = (req: RenderRequestBase): PrintLeafletLayout =>
  req.templateType === 'warning_leaflet' && req.leafletLayout === 'compact2col' ? 'compact2col' : 'classic';

/**
 * The leaflet's single last-page line: copyright, then the publish version.
 *
 * Assembled from segments and joined rather than interpolated, because interpolation is how
 * the shipped v8 booklet came to read "© 2026 . All rights reserved." — the leaflet dialog
 * offers no cover fields, so `cover.companyName` is always empty for a leaflet and the
 * template blank was printed as a literal hole. A missing segment now drops out with its
 * separator instead of leaving stray punctuation.
 */
export const buildCopyrightLine = (opts: {
  year: number;
  companyName?: string;
  version?: number;
  docCode?: string;
}): string => {
  const company = opts.companyName?.trim();
  return [
    company ? `© ${opts.year} ${company}. All rights reserved.` : `© ${opts.year}. All rights reserved.`,
    // Code before version: the code says WHICH document, the version says WHICH revision of
    // it, and that is the order someone reads them in when identifying a printed leaflet.
    isValidDocCode(opts.docCode) ? opts.docCode : '',
    opts.version ? `v${opts.version}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
};

/** The document code to print, or '' when none was sent or it failed validation. */
export const resolveDocCode = (req: RenderRequestBase): string =>
  isValidDocCode(req.docCode) ? req.docCode : '';

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

const PUBLISHED_BUCKET = 'im-published';

/**
 * Fetch the published manifest + each requested language's ResolvedManual JSON.
 *
 * Reads through the SERVICE-ROLE storage client rather than over a public URL. This used to
 * build `<base>/storage/v1/object/public/im-published/...` by hand and plain-`fetch` it,
 * which meant the entire print pipeline (prepare + part + merge all call this via
 * `loadManuals`) would break the moment the `im-published` bucket is flipped private.
 * A service-role download is unaffected by the bucket's public/private flag.
 *
 * The manifest still stores a permanent public `url` per language — that field is an
 * external contract we deliberately keep writing — so those URLs are converted back to
 * object paths here instead of being fetched directly.
 */
export const fetchManifestAndManuals = async (
  supabase: SupabaseClient,
  req: RenderRequestBase,
): Promise<{ manuals: PrintManual[]; ordered: string[] }> => {
  const downloadJson = async <T>(path: string): Promise<T> => {
    const { data, error } = await supabase.storage.from(PUBLISHED_BUCKET).download(path);
    if (error || !data) {
      throw new Error(`Could not read ${PUBLISHED_BUCKET}/${path}: ${error?.message ?? 'no data returned'}`);
    }
    return JSON.parse(await data.text()) as T;
  };

  /** `.../object/public/im-published/<path>` (or an already-bare path) -> `<path>`. */
  const toObjectPath = (url: string): string => {
    const marker = `/${PUBLISHED_BUCKET}/`;
    const i = url.indexOf(marker);
    const path = i === -1 ? url : url.slice(i + marker.length);
    return path.replace(/^\/+/, '').split('?')[0];
  };

  const manifest = await downloadJson<{ languages: Array<{ lang: string; url: string }> }>(
    `${req.projectId}/${req.templateType}/manifest.json`,
  );
  const byLang = new Map(manifest.languages.map((l) => [l.lang, l.url]));

  const ordered = req.languages.filter((l) => byLang.has(l));
  if (!ordered.length) throw new PermanentError('None of the requested languages are published for this IM.');

  const manuals: PrintManual[] = [];
  for (const lang of ordered) manuals.push(await downloadJson<PrintManual>(toObjectPath(byLang.get(lang)!)));
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
    leafletLayout: leafletLayoutOf(req),
    typography: resolveTypography(req),
    // Per-export choice from the print dialog; the server-side IM_PRINT_MERGE_TOC flag
    // still forces it on fleet-wide. Saves a page per language by letting content continue
    // on the TOC page, at the cost of the clean "contents, then the manual" separation.
    mergeTocIntoContent: req.mergeToc === true || flagEnabled(process.env.IM_PRINT_MERGE_TOC),
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

// ---------------------------------------------------------------------------
// Draft renders (template editor). See RenderRequestBase.draft.
//
// A draft's inputs and output both live INSIDE the job's tmp prefix, which is what
// makes it discardable for free: the cleanup call every job already makes in a
// `finally` block lists that one prefix and removes everything in it — the uploaded
// manuals and the merged PDF alike. No new cleanup path, no orphan sweeper.
// ---------------------------------------------------------------------------

/** Where the editor uploads one language's resolved manual for a draft render. */
export const draftManualPath = (
  projectId: string,
  templateType: string,
  jobId: string,
  language: string,
): string => `${tempJobPrefix(projectId, templateType, jobId)}/manual-${language}.json`;

/** Where a draft's merged PDF is written — inside the job prefix, so cleanup deletes it. */
export const draftPdfPath = (projectId: string, templateType: string, jobId: string): string =>
  `${tempJobPrefix(projectId, templateType, jobId)}/draft.pdf`;

/**
 * A draft job's manuals, read back from the files the editor uploaded. Order is the
 * client's requested language order verbatim — unlike the published path there is no
 * manifest to intersect against, so nothing can be silently dropped.
 */
const fetchDraftManuals = async (
  supabase: SupabaseClient,
  req: RenderRequestBase,
): Promise<{ manuals: PrintManual[]; ordered: string[] }> => {
  if (!req.jobId) throw new PermanentError('A draft render requires a jobId.');
  const manuals: PrintManual[] = [];
  for (const lang of req.languages) {
    const path = draftManualPath(req.projectId, req.templateType, req.jobId, lang);
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error || !data) {
      // Log the storage path server-side only — it is an internal detail (bucket layout,
      // job namespace), not something a client error message should echo back.
      console.error(`[print-render-shared] draft manual download failed (${path}):`, error);
      throw new PermanentError(
        `The draft manual for ${lang.toUpperCase()} is missing. Every selected language ` +
        'must be uploaded before rendering — close the dialog and try again.',
      );
    }
    try {
      manuals.push(JSON.parse(await data.text()) as PrintManual);
    } catch (e) {
      console.error(`[print-render-shared] draft manual is not valid JSON (${path}):`, e);
      throw new PermanentError(`The draft manual for ${lang.toUpperCase()} is not valid JSON.`);
    }
  }
  return { manuals, ordered: [...req.languages] };
};

/**
 * The manuals this request renders — a draft job's uploaded ones, or the published
 * manifest's. Every step of the pipeline goes through here so draft and production
 * renders provably share the builder, the typography and the stamping below it.
 */
export const loadManuals = async (
  supabase: SupabaseClient,
  req: RenderRequestBase,
): Promise<{ manuals: PrintManual[]; ordered: string[] }> =>
  req.draft ? fetchDraftManuals(supabase, req) : fetchManifestAndManuals(supabase, req);

// ---------------------------------------------------------------------------
// Placeholder wizard registry gate (migrations 142/143). See render-print-prepare.ts's
// third check.
// ---------------------------------------------------------------------------

export interface PendingRegulatoryAnswer {
  /** category_attributes.id or im_adhoc_placeholders.placeholder_id. */
  key: string;
  label: string;
}

/**
 * Every regulatory-tier placeholder wizard question for this project+template that has no
 * ANSWERED/NOT_APPLICABLE project-scope row yet in `im_placeholder_answers`.
 *
 * Queries live answer-store state directly rather than scanning resolved HTML: an unanswered
 * chip leaves no scannable artifact once resolved (`resolveLegacyChips` replaces it with
 * label text or nothing), unlike a literal `{{token}}`, so this can't reuse
 * `findUnresolvedTokens` the way check 2 does.
 *
 * Deliberately does NOT go through `src/data`'s `db` port / `getWizardQuestions` — that
 * composition root binds to the BROWSER Supabase client (Vite env vars, `isLive` gated), which
 * is not what this Netlify Function runs with. Every query here uses the SERVICE-ROLE
 * `supabase` client already constructed by the caller, the same one the two checks above
 * query through.
 *
 * Also does not use `DOMParser` (no DOM in this runtime, unlike `im-content.utils.ts`'s
 * section scanner): an attribute-bound placeholder's containment in a section is checked by
 * a cheap string/JSON search instead of a real HTML parse — safe here because the search is
 * membership-only ("does this known attribute id appear anywhere in these sections"), not
 * full extraction of an unknown set of ids.
 */
export const findPendingRegulatoryAnswers = async (
  supabase: SupabaseClient,
  projectId: string,
  templateType: 'im' | 'warning_leaflet',
): Promise<PendingRegulatoryAnswer[]> => {
  // FAIL CLOSED: this is a compliance gate, not an advisory one. category_attributes.wizard_tier
  // (migration 142) and im_placeholder_answers (migration 143) are NOT applied in every
  // environment yet — before this fix, an error reading either of those (a missing column, a
  // missing table) resulted in `data` being undefined, `?? []` turning that into an empty
  // result, and the gate silently reporting "nothing pending" for every project. Every read
  // below is therefore checked for `error` and thrown as a real exception (mapped to a 5xx by
  // the caller — see render-print-prepare.ts) rather than treated as "no rows".
  const { data: projectIm, error: projectImErr } = await supabase
    .from('project_ims')
    .select('id, template_id')
    .eq('project_id', projectId)
    .eq('template_type', templateType)
    .maybeSingle();
  if (projectImErr) throw new Error(`Could not read project_ims for the regulatory gate: ${projectImErr.message}`);
  // No manual saved yet for this project+type — nothing to gate here; checks 1/2 above
  // already require a publish to exist before this point is ever reached in practice.
  if (!projectIm) return [];

  const projectImId = projectIm.id as string;
  const templateId = projectIm.template_id as string;

  const { data: templateRow, error: templateErr } = await supabase
    .from('im_templates')
    .select('category_id')
    .eq('id', templateId)
    .maybeSingle();
  if (templateErr) throw new Error(`Could not read im_templates for the regulatory gate: ${templateErr.message}`);
  const categoryId = (templateRow?.category_id as string | null | undefined) ?? null;

  const [
    { data: sections, error: sectionsErr },
    { data: adhocRows, error: adhocErr },
    { data: attrRows, error: attrErr },
  ] = await Promise.all([
    supabase.from('im_sections').select('content, block_refs').eq('template_id', templateId),
    supabase
      .from('im_adhoc_placeholders')
      .select('placeholder_id, label')
      .eq('template_id', templateId)
      .eq('wizard_tier', 'regulatory'),
    supabase.from('category_attributes').select('id, name, category_id, assigned_category_ids').eq('wizard_tier', 'regulatory'),
  ]);
  if (sectionsErr) throw new Error(`Could not read im_sections for the regulatory gate: ${sectionsErr.message}`);
  if (adhocErr) throw new Error(`Could not read im_adhoc_placeholders for the regulatory gate: ${adhocErr.message}`);
  if (attrErr) throw new Error(`Could not read category_attributes for the regulatory gate: ${attrErr.message}`);

  // Regulatory-tier attributes actually usable by this category — mirrors
  // getAttributesForCategory's filter (global, owned, or shared-in) without pulling the
  // browser-side attribute-validation util into a Netlify Function.
  const candidateAttrs = (attrRows ?? []).filter(
    (a: any) => a.category_id === categoryId || a.category_id === null || (a.assigned_category_ids ?? []).includes(categoryId),
  );

  // Membership check: does this attribute id appear as a chip (`data-id="…"`) or a
  // `{{token}}` anywhere in the template's sections? A raw JSON/string search over the
  // section rows, not a DOM parse — see the doc comment above for why that is safe here.
  const haystack = JSON.stringify(sections ?? []);
  const referencedAttrs = candidateAttrs.filter(
    (a: any) => haystack.includes(`"${a.id}"`) || haystack.includes(`{{${a.id}}}`) || haystack.includes(`{{ ${a.id} }}`),
  );

  const candidates: PendingRegulatoryAnswer[] = [
    ...referencedAttrs.map((a: any) => ({ key: a.id as string, label: (a.name as string) ?? a.id })),
    ...(adhocRows ?? []).map((p: any) => ({ key: p.placeholder_id as string, label: (p.label as string) || p.placeholder_id })),
  ];
  if (!candidates.length) return [];

  const { data: answerRows, error: answersErr } = await supabase
    .from('im_placeholder_answers')
    .select('placeholder_key, status')
    .eq('project_im_id', projectImId)
    .eq('scope', 'project');
  if (answersErr) throw new Error(`Could not read im_placeholder_answers for the regulatory gate: ${answersErr.message}`);
  const settledKeys = new Set(
    (answerRows ?? []).filter((r: any) => r.status !== 'pending').map((r: any) => r.placeholder_key as string),
  );

  return candidates.filter((c) => !settledKeys.has(c.key));
};
