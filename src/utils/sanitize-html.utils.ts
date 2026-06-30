/**
 * Producer-side HTML sanitization.
 *
 * Manual/DB-sourced HTML (block content, section bodies, template back-page content) is rendered
 * via `dangerouslySetInnerHTML` in several admin/editor previews. This wraps DOMPurify so those
 * previews are XSS-safe and render identically to the customer-facing viewer.
 *
 * Config intentionally mirrors `src/modules/im-viewer/html.ts` (which keeps its own copy so the
 * viewer module stays standalone). Keep the two in sync if the allow-list changes.
 */

import DOMPurify from 'dompurify';

// Force every link to open safely in a new tab.
let hookInstalled = false;
const ensureHook = () => {
  if (hookInstalled) return;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  hookInstalled = true;
};

/** Sanitize a manual HTML string for safe rendering. SVG is allowed so ISO/callout icons survive. */
export const sanitizeHtml = (html: string): string => {
  if (!html) return '';
  ensureHook();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_ATTR: ['target', 'rel'],
  });
};
