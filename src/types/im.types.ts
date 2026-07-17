/**
 * Instruction Manual (IM) module types
 */

export type IMMasterLayoutName = 'cover' | 'chapter' | 'body' | 'appendix' | 'end';

/**
 * The kind of template a category holds. A category can have one of each:
 * a normal Instruction Manual and a Warning Leaflet. Both share the exact same
 * structure (sections, blocks, resolver) — only the type discriminates them.
 */
export type IMTemplateType = 'im' | 'warning_leaflet';

export const IM_TEMPLATE_TYPE_LABELS: Record<IMTemplateType, string> = {
  im: 'Instruction Manual',
  warning_leaflet: 'Warning Leaflet',
};

export interface IMMasterPageOverride {
  background?: string;
  iconStrip?: string;
  footerVariant?: 'default' | 'minimal' | 'none' | string;
}

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
  fontFamily?: string;
  masterPages?: Partial<Record<IMMasterLayoutName, IMMasterPageOverride>>;
  sectionLayoutMap?: Record<string, IMMasterLayoutName>;
}

export interface IMTemplate {
  id: string;
  categoryId: string;
  templateType: IMTemplateType;
  name: string;
  languages: string[];
  isFinalized: boolean;
  finalizedAt?: string | null;
  metadata?: IMTemplateMetadata;
  updatedAt?: string;
  lastUpdatedBy?: string;
}

export interface IMSection {
  id: string;
  templateId: string;
  parentId?: string | null;
  title: string; // base/default title (also the fallback when a language is missing)
  titleI18n?: Record<string, string>; // langCode -> translated title; falls back to `title`
  order: number;
  isPlaceholder: boolean;
  content: Record<string, string>; // langCode -> html
  conditionFeatureId?: string | null;
  conditionLabel?: string | null;
  isFinal?: boolean;
  completedLanguages?: string[];
  blockRefs?: BlockRef[]; // ordered content references; empty = legacy fallback to content[]
}

/** Resolve a section's title for a language, falling back to the base title. */
export const localizedSectionTitle = (
  s: { title: string; titleI18n?: Record<string, string> },
  lang: string,
): string => {
  const t = s.titleI18n?.[lang];
  return t && t.trim() ? t : s.title;
};

export interface ProjectIM {
  id: string;
  templateId: string;
  templateType: IMTemplateType;
  placeholderData: Record<string, string>;
  skuContent: Record<string, SKUContentValue>; // slot name → typed SKU content
  status: 'draft' | 'generated';
  updatedAt: string;
  // Monotonic publish counter — 0/absent while only ever saved as a draft, then
  // +1 on each publish (status='generated'). Stamped in the generated PDF footer.
  version?: number;
  // project_skus.id values this IM is bound to (the SKUs it covers). Empty/absent =
  // all of the project's SKUs (backward compatible). Bound SKUs drive resolution.
  boundSkuIds?: string[];
  // Project-only content layered on top of the template. The template itself is
  // never edited — these additions are merged in at resolve time only for this
  // project. See ProjectBlockAddition / ProjectExtraSection below.
  sectionAdditions?: Record<string /* templateSectionId */, ProjectBlockAddition[]>;
  extraSections?: ProjectExtraSection[];
  // Full project-level content for a *placeholder* template section. Placeholder
  // sections exist to be authored per project, so when one is edited its inline
  // blocks are stored here (keyed by template section id) and fully replace the
  // template's content for that section at resolve time. Absent key = untouched
  // (resolver falls back to the template content). The template is never modified.
  sectionOverrides?: Record<string /* templateSectionId */, InlineBlockRef[]>;
  // Per-chapter SKU scope: sectionId (a template im_sections id or a proj-… extra
  // section id) → the project_skus.id values that chapter applies to. Used to make
  // SKU-specific chapter variants (e.g. a duplicated "Setting the temperature"
  // chapter per SKU). Empty/absent = applies to all bound SKUs → no SKU header is
  // rendered. A chapter whose ids don't intersect the bound SKUs is hidden.
  sectionSkus?: Record<string /* sectionId */, string[] /* project_skus.id */>;
  // Per-project override of a single INLINE template block, keyed by section id then the
  // block's index among that section's blockRefs (same index convention as the per-ref
  // visibility `refvis_` keys). Lets a PM edit a template table's rows/columns for one
  // project only. Absent = the template block is used unchanged. Never applied to shared
  // or sku_slot refs, so approval-gated content and typed slots stay locked.
  blockOverrides?: Record<string /* sectionId */, Record<string /* refIndex */, InlineBlockRef>>;
}

