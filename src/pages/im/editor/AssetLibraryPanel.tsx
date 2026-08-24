/**
 * AssetLibraryPanel — the foldered, searchable asset database shared by the IM
 * Template Editor's Assets tab, the Project IM Generator's Asset Library modal,
 * and the per-row "Assets" button in SimpleRichTextEditor's toolbar. Content
 * only, no outer modal chrome — mirrors AttributePicker.tsx, callers provide
 * their own sidebar/modal shell.
 *
 * Backed by `im_asset_folders` / `im_assets` (migration 101) via
 * `im-asset-library.service`. Uploads still go through the existing
 * `im-asset.service` storage bucket; this panel just adds folders + search +
 * reusable alt text on top.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Search, Plus, Upload, Loader2, Folder, FolderPlus, Pencil, Trash2, Check, X, DownloadCloud,
} from 'lucide-react';
import { AssetFolder, IMAsset } from '../../../types';
import {
  getAssetFolders, createAssetFolder, renameAssetFolder, deleteAssetFolder,
  getAssets, createAsset, updateAsset, deleteAsset, backfillAssetsFromStorage,
} from '../../../services/im/im-asset-library.service';
import { imgTag } from './im-image-markup';

interface AssetLibraryPanelProps {
  /** Called with the ready-to-insert `<img>` HTML when the user picks an asset. */
  onInsert: (html: string) => void;
}

