/**
 * Badge — the canonical status pill (see DESIGN.md §Components: Status Badges).
 *
 * A tinted pill that pairs a hue with a text label, following the project's four-family status
 * vocabulary. Per DESIGN.md's Color-Plus-Shape Rule, status is never conveyed by color alone:
 * the label (and optional icon) always carries the meaning too.
 */

import React from 'react';

export type BadgeTone = 'indigo' | 'emerald' | 'rose' | 'amber' | 'gray';

const TONE_CLASSES: Record<BadgeTone, string> = {
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rose: 'bg-rose-50 text-rose-700 border-rose-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  gray: 'bg-gray-50 text-gray-600 border-gray-200',
};

export interface BadgeProps {
  tone?: BadgeTone;
  icon?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const Badge: React.FC<BadgeProps> = ({ tone = 'gray', icon, className = '', children }) => (
  <span
    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl border text-xs font-medium whitespace-nowrap ${TONE_CLASSES[tone]} ${className}`}
  >
    {icon}
    {children}
  </span>
);
