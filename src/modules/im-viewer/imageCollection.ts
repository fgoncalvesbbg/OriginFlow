/**
 * Collects every image in a manual (in reading order) so the lightbox can page through all of
 * them with prev/next. Covers images embedded in html/callout nodes, annotated image sets, and
 * step-sequence photos.
 */

import { ResolvedManual, CollectedImage } from './types';

/** Extract <img> sources (and alt) from an HTML string without a live DOM dependency. */
const imagesFromHtml = (html: string): CollectedImage[] => {
  const out: CollectedImage[] = [];
  const imgRe = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html))) {
    const tag = m[0];
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1];
    out.push({ url: src, alt });
  }
  return out;
};

export const collectImages = (manual: ResolvedManual): CollectedImage[] => {
  const images: CollectedImage[] = [];
  for (const section of manual.sections) {
    for (const node of section.nodes) {
      switch (node.type) {
        case 'html':
        case 'callout':
          images.push(...imagesFromHtml(node.html));
          break;
        case 'annotated_image_set':
          for (const img of node.images) {
            images.push({ url: img.url, alt: img.alt, caption: img.caption });
          }
          break;
        case 'step_sequence':
          for (const step of node.steps) {
            if (step.image?.url) images.push({ url: step.image.url, caption: step.text });
          }
          break;
        default:
          break;
      }
    }
  }
  return images;
};
