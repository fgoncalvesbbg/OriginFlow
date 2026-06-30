/**
 * Thin Supabase query/mutation helpers that centralize the repeated
 * `const { error } = await <query>; if (error) handleError(error, ctx)` boilerplate.
 *
 * Both helpers THROW (via handleError) on a database error — matching the dominant convention in
 * the service layer. Reads that intentionally SWALLOW errors and return a fallback (e.g.
 * `if (error) return []`) are left as explicit code, since that fallback behavior is per-call.
 */

import { handleError } from '../../utils/error.utils';

interface SupabaseResult<T> {
  data: T | null;
  error: unknown;
}

/** Run a Supabase mutation that should throw on error; the returned row (if any) is ignored. */
export async function runMutation(query: PromiseLike<SupabaseResult<unknown>>, context: string): Promise<void> {
  const { error } = await query;
  if (error) handleError(error, context);
}

/** Run a Supabase read/mutation that should throw on error and return its data. */
export async function runQuery<T>(query: PromiseLike<SupabaseResult<T>>, context: string): Promise<T> {
  const { data, error } = await query;
  if (error) handleError(error, context);
  return data as T;
}
