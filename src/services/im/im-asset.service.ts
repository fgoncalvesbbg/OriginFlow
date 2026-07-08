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

// Matches a base64 image data URI, e.g. `data:image/png;base64,iVBORw0KG...`. The
// base64 charset stops at the surrounding quote, so this captures the whole payload
// without spilling into the rest of the HTML attribute.
const DATA_URI_RE = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;

/** Decode a base64 image data URI into a File suitable for uploadIMAsset. */
const dataUriToFile = (dataUri: string, name: string): File | null => {
  const comma = dataUri.indexOf(',');
  if (comma < 0) return null;
  const meta = dataUri.slice(5, comma); // strip leading "data:"
  const mime = meta.split(';')[0] || 'image/png';
  const bin = atob(dataUri.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const ext = (mime.split('/')[1] || 'png').split('+')[0];
  return new File([bytes], `${name}.${ext}`, { type: mime });
};

/**
 * Replace every base64 image data URI in `html` with an uploaded storage URL, so
 * large images never live inside content JSONB (which is stored per language and
 * would otherwise be duplicated across every translation). `cache` dedups identical
 * data URIs across calls — the same image shared by many languages uploads ONCE.
 * Best-effort: an upload failure leaves that one data URI in place rather than throwing.
 * Returns the (possibly unchanged) HTML.
 */
export const externalizeHtmlImages = async (
  html: string,
  cache: Map<string, string>,
  folder = 'inline',
): Promise<string> => {
  if (!html || !html.includes('data:image')) return html;
  const uris = html.match(DATA_URI_RE);
  if (!uris) return html;
  let out = html;
  for (const uri of uris) {
    if (out.indexOf(uri) < 0) continue; // already replaced (duplicate in match list)
    let url = cache.get(uri);
    if (!url) {
      try {
        const file = dataUriToFile(uri, `img_${Date.now()}_${cache.size}`);
        if (!file) continue;
        url = await uploadIMAsset(file, folder);
        cache.set(uri, url);
      } catch (e) {
        console.error(TAG, 'externalize failed for one image; leaving inline', e);
        continue;
      }
    }
    out = out.split(uri).join(url);
  }
  return out;
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
