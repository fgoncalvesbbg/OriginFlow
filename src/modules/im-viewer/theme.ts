/**
 * Theme variable injection — mirrors the host app's getIMThemeVariables but self-contained.
 * Returns CSS custom properties consumed by im-viewer.css (scoped under .imv-root).
 */

import type { CSSProperties } from 'react';
import { TemplateMetadata } from './types';

const DEFAULT_PRIMARY = '#0f172a';
const DEFAULT_FONT = "'Inter', system-ui, Arial, sans-serif";

export const getThemeVars = (metadata?: TemplateMetadata): CSSProperties => {
  const fontFamily =
    metadata?.fontFamily && metadata.fontFamily !== 'Inter'
      ? `'${metadata.fontFamily}', Arial, sans-serif`
      : DEFAULT_FONT;
  return {
    ['--imv-primary' as string]: metadata?.primaryColor || DEFAULT_PRIMARY,
    ['--imv-font' as string]: fontFamily,
  };
};
