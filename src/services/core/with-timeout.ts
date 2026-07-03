/**
 * Reject if a thenable hasn't resolved within `ms` milliseconds.
 *
 * Supabase query builders are thenable but not full Promises, so we wrap them in
 * `Promise.resolve`. Bounding every save/read matters because a stalled network
 * or a stale `navigator.locks` auth lock would otherwise leave a request pending
 * forever — which, in the IM editor, latches the "Saving…" state and silently
 * blocks all further autosaves (losing later edits). A timeout lets the caller
 * fail, surface it, and retry.
 */
export const withTimeout = <T>(thenable: PromiseLike<T>, ms = 12000): Promise<T> =>
  Promise.race([
    Promise.resolve(thenable),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
