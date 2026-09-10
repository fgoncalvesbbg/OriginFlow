/**
 * OriginFlow wordmark mark. A single "origin" node flowing out to launches — the product's core
 * motion (one launch branching into steps, documents, suppliers). Steel-Slate tile so it reads on
 * both the dark rail and a light browser tab; the matching favicon lives in index.html.
 *
 * The tile carries the Klarstein accent (#5759e0, tertiary-surface). Beside it in the rail
 * sits the Klarstein wordmark — this mark is the product's, the wordmark is the brand's.
 */
import React from 'react';

export const Logo: React.FC<{ size?: number; className?: string; title?: string }> = ({
  size = 32,
  className = '',
  title = 'OriginFlow',
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 32 32"
    fill="none"
    role="img"
    aria-label={title}
    className={className}
  >
    <rect width="32" height="32" rx="7" fill="#5759e0" />
    <path
      d="M11 16 L22.5 10.5 M11 16 L22.5 21.5"
      stroke="#ffffff"
      strokeWidth="2.2"
      strokeLinecap="round"
      opacity="0.9"
    />
    <circle cx="11" cy="16" r="3.3" fill="#ffffff" />
    <circle cx="22.5" cy="10.5" r="2.4" fill="#ffffff" />
    <circle cx="22.5" cy="21.5" r="2.4" fill="#ffffff" />
  </svg>
);
