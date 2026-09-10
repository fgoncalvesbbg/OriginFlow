/**
 * Klarstein branding components.
 *
 * The palette and type live in src/styles/klarstein-brand.css, applied app-wide via the
 * `klarstein` class that index.html puts on <html>. What is left for a component is the
 * wordmark itself and the places it appears:
 *
 *   KlarsteinLogo    the wordmark, on a light or a dark ground
 *   PortalBrandBar   the wordmark strip used by the supplier-facing portals
 *
 * PortalBrandBar stays portal-specific because it does something the internal shell does
 * not need: it names the portal to someone who has never seen this tool, and prints
 * "Powered by OriginFlow" so a supplier chasing a broken link still has a name to quote.
 * Internally the nav rail carries the wordmark instead (src/components/Layout.tsx).
 */
import React from 'react';

/**
 * The Klarstein wordmark — the same Cloudinary vector the generated IM covers use
 * (DEFAULT_IM_LOGO_URL in src/config/im.constants.ts), so the mark on a portal, on the nav
 * rail and on the manual a supplier is reviewing are all the same asset.
 *
 * It is a 242x32 black-on-transparent wordmark, so it needs a light ground; pass
 * `variant="light"` on a dark one (the CSS inverts it, which for a pure-black asset yields
 * pure white). Kept as a remote <img> rather than an inlined SVG for the same reason the IM
 * does it: marketing re-points this asset, and every surface should follow.
 * `img-src https://res.cloudinary.com` is already allowed by the CSP.
 */
const KLARSTEIN_WORDMARK_URL =
  'https://res.cloudinary.com/chal-tec/image/upload/w_auto,q_auto,g_auto/marketing/gds/klarstein/logos/klarstein_vec.svg';

export const KlarsteinLogo: React.FC<{
  height?: number;
  className?: string;
  /** `light` inverts the black wordmark to white, for placement on a dark ground. */
  variant?: 'dark' | 'light';
}> = ({ height = 20, className = '', variant = 'dark' }) => (
  <img
    src={KLARSTEIN_WORDMARK_URL}
    alt="Klarstein"
    // Intrinsic ratio of the asset (242x32), given so nothing reflows while the SVG loads.
    width={Math.round((height * 242) / 32)}
    height={height}
    style={{ height, width: 'auto' }}
    className={`kl-wordmark ${variant === 'light' ? 'kl-wordmark--light' : ''} ${className}`}
  />
);

export interface PortalBrandBarProps {
  /**
   * What this portal is, in the supplier's words — "Supplier Portal", "Request For
   * Quotation", "Design Spec Review". Sits beside the wordmark, divided off from it, so the
   * wordmark stays the wordmark and is never read as part of the label.
   */
  label?: string;
  /** Optional right-hand slot (a print button, a language switch, a logout). */
  right?: React.ReactNode;
  /** Width of the inner container, matched to the page it sits above. */
  maxWidth?: string;
  className?: string;
}

/**
 * The slim Klarstein strip above a supplier portal's own header.
 *
 * Deliberately additive: it sits on top of whatever header the page already has rather
 * than replacing it, so no portal's layout or content moves. It carries the coral keyline
 * (`.kl-brandbar`).
 */
export const PortalBrandBar: React.FC<PortalBrandBarProps> = ({
  label,
  right,
  maxWidth = 'max-w-5xl',
  className = '',
}) => (
  <div className={`kl-brandbar no-print ${className}`}>
    <div className={`${maxWidth} mx-auto px-4 sm:px-6 h-14 flex items-center gap-4`}>
      <KlarsteinLogo height={20} />
      {label && (
        <>
          <span className="h-5 w-px bg-gray-200 shrink-0" aria-hidden="true" />
          <span className="text-sm font-semibold text-gray-700 truncate">{label}</span>
        </>
      )}
      <div className="flex-1" />
      {right}
      {/* Small, and last in the reading order — a supplier needs it only to name the tool
          when something is broken. */}
      <span className="hidden sm:block text-[10px] uppercase tracking-wide text-gray-400 shrink-0">
        Powered by OriginFlow
      </span>
    </div>
  </div>
);
