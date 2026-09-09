/**
 * Roadmap Creator — SKU text search.
 *
 * Pure, no React: the matching rule behind the detail panel's "+ Compare with…" picker and the
 * toolbar's "Jump to SKU" box, kept here so it can be asserted on directly rather than through a
 * rendered dropdown.
 *
 * `searchByTerms` was ProductToolkit's `shared/lib/textSearch.js` — 14 lines shared by three
 * pickers there. Inlined rather than re-shared: OriginFlow has no equivalent utility today, and
 * one caller does not justify a new shared module. Promote it to src/utils if a second one appears.
 */

/**
 * Records whose haystack contains EVERY whitespace-separated term in `query`, in input order.
 *
 * Terms may be given in any order — "122 fan" and "fan 122" match the same records — because
 * nobody remembers which half of a label they know first. An empty query returns every record.
 */
export function searchByTerms<T>(
  records: readonly T[],
  query: string,
  toHaystack: (record: T) => string,
): T[] {
  const terms = String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [...records];
  return records.filter(r => {
    const hay = toHaystack(r).toLowerCase();
    return terms.every(t => hay.includes(t));
  });
}

/**
 * SKUs matching `query`, in the order they were given.
 *
 * A SKU's haystack is its number AND its description, so it does not matter which half of the
 * label the planner happens to remember.
 */
export function searchSkus<T extends { sku: string; description?: string }>(
  skus: readonly T[] = [],
  query = '',
): T[] {
  return searchByTerms(skus, query, r => `${r.sku} ${r.description || ''}`);
}