// ---------------------------------------------------------------------------
// Project-only content additions — stored on project_ims, merged at resolve time
// ---------------------------------------------------------------------------

/** A project-authored inline block inserted into an existing template section. */
export interface ProjectBlockAddition {
  id: string;            // stable id for React keys / reorder
  position: number;      // insert index among the host section's template blockRefs (0..refs.length)
  block: InlineBlockRef; // reuses the template inline-block shape (content per lang, variant, conditions)
}

/** A section that exists only for this project (never written back to the template). */
export interface ProjectExtraSection {
  id: string;               // generated, prefixed `proj-…` so it can't collide with im_sections ids
  parentId: string | null;  // a template section id, another extra-section id, or null (root)
  title: string;
  order: number;            // sort key among siblings (template + extra sections mixed)
  // Project-authored inline blocks, plus optional references to approved shared
  // (standardized) blocks from im_blocks. Shared refs resolve read-only via the
  // block library — the resolver already handles `kind:'block'` in a section's refs.
  blocks: Array<InlineBlockRef | SharedBlockRef>;
}

// ---------------------------------------------------------------------------
// Block refs — stored in im_sections.block_refs
// ---------------------------------------------------------------------------

/** Callout variants — a hazard/info box with an official ISO 7010 sign. */
export type CalloutVariant = 'warning' | 'caution' | 'electric' | 'flammable' | 'hot_surface' | 'info';

/**
 * Visibility condition shared by inline and shared-block refs — the ref only
 * renders when all set conditions pass. Empty/absent fields mean "no gate".
 */
export interface FeatureConditionFields {
  requires_feature?: string | null;          // attributeId: must have a value (any, or matching label/range)
  requires_feature_label?: string | null;    // comma-separated expected values for enum/bool/text match
  requires_feature_num_min?: string | null;  // numeric range minimum (inclusive)
  requires_feature_num_max?: string | null;  // numeric range maximum (inclusive)
  requires_feature_absent?: string | null;   // attributeId: must have no value
}

export interface InlineBlockRef extends FeatureConditionFields {
  kind: 'inline';
  content: Record<string, string>; // lang -> html
  // When set, the entire row content is wrapped in this ISO callout box on
  // resolve (same treatment a shared block gets from its blockType). Absent =
  // plain content, no wrapping.
  variant?: CalloutVariant;
  // Marks this inline row as an optional "placeholder": it is NOT auto-included
  // when a project manual is generated. Instead the PM sees it as an opt-in
  // suggestion (with `note` as a review warning) and chooses to include it.
  isPlaceholder?: boolean;
  // Free-text guidance shown next to the opt-in (e.g. "Use this for the Beersafe
  // family"). Authoring-only — never rendered into the resolved manual.
  note?: string;
}

export interface SharedBlockRef extends FeatureConditionFields {
  kind: 'block';
  block_id: string;
}

export interface SKUSlotRef {
  kind: 'sku_slot';
  slot: string;
  schema: 'rich_text' | 'annotated_image_set' | 'legend_table' | 'step_sequence';
  label: Record<string, string>;
  required: boolean;
}

export type BlockRef = InlineBlockRef | SharedBlockRef | SKUSlotRef;

// ---------------------------------------------------------------------------
// IMBlock — reusable approved content unit stored in im_blocks
// ---------------------------------------------------------------------------

