/**
 * Reject if a thenable hasn't resolved within `ms` milliseconds.
 *
 * Supabase query builders are thenable but not full Promises, so we wrap them in
 * `Promise.resolve`. Bounding every save/read matters because a stalled network
 * or a stale `navigator.locks` auth lock would otherwise leave a request pending
 * forever — which, in the IM editor, latches the "Saving…" state and silently
 * blocks all further autosaves (losing later edits). A timeout lets the caller
 * fail, surface it, and retry.
 *
 * Racing the promise alone isn't enough: it abandons the client-side wait but
 * leaves the underlying fetch (and the Postgres statement it opened) running.
 * A caller that retries the same upsert then queues behind its own still-live
 * first attempt's row lock, which can chain into a real multi-minute Postgres
 * statement-timeout / 500 instead of the intended fast client-side failure. If
 * the builder supports `.abortSignal()` (all postgrest-js query builders do),
 * we wire it up so the timeout actually cancels the in-flight request.
 */
export const withTimeout = <T>(
  thenable: PromiseLike<T> & { abortSignal?: (signal: AbortSignal) => PromiseLike<T> },
  ms = 12000,
): Promise<T> => {
  const controller = new AbortController();
  const target = typeof thenable.abortSignal === 'function' ? thenable.abortSignal(controller.signal) : thenable;
  return Promise.race([
    Promise.resolve(target),
    new Promise<never>((_, reject) =>
      setTimeout(() => {
        controller.abort();
        reject(new Error(`Request timed out after ${ms / 1000}s`));
      }, ms),
    ),
  ]);
};
