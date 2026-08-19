/**
 * Print preflight — image weight check.
 *
 * Supplier images go into the print HTML at their original stored size; one 8 MB
 * PNG makes PDFShift slow (or time out — a wasted 422 under the pipeline's
 * permanent-failure rules) and bloats the booklet PDF for every language it
 * appears in. This preflight reads the PUBLISHED resolved-manual JSONs (public
 * bucket, no auth), collects every image URL with the sections/languages using
 * it, and HEAD-requests each unique URL for its Content-Length.
 *
 * Best-effort by design: a CORS-blocked HEAD (external image) or a missing
 * Content-Length yields bytes=null ("size unknown") rather than an error, and
 * callers treat the whole check as advisory — it never blocks a render.
 */

import type { IMTemplateType, ResolvedManual } from '../../types';
import { getPublishedManualUrl } from './im-publish.service';

/** Flag images at or above this many bytes (1 MB). */
export const HEAVY_IMAGE_BYTES = 1_000_000;

export interface PrintImageInfo {
  url: string;
  /** Content-Length in bytes; null when it could not be determined. */
  bytes: number | null;
  /** Section titles using this image (deduped, first-seen order). */
  sections: string[];
  /** Uppercased language codes whose published output includes it. */
  languages: string[];
}

export interface PrintImageReport {
  /** Images ≥ HEAVY_IMAGE_BYTES, heaviest first. */
  heavy: PrintImageInfo[];
  /** Unique images inspected. */
  checked: number;
  /** Of those, how many sizes could not be determined. */
  unknown: number;
}

const IMG_SRC_RE = /<img\b[^>]*?\bsrc\s*=\s*"([^"]+)"/gi;

/** Every image URL in one resolved manual, with the section titles using it. Pure — exported for tests. */
export const collectManualImages = (resolved: ResolvedManual): Map<string, Set<string>> => {
  const out = new Map<string, Set<string>>();
  const add = (url: string | undefined, title: string) => {
    if (!url || !/^https?:\/\//i.test(url)) return; // data: URIs etc. have no fetchable weight
    if (!out.has(url)) out.set(url, new Set());
    out.get(url)!.add(title);
  };
  for (const section of resolved.sections) {
    for (const node of section.nodes) {
      if (node.type === 'html' || node.type === 'callout') {
        for (const m of node.html.matchAll(IMG_SRC_RE)) add(m[1], section.title);
      } else if (node.type === 'annotated_image_set') {
        for (const img of node.images) add(img.url, section.title);
      } else if (node.type === 'step_sequence') {
        for (const st of node.steps) add(st.image?.url, section.title);
      }
    }
  }
  return out;
};

/** HEAD one URL for its Content-Length; null on any failure (CORS, 4xx, absent header). */
const headBytes = async (url: string): Promise<number | null> => {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (!res.ok) return null;
    const len = res.headers.get('content-length');
    const n = len ? Number(len) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
};

/**
 * Check every image in the PUBLISHED output of the given languages. Failures are
 * absorbed per language / per image; the caller only ever gets a (possibly
 * partial) advisory report.
 */
export const checkPrintImageWeights = async (
  projectId: string,
  templateType: IMTemplateType,
  languages: string[],
): Promise<PrintImageReport> => {
  // url → { sections, languages }, aggregated across the published JSONs.
  const usage = new Map<string, { sections: Set<string>; languages: Set<string> }>();

  await Promise.all(languages.map(async (lang) => {
    const url = getPublishedManualUrl(projectId, templateType, lang);
    if (!url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const resolved = (await res.json()) as ResolvedManual;
      for (const [imgUrl, titles] of collectManualImages(resolved)) {
        if (!usage.has(imgUrl)) usage.set(imgUrl, { sections: new Set(), languages: new Set() });
        const u = usage.get(imgUrl)!;
        titles.forEach((t) => u.sections.add(t));
        u.languages.add(lang.toUpperCase());
      }
    } catch { /* advisory — a missing/broken JSON just means fewer images checked */ }
  }));

  const urls = [...usage.keys()];
  const bytesByUrl = new Map<string, number | null>();
  // Small concurrency pool — dozens of sequential HEADs would be slow, an
  // unbounded fan-out is rude to the storage host.
  const POOL = 6;
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(POOL, urls.length) }, async () => {
    while (cursor < urls.length) {
      const u = urls[cursor++];
      bytesByUrl.set(u, await headBytes(u));
    }
  }));

  const infos: PrintImageInfo[] = urls.map((u) => ({
    url: u,
    bytes: bytesByUrl.get(u) ?? null,
    sections: [...usage.get(u)!.sections],
    languages: [...usage.get(u)!.languages],
  }));
  return {
    heavy: infos
      .filter((i) => i.bytes !== null && i.bytes >= HEAVY_IMAGE_BYTES)
      .sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0)),
    checked: infos.length,
    unknown: infos.filter((i) => i.bytes === null).length,
  };
};
