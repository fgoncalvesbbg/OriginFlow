/**
 * Card — the canonical raised-surface container (see DESIGN.md §Components: Cards + §4 Elevation).
 *
 * Encapsulates the "One-Border-Or-One-Shadow Rule": a resting surface gets a hairline border OR a
 * soft resting shadow, never both. Default is `bordered` (crisp, enterprise); `elevated` uses the
 * subtle resting shadow instead for surfaces that should read as lifted. Radius is the shipped
 * card corner (rounded-xl = 8px here) and never nests another Card.
 *
 * Padding is intentionally NOT baked in — callers pass it via `className` (p-4 / p-5 / p-6) so the
 * same primitive serves stat widgets, filter bars, and table shells without variant sprawl.
 */

import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Use the resting shadow instead of a border (still never both). */
  elevated?: boolean;
  /** Add a subtle hover border shift for clickable/linked cards. */
  interactive?: boolean;
}

export const Card: React.FC<CardProps> = ({
  elevated = false,
  interactive = false,
  className = '',
  children,
  ...rest
}) => (
  <div
    className={`bg-surface rounded-xl ${elevated ? 'shadow-sm' : 'border border-border'} ${
      interactive ? 'transition-colors hover:border-gray-300' : ''
    } ${className}`}
    {...rest}
  >
    {children}
  </div>
);
