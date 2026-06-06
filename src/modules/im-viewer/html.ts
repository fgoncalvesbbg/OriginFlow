/**
 * HTML helpers for the viewer: DOMPurify sanitization (the viewer is customer-facing, so all
 * manual HTML is sanitized before rendering) and the ISO callout wrapper.
 *
 * The ISO 7010 icons and callout markup are copied from the producer's im-resolver so callouts
 * render identically without importing anything from the host app.
 */

import DOMPurify from 'dompurify';
import { CalloutVariant } from './types';

// ISO 7010 W001 — General Warning / Caution
const ISO_W001 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><polygon points="50,6 94,87 6,87" fill="#FFDA00" stroke="#231F20" stroke-width="4.5" stroke-linejoin="round"/><rect x="46.5" y="30" width="7" height="31" rx="2.5" fill="#231F20"/><circle cx="50" cy="73" r="5.5" fill="#231F20"/></svg>`;
// ISO 7010 W012 — Electrical Hazard
const ISO_W012 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><polygon points="50,6 94,87 6,87" fill="#FFDA00" stroke="#231F20" stroke-width="4.5" stroke-linejoin="round"/><path d="M57,24 L39,55 L51,55 L44,78 L62,47 L50,47 Z" fill="#231F20"/></svg>`;
// ISO 7000-0190 / M002 — Information
const ISO_M002 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><circle cx="50" cy="50" r="46" fill="#0066B2"/><circle cx="50" cy="26" r="7" fill="white"/><rect x="43" y="40" width="14" height="36" rx="4" fill="white"/></svg>`;

const ISO_ICONS: Record<CalloutVariant, string> = {
  warning: ISO_W001,
  caution: ISO_W001,
  electric: ISO_W012,
  info: ISO_M002,
};
const CALLOUT_TITLES: Record<CalloutVariant, string> = {
  warning: 'WARNING',
  caution: 'CAUTION',
  electric: 'ELECTRIC HAZARD',
  info: 'INFO',
};

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

/** Sanitize a manual HTML string for safe rendering. SVG is allowed so ISO icons survive. */
export const sanitize = (html: string): string => {
  ensureHook();
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_ATTR: ['target', 'rel'],
  });
};

/** Wrap callout content in the ISO block markup (matches the producer's .imv-block-* styles). */
export const wrapCallout = (variant: CalloutVariant, contentHtml: string): string => {
  if (!contentHtml) return contentHtml;
  const icon = ISO_ICONS[variant];
  const title = CALLOUT_TITLES[variant] ?? variant.toUpperCase();
  return `<div class="imv-block-wrapper imv-block-${variant}"><div class="imv-block-icon">${icon}</div><div class="imv-block-content"><strong class="imv-block-title">${title}</strong>${contentHtml}</div></div>`;
};
