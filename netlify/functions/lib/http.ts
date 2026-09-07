/**
 * Shared HTTP/auth layer for every Netlify Function in this repo (netlify/functions/**).
 *
 * BEFORE THIS FILE: every handler re-implemented its own `NetlifyEvent` interface, its own
 * `json()` response helper, its own bearer-token extraction, and its own Supabase-session
 * check — copy-pasted across files with drift (translate.ts built its service-role client
 * WITHOUT `persistSession: false`, which every other handler had). Worse, every handler
 * stopped at "is this a valid session?" and never asked "is this caller allowed to touch
 * THIS projectId?" — an audit found that any authenticated account could render, merge or
 * clean up ANY project's print job, because the render functions verified the JWT but never
 * authorized it against the project the caller supplied in the request body.
 *
 * `authorizeProject` below is the fix for that specific hole. It re-runs the "does this
 * project exist" check AS THE CALLER — the anon key plus their own bearer token, via
 * `userClient` — instead of the service-role client every handler otherwise uses. Projects
 * already carry PM-scoped RLS (db_migrations/81_pm_scoped_rls_v2.sql): a PM sees only rows
 * where `projects.pm_id = auth.uid()`, an admin sees every row. So "is this project visible
 * to me" IS the authorization decision — this file does not need to reimplement the role
 * check, only ask Postgres the question the caller's own JWT is already scoped to answer.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface NetlifyEvent {
  httpMethod: string;
  body: string | null;
  headers: Record<string, string | undefined>;
  path?: string;
  queryStringParameters?: Record<string, string | undefined> | null;
}

export const json = (statusCode: number, payload: unknown) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});

/** Thrown when the server itself is missing required env vars (`serviceClient`/`userClient`).
 *  Handlers map this to 500 with the message below — the exact wording every handler already
 *  used, just no longer copy-pasted per file. */
export class ConfigError extends Error {}

/** Thrown by `authenticate` — handlers map this to 401. */
export class AuthError extends Error {}

/** Thrown by `authorizeProject` when the session is valid but the project is not visible to
 *  it (wrong PM, or no such project) — handlers map this to 403. */
export class ForbiddenError extends Error {}

/** Thrown by the `assert*` validators below — handlers map this to 400. */
export class ValidationError extends Error {}

const bearerToken = (event: NetlifyEvent): string =>
  (event.headers?.authorization || event.headers?.Authorization || '').replace(/^Bearer\s+/i, '').trim();

/**
 * One factory for the service-role client every handler that bypasses RLS needs (storage,
 * cross-project reads, writing im_print_renders, the SKU read API, …). Always
 * `persistSession: false` — there is no session to persist in a serverless invocation, and
 * translate.ts used to omit this, which is exactly the drift this factory removes.
 */
export const serviceClient = (): SupabaseClient => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new ConfigError('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not configured on the server.');
  }
  return createClient(url, key, { auth: { persistSession: false } });
};

/**
 * A client that runs AS THE CALLER — the anon key, with the caller's own bearer token
 * attached to every request, so Postgres RLS (not this function) decides what it can see.
 * This is what makes `authorizeProject` an honest re-derivation of "can this caller see this
 * row" rather than a second service-role query that would have to reimplement the RLS rule
 * (and could drift from it).
 *
 * SUPABASE_ANON_KEY is not a secret — it is the same value already shipped to every browser
 * as VITE_SUPABASE_ANON_KEY (see netlify.toml's SECRETS_SCAN_OMIT_KEYS) — so this falls back
 * to that var and no new Netlify environment variable has to be provisioned.
 */
export const userClient = (event: NetlifyEvent): SupabaseClient => {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new ConfigError('SUPABASE_URL / SUPABASE_ANON_KEY are not configured on the server.');
  }
  const token = bearerToken(event);
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
  });
};

/**
 * Bearer-token session check shared by every handler that requires sign-in. Throws
 * `AuthError` (handlers map this to 401) rather than returning a sentinel, so a handler
 * can never accidentally fall through a forgotten `if`.
 */
export const authenticate = async (event: NetlifyEvent): Promise<string> => {
  const token = bearerToken(event);
  if (!token) throw new AuthError('Authentication required.');
  const { data, error } = await serviceClient().auth.getUser(token);
  if (error || !data?.user) throw new AuthError('Invalid or expired session.');
  return data.user.email ?? data.user.id;
};

/**
 * Authenticates the caller, THEN authorizes them for one specific project by re-running
 * `select id from projects where id = :projectId` AS THE CALLER (see `userClient` above).
 * A row coming back IS the authorization — PM-scoped RLS already restricts it to the
 * caller's own projects (or every project, for an admin) — so no role check is duplicated
 * here.
 *
 * Throws `AuthError` (401) for no/invalid session, `ForbiddenError` (403) when the session
 * is valid but the project is not visible to it. Returns the caller's identity (email, or
 * id when no email is set) so a handler that also needs "who did this" (e.g. an
 * im_print_renders.created_by column) does not have to look the user up twice.
 */
export const authorizeProject = async (event: NetlifyEvent, projectId: string): Promise<string> => {
  const identity = await authenticate(event);
  const { data, error } = await userClient(event)
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .maybeSingle();
  if (error) throw new Error(`Could not verify project access: ${error.message}`);
  if (!data) throw new ForbiddenError('You do not have access to this project.');
  return identity;
};

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const JOB_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Every parameter interpolated into a Storage object key MUST pass this or `assertJobId` —
 * neither alphabet allows `/`, `..`, or any character that could escape the intended prefix.
 * Throws `ValidationError` (handlers map this to 400).
 */
export const assertUuid = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ValidationError(`${name} must be a UUID.`);
  }
  return value;
};

/** Throws `ValidationError` (handlers map this to 400). */
export const assertJobId = (value: unknown): string => {
  if (typeof value !== 'string' || !JOB_ID_RE.test(value)) {
    throw new ValidationError('jobId is invalid.');
  }
  return value;
};
