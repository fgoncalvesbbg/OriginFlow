/**
 * IM asset library service — CRUD for the foldered, searchable asset database
 * (im_asset_folders / im_assets) backing the IM Template Editor and Project IM
 * Generator's Asset Library, plus the per-row "Assets" picker in
 * SimpleRichTextEditor. Uploads still go through `uploadIMAsset` (im-asset.service);
 * this layer adds the persistent name/folder/alt-text metadata on top.
 */

import { db, orEmpty, withDeadline, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { AssetFolder, IMAsset } from '../../types';
import { generateUUID } from '../../utils';
import { uploadIMAsset, listIMAssets } from './im-asset.service';

const TAG = '[im-asset-library.service]';
const READ_TIMEOUT_MS = 12000;
const GENERIC_FOLDER_NAME = 'Generic';

const mapFolderRow = (r: any): AssetFolder => ({
  id: r.id,
  name: r.name,
  sortOrder: r.sort_order ?? 0,
  createdAt: r.created_at,
});

const mapAssetRow = (r: any): IMAsset => ({
  id: r.id,
  folderId: r.folder_id ?? null,
  name: r.name,
  url: r.url,
  storagePath: r.storage_path ?? null,
  altText: r.alt_text ?? null,
  createdBy: r.created_by ?? null,
  createdAt: r.created_at,
});

export const getAssetFolders = async (): Promise<AssetFolder[]> => {
  if (!isLive) { console.warn(TAG, 'getAssetFolders skipped — isLive=false'); return []; }
  const rows = await orEmpty(
    withDeadline(
      (signal) => db.select<Row>('im_asset_folders', { order: { column: 'sort_order' }, signal }),
      READ_TIMEOUT_MS,
      'getAssetFolders',
    ),
    `${TAG} getAssetFolders`,
  );
  return rows.map(mapFolderRow);
};

export const createAssetFolder = async (name: string): Promise<AssetFolder> => {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name cannot be empty.');
  const data = await withDeadline(
    (signal) => db.insert<Row>('im_asset_folders', { id: generateUUID(), name: trimmed }, { signal }),
    READ_TIMEOUT_MS,
    'createAssetFolder',
  );
  return mapFolderRow(data);
};

export const renameAssetFolder = async (id: string, name: string): Promise<AssetFolder> => {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Folder name cannot be empty.');
  const data = await withDeadline(
    (signal) => db.update<Row>('im_asset_folders', { name: trimmed }, { where: { id }, signal }),
    READ_TIMEOUT_MS,
    'renameAssetFolder',
  );
  return mapFolderRow(data);
};

/** Blocks deletion of a folder that still holds assets — move or delete them first. */
export const deleteAssetFolder = async (id: string): Promise<void> => {
  const count = await withDeadline(
    (signal) => db.count('im_assets', { where: { folder_id: id }, signal }),
    READ_TIMEOUT_MS,
    'deleteAssetFolder:count',
  );
  if (count > 0) {
    throw new Error(`This folder still has ${count} asset(s). Move or delete them first.`);
  }
  await withDeadline(
    (signal) => db.delete('im_asset_folders', { where: { id }, signal }),
    READ_TIMEOUT_MS,
    'deleteAssetFolder',
  );
};

export const getAssets = async (): Promise<IMAsset[]> => {
  if (!isLive) { console.warn(TAG, 'getAssets skipped — isLive=false'); return []; }
  const rows = await orEmpty(
    withDeadline(
      (signal) => db.select<Row>('im_assets', { order: { column: 'created_at', ascending: false }, signal }),
      READ_TIMEOUT_MS,
      'getAssets',
    ),
    `${TAG} getAssets`,
  );
  return rows.map(mapAssetRow);
};

export const createAsset = async (
  file: File,
  opts: { folderId: string | null; name?: string; altText?: string },
): Promise<IMAsset> => {
  const url = await uploadIMAsset(file, 'library');
  const name = (opts.name ?? file.name.replace(/\.[^.]+$/, '')).trim() || file.name;
  const payload = {
    id: generateUUID(),
    folder_id: opts.folderId,
    name,
    url,
    storage_path: null, // uploadIMAsset only returns the public URL; the path isn't needed for display or deletion
    alt_text: opts.altText?.trim() || null,
  };
  const data = await withDeadline(
    (signal) => db.insert<Row>('im_assets', payload, { signal }),
    READ_TIMEOUT_MS,
    'createAsset',
  );
  return mapAssetRow(data);
};

export const updateAsset = async (
  id: string,
  patch: { name?: string; altText?: string | null; folderId?: string | null },
): Promise<IMAsset> => {
  const values: Record<string, unknown> = {};
  if (patch.name !== undefined) values.name = patch.name.trim();
  if (patch.altText !== undefined) values.alt_text = patch.altText?.trim() || null;
  if (patch.folderId !== undefined) values.folder_id = patch.folderId;
  const data = await withDeadline(
    (signal) => db.update<Row>('im_assets', values, { where: { id }, signal }),
    READ_TIMEOUT_MS,
    'updateAsset',
  );
  return mapAssetRow(data);
};

export const deleteAsset = async (id: string): Promise<void> => {
  await withDeadline(
    (signal) => db.delete('im_assets', { where: { id }, signal }),
    READ_TIMEOUT_MS,
    'deleteAsset',
  );
};

/**
 * One-off: import any storage object under the `im-assets` bucket's `library/`
 * folder that predates this table (uploaded via the old flat list) into the
 * "Generic" folder, so pre-existing uploads aren't orphaned from the picker.
 * Dedups against assets already tracked by URL. Returns the number imported.
 */
export const backfillAssetsFromStorage = async (): Promise<{ imported: number }> => {
  const [urls, existing, folders] = await Promise.all([
    listIMAssets('library'),
    getAssets(),
    getAssetFolders(),
  ]);
  const known = new Set(existing.map((a) => a.url));
  const generic = folders.find((f) => f.name === GENERIC_FOLDER_NAME) ?? null;
  const missing = urls.filter((url) => !known.has(url));

  for (const url of missing) {
    const name = decodeURIComponent(url.split('/').pop() ?? 'Imported asset');
    await withDeadline(
      (signal) => db.insert<Row>('im_assets', {
        id: generateUUID(),
        folder_id: generic?.id ?? null,
        name,
        url,
        storage_path: null,
        alt_text: null,
      }, { signal }),
      READ_TIMEOUT_MS,
      'backfillAssetsFromStorage:insert',
    );
  }
  return { imported: missing.length };
};
