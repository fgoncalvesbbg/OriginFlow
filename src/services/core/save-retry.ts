/**
 * Shared retry pipeline for IM save writes.
 *
 * The old pattern (fixed 12s timeout + "refresh session and retry once") failed
 * deterministically on large payloads: the retry re-sent the identical bytes into
 * the identical 12s wall. This helper makes the timeout proportional to the
 * payload, retries transient failures with backoff and an escalating bound, and
 * fails fast on permanent errors (constraint/validation) where a retry can never
 * succeed. Session refresh stays part of the retry path because a stale token or
 * stuck navigator.locks refresh is still a real cause of stalled writes (see
 * supabase.client.ts).
 */

import { supabase } from './supabase.client';
import { withTimeout } from './with-timeout';

const BASE_TIMEOUT_MS = 12000;
const MAX_TIMEOUT_MS = 90000;
// Assumed sustained upload throughput when scaling the timeout to the payload —
// deliberately pessimistic (~2 Mbit/s) so slow office uplinks don't false-abort.
const ASSUMED_UPLOAD_BYTES_PER_SEC = 250_000;
// Above this, a save payload is suspicious (likely an inline base64 image that
// escaped externalization) — warn loudly so console reports are self-diagnosing.
const LARGE_PAYLOAD_WARN_BYTES = 1_000_000;

/** Timeout for a write carrying `payloadBytes` of JSON: 12s base + upload time, capped. */
export const timeoutForPayload = (payloadBytes: number): number =>
  Math.min(MAX_TIMEOUT_MS, BASE_TIMEOUT_MS + Math.ceil((payloadBytes / ASSUMED_UPLOAD_BYTES_PER_SEC) * 1000));

const errText = (e: unknown): string =>
  e instanceof Error ? e.message : String((e as any)?.message ?? e);

/**
 * Errors where re-sending the identical request cannot succeed: Postgres
 * constraint/validation failures, PostgREST schema errors, and the finalized-
 * template lock (migration 87 trigger). Auth and network/timeout errors are
 * NOT permanent — they get the retry path.
 */
const isPermanentError = (e: unknown): boolean =>
  /duplicate key|violates .*constraint|invalid input|malformed|is finalized|PGRST1\d\d|PGRST2\d\d|22P02|23\d{3}|42\d{3}/i.test(errText(e));

export interface SaveRetryOptions {
  /** Label used in warnings and the final error (e.g. 'saveIMSection'). */
  context: string;
  /** Serialized payload size; scales the timeout. 0/absent = base timeout. */
  payloadBytes?: number;
  /** Total attempts including the first (default 3). */
  attempts?: number;
}

/**
 * Run a one-shot write factory with size-aware timeout and differentiated retries.
 * `runWrite` receives the timeout to apply (wrap the query builder in `withTimeout`
 * with it) and must build a FRESH query each call — postgrest builders are one-shot.
 * It must THROW on failure (use runQuery/runMutation so in-band `{ error }` results
 * become throws), otherwise transient server errors would never be retried.
 */
export async function saveWithRetry<T>(
  runWrite: (timeoutMs: number) => Promise<T>,
  { context, payloadBytes = 0, attempts = 3 }: SaveRetryOptions,
): Promise<T> {
  const baseMs = timeoutForPayload(payloadBytes);
  if (payloadBytes > LARGE_PAYLOAD_WARN_BYTES) {
    console.warn(
      `[${context}] large save payload: ${(payloadBytes / 1024).toFixed(0)} KB — timeout scaled to ${Math.round(baseMs / 1000)}s. ` +
        'If this row keeps timing out, check for inline base64 images that escaped externalization.',
    );
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) {
      // Re-establish auth before retrying: a stale session or a stuck
      // navigator.locks token refresh presents as a timeout/fetch failure, and a
      // bounded refresh is cheap and harmless when auth was fine. Then back off
      // briefly so we don't hammer a struggling connection.
      await withTimeout(supabase.auth.refreshSession(), 8000).catch(() => {});
      await new Promise((r) => setTimeout(r, 400 * 2 ** (attempt - 1) + Math.random() * 200));
    }
    try {
      // Later attempts get a longer bound — if the first was a genuine slow
      // upload rather than a stall, more time is what actually fixes it.
      return await runWrite(Math.min(MAX_TIMEOUT_MS, Math.round(baseMs * (1 + attempt * 0.5))));
    } catch (e) {
      lastError = e;
      if (isPermanentError(e)) throw e;
      console.warn(`[${context}] write attempt ${attempt + 1}/${attempts} failed`, e);
    }
  }
  const size = payloadBytes ? ` (payload ${(payloadBytes / 1024).toFixed(0)} KB)` : '';
  throw new Error(`${context}: save failed after ${attempts} attempts${size} — ${errText(lastError)}`);
}

/**
 * Map `items` through an async `fn` with at most `limit` in flight. Used to bound
 * parallel section saves: unbounded Promise.all makes concurrent uploads compete
 * for bandwidth and push each other over the write timeout. Rejects on the first
 * item failure (like Promise.all); results keep input order.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
