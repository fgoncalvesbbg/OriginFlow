/**
 * Klarstein branding for the supplier-facing portals.
 *
 * Suppliers never see the internal app — they arrive on one tokenised route, do one thing
 * and leave. Those pages were the last place still presenting as "OriginFlow", a name no
 * supplier knows. These three pieces put Klarstein's identity on them:
 *
 *   PortalTheme      scopes src/styles/klarstein-brand.css to the page (palette + fonts)
 *   PortalBrandBar   the wordmark strip with the coral keyline
 *   KlarsteinLogo    the wordmark on its own, for headers that already have their own bar
 *
 * OriginFlow is not hidden, just demoted: `PortalBrandBar` prints "Powered by OriginFlow"
 * so a supplier chasing a broken link still has a name to quote, while the page reads as
 * Klarstein's.
 */
import React, { useEffect } from 'react';

/**
 * The Klarstein wordmark — the same Cloudinary vector the generated IM covers use
 * (DEFAULT_IM_LOGO_URL in src/config/im.constants.ts), so a supplier sees one identical
 * mark on the portal and on the manual they are reviewing.
 *
 * It is a 242x32 black-on-transparent wordmark, so it needs a light background; every
 * placement below is on white. Kept as a remote <img> rather than an inlined SVG for the
 * same reason the IM does it: marketing re-points this asset, and both surfaces should
 * follow. `img-src https://res.cloudinary.com` is already allowed by the CSP.
 */
export const KLARSTEIN_WORDMARK_URL =
  'https://res.cloudinary.com/chal-tec/image/upload/w_auto,q_auto,g_auto/marketing/gds/klarstein/logos/klarstein_vec.svg';

export const KlarsteinLogo: React.FC<{ height?: number; className?: string }> = ({
  height = 20,
  className = '',
}) => (
  <img
    src={KLARSTEIN_WORDMARK_URL}
    alt="Klarstein"
    // Intrinsic ratio of the asset (242x32), given so the header does not reflow while
    // the SVG loads over the network.
    width={Math.round((height * 242) / 32)}
    height={height}
    style={{ height, width: 'auto' }}
    className={`kl-wordmark ${className}`}
  />
);

export interface PortalBrandBarProps {
  /**
   * What this portal is, in the supplier's words — "Supplier Portal", "Request For
   * Quotation", "Design Spec Review". Sits beside the wordmark, divided off from it, so
   * the wordmark stays the wordmark and is never read as part of the label.
   */
  label?: string;
  /** Optional right-hand slot (a print button, a language switch, a logout). */
  right?: React.ReactNode;
  /** Width of the inner container, matched to the page it sits above. */
  maxWidth?: string;
  className?: string;
}

/**
 * The slim Klarstein strip that goes above a portal's own header.
 *
 * Deliberately additive: it sits on top of whatever header the page already has rather
 * than replacing it, so no portal's layout or content moves. It carries the coral keyline
 * (`.kl-brandbar`), which is the one piece of pure brand colour on these screens.
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

/**
 * Applies the Klarstein palette and fonts to the page for as long as it is mounted.
 *
 * The class goes on <html> rather than a wrapper <div> on purpose. Several portals build
 * their own full-viewport layout (`h-screen w-screen flex` in the review shell), and the
 * brand layer also has to reach `body`, which sets the app background. A wrapper element
 * would risk both; a class on the root element adds no node and cannot affect layout.
 *
 * Cleanup removes the class, so navigating from a portal back into the internal app
 * restores the standard theme. Rendering two of these at once is harmless — the class is
 * a set member, and only the last unmount clears it, which is also the last to leave.
 */
export const PortalTheme: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useEffect(() => {
    const root = document.documentElement;
    root.classList.add('klarstein-brand');
    return () => root.classList.remove('klarstein-brand');
  }, []);
  return <>{children}</>;
};
