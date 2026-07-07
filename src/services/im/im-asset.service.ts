/**
 * IM asset service — uploads images to the `im-assets` Supabase Storage bucket.
 * All IM images (inline HTML, annotated images, step photos) are stored here.
 * The bucket is public so <img src="..."> works without auth tokens.
 */

import { supabase } from '../core/supabase.client';

const BUCKET = 'im-assets';
const TAG = '[im-asset.service]';

/**
 * Upload a file to Supabase Storage and return its public URL.
 * @param file   The File object from an <input type="file">.
 * @param folder Optional sub-folder within the bucket (e.g. 'blocks', 'sku').
 */
export const uploadIMAsset = async (file: File, folder = 'uploads'): Promise<string> => {
  const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase();
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = `${folder}/${unique}.${ext}`;

  console.log(TAG, `uploading ${file.name} (${(file.size / 1024).toFixed(1)} KB) → ${storagePath}`);

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, { cacheControl: '31536000', upsert: false });

  if (error) {
    console.error(TAG, 'upload error:', error);
    throw new Error(`Image upload failed: ${error.message}`);
  }

  const { data: { publicUrl } } = supabase.storage.from(BUCKET).getPublicUrl(data.path);
  console.log(TAG, 'uploaded:', publicUrl);
  return publicUrl;
};

/**
 * List the public URLs of every asset previously uploaded to a folder, newest first.
 * Backs the template editor's reusable asset library so past uploads persist across
 * refreshes/sessions. Returns [] on error (the library just shows empty).
 * @param folder Sub-folder within the bucket to list (default 'library').
 */
export const listIMAssets = async (folder = 'library'): Promise<string[]> => {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(folder, { limit: 1000, sortBy: { column: 'created_at', order: 'desc' } });

  if (error) {
    console.error(TAG, 'list error:', error);
    return [];
  }

  return (data ?? [])
    // Skip sub-folders (id === null) and Supabase's `.emptyFolderPlaceholder` marker.
    .filter((obj) => obj.id !== null && !obj.name.startsWith('.'))
    .map((obj) => supabase.storage.from(BUCKET).getPublicUrl(`${folder}/${obj.name}`).data.publicUrl);
};
