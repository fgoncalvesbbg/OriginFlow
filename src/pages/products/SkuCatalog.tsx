/**
 * SKU Catalog — manage every SKU in the app (project-less "catalog" items and project SKUs)
 * independently of projects. Pick a category to see its attributes (grouped) as ROWS and its
 * SKUs as COLUMNS in an editable grid, add SKUs, bulk-upload a transposed values sheet, and
 * edit attribute values in bulk.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../../components/Layout';
import {
  getCategories, getCategoryAttributes,
  getCatalogSkus, createCatalogSku, updateProjectSku, deleteProjectSku, bulkUpsertCatalogSkus,
  setSkuFinal, logSkuChanges, logSkuCreated, logSkuDeleted, getSkuChangeLog, markSkusExported,
} from '../../services';
import type { SkuFieldChange } from '../../services';
import { getAttributesForCategory, generateUUID, parseSkuCsv, buildAkeneoRows } from '../../utils';
import type { SkuCsvParseResult } from '../../utils';
import { CatalogSku, CategoryAttribute, CategoryL3, SkuAttributeValue, SkuChangeLogEntry } from '../../types';
import { ATTRIBUTE_GROUPS } from '../../config/compliance.constants';
import { useAuth } from '../../context/AuthContext';
import * as XLSX from 'xlsx';
import { Package, Upload, Plus, CheckCircle, Trash2, Search, X, AlertTriangle, Lock, Unlock, History, Download } from 'lucide-react';

const SKUS_PER_PAGE = 20; // SKUs are columns now — paginate columns to keep the table manageable.

/** Cloudinary product thumbnail for a SKU number (empty string when there is no number yet). */
const skuThumbnailUrl = (skuNumber: string, width = 120): string => {
  const sku = skuNumber.trim();
  if (!sku) return '';
  return `https://res.cloudinary.com/chal-tec/image/upload/w_${width},q_auto,f_auto,dpr_2.0/bbg/${sku}/Gallery/${sku}_yy_0001_titel___`;
};

