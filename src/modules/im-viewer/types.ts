/**
 * Self-contained data contract for the IM viewer.
 *
 * This is an intentional copy of the producer's ResolvedManual shape. The viewer module must
 * not import from the host app's `src/types` — keeping its own copy is what lets it be lifted
 * into another platform and fed any manifest/manual URL. Keep in sync with
 * src/types/im.types.ts (RESOLVED_MANUAL_SCHEMA_VERSION).
 */

export const SUPPORTED_SCHEMA_VERSION = 2;

export type MasterLayoutName = 'cover' | 'chapter' | 'body' | 'appendix' | 'end';

export interface MasterPageOverride {
  background?: string;
  iconStrip?: string;
  footerVariant?: 'default' | 'minimal' | 'none' | string;
}

export interface TemplateMetadata {
  pageSize: 'a4' | 'letter' | 'a5';
  primaryColor: string;
  coverImageUrl?: string;
  companyLogoUrl?: string;
  companyName?: string;
  backPageContent?: string;
  footerText?: string;
  fontFamily?: string;
  masterPages?: Partial<Record<MasterLayoutName, MasterPageOverride>>;
  sectionLayoutMap?: Record<string, MasterLayoutName>;
}

export interface ImageAnnotation {
  number: number;
  x: number; // normalized 0..1
  y: number; // normalized 0..1
  label: string;
}

/** Resolved annotated image — alt/caption/label already collapsed to the active language. */
export interface AnnotatedImage {
  url: string;
  width: number;
  height: number;
  alt: string;
  caption?: string;
  annotations: ImageAnnotation[];
}

export interface HtmlNode {
  type: 'html';
  id: string;
  html: string;
  text: string;
  sourceBlock?: string;
}

export type CalloutVariant = 'warning' | 'caution' | 'electric' | 'flammable' | 'hot_surface' | 'info';

export interface CalloutNode {
  type: 'callout';
  id: string;
  variant: CalloutVariant;
  html: string;
  text: string;
  sourceBlock?: string;
}

export interface AnnotatedImageSetNode {
  type: 'annotated_image_set';
  id: string;
  images: AnnotatedImage[];
}

export interface LegendTableNode {
  type: 'legend_table';
  id: string;
  rows: Array<{ number: number; label: string }>;
}

export interface StepSequenceNode {
  type: 'step_sequence';
  id: string;
  steps: Array<{
    text: string;
    image?: { url: string; width: number; height: number };
  }>;
}

export type ManualNode =
  | HtmlNode
  | CalloutNode
  | AnnotatedImageSetNode
  | LegendTableNode
  | StepSequenceNode;

export interface ManualSection {
  id: string;
  title: string;
  layout: MasterLayoutName;
  parentId: string | null;
  order: number;
  /** SKU numbers this chapter applies to; rendered as an "Applies to: …" header. Absent = all SKUs. */
  skuScope?: string[];
  nodes: ManualNode[];
}

export interface SearchIndexEntry {
  sectionId: string;
  nodeId: string;
  text: string;
}

export interface ResolvedManual {
  schemaVersion: number;
  templateId: string;
  projectId?: string;
  language: string;
  metadata: TemplateMetadata;
  sections: ManualSection[];
  searchIndex: SearchIndexEntry[];
  warnings: string[];
}

export interface ManifestLanguage {
  lang: string;
  url: string;
  contentHash?: string;
}

export interface Manifest {
  schemaVersion: number;
  projectId?: string;
  templateId?: string;
  templateType?: string;
  publishedAt?: string;
  languages: ManifestLanguage[];
}

/** Accepted input shapes — the viewer renders whatever it is given, by URL or in-memory. */
export type ViewerSource =
  | { manifestUrl: string }
  | { manualUrl: string }
  | { manifest: Manifest }
  | { manual: ResolvedManual };

/** A single image known to the viewer, used by the lightbox to page through every image. */
export interface CollectedImage {
  url: string;
  alt?: string;
  caption?: string;
}
