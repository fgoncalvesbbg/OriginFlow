/**
 * Compliance module types (Technical Compliance Framework)
 */

import { FeatureConditionFields } from './im.types';

export enum ComplianceRequestStatus {
  PENDING_SUPPLIER = 'pending_supplier',
  SUBMITTED = 'submitted',
  UNDER_REVIEW = 'under_review',
  APPROVED = 'approved',
  REJECTED = 'rejected'
}

export enum ComplianceResponseStatus {
  COMPLY = 'comply',
  CANNOT_COMPLY = 'cannot_comply',
  NOT_APPLICABLE = 'not_applicable'
}

/**
 * The category tree is three levels: L1 (department) > L2 (family) > L3 (leaf).
 * Only L3 is referenced by the rest of the app — projects, RFQs, compliance requests,
 * requirements, product features, proposals and attributes all point at a categories_l3 id.
 * L1/L2 exist to organise and filter that list, never to be selected as a category.
 */
export interface CategoryL1 {
  id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface CategoryL2 {
  id: string;
  l1Id: string;
  name: string;
  sortOrder: number;
  active: boolean;
}

export interface CategoryL3 {
  id: string;
  name: string;
  active: boolean;
  /**
   * FINAL: this category's TCF requirement set is frozen (migration 172). Enforced in the
   * database, so a stale `false` here cannot be used to sneak an edit through — the write
   * is refused by a trigger.
   */
  isFinalized: boolean;
  finalizedAt?: string | null;
  /** Who locked it. Stamped server-side; never sent by the client. */
  finalizedBy?: string | null;
  pmId?: string | null;    // PM assigned to own this category
  pmName?: string | null;  // Denormalised for display
  /**
   * Parent L2, or null for an uncategorised leaf. A leaf may legitimately sit outside the
   * tree — legacy rows are parked there rather than deleted — so every consumer must treat
   * null as "no parent yet", not as a bug.
   */
  l2Id?: string | null;
  l2Name?: string | null;  // Denormalised from the tree for display and grouping
  l1Id?: string | null;
  l1Name?: string | null;
  sortOrder?: number;
}

/** Convenience shape for the grouped pickers: one L1 with its L2s and their leaves. */
export interface CategoryTree {
  l1: CategoryL1[];
  l2: CategoryL2[];
}

/**
 * A TCF section group — the heading requirements are filed under (migration 175).
 *
 * A row per section, including the six the app ships with: they used to be a TypeScript
 * constant, which is precisely why they could not be reordered. `sortOrder` is the operator's
 * decision and the only thing any surface should order sections by.
 */
export interface ComplianceSection {
  name: string;
  sortOrder: number;
  /**
   * One of the six standard sections. Informational only — the library labels them and offers
   * no delete, but they reorder like any other and nothing in the database enforces this.
   */
  isBuiltIn: boolean;
}

export interface ProductFeature {
  id: string;
  categoryId: string;
  name: string;
  active: boolean;
}

export interface ComplianceRequirement {
  id: string;
  /** null = global requirement that applies to every category (shown locked per-category). */
  categoryId: string | null;
  /**
   * Other categories this ONE row is LINKED to (migration 173) — "all Hoods need the same
   * LVD report" as a single requirement rather than twelve copies. Edit it once and every
   * listed category sees the change.
   *
   * Mirrors `CategoryAttribute.assignedCategoryIds` exactly, down to the resolution rule:
   * see `requirementAppliesToCategory` — owned OR global OR listed here. Always empty for a
   * global requirement, which already applies everywhere.
   *
   * Note for the FINAL lock (migration 172): a linked requirement is frozen if ANY category
   * it reaches is marked FINAL, not only its home one. Otherwise editing it here would
   * rewrite what a locked category requires.
   */
  assignedCategoryIds?: string[];
  /**
   * Categories a GLOBAL requirement does NOT apply to (migration 176) — "cast iron pans have
   * no electronics, so they never need an electrical safety report".
   *
   * Always empty for a category-owned requirement: there, not-applicable is expressed by not
   * sharing it there, and two mechanisms would make "why is this missing?" ambiguous.
   *
   * Exclusion beats every other scope in `requirementAppliesToCategory`. Distinct from a
   * `condition`, which is a per-PRODUCT question answered per request (migration 174); this
   * is a structural fact about the category, decided once.
   */
  excludedCategoryIds?: string[];
  section?: string;
  title: string;
  description: string;
  isMandatory: boolean;
  /**
   * Free-text citation. Superseded by `regulationId` for anything with a regulation behind
   * it (migration 139) and rendered nowhere; kept as the fallback label for unlinked rows
   * and as the value the backfill matched on.
   */
  referenceCode?: string;
  /**
   * The `regulations` row this deliverable exists to satisfy, or null/undefined for a
   * requirement with no regulation behind it — BOM, exploded view, packaging artwork are
   * real asks, not legal obligations (migration 139). This is the join that makes the
   * regulation library one brain instead of two: the regulation carries the summary, the
   * version and the IM checklist; this row carries what the SUPPLIER must hand over.
   */
  regulationId?: string | null;
  /**
   * The specific clause this evidence satisfies, when the obligation is narrower than the
   * whole document — "LVD Annex III", not "the LVD" (migration 141). Null means the
   * requirement answers for the regulation as a whole.
   */
  clauseId?: string | null;
  appliesByDefault: boolean;
  /**
   * Attribute-based applicability gate (mirrors IM block refs). When set, the
   * requirement only applies if the captured project attribute values satisfy
   * this condition (evaluated via passesFeatureGate). Null/absent = no gate.
   */
  condition?: FeatureConditionFields | null;
  /** @deprecated superseded by `condition`; kept for back-compat reads only. */
  conditionFeatureIds?: string[];
  /**
   * Position within its section, defined by the operator (migration 175). 0-based and
   * contiguous after a reorder; ties break on title.
   *
   * ONE number per requirement, not one per category it appears in. That is what makes a
   * global or shared requirement hold the same position everywhere — the point of the feature
   * being "so that they always show the same way".
   */
  sortOrder?: number;
  timingType?: string; // 'ETD' | 'POST_ETD'
  timingWeeks?: number;
  selfDeclarationAccepted?: boolean;
  testReportOrigin?: string; // 'third_party_mandatory' | 'supplier_inhouse'
}

export interface ComplianceResponseItem {
  requirementId: string;
  status: ComplianceResponseStatus;
  comment?: string;
}

export interface ChangeLogEntry {
  date: string;
  user: string;
  action: string;
}

export interface ComplianceRequest {
  id: string;
  requestId: string;
  projectId: string;
  projectName: string;
  supplierId: string;
  categoryId: string;
  /** @deprecated legacy product-feature toggles; superseded by conditionAttributes. */
  features: { featureId: string; value: boolean }[];
  /**
   * @deprecated Superseded by `conditionAnswers` (migration 174). Attribute values keyed by
   * `category_attributes.id`, from when conditions gated on PIM attributes. Never populated
   * on any live row — verified before the migration — and no longer read anywhere.
   */
  conditionAttributes?: Record<string, string>;
  /**
   * Answers to the TCF questions, captured by the wizard when the request was created and
   * keyed by `compliance_questions.id` (migration 174).
   *
   * This is the map handed to `passesFeatureGate` as `placeholderData`, and it is frozen at
   * creation on purpose: the request records what was true when it was sent, so re-opening it
   * a month later shows the set the supplier was actually asked for, not the set today's
   * library would produce.
   */
  conditionAnswers?: Record<string, string>;
  /**
   * The requirement set the wizard FORMULATED for this request, frozen at creation
   * (migration 174).
   *
   * Both the supplier portal and the internal detail render exactly these ids rather than
   * re-evaluating conditions, which is what lets the portal stay ignorant of the internal TCF
   * questions and stops a library edit from changing what an already-sent request asked for.
   * Empty on a legacy request — fall back to the unconditional requirements.
   */
  requirementIds?: string[];
  status: ComplianceRequestStatus;
  responses: ComplianceResponseItem[];
  token: string;
  accessCode?: string;
  createdAt: string;
  submittedAt?: string;
  completedAt?: string;
  updatedBy?: string;
  deadline?: string;
  changeLog?: ChangeLogEntry[];
  respondentName?: string;
  respondentPosition?: string;
}

export type AttributeDataType = 'text' | 'integer' | 'decimal' | 'boolean' | 'enum' | 'image';

/**
 * Placeholder intake wizard gate (migration 142). 'regulatory' blocks a non-draft
 * publish/print while any question at that tier is still pending (see
 * ProjectIMGenerator.buildPublishIssues and render-print-prepare.ts). 'recommended' and
 * 'optional' are advisory only. A parallel `PlaceholderTier` (im-placeholder-wizard.types.ts)
 * carries the same three values for `im_adhoc_placeholders` rows, kept as a separate type so
 * this file and that one don't need to import each other for one shared union.
 */
export type WizardTier = 'regulatory' | 'recommended' | 'optional';

export interface AttributeValidationRules {
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  allowRange?: boolean;
  enumOptions?: string[];
  placeholder?: string;
  required?: boolean;
}

export interface CategoryAttribute {
  id: string;
  categoryId: string | null; // null = global (predefined groups, shared across all categories)
  assignedCategoryIds?: string[]; // additional categories this attribute is shared into
  name: string;
  dataType: AttributeDataType;
  validationRules?: AttributeValidationRules;
  group?: string;
  akeneoId?: string;
  /**
   * false = internal only: never rendered in a supplier-facing attribute list.
   * Defaults to true (visible) so an attribute is only hidden when someone says so.
   * Presentation filter, not access control — see db_migrations/134.
   */
  supplierVisible?: boolean;
  /** Order within the attribute group. 0/undefined = unordered, falls back to name. */
  sortOrder?: number;
  /** ProductToolkit's stable attribute id — the rename-safe sync key (migration 138). */
  ptAttributeId?: number | null;
  /** EPREL identifier from the ProductToolkit definition. Reference only. */
  eprelId?: string | null;
  /** Placeholder intake wizard gate (migration 142). Absent/undefined reads as 'optional'. */
  wizardTier?: WizardTier;
  /** Always-visible short guidance shown under the question in the wizard. */
  wizardHint?: string | null;
  /** Longer guidance shown behind an expandable disclosure, not always visible. */
  wizardNote?: string | null;
  /** Pre-filled suggestion shown when no answer exists yet; never auto-committed as an answer. */
  wizardDefaultValue?: string | null;
  /**
   * The single other attribute (or its absence) this question is sequenced behind in the
   * wizard, in the same shape IM block refs already gate visibility with (reusing
   * FeatureConditionFields rather than a parallel condition shape). Built from the five
   * `wizard_depends_on_*` columns by `wizardConditionFromRow` (attribute-condition.utils.ts).
   * Null/absent = no dependency, always eligible.
   */
  wizardCondition?: FeatureConditionFields | null;
}

/**
 * One entry in the TCF requirements audit trail (migration 172).
 *
 * Written exclusively by database triggers, so it is complete by construction: it does not
 * matter whether a requirement was changed from the library, by the regulation importer, or
 * through the API — the row exists either way. The table carries no write grant for anyone,
 * which is what makes this readable as evidence rather than as a convenience log.
 */
export interface ComplianceRequirementHistoryEntry {
  id: number;
  /** null = a change to the GLOBAL requirement set, which belongs to no single category. */
  categoryId: string | null;
  /** null for `lock` / `release`, which are events on the category rather than a requirement. */
  requirementId: string | null;
  action: ComplianceHistoryAction;
  /** The requirement's (or category's) name AS IT WAS, so a deleted row still reads as a name. */
  title: string | null;
  section: string | null;
  /** Mandatory prose for `release`, optional note for `lock`, null for requirement edits. */
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Columns that differ between `before` and `after`. Only populated for `update`. */
  changedFields: string[];
  /**
   * The categories the requirement was shared with when the change happened, unioned across
   * before and after (migration 173). This is what makes a shared requirement's edit visible
   * in the history of every category it reaches, not just its home one.
   */
  linkedCategoryIds: string[];
  changedAt: string;
  changedBy: string | null;
}

export type ComplianceHistoryAction = 'create' | 'update' | 'delete' | 'lock' | 'release';

/** The answer shapes a TCF question can take. */
export type TcfQuestionDataType = 'boolean' | 'enum' | 'number' | 'text';

/**
 * A question the TCF library asks to decide which conditional requirements apply
 * (migration 174).
 *
 * Deliberately NOT a `CategoryAttribute`. Conditions used to gate on attribute ids, and when
 * all 172 attributes were deleted in Aug 2026 every conditional requirement silently stopped
 * applying — a compliance system quietly ceasing to ask for evidence. A question is owned by
 * the compliance library, phrased as a question, and only ever removed by someone editing the
 * library.
 *
 * Library-global on purpose: a requirement shared across twelve categories (migration 173)
 * could not gate on a category-scoped question without the question "which category's copy?"
 * having no answer. `group` organises them for the author and scopes nothing.
 */
export interface ComplianceQuestion {
  id: string;
  /** As a human is asked it — "Does the product transmit radio?", not "has_radio". */
  label: string;
  helpText?: string | null;
  dataType: TcfQuestionDataType;
  /** Choices for `enum`; ignored otherwise. */
  options: string[];
  /** Shown beside a `number` answer (W, kg, L). Display only. */
  unit?: string | null;
  group?: string | null;
  sortOrder: number;
  /**
   * True while nobody has confirmed what this question should ask. A requirement gated on one
   * still APPLIES and is flagged — see `evaluateRequirementApplicability`. Never silently
   * excluded, because under-asking for evidence is the failure an auditor finds.
   */
  needsReview: boolean;
  createdAt?: string;
  createdBy?: string | null;
}
