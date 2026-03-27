import { IMTemplateMetadata } from '../types';

export const DEFAULT_IM_TEMPLATE_METADATA: IMTemplateMetadata = {
  pageSize: 'a4',
  primaryColor: '#0f172a',
  coverImageUrl: '',
  companyLogoUrl: '',
  companyName: '',
  backPageContent: '',
  footerText: '',
  brand: {
    fontFamilies: {
      body: 'Inter, sans-serif',
      heading: 'Inter, sans-serif'
    },
    fontSizes: {
      body: 12,
      small: 10
    },
    headingScale: {
      h1: 2.6,
      h2: 1.8,
      h3: 1.3
    },
    textColors: {
      primary: '#0f172a',
      heading: '#0f172a',
      body: '#334155',
      muted: '#64748b'
    }
  },
  layout: {
    margins: {
      top: 20,
      right: 20,
      bottom: 20,
      left: 20
    },
    columns: {
      count: 1,
      gap: 8
    },
    headerHeight: 18,
    footerHeight: 18,
    pageNumberingStyle: 'numeric'
  },
  assets: {
    iconSet: 'default',
    watermarkAssetUrl: '',
    backgroundAssetUrl: ''
  },
  pages: {
    coverTemplate: 'standard-cover',
    chapterOpenerTemplate: 'standard-chapter-opener',
    bodyTemplate: 'standard-body',
    endPageVariants: ['standard-end']
  }
};

const asNumber = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

export const normalizeIMTemplateMetadata = (
  rawMetadata?: Partial<IMTemplateMetadata> | null
): IMTemplateMetadata => {
  const raw = rawMetadata || {};
  const primaryColor = raw.primaryColor || DEFAULT_IM_TEMPLATE_METADATA.primaryColor;

  return {
    pageSize: raw.pageSize || DEFAULT_IM_TEMPLATE_METADATA.pageSize,
    primaryColor,
    coverImageUrl: raw.coverImageUrl || '',
    companyLogoUrl: raw.companyLogoUrl || '',
    companyName: raw.companyName || '',
    backPageContent: raw.backPageContent || '',
    footerText: raw.footerText || '',
    brand: {
      fontFamilies: {
        body: raw.brand?.fontFamilies?.body || DEFAULT_IM_TEMPLATE_METADATA.brand!.fontFamilies.body,
        heading: raw.brand?.fontFamilies?.heading || DEFAULT_IM_TEMPLATE_METADATA.brand!.fontFamilies.heading
      },
      fontSizes: {
        body: asNumber(raw.brand?.fontSizes?.body, DEFAULT_IM_TEMPLATE_METADATA.brand!.fontSizes.body),
        small: asNumber(raw.brand?.fontSizes?.small, DEFAULT_IM_TEMPLATE_METADATA.brand!.fontSizes.small)
      },
      headingScale: {
        h1: asNumber(raw.brand?.headingScale?.h1, DEFAULT_IM_TEMPLATE_METADATA.brand!.headingScale.h1),
        h2: asNumber(raw.brand?.headingScale?.h2, DEFAULT_IM_TEMPLATE_METADATA.brand!.headingScale.h2),
        h3: asNumber(raw.brand?.headingScale?.h3, DEFAULT_IM_TEMPLATE_METADATA.brand!.headingScale.h3)
      },
      textColors: {
        primary: raw.brand?.textColors?.primary || primaryColor,
        heading: raw.brand?.textColors?.heading || primaryColor,
        body: raw.brand?.textColors?.body || DEFAULT_IM_TEMPLATE_METADATA.brand!.textColors.body,
        muted: raw.brand?.textColors?.muted || DEFAULT_IM_TEMPLATE_METADATA.brand!.textColors.muted
      }
    },
    layout: {
      margins: {
        top: asNumber(raw.layout?.margins?.top, DEFAULT_IM_TEMPLATE_METADATA.layout!.margins.top),
        right: asNumber(raw.layout?.margins?.right, DEFAULT_IM_TEMPLATE_METADATA.layout!.margins.right),
        bottom: asNumber(raw.layout?.margins?.bottom, DEFAULT_IM_TEMPLATE_METADATA.layout!.margins.bottom),
        left: asNumber(raw.layout?.margins?.left, DEFAULT_IM_TEMPLATE_METADATA.layout!.margins.left)
      },
      columns: {
        count: asNumber(raw.layout?.columns?.count, DEFAULT_IM_TEMPLATE_METADATA.layout!.columns.count),
        gap: asNumber(raw.layout?.columns?.gap, DEFAULT_IM_TEMPLATE_METADATA.layout!.columns.gap)
      },
      headerHeight: asNumber(raw.layout?.headerHeight, DEFAULT_IM_TEMPLATE_METADATA.layout!.headerHeight),
      footerHeight: asNumber(raw.layout?.footerHeight, DEFAULT_IM_TEMPLATE_METADATA.layout!.footerHeight),
      pageNumberingStyle: raw.layout?.pageNumberingStyle || DEFAULT_IM_TEMPLATE_METADATA.layout!.pageNumberingStyle
    },
    assets: {
      iconSet: raw.assets?.iconSet || DEFAULT_IM_TEMPLATE_METADATA.assets!.iconSet,
      watermarkAssetUrl: raw.assets?.watermarkAssetUrl || '',
      backgroundAssetUrl: raw.assets?.backgroundAssetUrl || ''
    },
    pages: {
      coverTemplate: raw.pages?.coverTemplate || DEFAULT_IM_TEMPLATE_METADATA.pages!.coverTemplate,
      chapterOpenerTemplate: raw.pages?.chapterOpenerTemplate || DEFAULT_IM_TEMPLATE_METADATA.pages!.chapterOpenerTemplate,
      bodyTemplate: raw.pages?.bodyTemplate || DEFAULT_IM_TEMPLATE_METADATA.pages!.bodyTemplate,
      endPageVariants: Array.isArray(raw.pages?.endPageVariants) && raw.pages?.endPageVariants.length > 0
        ? raw.pages.endPageVariants
        : [...DEFAULT_IM_TEMPLATE_METADATA.pages!.endPageVariants]
    }
  };
};
