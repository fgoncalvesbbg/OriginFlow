/**
 * Instruction Manual (IM) module types
 */

export interface IMTemplateMetadata {
  pageSize: 'a4' | 'letter' | 'a5';
  primaryColor: string;
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
