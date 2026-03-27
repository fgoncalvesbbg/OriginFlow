import { CSSProperties } from 'react';
import { IMTemplateMetadata } from '../../../types';

const DEFAULT_PRIMARY_COLOR = '#0f172a';

export const getIMThemeVariables = (metadata?: IMTemplateMetadata): CSSProperties => {
  return {
    ['--im-primary-color' as string]: metadata?.primaryColor || DEFAULT_PRIMARY_COLOR,
  };
};
