/**
 * Where an image sits relative to the text around it — one rule, shared by the editor and the
 * print renderer.
 *
 * The author chooses this with the Align control in InlineBlockEditor, which persists it as
 * `data-align`. Two things make that attribute insufficient on its own:
 *
 *  - Images migrated from the old library predate it and carry the same intent as inline
 *    `float` / `display` instead.
 *  - The editor's serializer rebuilds an image's style attribute from scratch, so a float it
 *    cannot see is destroyed the first time someone edits that section — the image silently
 *    becomes a full-width band and text stops wrapping beside it.
 *
 * Both sides therefore need the same fallback, and it lives here rather than being written
 * twice: the editor reads parsed CSS off the element, the renderer parses a style string, and
 * they must not disagree about what a given image means.
 */

export type ImageAlign = 'inline' | 'left' | 'right' | 'center';

export const IMAGE_ALIGNS: readonly ImageAlign[] = ['inline', 'left', 'right', 'center'];

/**
 * Widest an unsized floated image may be, as a percentage of the text column.
 *
 * Floating exists so text wraps beside the image over as many lines as its height allows. Left
 * at `max-width: 100%` a large image fills the column and exactly one line ends up next to it,
 * which is the worst of both layouts. 45% leaves ~68mm of the 128mm A5 column — around 40
 * characters at 7pt. An explicit author width is honoured instead of this.
 */
export const FLOAT_MAX_WIDTH_PCT = 45;

/** Whether a float leaves text beside it, as opposed to taking a band of its own. */
export const isFloatAlign = (align: ImageAlign | undefined): boolean =>
  align === 'left' || align === 'right';

/** The subset of an image's inline style that decides its placement. */
export interface ImageStyleHints {
  cssFloat?: string | null;
  display?: string | null;
  /** The shorthand or the resolved left margin — either may carry `auto` for a centred image. */
  margin?: string | null;
}

/**
 * The placement an image is asking for, or undefined when it expresses none.
 *
 * `dataAlign` wins whenever it holds a value the Align control could have produced; anything
 * else falls back to the inline style.
 */
export const inferImageAlign = (
  dataAlign: string | null | undefined,
  style: ImageStyleHints = {},
): ImageAlign | undefined => {
  const attr = dataAlign?.trim().toLowerCase();
  if (attr && (IMAGE_ALIGNS as readonly string[]).includes(attr)) return attr as ImageAlign;

  const floated = style.cssFloat?.trim().toLowerCase();
  if (floated === 'left' || floated === 'right') return floated;
  if (style.display?.trim().toLowerCase() === 'inline') return 'inline';
  if (style.margin?.toLowerCase().includes('auto')) return 'center';
  return undefined;
};
