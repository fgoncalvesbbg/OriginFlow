/**
 * Read side of the Translation Memory admin console (migration 121).
 *
 * Reads only, deliberately. Every write to the memory is a governed act and lives in
 * im-tm-write.service.ts next to the rules that explain it — approval in particular must
 * stay a browser call under the admin's own JWT, because a service-role connection
 * bypasses the governance trigger entirely.
 *
 * Why these go through RPCs rather than `db.select`: the data port exposes no OFFSET and
 * no text-search operator (see db_migrations/121_im_tm_admin_browse.sql for the full
 * reasoning). Paging and search therefore happen in the database, which is also where the
 * unpaged row count lives.
 */

import { db, orEmpty } from '../../data';
import { isLive } from '../../config/environment.config';
import { mapTmSegmentRow, type TmSegmentRecord } from './im-tm-lookup.service';

export type TmStatus = 'unreviewed' | 'approved' | 'deprecated';
export type TmBrowseSort = 'recent' | 'oldest' | 'queue';

/** Every field optional: an omitted filter means "no constraint", not "match nothing". */
export interface TmBrowseFilters {
  status?: readonly TmStatus[];
  targetLocales?: readonly string[];
  origins?: readonly string[];
  domainCategoryId?: string | null;
  /** Case-insensitive substring over source, raw source and target. */
  search?: string;
  sort?: TmBrowseSort;
}

export interface TmBrowsePage {
  rows: TmSegmentRecord[];
  /** Matching rows before paging — the pager needs this, not `rows.length`. */
  total: number;
}

/** Per (status, locale, origin) counts, for the stats strip and the facet counts. */
export interface TmStatsRow {
  status: TmStatus;
  targetLocale: string;
  origin: string;
  count: number;
}

/** One row of `im_tm_leverage`: reuse measured per locale, domain and match tier. */
export interface TmLeverageRow {
  targetLocale: string;
  domainCategoryId: string | null;
  tier: string;
  events: number;
  chars: number;
  appliedEvents: number;
  appliedChars: number;
}

/**
 * A page of the memory.
 *
 * `im_tm_browse` returns the segment as a composite column, so each row arrives as
 * `{ segment: {...}, total_count }` and the existing snake→camel mapper reads it
 * unchanged. An empty page still carries a total of 0, which is why `total` is read
 * defensively rather than from `rows[0]`.
 */
export const browseTmSegments = async (
  filters: TmBrowseFilters = {},
  page: { limit?: number; offset?: number } = {},
): Promise<TmBrowsePage> => {
  if (!isLive) return { rows: [], total: 0 };

  const search = filters.search?.trim();
  const raw = await orEmpty(
    db.rpc<any[]>('im_tm_browse', {
      p_status: filters.status?.length ? [...filters.status] : null,
      p_target_locales: filters.targetLocales?.length ? [...filters.targetLocales] : null,
      p_origins: filters.origins?.length ? [...filters.origins] : null,
      p_domain_category: filters.domainCategoryId || null,
      p_search: search || null,
      p_sort: filters.sort ?? 'recent',
      p_limit: page.limit ?? 50,
      p_offset: page.offset ?? 0,
    }),
    '[browseTmSegments]',
  );

  const rows = (raw ?? []).filter((r) => r?.segment).map((r) => mapTmSegmentRow(r.segment));
  const total = Number(raw?.[0]?.total_count ?? 0);
  return { rows, total: Number.isFinite(total) ? total : rows.length };
};

/** Counts grouped by status, locale and origin. The caller pivots. */
export const getTmStats = async (): Promise<TmStatsRow[]> => {
  if (!isLive) return [];
  const raw = await orEmpty(db.rpc<any[]>('im_tm_stats'), '[getTmStats]');
  return (raw ?? []).map((r) => ({
    status: r.status,
    targetLocale: r.target_locale,
    origin: r.origin,
    count: Number(r.n ?? 0),
  }));
};

/**
 * Reuse leverage from the append-only log.
 *
 * Returns rows per (locale, domain, tier) and deliberately offers NO blended percentage —
 * a single "TM saved us X%" number averages a perfect match and a fuzzy suggestion into
 * one figure that means nothing. Present the tiers, and `applied` separately from
 * `reference`. See the column comment on `im_tm_reuse_log.tier`.
 */
export const getTmLeverage = async (
  params: { from?: string; to?: string; targetLocales?: readonly string[]; templateId?: string } = {},
): Promise<TmLeverageRow[]> => {
  if (!isLive) return [];
  const raw = await orEmpty(
    db.rpc<any[]>('im_tm_leverage', {
      p_from: params.from ?? null,
      p_to: params.to ?? null,
      p_target_locales: params.targetLocales?.length ? [...params.targetLocales] : null,
      p_template_id: params.templateId ?? null,
    }),
    '[getTmLeverage]',
  );
  return (raw ?? []).map((r) => ({
    targetLocale: r.target_locale,
    domainCategoryId: r.domain_category_id ?? null,
    tier: r.tier,
    events: Number(r.events ?? 0),
    chars: Number(r.chars ?? 0),
    appliedEvents: Number(r.applied_events ?? 0),
    appliedChars: Number(r.applied_chars ?? 0),
  }));
};
