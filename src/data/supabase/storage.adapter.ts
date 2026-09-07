/**
 * Supabase Storage implementation of `StoragePort`.
 *
 * Note `publicUrl`: Supabase builds the URL client-side from the project URL and bucket
 * name, so it needs no round trip. An adapter fronting Azure Blob with private containers
 * has no equivalent and would have to route callers to `createSignedUrl` instead — the one
 * place where a new backend cannot simply satisfy this interface. See ../PORTING.md.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoragePort, SignedUrlAuth } from '../ports/storage.port';
import { toDataError } from './errors';

/** The one Netlify function `signedUrl` ever calls — see storage.port.ts's doc comment. */
const SIGNED_URL_ENDPOINT = '/.netlify/functions/im-file-url';

export const createSupabaseStorage = (client: SupabaseClient): StoragePort => ({
  async upload(bucket, path, body, options = {}) {
    const { data, error } = await client.storage.from(bucket).upload(path, body as Blob, {
      contentType: options.contentType,
      cacheControl: options.cacheControl,
      upsert: options.upsert ?? false,
    });
    if (error) throw toDataError(error, `storage.upload(${bucket})`);
    return { path: data?.path ?? path };
  },

  publicUrl(bucket, path) {
    return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  },

  async createSignedUrl(bucket, path, expiresInSeconds) {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(path, expiresInSeconds);
    if (error || !data?.signedUrl) {
      throw toDataError(error ?? { message: 'No signed URL returned' }, `storage.createSignedUrl(${bucket})`);
    }
    return data.signedUrl;
  },

  /**
   * `im-file-url` works against a PUBLIC bucket exactly like a private one — Supabase's
   * `createSignedUrl` is a plain Storage API call and does not check (or care) whether the
   * bucket also has a public-read policy layered on top of it. That is what lets this method
   * ship BEFORE `im-published`/`im-print` are flipped private and keep working, unchanged,
   * the moment they are: nothing here depends on the bucket's public/private flag, only on
   * the signing endpoint re-validating the caller each time.
   */
  async signedUrl(bucket, path, auth: SignedUrlAuth) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const body: Record<string, unknown> = { bucket, path };

    if (auth.portalToken) {
      // PORTAL path — the token alone is the proof; no session to attach.
      body.token = auth.portalToken;
    } else {
      // STAFF path — requires both a project to assert and a live session to prove it with.
      if (!auth.projectId) {
        throw toDataError(
          { message: 'storage.signedUrl requires either auth.portalToken or auth.projectId.' },
          `storage.signedUrl(${bucket})`,
        );
      }
      body.projectId = auth.projectId;
      const { data: sessionData } = await client.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        throw toDataError(
          { message: 'No active session to authorize this request.' },
          `storage.signedUrl(${bucket})`,
        );
      }
      headers.Authorization = `Bearer ${token}`;
    }

    let res: Response;
    try {
      res = await fetch(SIGNED_URL_ENDPOINT, { method: 'POST', headers, body: JSON.stringify(body) });
    } catch (e) {
      throw toDataError(
        { message: e instanceof Error ? e.message : 'Network error requesting a signed URL.' },
        `storage.signedUrl(${bucket})`,
      );
    }
    if (!res.ok) {
      let message = `Could not create a signed URL (HTTP ${res.status}).`;
      try {
        const errBody = await res.json();
        if (errBody?.error) message = errBody.error;
      } catch {
        /* non-JSON error body */
      }
      throw toDataError({ message }, `storage.signedUrl(${bucket})`);
    }
    const { url } = (await res.json()) as { url?: string };
    if (!url) throw toDataError({ message: 'No signed URL returned' }, `storage.signedUrl(${bucket})`);
    return url;
  },

  async list(bucket, folder, options = {}) {
    const { data, error } = await client.storage.from(bucket).list(folder, {
      limit: options.limit,
      sortBy: options.sortBy,
    });
    if (error) throw toDataError(error, `storage.list(${bucket})`);
    return (data ?? []).map((obj) => ({ name: obj.name, id: obj.id ?? null }));
  },
});
