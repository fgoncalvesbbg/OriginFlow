/**
 * The ONE source of editor image markup.
 *
 * Every path that puts an <img> into author HTML — toolbar upload, drag/drop, paste,
 * the asset library — must build the tag here. AssetLibraryPanel used to carry its own
 * template with `margin: 1rem 0` baked inline (which beats both stylesheets, so the
 * spacing settings never reached those images) and without `data-align`, so the print
 * renderer had to guess the placement. One builder means one contract.
 *
 * Because the editor's serializer rebuilds an image's style attribute from scratch,
 * anything not captured as a data-* attribute here is destroyed on the next edit —
 * which is why align, border and valign are all mirrored to data-*.
 */

import { isFloatAlign, FLOAT_MAX_WIDTH_PCT, inferImageAlign, type ImageAlign } from '../../../services/im/im-image-align';

export type ImgAlign = ImageAlign;

/**
 * Vertical placement of an INLINE image relative to the text line beside it.
 * Only meaningful for align='inline'; ignored otherwise. Baked into the inline style
 * (an inline style is the only thing that reliably beats both stylesheets' own
 * `vertical-align: middle`) and mirrored to data-valign for the round-trip.
 */
export type ImgVAlign = 'top' | 'middle' | 'baseline';
export const IMG_VALIGNS: readonly ImgVAlign[] = ['top', 'middle', 'baseline'];

/**
 * Inline style for an editor image. Width caps to the container (max-width:100%).
 * center → block with auto side-margins; left/right → float so text wraps beside it;
 * inline → sits within the text run; unset → legacy block with vertical margin.
 * `border` adds a thin frame (with a little inner padding so it doesn't hug the pixels).
 * `uncap` drops the print/editor height ceiling (--im-img-max-h / cellImageMaxHeightMm)
 * for this one image — see the `uncap` param comment on `imgTag` for why it's baked in
 * here rather than left to authored CSS.
 * Deliberately NO margins here — spacing comes from im-content.css / the print
 * stylesheet, driven by the same blockSpacingMm setting on both sides.
 */
export const imgStyleFor = (
  width?: string,
  align?: ImgAlign,
  border?: boolean,
  valign?: ImgVAlign,
  uncap?: boolean,
): string => {
  const w = width ? `width:${width};` : '';
  // A float with no author width would take the full column and leave nothing to wrap.
  const floatCap = width || !align || !isFloatAlign(align) ? '' : `max-width:${FLOAT_MAX_WIDTH_PCT}%;`;
  const b = border ? 'border:1px solid #d1d5db;padding:0.25rem;background:#fff;' : '';
  const maxH = uncap ? 'max-height:none;' : '';
  const base = `${w}${floatCap}${b}max-width:100%;height:auto;${maxH}border-radius:0.375rem;`;
  switch (align) {
    case 'center': return `${base}display:block;`;
    case 'left':   return `${base}float:left;`;
    case 'right':  return `${base}float:right;`;
    case 'inline': return `${base}display:inline;vertical-align:${valign ?? 'middle'};`;
    default:       return `${base}display:block;`;
  }
};

/**
 * Full <img> tag with size + alignment + border (align/border/valign mirrored to data-*
 * for re-parse).
 *
 * `uncap` opts this one image out of the height ceiling both stylesheets otherwise apply
 * (`--im-img-max-h` in the editor, `cellImageMaxHeightMm` in print) — for a deliberately
 * large diagram or full-page illustration that setting exists to protect OTHER images
 * from, not enable. It is mirrored to `data-uncap` (read back by `readImgUncap`, kept in
 * sync with print via the matching `[data-uncap]` rule in im-print-html.ts) AND baked
 * into the inline style, because the editor's serializer rebuilds an image's style
 * attribute from scratch on every edit — anything not captured as a data-* attribute (or
 * regenerated here) is destroyed on the next resize/align/border change.
 */
export const imgTag = (
  src: string,
  alt: string,
  width?: string,
  align?: ImgAlign,
  border?: boolean,
  valign?: ImgVAlign,
  uncap?: boolean,
): string => {
  const alignAttr = align ? ` data-align="${align}"` : '';
  const borderAttr = border ? ' data-border="1"' : '';
  const valignAttr = align === 'inline' && valign ? ` data-valign="${valign}"` : '';
  const uncapAttr = uncap ? ' data-uncap="1"' : '';
  return `<img src="${src}" alt="${alt}"${alignAttr}${borderAttr}${valignAttr}${uncapAttr} style="${imgStyleFor(width, align, border, valign, uncap)}" />`;
};

/** Read the placement off an <img>, or undefined when it expresses none. */
export const readImgAlign = (el: Element): ImgAlign | undefined => {
  const style = (el as HTMLElement).style;
  return inferImageAlign(el.getAttribute('data-align'), {
    cssFloat: style.cssFloat,
    display: style.display,
    // The shorthand is empty when the margin was set per side, so check both.
    margin: style.margin || style.marginLeft,
  });
};

/** Read the border flag off an <img> element (persisted as data-border). */
export const readImgBorder = (el: Element): boolean => el.getAttribute('data-border') === '1';

/** Read the height-ceiling opt-out off an <img> element (persisted as data-uncap). */
export const readImgUncap = (el: Element): boolean => el.getAttribute('data-uncap') === '1';

/** Read the vertical placement off an <img>, or undefined (default: middle). */
export const readImgValign = (el: Element): ImgVAlign | undefined => {
  const v = el.getAttribute('data-valign') as ImgVAlign | null;
  return v && IMG_VALIGNS.includes(v) ? v : undefined;
};
