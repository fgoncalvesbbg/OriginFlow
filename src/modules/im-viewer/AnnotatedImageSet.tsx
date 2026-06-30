/**
 * Renders an annotated image set: each image with numbered markers positioned at the stored
 * normalized coordinates, an optional caption, and a numbered legend. Clicking opens the lightbox.
 */

import React from 'react';
import { AnnotatedImageSetNode } from './types';
import { useLightbox } from './Lightbox';

export const AnnotatedImageSet: React.FC<{ node: AnnotatedImageSetNode }> = ({ node }) => {
  const { open } = useLightbox();

  return (
    <div className="imv-annotated">
      {node.images.map((img, i) => (
        <div key={i} style={{ marginBottom: 20 }}>
          <div
            className="imv-annotated-frame"
            onClick={() => open(img.url)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') open(img.url); }}
          >
            <img src={img.url} alt={img.alt} />
            {img.annotations.map((a) => (
              <span
                key={a.number}
                className="imv-marker"
                style={{ left: `${a.x * 100}%`, top: `${a.y * 100}%` }}
                title={a.label}
              >
                {a.number}
              </span>
            ))}
          </div>
          {img.caption && <div className="imv-caption">{img.caption}</div>}
          {img.annotations.length > 0 && (
            <ul className="imv-legend">
              {[...img.annotations]
                .sort((a, b) => a.number - b.number)
                .map((a) => (
                  <li key={a.number}>
                    <span className="imv-legend-num">{a.number}</span>
                    <span>{a.label}</span>
                  </li>
                ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
};
