/**
 * The "is this still current?" badge, shared by the library card and the detail header.
 *
 * Five states, and the distinction between three of them is the whole point:
 *
 *   current          — checked, nothing newer. Green.
 *   newer_available  — checked, EUR-Lex has moved on. Amber, and says by how much.
 *   repealed         — checked, the act is no longer in force. Red.
 *   not checkable    — no CELEX. A standard, which no free API covers. GREY, never green:
 *                      "we did not look" must not read like "we looked and it is fine".
 *   error            — the source could not be reached. Also grey, for the same reason.
 *
 * A row that has never been checked shows nothing at all rather than a fifth colour — an
 * empty space is honest, and the library's "Check versions" button is right there.
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, RefreshCw, XCircle } from 'lucide-react';

import { versionCheckAgeDays } from '../../services';
import type { Regulation } from '../../types';

const relative = (days: number | null): string => {
  if (days === null) return '';
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${Math.round(days / 365)}y ago`;
};

export const versionBadgeTitle = (r: Regulation): string => {
  const when = r.versionCheckedAt ? ` Checked ${relative(versionCheckAgeDays(r))}.` : '';
  const d = r.versionDetail;
  switch (r.versionState) {
    case 'current':
      return `EUR-Lex shows nothing newer than what this row records.${when}`;
    case 'newer_available':
      return [
        d?.latestConsolidatedOn ? `Consolidated version dated ${d.latestConsolidatedOn}.` : '',
        d?.lastAmendedOn ? `Last amended ${d.lastAmendedOn}${d.amendments ? ` (${d.amendments} amendment${d.amendments === 1 ? '' : 's'})` : ''}.` : '',
      ].filter(Boolean).join(' ') + when;
    case 'repealed':
      return `EUR-Lex records an end of validity of ${d?.endOfValidity ?? 'a past date'}.${when}`;
    case 'not_found':
      return r.celexId
        ? `EUR-Lex has no document with CELEX ${r.celexId}.${when}`
        : 'No CELEX number, so nothing to query. EN, IEC and ISO standards have no free catalogue API — track this one by its source link and review date.';
    case 'error':
      return `The last check could not reach EUR-Lex, so this is unknown, not current.${when}`;
    default:
      return 'Never checked.';
  }
};

const STYLES: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
  current:         { cls: 'bg-emerald-100 text-emerald-700', icon: <CheckCircle2 size={9} />,   label: 'Current' },
  newer_available: { cls: 'bg-amber-100 text-amber-800',     icon: <AlertTriangle size={9} />,  label: 'Newer version' },
  repealed:        { cls: 'bg-rose-100 text-rose-700',       icon: <XCircle size={9} />,        label: 'Repealed' },
  not_found:       { cls: 'bg-gray-100 text-gray-500',       icon: <HelpCircle size={9} />,     label: 'Not checkable' },
  error:           { cls: 'bg-gray-100 text-gray-500',       icon: <RefreshCw size={9} />,      label: 'Check failed' },
};

const VersionBadge: React.FC<{ regulation: Regulation; className?: string }> = ({ regulation, className }) => {
  const state = regulation.versionState;
  if (!state) return null;
  const style = STYLES[state];
  if (!style) return null;
  return (
    <span
      className={`${style.cls} px-1.5 py-0.5 rounded-full text-[9px] font-bold inline-flex items-center gap-1 ${className ?? ''}`}
      title={versionBadgeTitle(regulation)}
    >
      {style.icon} {style.label}
    </span>
  );
};

export default VersionBadge;
