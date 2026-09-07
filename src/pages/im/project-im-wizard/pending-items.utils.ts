/**
 * "Open items" model for the placeholder intake wizard (wizard plan §5) — a parallel type
 * to `publish-issues.ts`'s `PublishIssue`/`groupPublishIssues`/`summarizePublishIssues`, not
 * reused directly: a pending WIZARD QUESTION and a PUBLISH ISSUE are different domains (a
 * question can be open without blocking anything, e.g. optional/recommended tier), but the
 * shape convention — one flat list, a `summarize` for counts, a `group` for display — is
 * deliberately mirrored so `OpenItemsList` reads like `PublishReviewPanel`'s sibling.
 */
import { PlaceholderAnswerScope } from '../../../types';

/** Same three values as `PlaceholderTier` (im-placeholder-wizard.types.ts), kept separate so
 *  this file doesn't need to import that one just to share a union — see that type's own
 *  doc comment for the same reasoning applied to `WizardTier`/`PlaceholderTier`. */
export type PendingItemTier = 'regulatory' | 'recommended' | 'optional';

/**
 * Where jumping this item lands — reuses the exact `PublishIssueTarget` "fill" shape
 * (`publish-issues.ts`) rather than a wizard-only one, so a pending item can be surfaced
 * (and jumped to) from the "Fill values" tab / publish review panel just as naturally as
 * from inside the wizard itself.
 */
export interface PendingItemTarget {
  pane: 'fill';
  anchor: string;
}

/** One still-open wizard question. */
export interface PendingItem {
  key: string;
  label: string;
  sectionTitle: string;
  tier: PendingItemTier;
  scope: PlaceholderAnswerScope;
  /** Set for a SKU-scoped item — which SKU it's open for. */
  skuNumber?: string;
  target: PendingItemTarget;
}

export interface PendingItemSummary {
  total: number;
  /** Items that block a non-draft publish/print (see ProjectIMGenerator.buildPublishIssues). */
  regulatory: number;
  /** Everything else — worth finishing, not required to publish. */
  advisory: number;
}

/** Counts for the wizard's progress chip and the project-level open-items badge. Pure. */
export const summarizePendingItems = (items: PendingItem[]): PendingItemSummary => {
  const regulatory = items.filter((i) => i.tier === 'regulatory').length;
  return { total: items.length, regulatory, advisory: items.length - regulatory };
};

export interface PendingItemGroup {
  /** The section title, doubling as the React key — good enough for display grouping. */
  key: string;
  sectionTitle: string;
  items: PendingItem[];
}

/**
 * Groups pending items by chapter, in first-appearance order — mirrors
 * `groupPublishIssues`'s "order follows first appearance, not a fixed table" convention.
 */
export const groupPendingItems = (items: PendingItem[]): PendingItemGroup[] => {
  const groups: PendingItemGroup[] = [];
  const bySection = new Map<string, PendingItemGroup>();
  for (const item of items) {
    let group = bySection.get(item.sectionTitle);
    if (!group) {
      group = { key: item.sectionTitle, sectionTitle: item.sectionTitle, items: [] };
      bySection.set(item.sectionTitle, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
};
