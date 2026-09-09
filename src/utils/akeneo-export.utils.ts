/**
 * The column-code convention for an attribute in an outbound file: its external code, falling
 * back to a slug of its name.
 *
 * The row BUILDER that used to live here (`buildAkeneoRows`) was removed once the Attribute
 * Viewer started exporting from the authoritative value store — see
 * components/products/attribute-grid/export-validation.utils.ts (`buildExportRows`), which also
 * carries the CSV formula-injection guard this file used to own.
 *
 * It is deliberately NOT kept as a fallback: it silently dropped an attribute whenever two
 * resolved to the same column code (`if (seen.has(code)) continue`), which Phase 8 turned into a
 * hard export blocker. Leaving it available would leave that failure one import away.
 */
import type { CategoryAttribute } from '../types';

const slug = (s: string) =>
  s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Column code for an attribute in an outbound file: the external (Akeneo) code if it has one,
 * otherwise a slug of its name.
 *
 * The name fallback is why two attributes can collide — "Product Width" and "product width"
 * slug identically — so `validateExport` checks for that before any file is produced.
 */
export const akeneoColumnCode = (attr: CategoryAttribute): string =>
  attr.akeneoId?.trim() || slug(attr.name);
