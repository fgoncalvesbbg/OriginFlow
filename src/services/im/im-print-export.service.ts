/**
 * Print-export client — calls the render-print-pdf Netlify Function, which turns the published
 * ResolvedManual(s) into a combined, print-shop-ready PDF (A4/A5, bleed + crop marks, vector text)
 * via a hosted print engine and uploads it to the im-print bucket.
 *
 * The function needs server-only secrets (DocRaptor + Supabase service role). Since the browser
 * can't see those, the button is gated on the public flag VITE_PRINT_EXPORT_ENABLED ("true"), which
 * you set alongside the server secrets. When unset the UI hides the feature (app unaffected).
 * Rendering is decoupled from publishing — this is called on demand, never as part of Generate.
 */

import { supabase } from '../core/supabase.client';
import { isLive } from '../../config/environment.config';
import type { IMTemplateType } from '../../types';

const BUCKET = 'im-print';
const ENDPOINT = '/.netlify/functions/render-print-pdf';

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

/**
 * Ask the render function to build a combined print PDF and return its public URL.
 * Throws if no language is selected or the render fails.
 */
export const requestPrintPdf = async (params: RequestPrintPdfParams): Promise<PrintPdfResult> => {
  if (!params.languages.length) throw new Error('Select at least one language.');

  // The render function requires a valid session (it costs credits + writes to storage).
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('You must be signed in to generate a print PDF.');

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    let message = `Print render failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }

  // The function returns the freshly-inserted DB row (snake_case) under `render`.
  // Normalize it through mapRender so callers get a proper camelCase PrintRender —
  // otherwise `render.pageSize` etc. are undefined and crash the history list.
  const body = (await res.json()) as PrintPdfResult & { render?: unknown };
  return { ...body, render: body.render ? mapRender(body.render) : null };
};
