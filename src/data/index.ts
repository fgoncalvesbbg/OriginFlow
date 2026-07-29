/**
 * Composition root for data access — the ONLY module the app imports to reach a backend.
 *
 * Swapping Supabase for an internal SQL Server (or for an HTTP client against our own API)
 * means writing a sibling of `./supabase` and changing the four bindings below. Nothing in
 * `src/services`, `src/pages` or `src/context` names a vendor. `./PORTING.md` records what
 * is genuinely NOT portable and must be rebuilt rather than re-wired.
 *
 * Two database instances exist because the app has two trust contexts:
 *
 *  - `db`       authenticated staff client. Row-level-security policies read the caller's
 *               JWT (`auth.uid()`), so authorization happens in the database.
 *  - `portalDb` unauthenticated supplier-portal client. It can ONLY reach `rpc()` routines,
 *               which are SECURITY DEFINER functions that take an opaque token and enforce
 *               access themselves. Never use it for direct table reads.
 */
import { createSupabaseDatabase } from './supabase/database.adapter';
import { createSupabaseAuth } from './supabase/auth.adapter';
import { createSupabaseStorage } from './supabase/storage.adapter';
import { supabaseClient, supabasePortalClient } from './supabase/client';
import { createUnconfiguredDatabase } from './unconfigured';
import { isLive } from '../config/environment.config';
import type { AuthPort, DatabasePort, StoragePort } from './ports';

/** Authenticated staff data access. Authorization enforced by RLS against the caller's JWT. */
export const db: DatabasePort = isLive
  ? createSupabaseDatabase(supabaseClient, 'db')
  : createUnconfiguredDatabase('db');

/** Public supplier-portal data access. Token-scoped `rpc()` routines only — no table reads. */
export const portalDb: DatabasePort = isLive
  ? createSupabaseDatabase(supabasePortalClient, 'portalDb')
  : createUnconfiguredDatabase('portalDb');

export const auth: AuthPort = createSupabaseAuth(supabaseClient);

export const storage: StoragePort = createSupabaseStorage(supabaseClient);

export * from './ports';
export { withDeadline, orEmpty, orUndefined, orValue } from './resilience';
