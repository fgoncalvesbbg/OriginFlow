/**
 * Row-ref mutations for the IM template editor's row composer.
 *
 * `im_sections.content` is a legacy per-language mirror of a section's INLINE rows.
 * Two separate code paths still read it as real content whenever a section has no
 * inline ref left:
 *
 *   - the resolver's hybrid mode (`im-resolver.ts`) prepends it as a leading inline
 *     node, so it lands in every resolved manual and PDF;
 *   - the template editor's load-time shim synthesizes a row from it so the prose
 *     isn't invisible in the editor.
 *
 * Both exist to rescue sections written before shared blocks, where the prose lives
 * only in `content`. The cost is that deleting the last inline row without clearing
 * the mirror is a silent no-op: the row is back on the next load and never actually
 * left the published output. `removeRowRef` keeps the mirror in step with the rows.
 */

import { BlockRef, InlineBlockRef } from '../../types';

export interface RowRefsState {
  blockRefs: BlockRef[];
  /** The legacy per-language mirror — `{}` once no inline row remains. */
  content: Record<string, string>;
}

/**
 * Remove the row at `index`, returning the new refs plus the mirror they imply.
 * Removing a non-inline row (a shared block or SKU slot) leaves the mirror alone;
 * removing an inline row re-points it at the leading surviving inline row, or
 * empties it when that was the last one.
 */
export const removeRowRef = (
  refs: BlockRef[],
  index: number,
  content: Record<string, string> = {},
): RowRefsState => {
  const removed = refs[index];
  const blockRefs = refs.filter((_, i) => i !== index);
  if (removed?.kind !== 'inline') return { blockRefs, content };
  const survivor = blockRefs.find((r): r is InlineBlockRef => r.kind === 'inline');
  return { blockRefs, content: survivor ? { ...survivor.content } : {} };
};
