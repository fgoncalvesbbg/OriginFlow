/**
 * IMRegulationLibrary — the global regulation library (migration 115).
 *
 * One card per regulation or regulatory guideline, each optionally carrying an uploaded
 * Markdown summary. The summary is the ONLY thing the AI regulatory check is told about
 * a regulation, so a regulation without one is called out in amber: a check against it
 * is refused server-side rather than returning a reassuring "no findings".
 *
 * The .md file is read IN THE BROWSER with `file.text()` and stored as text — the same
 * read-in-the-tab pattern as ImImportDialog. Nothing is uploaded to a bucket, so no
 * bucket policy or MIME allow-list needed changing.
 *
 * Writes are admin-only by RLS, so the write affordances are hidden for non-admins
 * rather than failing with an opaque policy error.
 *
 * Exported as `RegulationLibraryContent` (no Layout wrapper) so IMDashboard can embed it
 * as a tab — the same shape as `BlockLibraryContent`.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ChevronDown, ChevronUp, Edit2, FileText, Loader2, Plus, Scale,
  Search, Trash2, Upload, X,
} from 'lucide-react';
import {
  createRegulation,
  deleteRegulation,
  getCategories,
  getRegulationById,
  getRegulations,
  getRegulationUsageCounts,
  updateRegulation,
  summaryByteLength,
  MAX_SUMMARY_BYTES,
  SUMMARY_WARN_BYTES,
  RegulationInUseError,
} from '../../services';
import type { CategoryL3, Regulation, RegulationInput, RegulationStatus } from '../../types';
import { UserRole } from '../../types';
import { useAuth } from '../../context/AuthContext';

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} kB`;

interface Draft extends RegulationInput {
  id?: string;
}

const emptyDraft = (): Draft => ({
  title: '',
  referenceCode: '',
  jurisdiction: '',
  notes: '',
  applicableCategories: [],
  status: 'active',
});

// ---------------------------------------------------------------------------
// Editor modal
// ---------------------------------------------------------------------------

interface EditorProps {
  draft: Draft;
  categories: CategoryL3[];
  saving: boolean;
  error: string;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onClose: () => void;
}

const RegulationEditor: React.FC<EditorProps> = ({
  draft, categories, saving, error, onChange, onSave, onClose,
}) => {
  const [showPreview, setShowPreview] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const summaryBytes = draft.summaryMd ? summaryByteLength(draft.summaryMd) : 0;
  const tooBig = summaryBytes > MAX_SUMMARY_BYTES;
  const large = summaryBytes > SUMMARY_WARN_BYTES && !tooBig;

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    try {
      const text = await file.text();
      if (!text.trim()) {
        setUploadError('That file is empty.');
        return;
      }
      const bytes = summaryByteLength(text);
      if (bytes > MAX_SUMMARY_BYTES) {
        setUploadError(
          `That summary is ${kb(bytes)}; the limit is ${kb(MAX_SUMMARY_BYTES)}. Trim it to ` +
          `the clauses that actually govern the manual.`,
        );
        return;
      }
      onChange({ ...draft, summaryMd: text, summaryFileName: file.name });
    } catch (e) {
      setUploadError(`Could not read that file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const toggleCategory = (id: string) => {
    const current = draft.applicableCategories ?? [];
    onChange({
      ...draft,
      applicableCategories: current.includes(id)
        ? current.filter((c) => c !== id)
        : [...current, id],
    });
  };

  const canSave = draft.title.trim() !== '' && draft.referenceCode.trim() !== '' && !tooBig && !saving;

  return (
    <div className="fixed inset-0 bg-black/50 z-[70] flex items-center justify-center p-4" onClick={() => !saving && onClose()}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b">
          <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
            <Scale size={16} /> {draft.id ? 'Edit regulation' : 'Add regulation'}
          </h3>
          <button onClick={() => !saving && onClose()} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
        </div>

        <div className="px-5 py-4 space-y-4 text-sm overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Reference code *</label>
              <input
                value={draft.referenceCode}
                onChange={(e) => onChange({ ...draft, referenceCode: e.target.value })}
                placeholder="(EU) 2019/2016"
                className="w-full text-sm border rounded px-2 py-1.5 mt-1 font-mono"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Exactly as it is cited in a manual. Must be unique.
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Jurisdiction</label>
              <input
                value={draft.jurisdiction ?? ''}
                onChange={(e) => onChange({ ...draft, jurisdiction: e.target.value })}
                placeholder="EU"
                className="w-full text-sm border rounded px-2 py-1.5 mt-1"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Title *</label>
            <input
              value={draft.title}
              onChange={(e) => onChange({ ...draft, title: e.target.value })}
              placeholder="Energy labelling of refrigerating appliances"
              className="w-full text-sm border rounded px-2 py-1.5 mt-1"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase">Notes</label>
            <textarea
              value={draft.notes ?? ''}
              onChange={(e) => onChange({ ...draft, notes: e.target.value })}
              rows={2}
              placeholder="Scope, edition, amendments — anything a reviewer should know."
              className="w-full text-sm border rounded px-2 py-1.5 mt-1"
            />
          </div>

          {/* Markdown summary */}
          <div className="border rounded-lg p-3 bg-light/50">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-600 uppercase flex items-center gap-1.5">
                <FileText size={13} /> Markdown summary
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 cursor-pointer">
                <Upload size={12} /> {draft.summaryMd ? 'Replace .md' : 'Upload .md'}
                <input
                  type="file"
                  accept="text/markdown,text/plain,.md,.markdown"
                  className="hidden"
                  onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
                />
              </label>
            </div>

            <p className="text-[11px] text-gray-500 mt-2">
              This is the <strong>only</strong> thing the AI check is told about the regulation,
              so its quality is the ceiling on the quality of the check.
            </p>

            {draft.summaryMd ? (
              <div className="mt-2">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-gray-600 truncate">
                    {draft.summaryFileName || 'summary.md'} · {kb(summaryBytes)}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setShowPreview((v) => !v)}
                      className="text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1"
                    >
                      {showPreview ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Preview
                    </button>
                    <button
                      onClick={() => onChange({ ...draft, summaryMd: null, summaryFileName: null })}
                      className="text-gray-400 hover:text-rose-600"
                      title="Remove the summary"
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
                {tooBig && (
                  <p className="text-[11px] text-rose-600 mt-1.5">
                    Too large to save ({kb(summaryBytes)} of {kb(MAX_SUMMARY_BYTES)}).
                  </p>
                )}
                {large && (
                  <p className="text-[11px] text-amber-600 mt-1.5">
                    This is large — every check call sends the whole summary, so runs will be
                    slower and dearer.
                  </p>
                )}
                {showPreview && (
                  // Raw source on purpose: it is Markdown, there is no Markdown renderer in
                  // the dependency list, and showing the source is honest and safe.
                  <pre className="mt-2 max-h-56 overflow-auto text-[11px] leading-relaxed bg-white border rounded p-2 whitespace-pre-wrap">
                    {draft.summaryMd}
                  </pre>
                )}
              </div>
            ) : (
              <p className="text-[11px] text-amber-600 mt-2 flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                No summary yet — a regulatory check against this regulation will be refused.
              </p>
            )}

            {uploadError && <p className="text-[11px] text-rose-600 mt-1.5">{uploadError}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">Status</label>
              <select
                value={draft.status ?? 'active'}
                onChange={(e) => onChange({ ...draft, status: e.target.value as RegulationStatus })}
                className="w-full text-sm border rounded px-2 py-1.5 mt-1 bg-white"
              >
                <option value="active">Active</option>
                <option value="superseded">Superseded</option>
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                Superseded hides it from the assignment picker without deleting it — existing
                assignments and past reports stay intact.
              </p>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase">
                Suggested for categories
              </label>
              <div className="mt-1 max-h-28 overflow-y-auto border rounded p-2 space-y-1 bg-white">
                {categories.length === 0 && (
                  <p className="text-[11px] text-gray-400">No categories defined.</p>
                )}
                {categories.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={(draft.applicableCategories ?? []).includes(c.id)}
                      onChange={() => toggleCategory(c.id)}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                A hint for the assignment picker only — never used to decide what is checked.
              </p>
            </div>
          </div>

          {error && (
            <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded p-2">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t">
          <button onClick={onClose} disabled={saving} className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50">
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={!canSave}
            className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-40 flex items-center gap-1.5"
          >
            {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// RegulationLibraryContent — reusable, no Layout wrapper
// ---------------------------------------------------------------------------

export const RegulationLibraryContent: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === UserRole.ADMIN;

  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RegulationStatus>('all');

  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [listError, setListError] = useState('');

  const loadData = useCallback(async () => {
    const [regs, cats, counts] = await Promise.all([
      getRegulations(), getCategories(), getRegulationUsageCounts(),
    ]);
    setRegulations(regs);
    setCategories(cats);
    setUsage(counts);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return regulations.filter((r) => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!needle) return true;
      return [r.referenceCode, r.title, r.jurisdiction, r.notes]
        .some((v) => (v ?? '').toLowerCase().includes(needle));
    });
  }, [regulations, search, statusFilter]);

  const handleEdit = async (r: Regulation) => {
    setSaveError('');
    // The list row has no summaryMd (the list query excludes it) — fetch the full row
    // so opening the editor never silently discards an existing summary on save.
    const full = await getRegulationById(r.id);
    const source = full ?? r;
    setDraft({
      id: source.id,
      title: source.title,
      referenceCode: source.referenceCode,
      jurisdiction: source.jurisdiction ?? '',
      notes: source.notes ?? '',
      summaryMd: source.summaryMd,
      summaryFileName: source.summaryFileName ?? null,
      applicableCategories: source.applicableCategories,
      status: source.status,
    });
  };

  const handleSave = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError('');
    try {
      if (draft.id) {
        const { id, ...updates } = draft;
        await updateRegulation(id, updates, user?.email);
      } else {
        await createRegulation(draft, user?.email);
      }
      await loadData();
      setDraft(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (r: Regulation) => {
    const count = usage[r.id] ?? 0;
    if (count > 0) {
      setListError(
        `"${r.referenceCode}" is assigned to ${count} template(s), so it cannot be deleted. ` +
        `Unassign it there, or set it to Superseded to retire it while keeping the history.`,
      );
      return;
    }
    if (!window.confirm(`Delete "${r.referenceCode}" from the library? This cannot be undone.`)) return;
    setDeletingId(r.id);
    setListError('');
    try {
      await deleteRegulation(r.id);
      await loadData();
    } catch (e) {
      setListError(e instanceof RegulationInUseError
        ? e.message
        : `Deleting failed: ${e instanceof Error ? e.message : String(e)}`);
      await loadData();
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <div className="text-center py-16 text-gray-400">Loading regulations…</div>;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-xs text-gray-400 max-w-2xl">
          Regulations and regulatory guidelines, each with an uploaded Markdown summary.
          Assign them to a category template from the Category Templates tab, then run a
          regulatory check from the template editor.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-2.5 text-gray-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="text-xs border rounded-lg pl-7 pr-2 py-1.5 w-44"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | RegulationStatus)}
            className="text-xs border rounded-lg px-2 py-1.5 bg-white"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="superseded">Superseded</option>
          </select>
          {isAdmin && (
            <button
              onClick={() => { setSaveError(''); setDraft(emptyDraft()); }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
            >
              <Plus size={13} /> Add regulation
            </button>
          )}
        </div>
      </div>

      {listError && (
        <div className="mb-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start justify-between gap-3">
          <span>{listError}</span>
          <button onClick={() => setListError('')} className="text-amber-500 hover:text-amber-800 shrink-0"><X size={14} /></button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {visible.map((r) => (
          <div key={r.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow flex flex-col hover:shadow-md transition-all">
            <div className="flex items-start justify-between gap-2">
              <span className="font-mono text-sm font-bold text-primary break-all">{r.referenceCode}</span>
              {r.status === 'superseded' && (
                <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full text-[9px] font-bold shrink-0">
                  SUPERSEDED
                </span>
              )}
            </div>
            <p className="text-sm text-gray-700 mt-1">{r.title}</p>

            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {r.jurisdiction && (
                <span className="bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full text-[9px] font-bold">
                  {r.jurisdiction}
                </span>
              )}
              <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full text-[9px] font-bold">
                used by {usage[r.id] ?? 0} template{(usage[r.id] ?? 0) === 1 ? '' : 's'}
              </span>
            </div>

            {r.summaryBytes > 0 ? (
              <p className="text-[11px] text-gray-500 mt-2 flex items-center gap-1.5 truncate">
                <FileText size={11} className="shrink-0" />
                <span className="truncate" title={r.summaryFileName ?? undefined}>
                  {kb(r.summaryBytes)} summary{r.summaryFileName ? ` · ${r.summaryFileName}` : ''}
                </span>
              </p>
            ) : (
              <p className="text-[11px] text-amber-600 mt-2 flex items-start gap-1.5">
                <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                No summary — checks against this regulation will be refused.
              </p>
            )}

            {r.notes && <p className="text-[11px] text-gray-400 mt-2 line-clamp-2">{r.notes}</p>}

            {isAdmin && (
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
                <button
                  onClick={() => handleEdit(r)}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1"
                >
                  <Edit2 size={12} /> Edit
                </button>
                <button
                  onClick={() => handleDelete(r)}
                  disabled={deletingId === r.id}
                  className="text-xs font-medium text-gray-400 hover:text-rose-600 inline-flex items-center gap-1 disabled:opacity-50"
                >
                  {deletingId === r.id
                    ? <><Loader2 size={12} className="animate-spin" /> Deleting…</>
                    : <><Trash2 size={12} /> Delete</>}
                </button>
              </div>
            )}
          </div>
        ))}

        {visible.length === 0 && (
          <div className="col-span-full text-center py-12 text-gray-400 bg-light border border-dashed border-gray-200 rounded-xl">
            {regulations.length === 0
              ? (isAdmin
                  ? 'No regulations yet. Add the first one to start building the library.'
                  : 'No regulations yet. An administrator can add them here.')
              : 'No regulations match that search.'}
          </div>
        )}
      </div>

      {draft && (
        <RegulationEditor
          draft={draft}
          categories={categories}
          saving={saving}
          error={saveError}
          onChange={setDraft}
          onSave={handleSave}
          onClose={() => setDraft(null)}
        />
      )}
    </div>
  );
};

export default RegulationLibraryContent;
