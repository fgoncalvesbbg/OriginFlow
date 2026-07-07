/**
 * Pure content helpers for the Project IM generator.
 *
 * Extracted from ProjectIMGenerator.tsx — these depend only on their arguments (no React state),
 * so they live here as standalone, testable functions.
 */

import { BlockRef, FeatureConditionFields } from '../../../types';

// matchesConditionValue now lives in the shared attribute-condition utils so the resolver
// (published JSON) and this generator (preview/PDF) decide chapter visibility identically.
// Re-exported here to keep existing imports from this module working unchanged.
export { matchesConditionValue } from '../../../utils/attribute-condition.utils';

/** Escape a string for safe inclusion in XML output. */
export const escapeXml = (unsafe: string): string => {
  if (!unsafe) return '';
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
    return c;
  });
};

/** Extract all `{{ token }}` names from an HTML fragment. */
export const getTokensInFragment = (html: string): string[] => {
  const out: string[] = [];
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) out.push(m[1].trim());
  return out;
};

/** A ref carries a condition when it requires (or requires the absence of) an attribute. */
export const refHasCondition = (ref: BlockRef): boolean =>
  ref.kind !== 'sku_slot' && !!((ref as FeatureConditionFields).requires_feature || (ref as FeatureConditionFields).requires_feature_absent);
