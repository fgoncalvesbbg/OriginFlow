/**
 * Slug helpers for reusable IM blocks (im_blocks), used by the Block Library
 * editor (IMBlockLibrary) to derive collision-resistant slugs from a title.
 */

export const toSnake = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);

export const makeUid = (): string => Math.random().toString(36).slice(2, 8);

/** Derives a slug from title + blockType + a short unique suffix. */
export const buildSlug = (title: string, blockType: string, uid: string): string => {
  const typePrefix =
    blockType && blockType !== 'content' && blockType !== 'legacy_html' ? `${blockType}_` : '';
  const titlePart = toSnake(title);
  const raw = `${typePrefix}${titlePart}${titlePart ? '_' : ''}${uid}`;
  return raw.replace(/_+/g, '_').replace(/^_|_$/g, '');
};