// Inserted assets default to 50% width (matches the resize toolbar's own 50% option
// in SimpleRichTextEditor) rather than filling the full available width. Built by the
// shared imgTag so the markup is identical to every other insert path — this panel
// used to bake `margin: 1rem 0` inline (beating both stylesheets, so no spacing
// setting could reach these images) and omitted data-align.
const buildImgHtml = (asset: IMAsset): string => {
  const alt = (asset.altText ?? '').replace(/"/g, "'");
  return `${imgTag(asset.url, alt, '50%')}<p></p>`;
};

export function AssetLibraryPanel({ onInsert }: AssetLibraryPanelProps) {
  const [folders, setFolders] = useState<AssetFolder[]>([]);
  const [assets, setAssets] = useState<IMAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null | 'all'>('all');
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [addingFolder, setAddingFolder] = useState(false);
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [editingAssetId, setEditingAssetId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ name: string; altText: string }>({ name: '', altText: '' });
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const [f, a] = await Promise.all([getAssetFolders(), getAssets()]);
    setFolders(f);
    setAssets(a);
  };

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, []);

  const genericFolderId = useMemo(() => folders.find((f) => f.name === 'Generic')?.id ?? null, [folders]);

  const visibleAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets
      .filter((a) => selectedFolderId === 'all' || a.folderId === selectedFolderId)
      .filter((a) => !q || a.name.toLowerCase().includes(q) || (a.altText ?? '').toLowerCase().includes(q));
  }, [assets, selectedFolderId, query]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const folderId = selectedFolderId === 'all' ? genericFolderId : selectedFolderId;
      const created = await createAsset(file, { folderId });
      setAssets((prev) => [created, ...prev]);
    } catch (err) {
      console.error('[AssetLibraryPanel] upload failed:', err);
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleImportExisting = async () => {
    setImporting(true);
    setError(null);
    try {
      const { imported } = await backfillAssetsFromStorage();
      if (imported > 0) await load();
    } catch (err) {
      console.error('[AssetLibraryPanel] import existing failed:', err);
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) { setAddingFolder(false); return; }
    try {
      const folder = await createAssetFolder(name);
      setFolders((prev) => [...prev, folder]);
      setNewFolderName('');
      setAddingFolder(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create folder');
    }
  };

  const handleRenameFolder = async (id: string) => {
    const name = renameDraft.trim();
    setRenamingFolderId(null);
    if (!name) return;
    try {
      const updated = await renameAssetFolder(id, name);
      setFolders((prev) => prev.map((f) => (f.id === id ? updated : f)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename folder');
    }
  };

  const handleDeleteFolder = async (id: string) => {
    try {
      await deleteAssetFolder(id);
      setFolders((prev) => prev.filter((f) => f.id !== id));
      if (selectedFolderId === id) setSelectedFolderId('all');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete folder');
    }
  };

  const startEditAsset = (asset: IMAsset) => {
    setEditingAssetId(asset.id);
    setEditDraft({ name: asset.name, altText: asset.altText ?? '' });
  };

  const saveEditAsset = async (id: string) => {
    setEditingAssetId(null);
    try {
      const updated = await updateAsset(id, { name: editDraft.name, altText: editDraft.altText });
      setAssets((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update asset');
    }
  };

  const handleMoveAsset = async (id: string, folderId: string | null) => {
    try {
      const updated = await updateAsset(id, { folderId });
      setAssets((prev) => prev.map((a) => (a.id === id ? updated : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not move asset');
    }
  };

  const handleDeleteAsset = async (id: string) => {
    try {
      await deleteAsset(id);
      setAssets((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete asset');
    }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center py-10 text-gray-400">
        <Loader2 size={20} className="animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Folder rail */}
      <div className="w-40 shrink-0 border-r border-gray-100 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          <button
            onClick={() => setSelectedFolderId('all')}
            className={`w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium truncate ${selectedFolderId === 'all' ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-light'}`}
          >
            <Folder size={13} /> All assets
          </button>
          {folders.map((f) => (
            <div key={f.id} className="group">
              {renamingFolderId === f.id ? (
                <div className="flex items-center gap-1 px-1">
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleRenameFolder(f.id); if (e.key === 'Escape') setRenamingFolderId(null); }}
                    onBlur={() => handleRenameFolder(f.id)}
                    className="w-full px-1.5 py-1 text-xs border border-indigo-300 rounded outline-none"
                  />
                </div>
              ) : (
                <button
                  onClick={() => setSelectedFolderId(f.id)}
                  className={`w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium truncate ${selectedFolderId === f.id ? 'bg-indigo-50 text-indigo-700' : 'text-gray-600 hover:bg-light'}`}
                >
                  <Folder size={13} className="shrink-0" />
                  <span className="flex-1 truncate">{f.name}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); setRenamingFolderId(f.id); setRenameDraft(f.name); }}
                    className="opacity-0 group-hover:opacity-100 hover:text-indigo-600 shrink-0"
                    title="Rename folder"
                  ><Pencil size={11} /></span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); handleDeleteFolder(f.id); }}
                    className="opacity-0 group-hover:opacity-100 hover:text-rose-600 shrink-0"
                    title="Delete folder (must be empty)"
                  ><Trash2 size={11} /></span>
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="p-2 border-t border-gray-100">
          {addingFolder ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') setAddingFolder(false); }}
                placeholder="Folder name…"
                className="w-full px-1.5 py-1 text-xs border border-gray-300 rounded outline-none focus:ring-1 focus:ring-indigo-400"
              />
              <button onClick={handleCreateFolder} className="text-indigo-600 shrink-0"><Check size={14} /></button>
              <button onClick={() => setAddingFolder(false)} className="text-gray-400 shrink-0"><X size={14} /></button>
            </div>
          ) : (
            <button
              onClick={() => setAddingFolder(true)}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-medium text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-md"
            >
              <FolderPlus size={13} /> New folder
            </button>
          )}
        </div>
      </div>

      {/* Assets */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <div className="p-3 border-b border-gray-100 space-y-2">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search assets…"
                className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <label className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors shrink-0 ${uploading ? 'opacity-60 cursor-wait' : 'cursor-pointer border-gray-300 hover:bg-light'}`}>
              {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
              {uploading ? 'Uploading…' : 'Upload'}
              <input type="file" accept="image/*" className="hidden" disabled={uploading} onChange={handleUpload} />
            </label>
          </div>
          <button
            onClick={handleImportExisting}
            disabled={importing}
            className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-indigo-600 disabled:opacity-50"
          >
            {importing ? <Loader2 size={11} className="animate-spin" /> : <DownloadCloud size={11} />}
            Import existing uploads
          </button>
          {error && <p className="text-[11px] text-rose-600">{error}</p>}
        </div>

        <div className="flex-1 overflow-y-auto p-3 grid grid-cols-3 sm:grid-cols-4 gap-2 content-start">
          {visibleAssets.map((asset) => (
            <div key={asset.id} className="group relative">
              <div
                className="relative aspect-square rounded-xl border border-gray-200 overflow-hidden cursor-pointer hover:ring-2 hover:ring-indigo-400 bg-white"
                onClick={() => onInsert(buildImgHtml(asset))}
                title={asset.name}
              >
                <img src={asset.url} alt={asset.altText ?? asset.name} className="w-full h-full object-contain p-1" />
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Plus size={20} className="text-white" />
                </div>
              </div>
              <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100">
                <button
                  onClick={(e) => { e.stopPropagation(); startEditAsset(asset); }}
                  className="p-1 rounded bg-white/90 text-gray-600 hover:text-indigo-600 shadow"
                  title="Edit name / alt text"
                ><Pencil size={11} /></button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteAsset(asset.id); }}
                  className="p-1 rounded bg-white/90 text-gray-600 hover:text-rose-600 shadow"
                  title="Remove from library"
                ><Trash2 size={11} /></button>
              </div>
              {folders.length > 0 && (
                <select
                  value={asset.folderId ?? ''}
                  onChange={(e) => handleMoveAsset(asset.id, e.target.value || null)}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1 w-full text-[10px] border border-gray-200 rounded px-1 py-0.5 text-gray-500 outline-none"
                  title="Move to folder"
                >
                  <option value="">Unfiled</option>
                  {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              )}
              <p className="mt-0.5 text-[10px] text-gray-400 truncate" title={asset.name}>{asset.name}</p>
            </div>
          ))}
          {visibleAssets.length === 0 && (
            <div className="col-span-full text-center py-10 text-gray-400 text-xs">
              {query.trim() ? `No assets match "${query}".` : 'No assets in this folder yet.'}
            </div>
          )}
        </div>
      </div>

      {editingAssetId && (() => {
        const asset = assets.find((a) => a.id === editingAssetId);
        if (!asset) return null;
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setEditingAssetId(null)}>
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-4 space-y-3" onMouseDown={(e) => e.stopPropagation()}>
              <h3 className="text-sm font-bold text-gray-800">Edit asset</h3>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Name</label>
                <input
                  autoFocus
                  value={editDraft.name}
                  onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                  className="w-full mt-1 px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Alt text (accessibility)</label>
                <input
                  value={editDraft.altText}
                  onChange={(e) => setEditDraft((d) => ({ ...d, altText: e.target.value }))}
                  className="w-full mt-1 px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button onClick={() => setEditingAssetId(null)} className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-light rounded-lg">Cancel</button>
                <button onClick={() => saveEditAsset(asset.id)} className="px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Save</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
