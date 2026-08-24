/**
 * Global print typography — the house style the PDF exporter renders with
 * (im_print_settings, migration 122).
 *
 * WHY this is global. Before this, the exported booklet's typography was not one decision in
 * one place:
 *   - the font FAMILY came from the IM template's metadata, and a template is bound to a
 *     product category — so the same booklet program printed in a different font per
 *     category, a house-style split nobody chose;
 *   - font SIZES, line spacing and page margins were worse than per-category: hardcoded in
 *     the print-HTML builder (mm-based, with a fixed 0.82 A5 type scale) and in the render
 *     functions (IM_MARGIN / LEAFLET_MARGIN), so changing any of them meant a code deploy.
 *
 * Now there is ONE admin-owned profile per (template type × page size). Product category is
 * deliberately not an axis. The two axes that remain are the ones that genuinely need
 * different values: a compact warning leaflet is set at ~6pt to fit a few pages while a full
 * manual is set at ~10.8pt, and A5 needs a smaller scale than A4 for the same content.
 *
 * Read by everyone (the print dialog shows the active profile and passes it to the render
 * pipeline); written by admins only (Admin console → IM Print) — the RLS policy is the real
 * gate, not the UI. The shape, limits and built-in defaults live in ./im-print-typography
 * (pure, so the Netlify render functions can import them too).
 */

import { db, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type { IMTemplateType } from '../../types';
import {
  defaultTypographyFor,
  normalizePrintTypography,
  profileKey,
  type PrintPageSizeKey,
  type PrintTypography,
} from './im-print-typography';

export type { PrintPageSizeKey, PrintTypography } from './im-print-typography';
// Re-exported so callers get the whole print-settings surface from one module. The
// remaining pieces of ./im-print-typography (DEFAULT_PRINT_TYPOGRAPHY,
// normalizePrintTypography) are imported straight from there by the Netlify render
// functions, which cannot pull in this file's database dependencies.
export { PRINT_FONT_FAMILIES, PRINT_SETTING_LIMITS, defaultTypographyFor } from './im-print-typography';

/** A stored profile — a typography set plus the (template type, page size) it applies to. */
export interface PrintSettingsProfile extends PrintTypography {
  id?: string;
  templateType: IMTemplateType;
  pageSize: PrintPageSizeKey;
  updatedAt?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const mapRow = (r: any): PrintSettingsProfile => ({
  id: r.id,
  templateType: r.template_type,
  pageSize: r.page_size,
  updatedAt: r.updated_at ?? undefined,
  // NUMERIC columns arrive as strings over PostgREST — normalize (which coerces and
  // range-checks every field) is what makes them numbers again.
  ...normalizePrintTypography(
    {
      fontFamily: r.font_family,
      bodyPt: Number(r.body_pt),
      headingPt: Number(r.heading_pt),
      lineHeight: Number(r.line_height),
      // Added by migration 123 — absent on a database that predates it, in which case
      // normalizePrintTypography substitutes the built-in default.
      tableCellPaddingMm: r.table_cell_padding_mm == null ? undefined : Number(r.table_cell_padding_mm),
      cellImageMaxHeightMm: r.cell_image_max_height_mm == null ? undefined : Number(r.cell_image_max_height_mm),
      // Added by migration 125.
      blockSpacingMm: r.block_spacing_mm == null ? undefined : Number(r.block_spacing_mm),
      // Added by migration 126.
      paragraphSpacingEm: r.paragraph_spacing_em == null ? undefined : Number(r.paragraph_spacing_em),
      tableFontScale: r.table_font_scale == null ? undefined : Number(r.table_font_scale),
      // Added by migration 127.
      tableBorderMm: r.table_border_mm == null ? undefined : Number(r.table_border_mm),
      margins: {
        top: Number(r.margin_top_mm),
        bottom: Number(r.margin_bottom_mm),
        left: Number(r.margin_left_mm),
        right: Number(r.margin_right_mm),
      },
    },
    defaultTypographyFor(r.template_type, r.page_size),
  ),
});
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Every profile, one per (template type, page size) — combinations with no stored row come
 * back with their built-in defaults, so the admin screen always renders a complete set of
 * four and never has to special-case "not configured yet".
 */
export const getPrintSettings = async (): Promise<PrintSettingsProfile[]> => {
  const stored = isLive
    ? await orEmpty(db.select<Row>('im_print_settings', {}), '[im-print-settings] getPrintSettings')
    : [];
  const byKey = new Map(stored.map((r) => [profileKey(r.template_type, r.page_size), mapRow(r)]));
  return (['im', 'warning_leaflet'] as IMTemplateType[]).flatMap((templateType) =>
    (['a4', 'a5'] as PrintPageSizeKey[]).map(
      (pageSize) =>
        byKey.get(profileKey(templateType, pageSize)) ?? {
          templateType,
          pageSize,
          ...defaultTypographyFor(templateType, pageSize),
        },
    ),
  );
};

/**
 * The single profile a render should use. Never throws and never blocks a render: an
 * unreachable table or a missing row degrades to the built-in default, which is exactly what
 * the renderer used before this table existed.
 */
export const getPrintTypography = async (
  templateType: IMTemplateType,
  pageSize: PrintPageSizeKey,
): Promise<PrintTypography> => {
  const fallback = defaultTypographyFor(templateType, pageSize);
  if (!isLive) return fallback;
  const rows = await orEmpty(
    db.select<Row>('im_print_settings', { where: { template_type: templateType, page_size: pageSize } }),
    '[im-print-settings] getPrintTypography',
  );
  if (!rows.length) return fallback;
  // Strip the row-only fields rather than listing the typography ones: enumerating them
  // meant every setting added to PrintTypography was silently dropped here.
  const { id: _id, templateType: _templateType, pageSize: _pageSize, updatedAt: _updatedAt, ...typography } = mapRow(rows[0]);
  return typography;
};

/**
 * Save one profile. Upserts on the (template_type, page_size) pair so the four profiles can
 * never be duplicated, and clamps every value to the shared limits before it goes out — the
 * table's CHECK constraints would reject an out-of-range write anyway, and a clamp gives the
 * admin a saved-and-corrected value instead of an opaque constraint error.
 */
export const savePrintSettingsProfile = async (
  profile: PrintSettingsProfile,
): Promise<PrintSettingsProfile> => {
  const typography = normalizePrintTypography(profile, defaultTypographyFor(profile.templateType, profile.pageSize));
  const row = await db.upsertReturning<Row>(
    'im_print_settings',
    {
      template_type: profile.templateType,
      page_size: profile.pageSize,
      font_family: typography.fontFamily,
      body_pt: typography.bodyPt,
      heading_pt: typography.headingPt,
      line_height: typography.lineHeight,
      table_cell_padding_mm: typography.tableCellPaddingMm,
      cell_image_max_height_mm: typography.cellImageMaxHeightMm,
      block_spacing_mm: typography.blockSpacingMm,
      paragraph_spacing_em: typography.paragraphSpacingEm,
      table_font_scale: typography.tableFontScale,
      table_border_mm: typography.tableBorderMm,
      margin_top_mm: typography.margins.top,
      margin_bottom_mm: typography.margins.bottom,
      margin_left_mm: typography.margins.left,
      margin_right_mm: typography.margins.right,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'template_type,page_size' },
  );
  return mapRow(row);
};
