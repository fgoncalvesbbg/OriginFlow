/**
 * Supabase (GoTrue) implementation of `AuthPort`.
 *
 * Confines the `{ data: { session }, error }` result shape, the snake_case token field, and
 * the driver's event vocabulary. The session object handed upward carries only what the app
 * genuinely consumes — an id, an email, and the bearer token our serverless functions verify.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Session, User } from '@supabase/supabase-js';
import type { AuthChangeEvent, AuthPort, AuthSession, AuthUser } from '../ports/auth.port';
import { toDataError } from './errors';

const toUser = (user: User): AuthUser => ({
  id: user.id,
  email: user.email ?? null,
  metadata: user.user_metadata ?? undefined,
});

const toSession = (session: Session | null): AuthSession | null =>
  session?.user ? { accessToken: session.access_token, user: toUser(session.user) } : null;

/** Events the app does not branch on collapse onto USER_UPDATED rather than widening the port. */
const KNOWN_EVENTS: readonly string[] = [
  'INITIAL_SESSION',
  'SIGNED_IN',
  'SIGNED_OUT',
  'TOKEN_REFRESHED',
  'USER_UPDATED',
  'PASSWORD_RECOVERY',
];

const toEvent = (event: string): AuthChangeEvent =>
  (KNOWN_EVENTS.includes(event) ? event : 'USER_UPDATED') as AuthChangeEvent;

export const createSupabaseAuth = (client: SupabaseClient): AuthPort => ({
  async getSession() {
    const { data, error } = await client.auth.getSession();
    if (error) {
      // A failed session check is routine on public portal routes, where no session
      // exists at all. Treated as "unauthenticated" rather than an app-level failure.
      console.warn('[auth] session check failed:', error.message);
      return null;
    }
    return toSession(data.session);
  },

  async getUser() {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) return null;
    return toUser(data.user);
  },

  async signInWithPassword(email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw toDataError(error, 'auth.signInWithPassword');
    const session = toSession(data.session);
    if (!session) throw toDataError({ message: 'Login failed' }, 'auth.signInWithPassword');
    return session;
  },

  async signUp(email, password, metadata) {
    const { error } = await client.auth.signUp({
      email,
      password,
      options: metadata ? { data: metadata } : undefined,
    });
    if (error) throw toDataError(error, 'auth.signUp');
  },

  async signOut() {
    await client.auth.signOut();
  },

  async refreshSession() {
    // Best-effort by contract: callers use this to shake off a stale token before a
    // retry, and a failure here is not independently actionable.
    await client.auth.refreshSession().catch(() => undefined);
  },

  onAuthStateChange(callback) {
    const { data } = client.auth.onAuthStateChange((event, session) => {
      callback(toEvent(event), toSession(session));
    });
    return { unsubscribe: () => data.subscription.unsubscribe() };
  },
});
