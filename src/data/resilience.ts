/**
 * Backend-agnostic resilience helpers that sit on top of the ports.
 *
 * Two concerns live here because both were previously entangled with the Supabase client:
 *
 *  - `withDeadline` bounds an operation AND cancels it. The old `withTimeout` had to sniff
 *    for `.abortSignal()` on a postgrest builder to do this; the ports take a plain
 *    `AbortSignal` instead, so the bound is expressible without knowing the driver.
 *    Cancelling matters, not just giving up: abandoning the promise while the request runs
 *    leaves the statement holding row locks, so a retry queues behind its own first attempt.
 *
 *  - `orEmpty` / `orUndefined` make "this read may fail, carry on" explicit. The ports
 *    always reject on failure; several reads (dashboards, optional lookups) deliberately
 *    degrade to an empty result instead of surfacing an error, and that intent should be
 *    visible at the call site rather than implied by an unchecked `{ error }`.
 */

/**
 * Run `op` with an abort deadline. `op` receives the signal and must forward it to the port
 * so the underlying request is genuinely cancelled, not merely ignored.
 */
export const withDeadline = <T>(
  op: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label = 'request',
): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new DOMException(`${label} exceeded ${ms}ms`, 'TimeoutError'));
      // Message kept verbatim from the previous `withTimeout`: the save-retry classifier
      // reads message text, and a timeout must stay classified as transient/retryable.
      reject(new Error(`Request timed out after ${ms / 1000}s`));
    }, ms);
    // Clearing on settle stops a late abort firing against an already-finished request.
    Promise.resolve(op(controller.signal))
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });

/** Resolve to `[]` if the read fails, logging why. For reads where an empty list is an acceptable degradation. */
export const orEmpty = <T>(read: Promise<T[]>, context: string): Promise<T[]> =>
  read.catch((e) => {
    console.error(`[read] ${context} failed`, e);
    return [] as T[];
  });

/** Resolve to `undefined` if the read fails, logging why. For optional single-row lookups. */
export const orUndefined = <T>(read: Promise<T | null>, context: string): Promise<T | undefined> =>
  read.then((v) => v ?? undefined).catch((e) => {
    console.error(`[read] ${context} failed`, e);
    return undefined;
  });

/** Resolve to `fallback` if the read fails, logging why. */
export const orValue = <T>(read: Promise<T>, fallback: T, context: string): Promise<T> =>
  read.catch((e) => {
    console.error(`[read] ${context} failed`, e);
    return fallback;
  });
