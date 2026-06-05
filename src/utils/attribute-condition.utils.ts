/**
 * Attribute-condition gate — shared between IM block refs and TCF compliance
 * requirements. A condition references a category attribute by id and is
 * satisfied when the supplied attribute values match (present/absent, enum
 * label match, numeric range). Kept dependency-free so both the IM resolver
 * and the compliance module can import it without coupling to each other.
 */
import { FeatureConditionFields } from '../types';

export const isFalsy = (v: string | boolean | undefined): boolean =>
  v === undefined || v === false || v === 'false' || v === '';

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
