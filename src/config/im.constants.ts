/**
 * Instruction Manual (IM) shared constants.
 */

/**
 * Default cover/company logo for generated IMs (PDF + preview) when a project or template
 * hasn't set its own. Used as the final fallback after `formData.__custom_logo` and
 * `template.metadata.companyLogoUrl`. Cloudinary auto-format/quality Klarstein vector logo.
 */
export const DEFAULT_IM_LOGO_URL =
  'https://res.cloudinary.com/chal-tec/image/upload/w_auto,q_auto,g_auto/marketing/gds/klarstein/logos/klarstein_vec.svg';

/**
 * Default header logo for Warning Leaflet PDF exports (the compact layout's logo-only header),
 * used as the fallback after `formData.__custom_logo` and `template.metadata.companyLogoUrl`.
 * Stored in the public `im-assets` bucket. Separate from DEFAULT_IM_LOGO_URL so leaflets and
 * full manuals can carry different standard branding.
 */
export const DEFAULT_LEAFLET_LOGO_URL =
  'https://ecueltibpmpnhnaxlskx.supabase.co/storage/v1/object/public/im-assets/cover/1783680033050_5j98qi.jpg';

/**
 * Reserved placeholder id for the "SKU QR code" chip (InlineBlockEditor's Insert menu).
 * Never bound to a real category attribute — the resolver fills its value in automatically
 * from the manual's first bound SKU, so it must never collide with an attribute id.
 */
export const QR_SKU_PLACEHOLDER_ID = 'sys.qr_sku';

/** Base URL the SKU QR code encodes: `${QR_SKU_URL_BASE}<skuNumber>`. */
export const QR_SKU_URL_BASE = 'https://use.berlin/';
