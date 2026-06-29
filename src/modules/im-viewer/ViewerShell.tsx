/**
 * Two-pane viewer chrome: sidebar (header, language switcher, search, TOC) + scrollable document.
 * Owns search state, scroll-spy (active section), and anchor navigation.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { ResolvedManual, ManifestLanguage } from './types';
import { buildSectionTree, flattenInReadingOrder } from './tree';
import { TableOfContents } from './TableOfContents';
import { SearchPanel } from './SearchPanel';
import { DocumentView } from './DocumentView';

interface Props {
  manual: ResolvedManual;
  languages?: ManifestLanguage[];
  currentLang: string;
  onChangeLang?: (lang: string) => void;
}

export const ViewerShell: React.FC<Props> = ({ manual, languages, currentLang, onChangeLang }) => {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const docRef = useRef<HTMLDivElement>(null);

  const tree = useMemo(() => buildSectionTree(manual.sections), [manual]);
  const ordered = useMemo(() => flattenInReadingOrder(tree), [tree]);

  // Tiny local debounce (no external dependency).
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 180);
    return () => clearTimeout(t);
  }, [query]);

  // Scroll-spy: highlight whichever section is nearest the top of the viewport.
  useEffect(() => {
    const root = docRef.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('[data-imv-section]'));
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActiveId(visible[0].target.id.replace(/^section-/, ''));
      },
      { root, rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [ordered]);

  const scrollTo = (elementId: string, flash = false) => {
    const root = docRef.current;
    const el = root?.querySelector<HTMLElement>(`#${CSS.escape(elementId)}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (flash) {
      el.classList.remove('imv-node-flash');
      // Force reflow so the animation restarts if the same node is targeted again.
      void el.offsetWidth;
      el.classList.add('imv-node-flash');
    }
  };

  const navigateSection = (sectionId: string) => scrollTo(`section-${sectionId}`);
  const navigateNode = (_sectionId: string, nodeId: string) => {
    setQuery('');
    setDebounced('');
    // Defer to let the TOC re-render before scrolling.
    requestAnimationFrame(() => scrollTo(`node-${nodeId}`, true));
  };

  const { metadata } = manual;

  return (
    <>
      <aside className="imv-sidebar">
        <div className="imv-sidebar-header">
          {metadata.companyLogoUrl && (
            <img className="imv-company-logo" src={metadata.companyLogoUrl} alt="" />
          )}
          {metadata.companyName && <div className="imv-company-name">{metadata.companyName}</div>}
          {languages && languages.length > 1 && (
            <select
              className="imv-lang-select"
              value={currentLang}
              onChange={(e) => onChangeLang?.(e.target.value)}
            >
              {languages.map((l) => (
                <option key={l.lang} value={l.lang}>
                  {l.lang.toUpperCase()}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="imv-search-box">
          <Search size={14} className="imv-search-icon" />
          <input
            className="imv-search-input"
            placeholder="Search the manual…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="imv-sidebar-scroll">
          {debounced.trim() ? (
            <SearchPanel manual={manual} query={debounced} onNavigate={navigateNode} />
          ) : (
            <TableOfContents tree={tree} activeId={activeId} onNavigate={navigateSection} />
          )}
        </div>
      </aside>

      <main className="imv-doc" ref={docRef}>
        <DocumentView ordered={ordered} metadata={metadata} language={manual.language} />
      </main>
    </>
  );
};
