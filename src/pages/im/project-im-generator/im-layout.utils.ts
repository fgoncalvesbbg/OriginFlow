/**
 * Pure layout/value helpers for the Project IM generator.
 *
 * Extracted from ProjectIMGenerator.tsx. These have no React-state dependencies and are shared
 * between the page component and its sub-components (e.g. BindableField).
 */

import { IMMasterLayoutName, IMMasterPageOverride } from '../../../types';

/** Empty master-page overrides for each layout slot. */
export const DEFAULT_MASTER_PAGES: Record<IMMasterLayoutName, IMMasterPageOverride> = {
  cover: {},
  chapter: {},
  body: {},
  appendix: {},
  end: {},
};

/** Resolve a master-page override into an inline background style (image, gradient, or color). */
export const getBackgroundStyle = (override?: IMMasterPageOverride) => {
  const bg = override?.background?.trim();
  if (!bg) return undefined;
  if (bg.startsWith('http') || bg.startsWith('data:image') || bg.includes('gradient')) {
    return { backgroundImage: bg.startsWith('gradient') ? bg : `url(${bg})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  return { backgroundColor: bg };
};

/** Join the values of the given attributes (in order), skipping empties. */
export const joinAttrValues = (attrIds: string[], submitted: Record<string, string>): string =>
  attrIds.map(id => (submitted[id] ?? '').trim()).filter(Boolean).join(' ');
