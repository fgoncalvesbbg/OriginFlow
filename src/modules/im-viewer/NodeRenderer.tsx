/**
 * Renders a single resolved node. HTML and callout content is sanitized; embedded <img> clicks
 * are delegated to the lightbox. Typed nodes get purpose-built renderers.
 */

import React from 'react';
import { ManualNode } from './types';
import { sanitize, wrapCallout } from './html';
import { AnnotatedImageSet } from './AnnotatedImageSet';
import { useLightbox } from './Lightbox';

const HtmlBlock: React.FC<{ id: string; html: string }> = ({ id, html }) => {
  const { open } = useLightbox();
  // Delegate clicks: open the lightbox when an embedded image is clicked.
  const onClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'IMG') {
      const src = target.getAttribute('src');
      if (src) open(src);
    }
  };
  return (
    <div
      id={`node-${id}`}
      className="imv-node imv-content"
      onClick={onClick}
      dangerouslySetInnerHTML={{ __html: sanitize(html) }}
    />
  );
};

export const NodeRenderer: React.FC<{ node: ManualNode; language?: string }> = ({ node, language }) => {
  switch (node.type) {
    case 'html':
      return <HtmlBlock id={node.id} html={node.html} />;

    case 'callout':
      return (
        <div
          id={`node-${node.id}`}
          className="imv-node imv-content"
          dangerouslySetInnerHTML={{ __html: sanitize(wrapCallout(node.variant, node.html, language)) }}
        />
      );

    case 'annotated_image_set':
      return (
        <div id={`node-${node.id}`} className="imv-node">
          <AnnotatedImageSet node={node} />
        </div>
      );

    case 'legend_table':
      return (
        <div id={`node-${node.id}`} className="imv-node">
          <table className="imv-legend-table">
            <tbody>
              {[...node.rows]
                .sort((a, b) => a.number - b.number)
                .map((r) => (
                  <tr key={r.number}>
                    <td>{r.number}</td>
                    <td>{r.label}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      );

    case 'step_sequence':
      return <StepSequence id={node.id} steps={node.steps} />;

    default:
      return null;
  }
};

const StepSequence: React.FC<{
  id: string;
  steps: Array<{ text: string; image?: { url: string; width: number; height: number } }>;
}> = ({ id, steps }) => {
  const { open } = useLightbox();
  return (
    <ol id={`node-${id}`} className="imv-node imv-steps">
      {steps.map((step, i) => (
        <li className="imv-step" key={i}>
          <span className="imv-step-num" aria-hidden />
          <div className="imv-step-body">
            <div>{step.text}</div>
            {step.image?.url && (
              <img
                className="imv-step-img"
                src={step.image.url}
                alt=""
                onClick={() => open(step.image!.url)}
              />
            )}
          </div>
        </li>
      ))}
    </ol>
  );
};
