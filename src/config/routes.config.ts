/**
 * Route configuration
 * Centralised path prefixes used across routing and auth detection.
 */

/**
 * Hash-router path segments that identify public supplier/compliance portals.
 *
 * Load-bearing: AuthContext skips PM session initialisation entirely on these routes, so an
 * anonymous visitor isn't held behind a profile read (and can't collide with a signed-in PM's
 * Web Lock). A public route missing from this list still renders, but slowly and for the
 * wrong reason — which is why the three token routes below were added alongside /review/im/.
 */
export const PORTAL_ROUTE_PREFIXES = [
  '/supplier/',
  '/supplier-dashboard/',
  '/compliance/supplier/',
  '/compliance/supplier-portal',
  '/sourcing/supplier/',
  '/review/im/',
  '/share/im/',
  '/attribute-request/',
];

/** Returns true if the current URL hash indicates a public portal route. */
export const isPortalRoute = (): boolean =>
  PORTAL_ROUTE_PREFIXES.some(prefix => window.location.hash.includes(prefix));
