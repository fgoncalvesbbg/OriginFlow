/**
 * How a cell state looks and what it is called — one definition, shared by the grid, the
 * legend and the cell drawer.
 *
 * ProductToolkit's rule, carried over: **status is hue AND a label, never hue alone.**
 * Every state below pairs a colour with a word, so the grid stays readable to anyone who
 * cannot separate amber from red and so a screenshot in a ticket still says what it means.
 *
 * The four states are the whole vocabulary now that OriginFlow is the system of record —
 * PT needed eight because it was reconciling two systems. See §1 of
 * docs/originflow-attribute-viewer-merge-plan.md.
 */
import type { SkuCellState } from '../../../types';

export interface CellStatePresentation {
  /** Short label. Appears in the legend, the tooltip and the drawer's pill. */
  label: string;
  /** What this state means, in the words a reader needs to decide what to do. */
  description: string;
  /** Classes for the cell itself. */
  cell: string;
  /** Classes for the pill form (legend swatch, drawer badge). */
  pill: string;
}

export const CELL_STATES: Record<SkuCellState, CellStatePresentation> = {
  filled: {
    label: 'Filled',
    description: 'A value is stored and it is valid.',
    cell: 'text-gray-800',
    pill: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  empty: {
    label: 'Empty',
    description: 'Nobody has touched this cell. This is a gap to fill.',
    cell: 'text-gray-300',
    pill: 'bg-gray-50 text-gray-500 border-gray-200',
  },
  cleared: {
    label: 'Cleared',
    description:
      'Somebody emptied this on purpose — this product genuinely has none. Different from never having been filled.',
    cell: 'bg-rose-50 text-rose-700',
    pill: 'bg-rose-50 text-rose-700 border-rose-200',
  },
  invalid: {
    label: 'Invalid',
    description:
      'The stored value is not something this attribute can hold — an off-list option, or a non-number in a numeric field.',
    // The one state that earns a solid fill: it is the only one that means "this is wrong".
    cell: 'bg-red-600 text-white',
    pill: 'bg-red-600 text-white border-red-700',
  },
};

/** Order the legend reads in: what to do about it, most actionable first. */
export const CELL_STATE_ORDER: readonly SkuCellState[] = [
  'filled',
  'empty',
  'cleared',
  'invalid',
];

/**
 * EPREL is an OVERLAY, not a fifth cell state.
 *
 * What the registry says is a different question from what our own record holds — a cell can be
 * `filled` and also disagree with EPREL, and both facts matter at once. Folding them into one
 * state would force a choice between showing "we have a value" and "the registry disagrees".
 *
 * Violet is used because nothing else in this palette has spoken for it, so the axis reads as
 * separate rather than as a variation of one of the four.
 */
export const EPREL_PRESENTATION = {
  differs: {
    label: 'EPREL differs',
    description:
      'The registry holds a different figure for this field. One of the two is wrong — usually ours.',
    // A ring rather than a fill, so the cell's own state colour still shows through.
    cell: 'ring-1 ring-inset ring-violet-500',
    pill: 'bg-violet-50 text-violet-700 border-violet-300',
    text: 'text-violet-700',
  },
  onlyEprel: {
    label: 'EPREL has it',
    description:
      'The registry has a figure and we have none. This is a gap to fill, not a disagreement.',
    cell: 'ring-1 ring-inset ring-violet-300',
    pill: 'bg-violet-50 text-violet-600 border-violet-200',
    text: 'text-violet-600',
  },
} as const;
