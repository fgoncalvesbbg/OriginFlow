/**
 * The pre-publish issue model — what is wrong with a manual, and WHERE to fix it.
 *
 * The publish check used to produce flat strings ("Rated power — Safety"), which could only
 * ever be read: an operator with 30 missing values had to translate every line back into a
 * chapter and hunt for the field by hand. Every issue here therefore carries a `target`
 * alongside its label, so the review panel can put the editor on the exact field, chapter or
 * control that resolves it (see PublishReviewPanel and ProjectIMGenerator.jumpToIssue).
 *
 * Two pane kinds, because the two editor tabs fix different things:
 *   - `fill`    — a value, a required SKU slot, a chapter condition, the SKU binding: all of
 *                 these live in the "Fill values" form, found by a `data-fill-anchor`.
 *   - `content` — a missing translation is fixed by editing the chapter's text in that
 *                 language, so the target names both the chapter and the language.
 *
 * Anchor keys are built here rather than inlined at both ends: the producer (the form JSX)
 * and the consumer (the jump) have to agree on the string, and a silent typo would give a
 * click that does nothing — the exact failure this feature exists to remove.
 */

/** What kind of gap this is. Drives grouping, tone and the fix hint in the panel. */
export type PublishIssueKind =
  /** Publishing is impossible until it is fixed (no SKU bound, no SKU on the project). */
  | 'blocking'
  /** A placeholder or bound spec value nobody has filled. */
  | 'value'
  /** A required per-SKU content slot (table, image set, …) with nothing in it. */
  | 'slot'
  /** A conditional chapter whose driving attribute has no value, so it is left OUT. */
  | 'condition'
  /** Text authored in English with no translation in a required language. */
  | 'translation';

export type PublishIssueTarget =
  /** "Fill values" tab, scrolled to the element stamped with this anchor. */
  | { pane: 'fill'; anchor: string }
  /** "Add content" tab, with this chapter selected and this language active. */
  | { pane: 'content'; sectionId: string; lang: string };

export interface PublishIssue {
  /** Stable within one build — React key and de-dupe identity. */
  key: string;
  kind: PublishIssueKind;
  /** The thing that is missing, e.g. a field name or a chapter title. */
  label: string;
  /** Chapter the gap sits in, when it belongs to one. */
  sectionTitle?: string;
  /** One extra clause of context (why it matters, what happens if ignored). */
  detail?: string;
  /** Language code for a translation gap. */
  lang?: string;
  /**
   * Where clicking the row lands the editor. `null` when nothing in the editor can be
   * focused (e.g. "this project has no SKUs" — that is fixed on another page), in which
   * case the panel renders the row as text rather than as a dead button.
   */
  target: PublishIssueTarget | null;
}

/**
 * `data-fill-anchor` — stamped by the "Fill values" form on everything an issue can point
 * at. Matched in JS, not as a CSS selector: the values embed attribute/section ids and slot
 * names straight from data, which would otherwise need escaping to be selector-safe.
 */
export const FILL_ANCHOR_ATTR = 'data-fill-anchor';

/** The anchor vocabulary. Both sides of the jump import these — never hand-write the string. */
export const fillAnchors = {
  /** The "Bound SKUs" block. */
  skuBinding: 'sku-binding',
  /** A placeholder / bound-spec input, keyed by the placeholder or attribute id. */
  value: (id: string) => `value:${id}`,
  /** A required SKU content slot, keyed by its slot name. */
  slot: (slot: string) => `slot:${slot}`,
  /** One chapter's row in "Chapter Conditions". */
  condition: (sectionId: string) => `cond:${sectionId}`,
  /** A chapter's group in the form — the fallback when a finer anchor is not rendered. */
  section: (sectionId: string) => `section:${sectionId}`,
} as const;

export interface PublishIssueSummary {
  total: number;
  /** Issues that stop the publish outright. */
  blocking: number;
  /** Everything else — worth reviewing, publishable anyway. */
  advisory: number;
}

/** Counts for the badge, the rail and the publish button's wording. Pure. */
export const summarizePublishIssues = (issues: PublishIssue[]): PublishIssueSummary => {
  const blocking = issues.filter(i => i.kind === 'blocking').length;
  return { total: issues.length, blocking, advisory: issues.length - blocking };
};

export interface PublishIssueGroup {
  /** `kind`, plus the language for a translation group — unique, and the React key. */
  key: string;
  kind: PublishIssueKind;
  /** Set on translation groups only: one group per required language. */
  lang?: string;
  issues: PublishIssue[];
}

/**
 * Group issues for display: one group per kind, and one per LANGUAGE within translations
 * (a manual in eleven languages has eleven separate lists to work through, not one pile).
 *
 * Order follows first appearance rather than a fixed table, so the panel's order matches the
 * order the builder walks the manual in — chapters top to bottom, languages in publish order.
 */
export const groupPublishIssues = (issues: PublishIssue[]): PublishIssueGroup[] => {
  const groups: PublishIssueGroup[] = [];
  const byKey = new Map<string, PublishIssueGroup>();
  for (const issue of issues) {
    const key = issue.kind === 'translation' ? `translation:${issue.lang ?? ''}` : issue.kind;
    let group = byKey.get(key);
    if (!group) {
      group = { key, kind: issue.kind, ...(issue.kind === 'translation' && { lang: issue.lang }), issues: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.issues.push(issue);
  }
  return groups;
};
