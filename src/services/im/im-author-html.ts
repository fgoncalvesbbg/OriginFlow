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
 * Strip the inline margins the editor used to bake onto images, and px sizes pinned inside a
 * table.
 *
 * The px strip is scoped to tables on purpose. In a cell a pinned width fixes that column on
 * EVERY row, including rows whose image cell is empty — the phantom image column in the
 * exports. Outside a table the width is a deliberate editorial choice (a floated logo sized to
 * 150px), and removing it would let the image grow to the full column.
 *
 * Nested tables would end the first pass at the inner `</table>`; manuals do not use them, and
 * the cost of missing one is a phantom column, not broken markup.
 */
const repairImages = (html: string): string => {
  const insideTables = html.replace(TABLE_BLOCK_RE, (block) =>
    block.replace(IMG_TAG_RE, (tag) =>
      withoutDeclarations(tag, (d) => PX_SIZE_DECL_RE.test(d)).replace(PX_SIZE_ATTR_RE, ''),
    ),
  );
  return insideTables.replace(IMG_TAG_RE, (tag) =>
    withoutDeclarations(tag, (d) => MARGIN_DECL_RE.test(d)),
  );
};

/**
 * Strip the cell styles that compete with the print settings: padding, pinned px widths, and
 * borders with a visible weight.
 *
 * A border the author set to ZERO is kept, because that is a real decision — some tables are
 * used for layout and are meant to be invisible. Only a visible weight is dropped, since that is
 * the one fighting the setting. Percentage widths are kept: they are relative to the table and
 * behave correctly at any page size. Alignment and every other declaration is left alone.
 */
const repairTableCells = (html: string): string =>
  html.replace(CELL_TAG_RE, (tag) =>
    withoutDeclarations(tag, (declaration) => {
      if (PADDING_DECL_RE.test(declaration)) return true;
      if (PX_SIZE_DECL_RE.test(declaration)) return true;
      const border = declaration.match(BORDER_DECL_RE);
      return !!border && VISIBLE_LENGTH_RE.test(border[1]);
    }).replace(PX_SIZE_ATTR_RE, ''),
  );

/**
 * Everything author HTML needs before it is stored or printed.
 *
 * Safe to call on content that is already clean, and on content that has already been through
 * it — nothing here depends on running exactly once.
 */
export const sanitizeAuthorHtml = (html: string): string => repairTableCells(repairImages(html));