const SkuCatalog: React.FC = () => {
  const { user } = useAuth();
  const actor = { id: user?.id ?? null, name: user?.name ?? '' };

  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [allAttrs, setAllAttrs] = useState<CategoryAttribute[]>([]);
  const [allSkus, setAllSkus] = useState<CatalogSku[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [gridSkus, setGridSkus] = useState<CatalogSku[]>([]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Bulk upload modal
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadResult, setUploadResult] = useState<SkuCsvParseResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Change-log / history viewer
  const [historySku, setHistorySku] = useState<CatalogSku | null>(null);
  const [historyEntries, setHistoryEntries] = useState<SkuChangeLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => { void loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [c, a, s] = await Promise.all([getCategories(), getCategoryAttributes(), getCatalogSkus()]);
      setCategories(c);
      setAllAttrs(a);
      setAllSkus(s);
      setSelectedCategory(prev => prev || (c[0]?.id ?? ''));
    } finally {
      setLoading(false);
    }
  };

  const reloadSkus = async () => setAllSkus(await getCatalogSkus());

  // Attributes for the selected category, grouped by group in ATTRIBUTE_GROUPS order.
  const groupedAttrs = useMemo(() => {
    if (!selectedCategory) return [] as { group: string; attrs: CategoryAttribute[] }[];
    const attrs = getAttributesForCategory(allAttrs, selectedCategory);
    return (ATTRIBUTE_GROUPS as readonly string[])
      .map(group => ({
        group,
        attrs: attrs
          .filter(a => (a.group ?? 'Category Specific') === group)
          .sort((x, y) => x.name.localeCompare(y.name)),
      }))
      .filter(g => g.attrs.length > 0);
  }, [allAttrs, selectedCategory]);

  const attrCount = groupedAttrs.reduce((n, g) => n + g.attrs.length, 0);

  // Rebuild the working copy when data or category changes — but not while there are unsaved edits.
  useEffect(() => {
    if (!selectedCategory) { setGridSkus([]); return; }
    if (dirty.size > 0) return;
    setGridSkus(
      allSkus
        .filter(s => s.categoryId === selectedCategory)
        .map(s => ({ ...s, attributeValues: s.attributeValues.map(v => ({ ...v })) })),
    );
    setPage(0);
  }, [allSkus, selectedCategory, dirty.size]);

  const markDirty = (id: string) => setDirty(prev => new Set(prev).add(id));

  const getVal = (sku: CatalogSku, attrId: string) =>
    sku.attributeValues.find(v => v.attributeId === attrId)?.value ?? '';

  const setCell = (skuId: string, attr: CategoryAttribute, value: string) => {
    setGridSkus(prev => prev.map(s => {
      if (s.id !== skuId) return s;
      const arr = s.attributeValues.slice();
      const idx = arr.findIndex(v => v.attributeId === attr.id);
      if (idx >= 0) arr[idx] = { ...arr[idx], value };
      else arr.push({ attributeId: attr.id, name: attr.name, value, type: attr.dataType });
      return { ...s, attributeValues: arr };
    }));
    markDirty(skuId);
  };

  const setField = (skuId: string, patch: Partial<CatalogSku>) => {
    setGridSkus(prev => prev.map(s => (s.id === skuId ? { ...s, ...patch } : s)));
    markDirty(skuId);
  };

  const addSku = () => {
    if (!selectedCategory) return;
    const id = generateUUID();
    const row: CatalogSku = {
      id, projectId: null, categoryId: selectedCategory, projectName: null,
      skuNumber: '', skuTitle: '', attributeValues: [], sortOrder: 0, isFinal: false,
      pendingExport: false, lastExportedAt: null, createdAt: '', updatedAt: '',
    };
    setGridSkus(prev => [row, ...prev]);
    setNewIds(prev => new Set(prev).add(id));
    markDirty(id);
    setPage(0);
  };

  const removeSku = async (sku: CatalogSku) => {
    if (newIds.has(sku.id)) {
      setGridSkus(prev => prev.filter(s => s.id !== sku.id));
      setNewIds(prev => { const n = new Set(prev); n.delete(sku.id); return n; });
      setDirty(prev => { const n = new Set(prev); n.delete(sku.id); return n; });
      return;
    }
    if (sku.isFinal) { alert('This SKU is final. Unlock it before deleting.'); return; }
    const where = sku.projectId ? ` from project "${sku.projectName ?? ''}"` : '';
    if (!window.confirm(`Delete SKU "${sku.skuNumber}"${where}? This cannot be undone.`)) return;
    try {
      await logSkuDeleted(sku.id, sku.skuNumber, actor); // log before delete (FK becomes null on delete)
      await deleteProjectSku(sku.id);
      await reloadSkus();
    } catch (e: any) {
      alert(`Failed to delete: ${e.message}`);
    }
  };

  // Field-level diff between the persisted SKU and the edited one, for the audit log.
  const diffSku = (oldS: CatalogSku, newS: CatalogSku): SkuFieldChange[] => {
    const changes: SkuFieldChange[] = [];
    if ((oldS.skuNumber || '') !== (newS.skuNumber || '')) changes.push({ field: 'SKU number', oldValue: oldS.skuNumber, newValue: newS.skuNumber });
    if ((oldS.skuTitle || '') !== (newS.skuTitle || '')) changes.push({ field: 'Title', oldValue: oldS.skuTitle, newValue: newS.skuTitle });
    const ids = new Set([...oldS.attributeValues.map(v => v.attributeId), ...newS.attributeValues.map(v => v.attributeId)]);
    for (const id of ids) {
      const ov = oldS.attributeValues.find(v => v.attributeId === id);
      const nv = newS.attributeValues.find(v => v.attributeId === id);
      const o = ov?.value ?? '';
      const n = nv?.value ?? '';
      if (o !== n) changes.push({ field: nv?.name ?? ov?.name ?? id, oldValue: o, newValue: n });
    }
    return changes;
  };

  const saveAll = async () => {
    const changed = gridSkus.filter(s => dirty.has(s.id));
    if (changed.length === 0) { setDirty(new Set()); return; }
    if (changed.some(s => !s.skuNumber.trim())) { alert('Every SKU needs a SKU number before saving.'); return; }
    setSaving(true);
    try {
      for (const s of changed) {
        if (newIds.has(s.id)) {
          const created = await createCatalogSku(selectedCategory, s.skuNumber, s.skuTitle, s.attributeValues);
          await logSkuCreated(created.id, s.skuNumber, actor);
        } else {
          const old = allSkus.find(x => x.id === s.id);
          await updateProjectSku(s.id, { skuNumber: s.skuNumber, skuTitle: s.skuTitle, attributeValues: s.attributeValues });
          if (old) {
            const changes = diffSku(old, s);
            if (changes.length) await logSkuChanges(s.id, s.skuNumber, changes, actor);
          }
        }
      }
      setDirty(new Set());
      setNewIds(new Set());
      await reloadSkus();
    } catch (e: any) {
      alert(`Error saving: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const toggleFinal = async (sku: CatalogSku) => {
    if (newIds.has(sku.id)) { alert('Save the SKU before finalizing.'); return; }
    if (dirty.has(sku.id)) { alert('Save this SKU’s changes before finalizing.'); return; }
    try {
      if (!sku.isFinal) {
        if (!window.confirm(`Mark SKU "${sku.skuNumber}" as final? Its data will be locked from edits until unlocked.`)) return;
        await setSkuFinal(sku.id, sku.skuNumber, true, actor);
      } else {
        const note = window.prompt('Unlock this SKU for editing. Reason (optional — recorded in the log):', '');
        if (note === null) return; // cancelled
        await setSkuFinal(sku.id, sku.skuNumber, false, actor, note);
      }
      await reloadSkus();
    } catch (e: any) {
      alert(`Failed to change lock state: ${e.message}`);
    }
  };

  const openHistory = async (sku: CatalogSku) => {
    setHistorySku(sku);
    setHistoryLoading(true);
    setHistoryEntries([]);
    try {
      setHistoryEntries(await getSkuChangeLog(sku.id));
    } finally {
      setHistoryLoading(false);
    }
  };

  // SKUs in this category with unsaved-to-Akeneo changes (from persisted data, not the draft).
  const changedSkus = useMemo(
    () => allSkus.filter(s => s.categoryId === selectedCategory && s.pendingExport),
    [allSkus, selectedCategory],
  );
  // Only FINAL (locked) SKUs are exportable — a SKU must be finalized before it can go to Akeneo.
  const exportableSkus = useMemo(() => changedSkus.filter(s => s.isFinal), [changedSkus]);

  const exportToAkeneo = async () => {
    if (exportableSkus.length === 0) {
      const changedNotFinal = changedSkus.length - exportableSkus.length;
      alert(changedNotFinal > 0
        ? `Nothing to export: ${changedNotFinal} changed SKU(s) are not marked Final. Mark them as Final first — only final SKUs can be exported to Akeneo.`
        : 'No final SKUs with changes to export for this category.');
      return;
    }
    if (dirtyCount > 0 && !window.confirm('You have unsaved edits that won’t be included. Export the saved data only?')) return;
    setExporting(true);
    try {
      const { headers, rows } = buildAkeneoRows(exportableSkus, catAttrsFlat);
      const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Products');
      const catName = categories.find(c => c.id === selectedCategory)?.name ?? 'skus';
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `akeneo_${catName.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${stamp}.csv`, { bookType: 'csv' });
      // Mark exported (reset the "changed" state) and log it.
      await markSkusExported(exportableSkus.map(s => ({ id: s.id, skuNumber: s.skuNumber })), actor);
      await reloadSkus();
      alert(`Exported ${exportableSkus.length} final SKUs and marked them as done.`);
    } catch (e: any) {
      alert(`Export failed: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  // ── Bulk upload ────────────────────────────────────────────────────────────
  const openUpload = () => {
    setUploadFileName(''); setUploadResult(null); setUploadError(null); setUploading(false);
    setUploadOpen(true);
  };

  const catAttrsFlat = useMemo(() => groupedAttrs.flatMap(g => g.attrs), [groupedAttrs]);

  const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFileName(file.name);
    try {
      const buf = await file.arrayBuffer();
      const res = parseSkuCsv(buf, catAttrsFlat);
      setUploadResult(res);
      setUploadError(res.rows.length === 0
        ? 'No SKU columns found. The header row should list SKU numbers across the top, with attributes down the first column.'
        : null);
    } catch (err: any) {
      setUploadError(`Could not read file: ${err.message}`);
    }
    e.target.value = '';
  };

  const confirmUpload = async () => {
    if (!uploadResult || !selectedCategory) return;
    setUploading(true);
    setUploadError(null);
    try {
      const res = await bulkUpsertCatalogSkus(selectedCategory, uploadResult.rows, actor);
      await reloadSkus();
      setUploadOpen(false);
      alert(`Upload complete: ${res.created} created, ${res.updated} updated${res.lockedSkipped ? `, ${res.lockedSkipped} skipped (final/locked)` : ''}${res.skipped ? `, ${res.skipped} skipped` : ''}.`);
    } catch (e: any) {
      setUploadError(`Upload failed: ${e.message}`);
    } finally {
      setUploading(false);
    }
  };

  // ── Derived view state ───────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return gridSkus.filter(s => {
      if (onlyChanged && !s.pendingExport) return false;
      if (!q) return true;
      return s.skuNumber.toLowerCase().includes(q) || s.skuTitle.toLowerCase().includes(q);
    });
  }, [gridSkus, search, onlyChanged]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / SKUS_PER_PAGE));
  const pageSkus = filtered.slice(page * SKUS_PER_PAGE, page * SKUS_PER_PAGE + SKUS_PER_PAGE);
  const dirtyCount = dirty.size;

  const renderCell = (sku: CatalogSku, attr: CategoryAttribute) => {
    const value = getVal(sku, attr.id);
    const locked = sku.isFinal;
    const base = `w-full px-1.5 py-1 border border-gray-200 rounded text-xs focus:ring-1 focus:ring-indigo-400 outline-none ${locked ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`;
    if (attr.dataType === 'boolean') {
      return (
        <select value={value} disabled={locked} onChange={e => setCell(sku.id, attr, e.target.value)} className={`${base} ${locked ? '' : 'bg-white'}`}>
          <option value="">—</option>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      );
    }
    if (attr.dataType === 'enum') {
      const opts = attr.validationRules?.enumOptions ?? [];
      const showLegacy = value && !opts.includes(value);
      return (
        <select value={value} disabled={locked} onChange={e => setCell(sku.id, attr, e.target.value)} className={`${base} ${locked ? '' : 'bg-white'}`}>
          <option value="">—</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
          {showLegacy && <option value={value}>{value} (?)</option>}
        </select>
      );
    }
    return (
      <input
        type="text"
        value={value}
        disabled={locked}
        onChange={e => setCell(sku.id, attr, e.target.value)}
        placeholder={attr.validationRules?.unit ? attr.validationRules.unit : ''}
        className={base}
      />
    );
  };

  const colCount = pageSkus.length + 1;

  return (
    <Layout>
      <div className="mb-6 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
          <Package className="text-indigo-600" size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-primary">SKU Catalog</h1>
          <p className="text-sm text-muted">Attributes down the side, SKUs across the top — edit values in bulk, with or without a project.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={selectedCategory}
          onChange={e => setSelectedCategory(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:ring-2 focus:ring-indigo-500 outline-none"
        >
          <option value="">Select a category…</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>

        {selectedCategory && (
          <>
            <div className="relative">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search SKUs…"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(0); }}
                className="pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
            <label className="flex items-center gap-1.5 text-sm text-gray-600 select-none cursor-pointer">
              <input type="checkbox" checked={onlyChanged} onChange={e => { setOnlyChanged(e.target.checked); setPage(0); }} />
              Only changed{changedSkus.length > 0 ? ` (${changedSkus.length})` : ''}
            </label>
            <div className="flex-1" />
            <button
              onClick={exportToAkeneo}
              disabled={exporting || exportableSkus.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 text-sm font-medium shadow disabled:opacity-50 disabled:cursor-not-allowed"
              title="Export changed FINAL SKUs to an Akeneo CSV and mark them as exported. Only final SKUs are exported."
            >
              <Download size={16} /> {exporting ? 'Exporting…' : `Export to Akeneo${exportableSkus.length ? ` (${exportableSkus.length})` : ''}`}
            </button>
            <button onClick={openUpload} className="flex items-center gap-2 px-4 py-2 bg-white text-indigo-700 border border-indigo-200 rounded-md hover:bg-indigo-50 text-sm font-medium shadow-sm">
              <Upload size={16} /> Bulk upload
            </button>
            <button onClick={addSku} className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-md hover:bg-gray-50 text-sm font-medium shadow-sm">
              <Plus size={16} /> Add SKU
            </button>
            <button
              onClick={saveAll}
              disabled={saving || dirtyCount === 0}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle size={16} /> {saving ? 'Saving…' : `Save all${dirtyCount ? ` (${dirtyCount})` : ''}`}
            </button>
          </>
        )}
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-16">Loading…</div>
      ) : !selectedCategory ? (
        <div className="text-center text-gray-400 py-16 border border-dashed border-gray-200 rounded-xl">
          Pick a category to view and edit its SKUs.
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl bg-white shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-light border-b border-gray-200 text-xs text-muted flex items-center justify-between">
            <span>
              {filtered.length} SKU{filtered.length === 1 ? '' : 's'} · {attrCount} attribute{attrCount === 1 ? '' : 's'}
              {dirtyCount > 0 && <span className="ml-2 text-amber-600 font-medium">· {dirtyCount} unsaved</span>}
              {attrCount === 0 && <span className="ml-2 text-rose-500">· this category has no attributes yet</span>}
            </span>
            {pageCount > 1 && (
              <span className="flex items-center gap-2">
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} className="px-2 py-0.5 rounded border border-gray-200 disabled:opacity-40">Prev</button>
                SKUs {page * SKUS_PER_PAGE + 1}–{Math.min(filtered.length, (page + 1) * SKUS_PER_PAGE)} of {filtered.length}
                <button onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1} className="px-2 py-0.5 rounded border border-gray-200 disabled:opacity-40">Next</button>
              </span>
            )}
          </div>
          <div className="overflow-auto max-h-[calc(100vh-300px)]">
            <table className="text-xs border-separate border-spacing-0">
              <thead className="sticky top-0 z-20">
                <tr className="bg-slate-50 text-left text-gray-500">
                  <th className="px-2 py-2 sticky left-0 z-30 bg-slate-50 border-r border-gray-200 min-w-[200px] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)]">Attribute</th>
                  {pageSkus.length === 0 ? (
                    <th className="px-3 py-2 font-normal italic text-gray-400">No SKUs — click “Add SKU” or “Bulk upload”.</th>
                  ) : pageSkus.map(sku => {
                    const isDirty = dirty.has(sku.id);
                    const isNew = newIds.has(sku.id);
                    const locked = sku.isFinal;
                    return (
                      <th key={sku.id} className={`px-2 py-2 align-top min-w-[150px] border-l border-gray-200 ${locked ? 'bg-slate-50' : isDirty ? 'bg-amber-50' : ''}`}>
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1">
                            {isNew ? (
                              // Only unsaved SKUs can set their number; once created it is the
                              // immutable identity — shown as read-only text, delete-only.
                              <input
                                type="text"
                                value={sku.skuNumber}
                                onChange={e => setField(sku.id, { skuNumber: e.target.value })}
                                placeholder="SKU #"
                                autoFocus
                                className="w-full px-1.5 py-1 border border-gray-200 rounded text-xs font-semibold text-gray-800 focus:ring-1 focus:ring-indigo-400 outline-none"
                              />
                            ) : (
                              <span className="flex-1 px-1.5 py-1 text-xs font-semibold text-gray-800 break-all" title={sku.skuNumber}>
                                {sku.skuNumber}
                              </span>
                            )}
                            {!isNew && (
                              <button
                                onClick={() => toggleFinal(sku)}
                                className={`p-1 rounded shrink-0 ${locked ? 'text-amber-600 hover:bg-amber-50' : 'text-gray-300 hover:text-emerald-600 hover:bg-emerald-50'}`}
                                title={locked ? 'Unlock (recorded in log)' : 'Mark as final (lock)'}
                              >
                                {locked ? <Lock size={13} /> : <Unlock size={13} />}
                              </button>
                            )}
                            {!isNew && (
                              <button onClick={() => openHistory(sku)} className="p-1 text-gray-300 hover:text-indigo-600 hover:bg-indigo-50 rounded shrink-0" title="Change history">
                                <History size={13} />
                              </button>
                            )}
                            <button onClick={() => removeSku(sku)} className="p-1 text-gray-300 hover:text-rose-600 hover:bg-rose-50 rounded shrink-0" title="Delete SKU">
                              <Trash2 size={13} />
                            </button>
                          </div>
                          <input
                            type="text"
                            value={sku.skuTitle}
                            disabled={locked}
                            onChange={e => setField(sku.id, { skuTitle: e.target.value })}
                            placeholder="Title"
                            className={`w-full px-1.5 py-0.5 border border-gray-200 rounded text-[11px] font-normal text-gray-500 focus:ring-1 focus:ring-indigo-400 outline-none ${locked ? 'bg-gray-50 cursor-not-allowed' : ''}`}
                          />
                          {sku.skuNumber.trim() && (
                            <a
                              href={skuThumbnailUrl(sku.skuNumber, 750)}
                              target="_blank"
                              rel="noreferrer"
                              className="block h-20 w-full rounded border border-gray-100 bg-gray-50 overflow-hidden"
                              title={`Open full image for ${sku.skuNumber}`}
                            >
                              <img
                                src={skuThumbnailUrl(sku.skuNumber)}
                                alt={sku.skuNumber}
                                loading="lazy"
                                className="h-full w-full object-contain"
                                onError={e => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }}
                              />
                            </a>
                          )}
                          <div className="flex items-center gap-1 flex-wrap">
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase ${isNew ? 'text-emerald-600 bg-emerald-50' : sku.projectId ? 'text-violet-600 bg-violet-50' : 'text-slate-500 bg-slate-100'}`} title={sku.projectName ?? ''}>
                              {isNew ? 'New' : sku.projectId ? 'Project' : 'Catalog'}
                            </span>
                            {locked && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded uppercase text-amber-700 bg-amber-100">
                                <Lock size={9} /> Final
                              </span>
                            )}
                            {!isNew && sku.pendingExport && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase text-orange-600 bg-orange-50" title={sku.lastExportedAt ? `Changed since last export (${new Date(sku.lastExportedAt).toLocaleDateString()})` : 'Never exported'}>
                                Changed
                              </span>
                            )}
                          </div>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {attrCount === 0 ? (
                  <tr><td colSpan={colCount} className="px-4 py-10 text-center text-gray-400 italic">This category has no attributes. Add attributes in the Admin panel first.</td></tr>
                ) : groupedAttrs.map(({ group, attrs }) => (
                  <React.Fragment key={group}>
                    <tr>
                      <td colSpan={colCount} className="px-3 py-1.5 bg-indigo-50 border-y border-indigo-100 text-[11px] font-bold uppercase tracking-wide text-indigo-600 sticky left-0 z-10">
                        {group} <span className="text-indigo-300 font-normal normal-case">({attrs.length})</span>
                      </td>
                    </tr>
                    {attrs.map(attr => (
                      <tr key={attr.id} className="hover:bg-light border-b border-slate-100">
                        <td className="px-2 py-1.5 sticky left-0 z-10 bg-white border-r border-gray-200 align-middle shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)]">
                          <div className="font-medium text-gray-800">{attr.name}</div>
                          <div className="text-[10px] text-gray-400 capitalize">
                            {attr.dataType}{attr.validationRules?.unit ? ` · ${attr.validationRules.unit}` : ''}
                          </div>
                        </td>
                        {pageSkus.length === 0 ? <td /> : pageSkus.map(sku => (
                          <td key={sku.id} className={`px-2 py-1.5 border-l border-gray-100 ${dirty.has(sku.id) ? 'bg-amber-50/40' : ''}`}>
                            {renderCell(sku, attr)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {uploadOpen && (() => {
        const catName = categories.find(c => c.id === selectedCategory)?.name ?? 'this category';
        const res = uploadResult;
        const matched = res?.attributes.filter(a => a.matched).length ?? 0;
        const ignored = res?.attributes.filter(a => !a.matched) ?? [];
        const flaggedRows = res?.rows.filter(r => r.flags.length > 0).length ?? 0;
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl p-6 flex flex-col max-h-[88vh]">
              <div className="flex justify-between items-center mb-1">
                <h3 className="font-bold text-lg text-gray-800">Bulk upload SKUs</h3>
                <button onClick={() => setUploadOpen(false)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
              </div>
              <p className="text-xs text-muted mb-4">
                Upload a <strong>transposed</strong> sheet into <span className="font-semibold text-gray-700">{catName}</span>:
                attributes down the first column, <strong>SKU numbers across the header row</strong> (an optional “Title” row sets SKU titles).
                Attribute rows are matched by Akeneo code then name. Existing catalog SKUs (matched by SKU number) are updated; new ones are created.
              </p>

              <div className="flex items-center gap-3 mb-4">
                <label className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow cursor-pointer">
                  <Upload size={16} /> Choose file
                  <input type="file" accept=".csv,text/csv,application/vnd.ms-excel,.xlsx" onChange={handleUploadFile} className="hidden" />
                </label>
                {uploadFileName && <span className="text-sm text-gray-600 truncate">{uploadFileName}</span>}
              </div>

              {uploadError && (
                <div className="mb-3 flex items-start gap-2 text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" /> <span>{uploadError}</span>
                </div>
              )}

              {res && (res.skus.length > 0 || res.attributes.length > 0) && (
                <>
                  <div className="flex flex-wrap items-center gap-3 mb-2 text-xs">
                    <span className="text-gray-600 font-medium">{res.skus.length} SKUs</span>
                    <span className="text-emerald-600 font-medium">{matched} attributes matched</span>
                    {ignored.length > 0 && <span className="text-gray-500 font-medium">{ignored.length} attribute rows ignored</span>}
                    {flaggedRows > 0 && <span className="text-rose-600 font-medium">· {flaggedRows} SKUs with warnings</span>}
                  </div>
                  {ignored.length > 0 && (
                    <div className="mb-3 text-[11px] text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
                      <span className="font-medium text-gray-600">Ignored rows (no matching attribute):</span>{' '}
                      {ignored.map(a => a.label).join(', ')}
                    </div>
                  )}

                  <div className="overflow-auto flex-1 border border-gray-200 rounded-lg">
                    <table className="w-full text-xs">
                      <thead className="bg-light sticky top-0 text-left text-gray-500">
                        <tr>
                          <th className="px-2 py-2">SKU #</th>
                          <th className="px-2 py-2">Title</th>
                          <th className="px-2 py-2">Values</th>
                          <th className="px-2 py-2">Warnings</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {res.rows.slice(0, 100).map((r, i) => (
                          <tr key={i} className="hover:bg-light align-top">
                            <td className="px-2 py-1.5 font-medium">{r.skuNumber}</td>
                            <td className="px-2 py-1.5 text-gray-600 max-w-[180px] truncate">{r.skuTitle || '—'}</td>
                            <td className="px-2 py-1.5 text-gray-400">{r.values.length}</td>
                            <td className="px-2 py-1.5 max-w-[360px]">
                              {r.flags.length > 0 ? (
                                <ul className="space-y-0.5">
                                  {r.flags.map((f, j) => (
                                    <li key={j} className="flex items-start gap-1 text-rose-600">
                                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                                      <span className="leading-snug">{f}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="text-gray-300">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {res.rows.length > 100 && <div className="px-3 py-2 text-[11px] text-gray-400">Showing first 100 of {res.rows.length} SKUs.</div>}
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-4 border-t border-gray-100 mt-3">
                <button onClick={() => setUploadOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium">Cancel</button>
                <button
                  onClick={confirmUpload}
                  disabled={uploading || !res || res.rows.length === 0}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Upload size={16} /> {uploading ? 'Uploading…' : `Import ${res?.rows.length ?? 0} SKUs`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {historySku && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-center mb-1">
              <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                <History size={18} className="text-indigo-600" /> Change history
              </h3>
              <button onClick={() => setHistorySku(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <p className="text-xs text-muted mb-4">
              SKU <span className="font-semibold text-gray-700">{historySku.skuNumber}</span>
              {historySku.isFinal && <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded uppercase text-amber-700 bg-amber-100"><Lock size={9} /> Final</span>}
            </p>

            <div className="overflow-y-auto flex-1 border border-gray-200 rounded-lg divide-y divide-slate-100">
              {historyLoading ? (
                <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
              ) : historyEntries.length === 0 ? (
                <div className="p-6 text-center text-sm text-gray-400 italic">No changes recorded yet.</div>
              ) : historyEntries.map(e => {
                const badge =
                  e.action === 'finalize' ? 'text-amber-700 bg-amber-100'
                  : e.action === 'unlock' ? 'text-emerald-700 bg-emerald-100'
                  : e.action === 'delete' ? 'text-rose-700 bg-rose-100'
                  : e.action === 'create' ? 'text-indigo-700 bg-indigo-100'
                  : 'text-slate-600 bg-slate-100';
                return (
                  <div key={e.id} className="px-4 py-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${badge}`}>{e.action}</span>
                      <span className="text-gray-400">
                        {e.changedByName || 'someone'}{e.createdAt ? ` · ${new Date(e.createdAt).toLocaleString()}` : ''}
                      </span>
                    </div>
                    {e.field && (
                      <div className="mt-1 text-gray-700">
                        <span className="font-medium">{e.field}:</span>{' '}
                        <span className="text-rose-500 line-through">{e.oldValue || '∅'}</span>{' → '}
                        <span className="text-emerald-600">{e.newValue || '∅'}</span>
                      </div>
                    )}
                    {e.note && <div className="mt-0.5 text-gray-400 italic">“{e.note}”</div>}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end pt-4 border-t border-gray-100 mt-3">
              <button onClick={() => setHistorySku(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium">Close</button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default SkuCatalog;
