/**
 * Sectioning for the regulation library — 36 flat cards is not a list, it is a wall.
 *
 * WHY THE GROUPING KEY IS READ OFF `referenceCode` AND NOTHING ELSE. The obvious idea is to
 * group by subject ("ecodesign", "food contact", "batteries"), because that is how a person
 * looks for a regulation. It is not implementable from the data we hold, and faking it would
 * be worse than not having it:
 *
 *   - Nothing records a subject. It would have to be inferred from keywords, and a keyword
 *     classifier hardcoded here rots the moment somebody adds a regulation it does not know —
 *     silently, into the wrong section, in a compliance tool.
 *   - The real subjects overlap. EN IEC 62133-2 is safety AND batteries; EN 18031-1 is radio
 *     AND cybersecurity. A single bucket per row would be arbitrary either way.
 *
 * So the kinds here are the ones the citation itself states — an EU directive, an EU
 * regulation, a harmonised standard — which is also a distinction that MEANS something to a
 * technical file: a directive states the obligation, a standard is the presumption of
 * conformity against it, and guidance is neither. `applicableCategories` would be the useful
 * *filter* to add next; it cannot be a grouping, because a regulation listing four categories
 * would render four times and multiply the very cards this exists to reduce.
 *
 * CLASSIFY FROM THE CODE, NOT THE TITLE. Titles cite other instruments and would mis-file on
 * a substring: `(EU) 2025/138`'s title is "harmonised standards for radio equipment in support
 * of the Directive 2014/53/EU essential requirements…", which contains both "harmonised
 * standards" and "Directive" while being neither. The reference code is the row's own identity
 * and is the only field read for the kind. An unrecognised code lands in 'other' rather than
 * being guessed at.
 */

import type { Regulation, RegulationStatus } from '../../types';

/** How the library is sectioned. 'none' is the old flat grid, kept as an escape hatch. */
export type RegulationGroupBy = 'kind' | 'jurisdiction' | 'status' | 'none';

/** What the citation says the document IS. Ordered as KIND_ORDER below, not alphabetically. */
export type RegulationKind =
  | 'directive'
  | 'euAct'
  | 'standard'
  | 'national'
  | 'international'
  | 'guidance'
  | 'other';

export const KIND_LABELS: Record<RegulationKind, string> = {
  directive: 'EU directives',
  euAct: 'EU regulations & decisions',
  standard: 'Standards (EN / IEC / ISO)',
  national: 'National law',
  international: 'International',
  guidance: 'Guidance & interpretation',
  other: 'Other',
};

/** Obligation first, then what demonstrates it, then the rest. */
export const KIND_ORDER: RegulationKind[] = [
  'directive', 'euAct', 'standard', 'national', 'international', 'guidance', 'other',
];

/**
 * `EN 60529`, `EN IEC 60335-1:2021`, `EN60335-2-24 Chapter 7`, `IEC 60335-2-30`, `EN 18031-1`.
 * The optional separator matters: real rows in this library omit the space after `EN`.
 */
const STANDARD_RE = /^(?:EN|DIN)\s*(?:IEC|ISO)?\s*\d|^(?:IEC|ISO)\s*\d/i;
/** `(EU) 2025/138`, `(EC) No 1907/2006` — an EU act cited without the leading word. */
const BARE_EU_RE = /^\((?:EU|EC|EEC)\)/i;

const STATUS_ORDER: RegulationStatus[] = ['active', 'expired', 'superseded'];
const STATUS_LABELS: Record<RegulationStatus, string> = {
  active: 'Active',
  expired: 'Expired',
  superseded: 'Superseded',
};

/**
 * What kind of document this citation names. Read `referenceCode` only — see the file header
 * for why the title is deliberately not consulted.
 *
 * Order of tests is load-bearing: `Delegated Regulation (EU) 2022/30` contains "Regulation",
 * and a standard's code never contains either word, so standards are matched first and the
 * legal-act words after.
 */
export const classifyRegulation = (regulation: Regulation): RegulationKind => {
  const code = (regulation.referenceCode ?? '').trim();
  if (!code) return 'other';

  if (STANDARD_RE.test(code)) return 'standard';
  if (/\bdirective\b/i.test(code)) return 'directive';
  if (/\bregulation\b/i.test(code) || BARE_EU_RE.test(code)) return 'euAct';
  if (/^UN\b/i.test(code)) return 'international';
  if (/\bguid(?:e|ance|eline)s?\b/i.test(code)) return 'guidance';

  // Nothing in the citation says what it is. A jurisdiction that is not the EU at least says
  // it is somebody's national law (`LFGB (BfR §30, §31)`, jurisdiction DE).
  const jurisdiction = (regulation.jurisdiction ?? '').trim().toUpperCase();
  if (jurisdiction && jurisdiction !== 'EU') return 'national';
  return 'other';
};

/** One section of the library. */
export interface RegulationGroup {
  /** Stable key — also the collapse identity, so it must not change between renders. */
  key: string;
  label: string;
  regulations: Regulation[];
}

/**
 * Section a list for rendering. Input order is preserved inside every group (the library
 * query already sorts by reference code), and empty groups are dropped rather than rendered
 * as headers over nothing.
 */
export const groupRegulations = (
  regulations: Regulation[],
  groupBy: RegulationGroupBy,
): RegulationGroup[] => {
  if (groupBy === 'none') {
    return regulations.length ? [{ key: 'all', label: 'All regulations', regulations }] : [];
  }

  const buckets = new Map<string, Regulation[]>();
  const push = (key: string, r: Regulation) => {
    const existing = buckets.get(key);
    if (existing) existing.push(r);
    else buckets.set(key, [r]);
  };

  if (groupBy === 'kind') {
    for (const r of regulations) push(classifyRegulation(r), r);
    return KIND_ORDER
      .filter(k => buckets.has(k))
      .map(k => ({ key: k, label: KIND_LABELS[k], regulations: buckets.get(k)! }));
  }

  if (groupBy === 'status') {
    for (const r of regulations) push(r.status, r);
    return STATUS_ORDER
      .filter(s => buckets.has(s))
      .map(s => ({ key: s, label: STATUS_LABELS[s], regulations: buckets.get(s)! }));
  }

  // Jurisdiction. Free text on the row and blank on several, so it is normalised for the key
  // and the blanks collect under one heading at the end rather than becoming a group each.
  const UNSPECIFIED = '__unspecified__';
  for (const r of regulations) {
    const j = (r.jurisdiction ?? '').trim();
    push(j ? j.toUpperCase() : UNSPECIFIED, r);
  }
  const named = [...buckets.keys()].filter(k => k !== UNSPECIFIED).sort((a, b) => {
    if (a === 'EU') return -1;            // the bulk of the library — lead with it
    if (b === 'EU') return 1;
    return a.localeCompare(b);
  });
  const groups = named.map(k => ({ key: k, label: k, regulations: buckets.get(k)! }));
  if (buckets.has(UNSPECIFIED)) {
    groups.push({
      key: UNSPECIFIED,
      label: 'No jurisdiction recorded',
      regulations: buckets.get(UNSPECIFIED)!,
    });
  }
  return groups;
};
