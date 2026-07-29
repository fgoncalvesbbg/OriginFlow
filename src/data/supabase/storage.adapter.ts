/**
 * Supabase Storage implementation of `StoragePort`.
 *
 * Note `publicUrl`: Supabase builds the URL client-side from the project URL and bucket
 * name, so it needs no round trip. An adapter fronting Azure Blob with private containers
 * has no equivalent and would have to route callers to `createSignedUrl` instead — the one
 * place where a new backend cannot simply satisfy this interface. See ../PORTING.md.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { StoragePort } from '../ports/storage.port';
import { toDataError } from './errors';

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

  async list(bucket, folder, options = {}) {
    const { data, error } = await client.storage.from(bucket).list(folder, {
      limit: options.limit,
      sortBy: options.sortBy,
    });
    if (error) throw toDataError(error, `storage.list(${bucket})`);
    return (data ?? []).map((obj) => ({ name: obj.name, id: obj.id ?? null }));
  },
});
