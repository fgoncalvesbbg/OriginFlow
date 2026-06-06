/**
 * Nested table of contents built from the section tree. Clicking a node scrolls to its section;
 * the active section (from the document scroll-spy) is highlighted.
 */

import React from 'react';
import { SectionTreeNode } from './tree';

interface Props {
  tree: SectionTreeNode[];
  activeId: string | null;
  onNavigate: (sectionId: string) => void;
}

const renderNodes = (
  nodes: SectionTreeNode[],
  activeId: string | null,
  onNavigate: (id: string) => void,
): React.ReactNode =>
  nodes.map(({ section, depth, children }) => {
    const isChapter = section.layout === 'chapter' && depth === 0;
    return (
      <React.Fragment key={section.id}>
        <button
          className={`imv-toc-item${isChapter ? ' imv-toc-chapter' : ''}${
            activeId === section.id ? ' imv-active' : ''
          }`}
          style={{ paddingLeft: 16 + depth * 14 }}
          onClick={() => onNavigate(section.id)}
        >
          {section.title || 'Untitled'}
        </button>
        {children.length > 0 && renderNodes(children, activeId, onNavigate)}
      </React.Fragment>
    );
  });

export const TableOfContents: React.FC<Props> = ({ tree, activeId, onNavigate }) => (
  <nav>{renderNodes(tree, activeId, onNavigate)}</nav>
);
