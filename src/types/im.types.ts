/**
 * Instruction Manual (IM) module types
 */

export interface IMTemplateMetadata {
  pageSize: 'a4' | 'letter' | 'a5';
  primaryColor: string;
  brand?: {
    fontFamilies: {
      body: string;
      heading: string;
    };
    fontSizes: {
      body: number;
      small: number;
    };
    headingScale: {
      h1: number;
      h2: number;
      h3: number;
    };
    textColors: {
      primary: string;
      heading: string;
      body: string;
      muted: string;
    };
  };
  layout?: {
    margins: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
    columns: {
      count: number;
      gap: number;
    };
    headerHeight: number;
    footerHeight: number;
    pageNumberingStyle: 'numeric' | 'roman' | 'none';
  };
  assets?: {
    iconSet: string;
    watermarkAssetUrl?: string;
    backgroundAssetUrl?: string;
  };
  pages?: {
    coverTemplate: string;
    chapterOpenerTemplate: string;
    bodyTemplate: string;
    endPageVariants: string[];
  };
  coverImageUrl?: string;
  companyLogoUrl?: string;
  companyName?: string;
  backPageContent?: string;
  footerText?: string;
}

export interface IMTemplate {
  id: string;
  categoryId: string;
  name: string;
  languages: string[];
  isFinalized: boolean;
  finalizedAt?: string;
  metadata?: IMTemplateMetadata;
  updatedAt?: string;
  lastUpdatedBy?: string;
}

export interface IMSection {
  id: string;
  templateId: string;
  parentId?: string | null;
  title: string;
  order: number;
  isPlaceholder: boolean;
  content: Record<string, string>; // langCode -> html
}

export interface ProjectIM {
  id: string;
  templateId: string;
  placeholderData: Record<string, string>;
  status: 'draft' | 'generated';
  updatedAt: string;
}
