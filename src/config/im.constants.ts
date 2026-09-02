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

/**
 * Fallback destination for the SKU QR code when there's no specific SKU to link to — e.g. a
 * Warning Leaflet template assigned to every item in a category rather than to one bound SKU.
 */
export const QR_ROOT_URL = 'https://use.berlin';

/**
 * Brands an IM / Warning Leaflet can be printed under. The document itself is brand-neutral —
 * the ONLY thing that changes between brands is the wordmark on the IM cover and in the
 * leaflet header, which is why a brand is a per-export choice (Print export dialog) rather
 * than a property of the template or the project: the same category content is issued under
 * whichever brand that SKU ships as.
 *
 * Klarstein is always the default; nothing picks another brand unless an operator does.
 */
export type IMBrand = 'klarstein' | 'blumfeldt';

/** The house brand. Every export starts here unless the operator switches it. */
export const DEFAULT_IM_BRAND: IMBrand = 'klarstein';

export interface IMBrandLogos {
  label: string;
  /** Cover logo for the full IM booklet. */
  coverLogoUrl: string;
  /** Header logo for the compact Warning Leaflet layout. */
  leafletLogoUrl: string;
}

/**
 * Klarstein keeps its historical pair (a Cloudinary vector on the cover, the raster wordmark
 * in the im-assets bucket for leaflets) so existing exports are byte-identical to before.
 * Blumfeldt uses its Cloudinary vector wordmark in both places — there is no separate leaflet
 * asset for it, and the vector renders at the leaflet's 8mm header height without loss.
 */
export const IM_BRANDS: Record<IMBrand, IMBrandLogos> = {
  klarstein: {
    label: 'Klarstein',
    coverLogoUrl: DEFAULT_IM_LOGO_URL,
    leafletLogoUrl: DEFAULT_LEAFLET_LOGO_URL,
  },
  blumfeldt: {
    label: 'Blumfeldt',
    coverLogoUrl:
      'https://res.cloudinary.com/chal-tec/image/upload/w_auto,q_auto,g_auto/marketing/gds/blumfeldt/logos/blumfeldt_vec.svg',
    leafletLogoUrl:
      'https://res.cloudinary.com/chal-tec/image/upload/w_auto,q_auto,g_auto/marketing/gds/blumfeldt/logos/blumfeldt_vec.svg',
  },
};

export const IM_BRAND_ORDER: IMBrand[] = ['klarstein', 'blumfeldt'];

/** The logo a brand contributes to this document type. */
export const brandLogoUrl = (brand: IMBrand, isLeaflet: boolean): string =>
  isLeaflet ? IM_BRANDS[brand].leafletLogoUrl : IM_BRANDS[brand].coverLogoUrl;

/**
 * Which brand a logo URL belongs to, or null when it is a custom upload / a template's own
 * logo. Lets the export dialogs derive the selected brand from the logo they already hold
 * instead of tracking it as a second, drift-prone piece of state.
 */
export const brandForLogoUrl = (logoUrl: string | undefined): IMBrand | null =>
  IM_BRAND_ORDER.find(
    (b) => logoUrl === IM_BRANDS[b].coverLogoUrl || logoUrl === IM_BRANDS[b].leafletLogoUrl,
  ) ?? null;
