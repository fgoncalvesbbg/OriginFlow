/**
 * Supplier/compliance portal lockout signalling.
 *
 * The portal auth RPCs enforce a per-token brute-force lockout in the database
 * (see migration portal_bruteforce_ratelimit_*). When a caller is locked out the
 * function raises `PORTAL_LOCKED:<seconds>`, which surfaces here as a thrown
 * DataAccessError whose message contains that token. This helper turns it into a
 * typed, user-friendly error so portals can show a clear "please wait" message
 * instead of a misleading "invalid code".
 */

const LOCK_RE = /PORTAL_LOCKED:(\d+)/;

const formatWait = (seconds: number): string => {
  if (seconds <= 0) return 'a moment';
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const mins = Math.ceil(seconds / 60);
  return `${mins} minute${mins === 1 ? '' : 's'}`;
};

export class PortalLockedError extends Error {
  readonly retryAfterSeconds: number;
  constructor(seconds: number) {
    super(
      `Too many incorrect attempts. For security, access is paused — please wait ` +
        `${formatWait(seconds)} and try again.`,
    );
    this.name = 'PortalLockedError';
    this.retryAfterSeconds = seconds;
  }
}

/** If `e` represents a portal lockout, return a typed PortalLockedError; else null. */
export const asPortalLockedError = (e: unknown): PortalLockedError | null => {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const m = msg.match(LOCK_RE);
  return m ? new PortalLockedError(parseInt(m[1], 10)) : null;
};

/** True when the error is a portal lockout. */
export const isPortalLockedError = (e: unknown): boolean =>
  e instanceof PortalLockedError || asPortalLockedError(e) !== null;
