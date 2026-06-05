/**
 * IM theme helpers — derive CSS variables/inline styles for IM rendering from template metadata.
 */
import { CSSProperties } from 'react';
import { IMTemplateMetadata } from '../../../types';

const DEFAULT_PRIMARY_COLOR = '#0f172a';
const DEFAULT_FONT_FAMILY = 'Inter, Arial, sans-serif';

export const getIMThemeVariables = (metadata?: IMTemplateMetadata): CSSProperties => {
  const fontFamily = metadata?.fontFamily && metadata.fontFamily !== 'Inter'
    ? `'${metadata.fontFamily}', Arial, sans-serif`
    : DEFAULT_FONT_FAMILY;
  return {
    ['--im-primary-color' as string]: metadata?.primaryColor || DEFAULT_PRIMARY_COLOR,
    ['--im-font-family' as string]: fontFamily,
  };
};
