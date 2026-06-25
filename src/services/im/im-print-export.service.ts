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
  subtitle?: string;
  markUrls?: string[];
  companyName?: string;
  footerText?: string;
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
}

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

  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  return res.json();
};