export interface IMBlock {
  id: string;
  slug: string;
  title: string;
  /** Brief internal-only label to differentiate blocks in the library/pickers. Never printed on generated IMs. */
  internalTitle?: string | null;
  blockType: 'content' | 'warning' | 'caution' | 'electric' | 'flammable' | 'hot_surface' | 'info' | 'legacy_html';
  sourceLanguage: string;
  content: Record<string, string>; // lang -> html
  placeholders: string[];
  applicableCategories: string[];
  requiresFeature?: string | null;
  requiresFeatureAbsent?: string | null;
  regulationRefs: string[];
  approvalStatus: 'draft' | 'approved';
  createdAt: string;
  updatedAt: string;
  lastUpdatedBy?: string | null;
}

// ---------------------------------------------------------------------------
// SKU content schemas — typed values assemblers fill per sku_slot
// ---------------------------------------------------------------------------

export interface RichTextContent {
  type: 'rich_text';
  value: Record<string, string>; // lang -> html
}

export interface AnnotatedImage {
  asset_id: string;
  url: string;
  width: number;
  height: number;
  alt: Record<string, string>;
  caption?: Record<string, string>;
  annotations: Array<{
    number: number;
    x: number; // normalized 0..1
    y: number;
    label: Record<string, string>;
  }>;
}

export interface AnnotatedImageSetContent {
  type: 'annotated_image_set';
  images: AnnotatedImage[];
}

export interface LegendTableContent {
  type: 'legend_table';
  rows: Array<{ number: number; label: Record<string, string> }>;
}

export interface StepSequenceContent {
  type: 'step_sequence';
  steps: Array<{
    text: Record<string, string>;
    asset_id?: string;
    image?: { url: string; width: number; height: number };
  }>;
}

export type SKUContentValue =
  | RichTextContent
  | AnnotatedImageSetContent
  | LegendTableContent
  | StepSequenceContent;

// ---------------------------------------------------------------------------
// ResolvedManual — structured node-tree output of resolveManual()
// ---------------------------------------------------------------------------

export interface ResolvedHtmlNode {
  type: 'html';
  id: string;
  html: string;
  text: string;
  sourceBlock?: string;
}

export interface ResolvedCalloutNode {
  type: 'callout';
  id: string;
  variant: CalloutVariant;
  html: string;
  text: string;
  sourceBlock?: string;
}

export interface ResolvedAnnotatedImageSetNode {
  type: 'annotated_image_set';
  id: string;
  images: AnnotatedImage[];
}

export interface ResolvedLegendTableNode {
  type: 'legend_table';
  id: string;
  rows: Array<{ number: number; label: string }>;
}

export interface ResolvedStepSequenceNode {
  type: 'step_sequence';
  id: string;
  steps: Array<{
    text: string;
    image?: { url: string; width: number; height: number };
  }>;
}

export type ResolvedNode =
  | ResolvedHtmlNode
  | ResolvedCalloutNode
  | ResolvedAnnotatedImageSetNode
  | ResolvedLegendTableNode
  | ResolvedStepSequenceNode;

export interface ResolvedSection {
  id: string;
  title: string;
  layout: IMMasterLayoutName;
  /** Parent section id, or null for a root section — lets renderers rebuild the chapter tree. */
  parentId: string | null;
  /** Sort position among siblings (mirrors the source IMSection.order). */
  order: number;
  /**
   * SKU numbers this chapter applies to, when the project scoped it to specific
   * SKUs (see ProjectIM.sectionSkus). Rendered as an "Applies to: …" header on the
   * final IM. Absent/empty = applies to all SKUs → no header.
   */
  skuScope?: string[];
  nodes: ResolvedNode[];
}

export interface ResolvedManual {
  /** Format version of this artifact — the producer↔renderer contract. Bump on breaking shape changes. */
  schemaVersion: number;
  templateId: string;
  projectId?: string;
  language: string;
  metadata: IMTemplateMetadata;
  sections: ResolvedSection[];
  searchIndex: Array<{ sectionId: string; nodeId: string; text: string }>;
  warnings: string[];
}

/**
 * Current ResolvedManual schema version. Bump when the resolved node shape changes incompatibly.
 * v2: ResolvedSection gained `parentId` + `order` so renderers can rebuild the chapter tree.
 */
export const RESOLVED_MANUAL_SCHEMA_VERSION = 2;
