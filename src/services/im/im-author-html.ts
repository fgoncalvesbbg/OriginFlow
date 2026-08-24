/**
 * Repairs author HTML that overrides the print settings.
 *
 * WHY. Content can arrive with inline styles: pasted from Word or Excel, typed in the editor's
 * HTML mode, or migrated years ago from the old library. An inline style beats every stylesheet,
 * so those declarations silently defeat the admin settings — and only on the tables and images
 * that most needed them. Real values from the corpus:
 *
 *     <th style="width: 22%; padding: 12px; border: 1px solid #ccc; text-align: center;">
 *     <img style="max-width:100%;height:auto;margin:1rem 0;" />
 *
 * `padding: 12px` is 3.18mm a side — 6.35mm per row against a 1.2mm setting, over two A5 line
 * boxes of pure padding on every row. `border: 1px` is 0.75pt, so the 0.1mm hairline setting
 * never reached these tables at all. `margin: 1rem` is 8.47mm of image gap that no setting could
 * change.
 *
 * Applied in two places, which is why it lives in its own module: the renderer runs it on every
 * export, and the editor runs it on every HTML ingress so the content is repaired at the source
 * rather than re-fixed forever. It deliberately does NOT import the print renderer — that module
 * inlines ~300KB of base64 font data and is only ever loaded by the netlify functions.
 *
 * Idempotent: running it twice changes nothing, so it is safe on both paths.
 */

export const IMG_TAG_RE = /<img\b[^>]*>/gi;
export const STYLE_ATTR_RE = /(\bstyle\s*=\s*")([^"]*)(")/i;
export const TAG_END_RE = /(\s*\/?>)$/;

/** A width/height pinned in px, which fixes a column or stops an image scaling down. */
const PX_SIZE_DECL_RE = /^\s*(?:width|height|max-width|max-height)\s*:\s*\d+(?:\.\d+)?px\s*$/i;
/** The presentational attribute form, e.g. `<img width="160">`. */
const PX_SIZE_ATTR_RE = /\s(?:width|height)\s*=\s*"?\d+(?:\.\d+)?"?/gi;
const MARGIN_DECL_RE = /^\s*margin(?:-top|-right|-bottom|-left)?\s*:/i;
const TABLE_BLOCK_RE = /<table\b[\s\S]*?<\/table>/gi;
const CELL_TAG_RE = /<t[dh]\b[^>]*>/gi;
const PADDING_DECL_RE = /^\s*padding(?:-top|-right|-bottom|-left)?\s*:/i;
const BORDER_DECL_RE = /^\s*border(?:-(?:top|right|bottom|left))?\s*:\s*(.*)$/i;
/** A length the reader can actually see — i.e. not `0`, `none` or `0px`. */
const VISIBLE_LENGTH_RE = /(?:^|[^\d.])(?:[1-9]\d*(?:\.\d+)?|0?\.\d+)\s*(?:px|pt|mm|cm|in|em|rem)\b/i;

/** The inline style attribute's contents, or '' when the tag has none. */
export const styleOf = (tag: string): string => tag.match(STYLE_ATTR_RE)?.[2] ?? '';

/** Drop the inline style declarations `drop` selects, leaving the rest of the tag intact. */
export const withoutDeclarations = (
  tag: string,
  drop: (declaration: string) => boolean,
): string =>
  tag.replace(STYLE_ATTR_RE, (full: string, open: string, css: string, close: string) => {
    const declarations = css.split(';').filter((declaration) => declaration.trim());
    const kept = declarations.filter((declaration) => !drop(declaration));
    // Nothing to repair: hand back the original attribute untouched. Rebuilding it would drop the
    // trailing semicolon, and since the editor sanitises on every load that cosmetic difference
    // would make clean content look changed every single time it was opened.
    if (kept.length === declarations.length) return full;
    const trailingSemicolon = /;\s*$/.test(css) ? ';' : '';
    return `${open}${kept.join(';')}${trailingSemicolon}${close}`;
  });

/**
 * Strip the inline margins the editor used to bake onto images.
 *
 * Only margins. An author's WIDTH is left alone wherever it appears, including inside a table.
 * An earlier version stripped pixel widths from images in cells, on the theory that a pinned
 * width was behind the phantom image column in the exports. That was wrong twice over: a
 * column has to be wide enough for the widest image it holds, so the width was doing its job;
 * and the actual phantom column is a table whose image column holds NO images at all, which no
 * image width causes. Meanwhile the strip destroyed real layouts — the disposal block pairs a
 * 70px icon with its text in a two-column table, and without the width the icon collapsed.
 *
 * The genuinely empty column is a separate feature (suppress a column no row fills) and is not
 * something markup repair can infer.
 */
const repairImages = (html: string): string =>
  html.replace(IMG_TAG_RE, (tag) => withoutDeclarations(tag, (d) => MARGIN_DECL_RE.test(d)));

/**
 * Strip the cell styles that compete with the print settings — but only in DATA tables.
 *
 * A cell that declares no border, or explicitly none, is part of a table being used for LAYOUT:
 * the disposal block, for instance, sets an icon beside its text with
 * `width:120px; padding:0 12px 0 0; border:none`. Every one of those declarations is deliberate
 * geometry, and an earlier version of this stripped all three — collapsing the icon column and
 * removing the gutter between icon and text. A layout table has no house style to conform to,
 * so it is left exactly as written.
 *
 * A bordered cell is a data table, which is what the density settings exist for: there, pasted
 * `padding: 12px` (3.18mm a side) and `border: 1px solid #ccc` (0.75pt) are overriding the
 * admin's padding and hairline, and go. Percentage widths are always kept — they are relative
 * to the table and behave correctly at any page size — as are alignment and everything else.
 */
const repairTableCells = (html: string): string =>
  html.replace(CELL_TAG_RE, (tag) => {
    const border = styleOf(tag).match(/(?:^|;)\s*border(?:-(?:top|right|bottom|left))?\s*:\s*([^;]*)/i);
    const isLayoutCell = !border || !VISIBLE_LENGTH_RE.test(border[1]);
    if (isLayoutCell) return tag;
    return withoutDeclarations(tag, (declaration) => {
      if (PADDING_DECL_RE.test(declaration)) return true;
      if (PX_SIZE_DECL_RE.test(declaration)) return true;
      const decl = declaration.match(BORDER_DECL_RE);
      return !!decl && VISIBLE_LENGTH_RE.test(decl[1]);
    }).replace(PX_SIZE_ATTR_RE, '');
  });

/**
 * Everything author HTML needs before it is stored or printed.
 *
 * Safe to call on content that is already clean, and on content that has already been through
 * it — nothing here depends on running exactly once.
 */
export const sanitizeAuthorHtml = (html: string): string => repairTableCells(repairImages(html));
