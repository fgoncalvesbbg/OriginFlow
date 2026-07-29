/**
 * Vendor-neutral authentication port.
 *
 * This is the smallest of the three ports and the most expensive to re-implement.
 * Supabase Auth issues the JWT that the database's row-level-security policies read via
 * `auth.uid()` — 110 policy references. So swapping the identity provider is not a
 * matter of satisfying this interface; it also invalidates the authorization model that
 * currently lives in the database. See ../PORTING.md.
 *
 * The interface stays this small on purpose: password reset, invites and MFA are not
 * exposed because the app does not use them. Adding them later is additive.
 */

export interface AuthUser {
  id: string;
  email?: string | null;
  /**
   * Free-form attributes attached at sign-up (currently just `{ name }`). Symmetric with
   * `signUp`'s `metadata`. Read it for display defaults only — the `profiles` table, not the
   * identity provider, is the system of record for a user's name and role.
   */
  metadata?: Record<string, unknown>;
}

export interface AuthSession {
  /** Bearer token for calls to our own serverless functions. */
  accessToken: string;
  user: AuthUser;
}

/**
 * Lifecycle events the app reacts to. Deliberately a closed set — `AuthContext`
 * branches on `SIGNED_OUT`, and treats everything else as "session present".
 */
export type AuthChangeEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY';

export interface AuthSubscription {
  unsubscribe(): void;
}

export interface AuthPort {
  /**
   * Current session, or `null` when unauthenticated. Resolves `null` rather than
   * rejecting when there simply is no session (the common case on public portal routes);
   * rejects only on a genuine transport failure.
   */
  getSession(): Promise<AuthSession | null>;

  /** Current user, or `null` when unauthenticated. */
  getUser(): Promise<AuthUser | null>;

  /** Rejects with a `DataAccessError` on bad credentials. */
  signInWithPassword(email: string, password: string): Promise<AuthSession>;

  /** `metadata` is merged into the user record (currently just `{ name }`). */
  signUp(email: string, password: string, metadata?: Record<string, unknown>): Promise<void>;

  signOut(): Promise<void>;

  /**
   * Force a token refresh. Used by the save-retry path: a stale token presents as a
   * stalled write, and refreshing before a retry is cheap and harmless when auth was fine.
   * Never rejects — a failed refresh is not itself actionable.
   */
  refreshSession(): Promise<void>;

  onAuthStateChange(
    callback: (event: AuthChangeEvent, session: AuthSession | null) => void,
  ): AuthSubscription;
}
