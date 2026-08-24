/**
 * The style object that makes a `.im-content` container model the printed page.
 *
 * im-content.css keys every density rule off `--im-*` CSS variables with web-ish
 * fallbacks. Only the live rich-text editor used to SET those variables, so every
 * read-only preview (template block cards, the project page preview, the optional
 * content panel, the share preview) silently ran on the fallbacks: 1rem block gaps
 * against 2.5mm in print, 0.5rem cell padding against 1.2mm, no image height cap at
 * all. This helper is the single place the wiring lives, so a new preview surface
 * cannot forget half the variables.
 */

import type { CSSProperties } from 'react';
import type { PrintColumnGeometry } from '../../../services/im/im-print-geometry';

/**
 * Every `--im-*` variable im-content.css consumes, in em of the container's body size,
 * plus the profile's line-height. Spread this onto any `.im-content` element; add
 * `fontSize: geometry.bodyPx` (and a width/zoom) where the surface models true print
 * scale rather than just proportions.
 */
export const imContentVars = (g: PrintColumnGeometry): CSSProperties => ({
  ['--im-img-max-h' as string]: `${g.imageMaxHeightEm}em`,
  ['--im-block-gap' as string]: `${g.blockSpacingEm}em`,
  ['--im-para-gap' as string]: `${g.paragraphSpacingEm}em`,
  ['--im-item-gap' as string]: `${g.listItemSpacingEm}em`,
  ['--im-cell-pad' as string]: `${g.cellPaddingEm}em`,
  ['--im-cell-border' as string]: `${g.cellBorderEm}em`,
  ['--im-table-scale' as string]: `${g.tableFontRatio}em`,
  ['--im-callout-icon' as string]: `${g.calloutIconEm}em`,
  ['--im-h1' as string]: `${g.h1Em}em`,
  ['--im-h2' as string]: `${g.h2Em}em`,
  ['--im-h3' as string]: `${g.h3Em}em`,
  ['--im-head-mt' as string]: `${g.headingMarginTopEm}em`,
  ['--im-head-mb' as string]: `${g.headingMarginBottomEm}em`,
  lineHeight: g.lineHeight,
});

/**
 * The full print-scale style for a `.im-content` container: the variables plus the
 * printed body size and face. With these set, `%`, `px` and `mm` lengths inside all
 * mean exactly what they will mean on the page (scale with CSS `zoom` for legibility).
 */
export const imContentPrintScale = (g: PrintColumnGeometry): CSSProperties => ({
  ...imContentVars(g),
  fontSize: `${g.bodyPx}px`,
  fontFamily: `'${g.fontFamily}', Arial, sans-serif`,
});
