/**
 * Attribute-condition gate — shared between IM block refs and TCF compliance
 * requirements. A condition references a category attribute by id and is
 * satisfied when the supplied attribute values match (present/absent, enum
 * label match, numeric range). Kept dependency-free so both the IM resolver
 * and the compliance module can import it without coupling to each other.
 */
import { FeatureConditionFields, CategoryAttribute } from '../types';

const isFalsy = (v: string | boolean | undefined): boolean =>
  v === undefined || v === false || v === 'false' || v === '';

/**
 * Whether a submitted attribute `value` satisfies a section/ref condition `conditionLabel`,
 * interpreted per the attribute's data type. Shared by the Project IM generator (preview/PDF)
 * and the resolver (published JSON) so both decide chapter visibility identically. Kept here,
 * dependency-free, alongside passesFeatureGate.
 */
export const matchesConditionValue = (value: string, conditionLabel: string, attr: CategoryAttribute): boolean => {
  const v = value.trim();
  const cv = conditionLabel.trim();
  switch (attr.dataType) {
    case 'boolean':
      return (v === 'true' && cv === 'Yes') || (v === 'false' && cv === 'No');
    case 'enum':
      return cv.split(',').map(s => s.trim()).includes(v);
    case 'integer':
    case 'decimal': {
      const num = parseFloat(v);
      if (isNaN(num)) return false;
      const rangeMatch = cv.match(/^([\d.]+)\s*[–\-]\s*([\d.]+)/);
      if (rangeMatch) return num >= parseFloat(rangeMatch[1]) && num <= parseFloat(rangeMatch[2]);
      return parseFloat(cv.replace(/[^\d.]/g, '')) === num;
    }
    case 'text':
      return v.toLowerCase() === cv.toLowerCase();
    default:
      return true;
  }
};

/**
 * Feature-condition visibility gate. Returns false when the ref should be
 * hidden (all set conditions must pass — AND logic).
 */
export const passesFeatureGate = (
  ref: FeatureConditionFields,
  placeholderData: Record<string, string>,
  conditions: Record<string, boolean | string>,
): boolean => {
  if (ref.requires_feature) {
    const raw = placeholderData[ref.requires_feature] ?? conditions[ref.requires_feature];
    if (isFalsy(raw)) return false;
    const val = String(raw);

    // Label match: comma-separated expected values (enum, bool, text)
    if (ref.requires_feature_label) {
      const expected = ref.requires_feature_label.split(',').map(s => s.trim()).filter(Boolean);
      if (expected.length && !expected.includes(val)) return false;
    }

    // Numeric range match (independent of label — both can be set together)
    if (ref.requires_feature_num_min || ref.requires_feature_num_max) {
      const num = parseFloat(val);
      if (isNaN(num)) return false;
      if (ref.requires_feature_num_min && num < parseFloat(ref.requires_feature_num_min)) return false;
      if (ref.requires_feature_num_max && num > parseFloat(ref.requires_feature_num_max)) return false;
    }
  }
  if (ref.requires_feature_absent) {
    const val = placeholderData[ref.requires_feature_absent] ?? conditions[ref.requires_feature_absent];
    if (!isFalsy(val)) return false;
  }
  return true;
};

/** The five `wizard_depends_on_*` columns shared by category_attributes and im_adhoc_placeholders. */
export interface WizardDependsOnRow {
  wizard_depends_on_attribute_id?: string | null;
  wizard_depends_on_label?: string | null;
  wizard_depends_on_num_min?: string | null;
  wizard_depends_on_num_max?: string | null;
  wizard_depends_on_absent?: boolean | null;
}

/**
 * Builds the placeholder wizard's dependency gate (migration 142) into the same
 * `FeatureConditionFields` shape IM block refs already use with `passesFeatureGate`, so a
 * wizard question's visibility is computed by the identical gate rather than a parallel one.
 *
 * The DB models a wizard dependency as ONE attribute plus a present/absent flag —
 * `wizard_depends_on_absent` chooses which half of FeatureConditionFields it becomes,
 * since a wizard question only ever depends on one prior answer (never an independent
 * presence-of-X-AND-absence-of-Y pair, which is what the fuller `requires_feature` +
 * `requires_feature_absent` combination on a block ref can express).
 */
export const wizardConditionFromRow = (row: WizardDependsOnRow): FeatureConditionFields | null => {
  const attrId = row.wizard_depends_on_attribute_id;
  if (!attrId) return null;
  if (row.wizard_depends_on_absent) return { requires_feature_absent: attrId };
  return {
    requires_feature: attrId,
    requires_feature_label: row.wizard_depends_on_label ?? null,
    requires_feature_num_min: row.wizard_depends_on_num_min ?? null,
    requires_feature_num_max: row.wizard_depends_on_num_max ?? null,
  };
};
