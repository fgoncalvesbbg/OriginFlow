/**
 * Route configuration
 * Centralised path prefixes used across routing and auth detection.
 */

/** Hash-router path segments that identify public supplier/compliance portals. */
export const PORTAL_ROUTE_PREFIXES = [
  '/supplier/',
  '/supplier-dashboard/',
  '/compliance/supplier/',
  '/compliance/supplier-portal',
  '/sourcing/supplier/',
];

/** Returns true if the current URL hash indicates a public portal route. */
export const isPortalRoute = (): boolean =>
  PORTAL_ROUTE_PREFIXES.some(prefix => window.location.hash.includes(prefix));
