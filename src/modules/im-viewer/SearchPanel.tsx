/**
 * Search results derived from the manual's prebuilt searchIndex. Shows section title + a
 * highlighted snippet; clicking scrolls to the matching node.
 */

import React, { useMemo } from 'react';
import { ResolvedManual } from './types';

interface Props {
  manual: ResolvedManual;
  query: string;
  onNavigate: (sectionId: string, nodeId: string) => void;
}

const SNIPPET_PAD = 40;

const buildSnippet = (text: string, q: string): React.ReactNode => {
  const lower = text.toLowerCase();
  const at = lower.indexOf(q.toLowerCase());
  if (at < 0) return text.slice(0, 80);
  const start = Math.max(0, at - SNIPPET_PAD);
  const end = Math.min(text.length, at + q.length + SNIPPET_PAD);
  return (
    <>
      {start > 0 && '…'}
      {text.slice(start, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length, end)}
      {end < text.length && '…'}
    </>
  );
};

export const SearchPanel: React.FC<Props> = ({ manual, query, onNavigate }) => {
  const titles = useMemo(() => {
    const map = new Map<string, string>();
    manual.sections.forEach((s) => map.set(s.id, s.title));
    return map;
  }, [manual]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return manual.searchIndex
      .filter((e) => e.text && e.text.toLowerCase().includes(q))
      .slice(0, 50);
  }, [manual, query]);

  if (!query.trim()) return null;

  if (results.length === 0) {
    return <div className="imv-search-empty">No matches for “{query}”.</div>;
  }

  return (
    <div>
      {results.map((r, i) => (
        <button
          key={`${r.nodeId}-${i}`}
          className="imv-search-result"
          onClick={() => onNavigate(r.sectionId, r.nodeId)}
        >
          <div className="imv-search-result-title">{titles.get(r.sectionId) || 'Untitled'}</div>
          <div className="imv-search-result-snippet">{buildSnippet(r.text, query.trim())}</div>
        </button>
      ))}
    </div>
  );
};
