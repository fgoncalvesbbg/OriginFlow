/**
 * Instruction Manual (IM) module types
 */

export type IMMasterLayoutName = 'cover' | 'chapter' | 'body' | 'appendix' | 'end';

export interface IMMasterPageOverride {
  background?: string;
  iconStrip?: string;
  footerVariant?: 'default' | 'minimal' | 'none' | string;
}

export interface IMTemplateMetadata {
  pageSize: 'a4' | 'letter' | 'a5';
  primaryColor: string;
  coverImageUrl?: string;
  companyLogoUrl?: string;
  companyName?: string;
  backPageContent?: string;
  footerText?: string;
  masterPages?: Partial<Record<IMMasterLayoutName, IMMasterPageOverride>>;
  sectionLayoutMap?: Record<string, IMMasterLayoutName>;
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
