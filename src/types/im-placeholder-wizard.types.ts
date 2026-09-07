/**
 * IM Placeholder Intake Wizard — registry + answer-store types (migrations 142/143).
 *
 * See src/services/im/im-placeholder-answer.service.ts for the service built on these
 * shapes, and CategoryAttribute (compliance.types.ts) for the attribute-bound half of the
 * registry — this file carries the ad-hoc (non-attribute) half plus the normalized
 * question/answer shapes the wizard reads and writes.
 */

import { CategoryAttribute } from './compliance.types';
import { FeatureConditionFields } from './im.types';

/**
 * Same three values as `WizardTier` (compliance.types.ts), kept as a separate type so this
 * file and compliance.types.ts don't need to import each other just to share one union —
 * `im_adhoc_placeholders.wizard_tier` and `category_attributes.wizard_tier` are independent
 * columns that happen to use the same vocabulary.
 */
export type PlaceholderTier = 'regulatory' | 'recommended' | 'optional';

/** `im_placeholder_answers.status`. */
export type PlaceholderAnswerStatus = 'pending' | 'answered' | 'not_applicable';

/** `im_placeholder_answers.scope` — project-wide value, or one SKU's overlay. */
export type PlaceholderAnswerScope = 'project' | 'sku';

/** `im_placeholder_answers.source` — where the CURRENT value came from. */
export type PlaceholderAnswerSource = 'manual' | 'pim' | 'eprel' | 'supplier' | 'carried_over';

/** `im_placeholder_answer_log.action` — see saveWizardAnswer for the status-transition mapping. */
export type PlaceholderAnswerLogAction =
  | 'answer'
  | 'update'
  | 'skip'
  | 'unskip'
  | 'mark_not_applicable'
  | 'clear';

/**
 * The wizard registry entry for a template-authored `.im-placeholder` chip that is NOT
 * bound to a category attribute (no `data-attr-id`) — one row per `im_adhoc_placeholders`.
 */
export interface AdhocPlaceholder {
  id: string;
  templateId: string;
  /** The chip's `data-id`, as authored by the chip-insertion UI. */
  placeholderId: string;
  label: string;
  type: 'text' | 'image';
  wizardTier: PlaceholderTier;
  wizardHint?: string | null;
  wizardNote?: string | null;
  wizardDefaultValue?: string | null;
  wizardCondition?: FeatureConditionFields | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One normalized wizard question, merging an attribute-bound placeholder and an ad-hoc one
 * into a single orderable shape (`getWizardQuestions` builds this list).
 */
export interface WizardQuestion {
  /** category_attributes.id (origin 'attribute') or im_adhoc_placeholders.placeholderId (origin 'adhoc'). */
  key: string;
  origin: 'attribute' | 'adhoc';
  label: string;
  type: 'text' | 'integer' | 'decimal' | 'boolean' | 'enum' | 'image';
  tier: PlaceholderTier;
  hint?: string | null;
  note?: string | null;
  defaultValue?: string | null;
  condition?: FeatureConditionFields | null;
  /** Set when origin === 'attribute' — feeds AttributeInput directly, unmodified. */
  attribute?: CategoryAttribute;
  /** Template section ids whose content references this key (chip or `{{token}}`). */
  sectionIds: string[];
  /** The current answer row for this manual (+ SKU, when scoped), or null if never answered. */
  currentAnswer?: PlaceholderAnswer | null;
}

/** `im_placeholder_answers` row, camelCased. */
export interface PlaceholderAnswer {
  id: string;
  projectImId: string;
  placeholderKey: string;
  scope: PlaceholderAnswerScope;
  projectSkuId?: string | null;
  status: PlaceholderAnswerStatus;
  value?: string | null;
  source: PlaceholderAnswerSource;
  skippedThenFilled: boolean;
  answeredBy?: string | null;
  answeredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** `im_placeholder_answer_log` row, camelCased — append-only. */
export interface PlaceholderAnswerLogEntry {
  id: string;
  projectImId?: string | null;
  projectSkuId?: string | null;
  skuNumberSnapshot: string;
  placeholderKey: string;
  scope: PlaceholderAnswerScope;
  action: PlaceholderAnswerLogAction;
  oldValue?: string | null;
  newValue?: string | null;
  oldStatus?: string | null;
  newStatus: PlaceholderAnswerStatus;
  changedBy?: string | null;
  changedByName: string;
  createdAt: string;
}
