/**
 * Renders the manual body: an optional cover banner from metadata, then every section in reading
 * order with heading levels derived from tree depth. Section/node ids become scroll anchors.
 */

import React from 'react';
import { ManualSection, TemplateMetadata } from './types';
import { NodeRenderer } from './NodeRenderer';

interface Props {
  ordered: Array<{ section: ManualSection; depth: number }>;
  metadata: TemplateMetadata;
}

const headingClass = (depth: number) => (depth === 0 ? 'imv-h1' : depth === 1 ? 'imv-h2' : 'imv-h3');

export const DocumentView: React.FC<Props> = ({ ordered, metadata }) => (
  <div className="imv-doc-inner">
    {(metadata.coverImageUrl || metadata.companyName) && (
      <header className="imv-cover">
        {metadata.coverImageUrl && (
          <img className="imv-cover-image" src={metadata.coverImageUrl} alt="" />
        )}
        {metadata.companyName && <div className="imv-cover-title">{metadata.companyName}</div>}
      </header>
    )}

    {ordered.map(({ section, depth }) => (
      <section key={section.id} id={`section-${section.id}`} className="imv-section" data-imv-section>
        {section.title && (
          <div className={`imv-section-title ${headingClass(depth)}`}>{section.title}</div>
        )}
        {section.nodes.map((node) => (
          <NodeRenderer key={node.id} node={node} />
        ))}
      </section>
    ))}

    {metadata.footerText && <div className="imv-caption" style={{ marginTop: 40 }}>{metadata.footerText}</div>}
  </div>
);
