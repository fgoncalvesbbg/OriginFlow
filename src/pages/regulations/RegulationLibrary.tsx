/**
 * The regulation library — one list, for the whole company.
 *
 * Moved here from the IM dashboard's Regulations tab (migration 139). It used to be an IM
 * feature that the TCF knew nothing about, which is exactly why the same regulation ended
 * up described twice with different facts. It is now a top-level section that both the
 * technical file and the manual read from, and each card says who currently answers for
 * the regulation on BOTH sides.
 *
 * Writes are admin-only by RLS, so the write affordances are hidden for non-admins rather
 * than failing with an opaque policy error.
 *
 * `applicableCategories` is NOT decoration: ticking a category makes the regulation apply
 * to that category's IM and warning-leaflet templates automatically (see
 * src/services/regulatory/regulation-assignment.service.ts).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Ban, CalendarClock, CheckSquare, ChevronDown, ChevronRight, Edit2, FileJson,
  FileText, Loader2, Plus, RefreshCw, Scale, Search, ShieldCheck, Trash2, X,
} from 'lucide-react';

import {
  RegulationInUseError,
  createRegulation,
  deleteRegulation,
  getCategories,
  getRegulationById,
  getRegulationTcfCounts,
  getRegulationUsageCounts,
  getRegulations,
  groupRegulations,
  indexRegulations,
  isReviewOverdue,
  parseRegulationChecklist,
  resolveReplacement,
  runVersionCheck,
  updateRegulation,
} from '../../services';
import type { RegulationGroupBy } from '../../services';
import type { CategoryL3, Regulation, RegulationStatus } from '../../types';
import { UserRole } from '../../types';
import { useAuth } from '../../context/AuthContext';
import RegulationEditor, { emptyRegulationDraft, type RegulationDraft } from './RegulationEditor';
import RegulationImportDialog from './RegulationImportDialog';
import VersionBadge from './VersionBadge';

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} kB`;

/** The edition line a card shows: "Ed. 6.1 · 2021", or whichever half exists. */
const editionLine = (r: Regulation): string =>
  [r.version, r.editionYear ? String(r.editionYear) : ''].filter(Boolean).join(' · ');

