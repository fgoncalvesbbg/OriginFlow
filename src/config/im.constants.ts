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
