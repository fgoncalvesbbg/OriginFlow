/**
 * Pure content helpers for the Project IM generator.
 *
 * Extracted from ProjectIMGenerator.tsx — these depend only on their arguments (no React state),
 * so they live here as standalone, testable functions.
 */

import { CategoryAttribute, BlockRef, FeatureConditionFields } from '../../../types';

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

/** Whether a submitted attribute `value` satisfies a section/ref condition label, per the attribute's data type. */
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

/** A ref carries a condition when it requires (or requires the absence of) an attribute. */
export const refHasCondition = (ref: BlockRef): boolean =>
  ref.kind !== 'sku_slot' && !!((ref as FeatureConditionFields).requires_feature || (ref as FeatureConditionFields).requires_feature_absent);
