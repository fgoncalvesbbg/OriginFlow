/**
 * TypographySummary — read-only view of the global print typography a PDF export will use.
 *
 * Shared by both print-export dialogs (the project's production export and the template
 * editor's draft render), which is the point: a draft that showed different typography from
 * the real thing would be preview theatre. Lives here, alongside the other components both
 * IM editors reach for.
 */

import React from 'react';
import { Type } from 'lucide-react';
import type { PrintTypography } from '../../../services/im/im-print-settings.service';

/**
 * Deliberately not editable. Typography used to vary by product category (the font family
 * came from the category's IM template) and the leaflet's point sizes were typed in per
 * export, so two booklets from the same program could be set differently. It is now one
 * admin-owned setting per page size, and this panel exists so the operator can see what they
 * are about to get — and where to change it — without being able to diverge from it.
 */
export const TypographySummary: React.FC<{ typography: PrintTypography; pageSize: 'a4' | 'a5' }> = ({
  typography,
  pageSize,
}) => {
  const { fontFamily, bodyPt, headingPt, lineHeight, margins } = typography;
  const row = (label: string, value: string) => (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-xs font-medium text-gray-700 tabular-nums">{value}</span>
    </div>
  );
  return (
    <div className="border rounded-lg p-4 space-y-2 bg-gray-50/60">
      <div className="flex items-center gap-2">
        <Type size={14} className="text-gray-400" />
        <span className="text-sm font-semibold text-gray-700">Typography ({pageSize.toUpperCase()})</span>
      </div>
      <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 pt-1">
        {row('Font', fontFamily)}
        {row('Body', `${bodyPt} pt`)}
        {row('Headings', `${headingPt} pt`)}
        {row('Line spacing', `${lineHeight}×`)}
        {row('Margins T/B', `${margins.top} / ${margins.bottom} mm`)}
        {row('Margins L/R', `${margins.left} / ${margins.right} mm`)}
      </div>
      <p className="text-[11px] text-gray-400">
        One global house style per page size — the same for every product category. Admins change
        it in the Admin console → IM Print.
      </p>
    </div>
  );
};