export const RegulationLibraryContent: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === UserRole.ADMIN;

  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [usage, setUsage] = useState<Record<string, number>>({});
  const [tcfUsage, setTcfUsage] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RegulationStatus>('all');
  const [groupBy, setGroupBy] = useState<RegulationGroupBy>('kind');
  /** Collapsed sections, by group key. Empty = everything open. */
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const [draft, setDraft] = useState<RegulationDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [listError, setListError] = useState('');

  const [checking, setChecking] = useState(false);
  const [checkNote, setCheckNote] = useState('');
  const [importing, setImporting] = useState(false);

  const loadData = useCallback(async () => {
    // getRegulationUsageCounts/getRegulationTcfCounts deliberately THROW on a failed read
    // rather than degrading to {} — a zero usage count is what unlocks the delete button, so
    // a silent empty result could let an in-use regulation be deleted. That makes this load
    // rejectable, so it must be handled here: without a catch the spinner would latch on
    // forever and the rejection would surface only as an unhandled promise.
    try {
      setListError('');
      const [regs, cats, counts, tcfCounts] = await Promise.all([
        getRegulations(), getCategories(), getRegulationUsageCounts(), getRegulationTcfCounts(),
      ]);
      setRegulations(regs);
      setCategories(cats);
      setUsage(counts);
      setTcfUsage(tcfCounts);
    } catch (e) {
      setListError(e instanceof Error ? e.message : 'Could not load the regulation library.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return regulations.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (!needle) return true;
      return [r.referenceCode, r.title, r.jurisdiction, r.summary, r.tcfDescription, r.notes, r.checklist, r.celexId]
        .some(v => (v ?? '').toLowerCase().includes(needle));
    });
  }, [regulations, search, statusFilter]);

  /**
   * Expiry resolved for every row (migration 140), so a card can say whether it is merely
   * expired or actually stopping work. Resolution walks the replacement chain, which needs
   * the whole library — hence one map built here rather than per card.
   */
  const lifecycleById = useMemo(() => {
    const byId = indexRegulations(regulations);
    return new Map(regulations.map(r => [r.id, resolveReplacement(r, byId)]));
  }, [regulations]);

  const blockingCount = useMemo(
    () => Array.from(lifecycleById.values()).filter(l => l.blocking).length,
    [lifecycleById],
  );

  /**
   * The sections rendered below. Grouping runs on the FILTERED list, so a search narrows the
   * sections to those that still have a hit rather than leaving empty headers behind.
   */
  const groups = useMemo(() => groupRegulations(visible, groupBy), [visible, groupBy]);

  const toggleGroup = useCallback((key: string) => {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Collapse state is keyed by group key, and the keys change meaning when the dimension does
  // ('standard' vs 'EU' vs 'active'), so a stale set would collapse an unrelated section.
  const handleGroupByChange = useCallback((next: RegulationGroupBy) => {
    setGroupBy(next);
    setCollapsed(new Set());
  }, []);

  /** How many rows the version check can actually speak to — everything with a CELEX. */
  const checkableCount = useMemo(
    () => regulations.filter(r => (r.celexId ?? '').trim()).length,
    [regulations],
  );

  const handleCheckVersions = async () => {
    setChecking(true);
    setCheckNote('');
    setListError('');
    try {
      const outcome = await runVersionCheck(regulations);
      const verdicts = Object.values(outcome.results);
      const newer = verdicts.filter(v => v.state === 'newer_available').length;
      const repealed = verdicts.filter(v => v.state === 'repealed').length;
      const parts = [`Checked ${verdicts.length} EU act${verdicts.length === 1 ? '' : 's'} against EUR-Lex.`];
      if (newer) parts.push(`${newer} ${newer === 1 ? 'has' : 'have'} a newer version.`);
      if (repealed) parts.push(`${repealed} repealed.`);
      if (!newer && !repealed && verdicts.length) parts.push('Nothing newer.');
      if (outcome.skipped.length) {
        parts.push(
          `${outcome.skipped.length} skipped — no CELEX, so nothing to query. ` +
          `EN/IEC/ISO standards have no free catalogue API; give those a source link and a review date.`,
        );
      }
      setCheckNote(parts.join(' '));
      if (outcome.error) setListError(outcome.error);
      await loadData();
    } catch (e) {
      setListError(`The version check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setChecking(false);
    }
  };

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
      summary: source.summary ?? '',
      tcfDescription: source.tcfDescription ?? '',
      notes: source.notes ?? '',
      checklist: source.checklist ?? '',
      summaryMd: source.summaryMd,
      summaryFileName: source.summaryFileName ?? null,
      applicableCategories: source.applicableCategories,
      status: source.status,
      supersededById: source.supersededById ?? null,
      expiredAt: source.expiredAt ?? '',
      expiredReason: source.expiredReason ?? '',
      version: source.version ?? '',
      editionYear: source.editionYear ?? null,
      issuedAt: source.issuedAt ?? '',
      lastAmendedAt: source.lastAmendedAt ?? '',
      reviewDueAt: source.reviewDueAt ?? '',
      sourceUrl: source.sourceUrl ?? '',
      celexId: source.celexId ?? '',
      obligationsCount: source.obligations?.length ?? 0,
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
    const templates = usage[r.id] ?? 0;
    const tcf = tcfUsage[r.id] ?? 0;
    if (templates > 0 || tcf > 0) {
      setListError(
        `"${r.referenceCode}" is still cited by ${templates} template(s) and ${tcf} TCF ` +
        `requirement(s), so it cannot be deleted. Unlink it there, or set it to Superseded ` +
        `to retire it while keeping the history.`,
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
          Every regulation and standard in one place. Each carries what it means for the
          technical file, what the manual must contain, and the summary the AI check reads —
          so the TCF and the IM answer for the same version of the same document.
        </p>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} className="absolute left-2 top-2.5 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="text-xs border rounded-lg pl-7 pr-2 py-1.5 w-44"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as 'all' | RegulationStatus)}
            className="text-xs border rounded-lg px-2 py-1.5 bg-white"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="expired">Expired</option>
            <option value="superseded">Superseded</option>
          </select>
          <select
            value={groupBy}
            onChange={e => handleGroupByChange(e.target.value as RegulationGroupBy)}
            title="How the library is sectioned. Kind reads the citation itself — a directive states the obligation, a standard demonstrates it."
            className="text-xs border rounded-lg px-2 py-1.5 bg-white"
          >
            <option value="kind">Group by kind</option>
            <option value="jurisdiction">Group by jurisdiction</option>
            <option value="status">Group by status</option>
            <option value="none">No grouping</option>
          </select>
          <button
            onClick={handleCheckVersions}
            disabled={checking || checkableCount === 0}
            title={checkableCount === 0
              ? 'No regulation has a CELEX number yet, so there is nothing EUR-Lex can be asked about.'
              : `Ask EUR-Lex whether a newer consolidated version exists for the ${checkableCount} EU act(s) in the library.`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 transition-colors"
          >
            {checking
              ? <><Loader2 size={13} className="animate-spin" /> Checking…</>
              : <><RefreshCw size={13} /> Check versions</>}
          </button>
          {isAdmin && (
            <button
              onClick={() => setImporting(true)}
              title="Import a regulation researched by AI — validated and previewed before anything is written"
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 transition-colors"
            >
              <FileJson size={13} /> Import
            </button>
          )}
          {isAdmin && (
            <button
              onClick={() => { setSaveError(''); setDraft(emptyRegulationDraft()); }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors"
            >
              <Plus size={13} /> Add regulation
            </button>
          )}
        </div>
      </div>

      {blockingCount > 0 && (
        <div className="mb-4 text-xs text-rose-900 bg-rose-50 border border-rose-300 rounded-lg p-3 flex items-start gap-2">
          <Ban size={15} className="text-rose-600 mt-0.5 shrink-0" />
          <span>
            <strong>
              {blockingCount} regulation{blockingCount === 1 ? ' is' : 's are'} expired with no
              replacement recorded.
            </strong>{' '}
            No manual citing {blockingCount === 1 ? 'it' : 'them'} can be published, and no new
            TCF request can be created for a category that asks for{' '}
            {blockingCount === 1 ? 'it' : 'them'}. Open the regulation and record what replaces
            it to release the block.
          </span>
        </div>
      )}

      {checkNote && (
        <div className="mb-4 text-xs text-gray-600 bg-light border border-gray-200 rounded-lg p-3 flex items-start justify-between gap-3">
          <span>{checkNote}</span>
          <button onClick={() => setCheckNote('')} className="text-gray-400 hover:text-gray-700 shrink-0"><X size={14} /></button>
        </div>
      )}

      {listError && (
        <div className="mb-4 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start justify-between gap-3">
          <span>{listError}</span>
          <button onClick={() => setListError('')} className="text-amber-500 hover:text-amber-800 shrink-0"><X size={14} /></button>
        </div>
      )}

      {groups.map(group => {
        const isCollapsed = collapsed.has(group.key);
        return (
          <section key={group.key} className="mb-6 last:mb-0">
            {groupBy !== 'none' && (
              <button
                onClick={() => toggleGroup(group.key)}
                aria-expanded={!isCollapsed}
                className="w-full flex items-center gap-2 mb-3 pb-1.5 border-b border-gray-200 text-left group"
              >
                {isCollapsed
                  ? <ChevronRight size={14} className="text-gray-400 shrink-0" />
                  : <ChevronDown size={14} className="text-gray-400 shrink-0" />}
                <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide group-hover:text-indigo-600 transition-colors">
                  {group.label}
                </h3>
                <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                  {group.regulations.length}
                </span>
              </button>
            )}
            {!isCollapsed && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {group.regulations.map(r => {
              const templates = usage[r.id] ?? 0;
              const tcf = tcfUsage[r.id] ?? 0;
              // Obligations (migration 141) supersede the free-text blob as the source of truth;
              // counting the blob once a regulation has obligation rows would under/over-report
              // what it actually contains. Same fallback rule as the checklist builder itself.
              const hasObligationRows = (r.obligations?.length ?? 0) > 0;
              const obligationCount = hasObligationRows
                ? (r.obligations?.length ?? 0)
                : parseRegulationChecklist(r.checklist).length;
              const obligationTitles = hasObligationRows
                ? (r.obligations ?? []).map(o => o.text).join('\n')
                : parseRegulationChecklist(r.checklist).join('\n');
              const edition = editionLine(r);
              return (
                <div key={r.id} className="bg-white p-4 rounded-xl border border-gray-200 shadow flex flex-col hover:shadow-md transition-all">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to={`/regulations/${r.id}`}
                      className="font-mono text-sm font-bold text-primary break-all hover:text-indigo-600"
                    >
                      {r.referenceCode}
                    </Link>
                    {r.status === 'superseded' && (
                      <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full text-[9px] font-bold shrink-0">
                        SUPERSEDED
                      </span>
                    )}
                    {r.status === 'expired' && (() => {
                      const life = lifecycleById.get(r.id);
                      return (
                        <span
                          className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold shrink-0 inline-flex items-center gap-1 ${
                            life?.blocking ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-800'
                          }`}
                          title={life?.blocking
                            ? 'Expired with no replacement recorded — this is blocking publishes and new TCF requests.'
                            : `Expired, replaced by ${life?.effective.referenceCode}. Nothing is blocked.`}
                        >
                          <Ban size={9} /> {life?.blocking ? 'BLOCKING' : 'EXPIRED'}
                        </span>
                      );
                    })()}
                  </div>
                  <Link to={`/regulations/${r.id}`} className="text-sm text-gray-700 mt-1 hover:text-indigo-600">
                    {r.title}
                  </Link>

                  {edition && (
                    <p className="text-[11px] text-gray-500 mt-1.5 font-medium">{edition}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    {r.jurisdiction && (
                      <span className="bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded-full text-[9px] font-bold">
                        {r.jurisdiction}
                      </span>
                    )}
                    <VersionBadge regulation={r} />
                    {isReviewOverdue(r) && (
                      <span
                        className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full text-[9px] font-bold inline-flex items-center gap-1"
                        title={`A person was due to re-verify this against the source by ${r.reviewDueAt}.`}
                      >
                        <CalendarClock size={9} /> Review due
                      </span>
                    )}
                  </div>

                  {/* Both halves of the obligation, side by side — the whole reason the two
                      libraries were merged. A zero on either side is worth seeing. */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                    <span
                      className="bg-sky-50 text-sky-700 border border-sky-100 px-1.5 py-0.5 rounded-full text-[9px] font-bold inline-flex items-center gap-1"
                      title="TCF requirements that exist to satisfy this regulation."
                    >
                      <ShieldCheck size={9} /> {tcf} TCF
                    </span>
                    <span
                      className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full text-[9px] font-bold"
                      title="IM templates that answer for this regulation, explicitly or via a ticked category."
                    >
                      {templates} template{templates === 1 ? '' : 's'}
                    </span>
                    {obligationCount > 0 && (
                      <span
                        className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full text-[9px] font-bold inline-flex items-center gap-1"
                        title={obligationTitles}
                      >
                        <CheckSquare size={9} /> {obligationCount} obligation{obligationCount === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>

                  {r.summary && (
                    <p className="text-[11px] text-gray-500 mt-2 line-clamp-3">{r.summary}</p>
                  )}

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

                  <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-100">
                    <Link
                      to={`/regulations/${r.id}`}
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-800 inline-flex items-center gap-1"
                    >
                      <Scale size={12} /> Open
                    </Link>
                    {isAdmin && (
                      <>
                        <button
                          onClick={() => handleEdit(r)}
                          className="text-xs font-medium text-gray-500 hover:text-indigo-700 inline-flex items-center gap-1"
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
                      </>
                    )}
                  </div>
                </div>
              );
                })}
              </div>
            )}
          </section>
        );
      })}

      {visible.length === 0 && (
        <div className="text-center py-12 text-gray-400 bg-light border border-dashed border-gray-200 rounded-xl">
          {regulations.length === 0
            ? (isAdmin
                ? 'No regulations yet. Add the first one to start building the library.'
                : 'No regulations yet. An administrator can add them here.')
            : 'No regulations match that search.'}
        </div>
      )}

      {importing && (
        <RegulationImportDialog
          library={regulations}
          categories={categories}
          actor={user?.email}
          onClose={() => setImporting(false)}
          onImported={() => { void loadData(); }}
        />
      )}

      {draft && (
        <RegulationEditor
          draft={draft}
          categories={categories}
          library={regulations}
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
