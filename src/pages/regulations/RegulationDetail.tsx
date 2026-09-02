/**
 * One standard, whole — identity, version, and every requirement it imposes.
 *
 * This is the page the merge exists for. Before it, answering "what does the LVD actually
 * oblige us to do?" meant opening the TCF library for one category at a time to find the
 * evidence rows, then the IM template list to find the checklist, and neither told you
 * which edition anyone meant. Here it is one screen, in the order a person asks:
 *
 *   1. WHICH document is this — reference, title, edition, in force or not.
 *   2. Is it still CURRENT — the live EUR-Lex verdict, with what it found and when.
 *   3. What it means for the TECHNICAL FILE — the description, and every requirement
 *      citing it, grouped by category, with what each supplier must actually send.
 *   4. What it means for the MANUAL — the IM checklist, and which templates answer for it.
 *   5. The source text — the Markdown summary the AI check reads.
 *
 * The two usage lists are honest about zero. A regulation with a summary, a checklist and
 * no template answering for it is a real and common state, and saying "0 templates" is the
 * only way anyone notices.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeft, Building, CalendarClock, CheckSquare, Clock, Edit2, ExternalLink,
  Ban, FileCheck, FileText, Globe, ListTree, Loader2, Lock, RefreshCw, Scale, ShieldCheck,
} from 'lucide-react';

import Layout from '../../components/Layout';
import {
  collectBlocks,
  getCategories,
  getRegulationById,
  getRegulations,
  getRegulationUsage,
  resolveReplacement,
  indexRegulations,
  parseRegulationChecklist,
  parseRegulationNotes,
  runVersionCheck,
  updateRegulation,
  versionCheckAgeDays,
} from '../../services';
import type { CategoryL3, ComplianceRequirement, Regulation, RegulationClause } from '../../types';
import { UserRole } from '../../types';
import { useAuth } from '../../context/AuthContext';
import type { RegulationTemplateUse } from '../../services/regulatory/regulation-usage.service';
import RegulationEditor, { type RegulationDraft } from './RegulationEditor';
import ObligationsEditor from './ObligationsEditor';
import VersionBadge, { versionBadgeTitle } from './VersionBadge';

const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024))} kB`;

const Section: React.FC<{
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  accent?: string;
  children: React.ReactNode;
}> = ({ icon, title, subtitle, accent, children }) => (
  <div className={`bg-white rounded-xl border shadow-sm overflow-hidden ${accent ?? 'border-gray-200'}`}>
    <div className="px-4 py-3 border-b border-gray-100">
      <h2 className="text-sm font-bold text-gray-800 flex items-center gap-2">{icon} {title}</h2>
      {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
    </div>
    <div className="p-4">{children}</div>
  </div>
);

const Fact: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div>
    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{label}</div>
    <div className="text-sm text-gray-800 mt-0.5">{children}</div>
  </div>
);

/** The supplier-facing rules of one TCF requirement, in the same words the portal uses. */
const RequirementRules: React.FC<{ r: ComplianceRequirement }> = ({ r }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 text-[10px] text-gray-500">
    <span className="inline-flex items-center gap-1">
      <Clock size={10} />
      {r.timingType === 'POST_ETD' ? `ETD+${r.timingWeeks ?? 0}w` : 'At ETD'}
    </span>
    <span className="inline-flex items-center gap-1">
      <Building size={10} />
      {r.testReportOrigin === 'supplier_inhouse' ? 'In-house' : '3rd party'}
    </span>
    <span className="inline-flex items-center gap-1">
      <FileCheck size={10} />
      {r.selfDeclarationAccepted ? 'Self-declaration OK' : 'Lab report required'}
    </span>
    {r.condition && (
      <span className="inline-flex items-center gap-1 text-indigo-500">
        <Lock size={10} /> Conditional
      </span>
    )}
  </div>
);

const RegulationDetail: React.FC = () => {
  const { regulationId } = useParams<{ regulationId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === UserRole.ADMIN;

  const [regulation, setRegulation] = useState<Regulation | null>(null);
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [requirements, setRequirements] = useState<ComplianceRequirement[]>([]);
  const [templates, setTemplates] = useState<RegulationTemplateUse[]>([]);
  // The whole library: the replacement picker needs it, and so does resolving this row's
  // own expiry chain (migration 140).
  const [library, setLibrary] = useState<Regulation[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [draft, setDraft] = useState<RegulationDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [editingObligations, setEditingObligations] = useState(false);

  const load = useCallback(async () => {
    if (!regulationId) return;
    const [reg, cats, usage, lib] = await Promise.all([
      getRegulationById(regulationId),
      getCategories(),
      getRegulationUsage(regulationId),
      getRegulations(),
    ]);
    if (!reg) { setNotFound(true); setLoading(false); return; }
    setRegulation(reg);
    setCategories(cats);
    setRequirements(usage.tcfRequirements);
    setTemplates(usage.templates);
    setLibrary(lib);
    setLoading(false);
  }, [regulationId]);

  useEffect(() => { load(); }, [load]);

  const categoryName = useCallback(
    (id: string | null | undefined) => (id ? categories.find(c => c.id === id)?.name ?? 'Unknown category' : 'All categories'),
    [categories],
  );

  /** TCF requirements grouped by the category that asks for them. */
  const requirementsByCategory = useMemo(() => {
    const groups = new Map<string, ComplianceRequirement[]>();
    for (const r of requirements) {
      const key = r.categoryId ?? '__global__';
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    return Array.from(groups.entries()).sort(([a], [b]) =>
      a === '__global__' ? -1 : b === '__global__' ? 1 : categoryName(a).localeCompare(categoryName(b)));
  }, [requirements, categoryName]);

  const checklistItems = useMemo(
    () => parseRegulationChecklist(regulation?.checklist),
    [regulation?.checklist],
  );
  const scopeNotes = useMemo(
    () => parseRegulationNotes(regulation?.notes),
    [regulation?.notes],
  );

  /**
   * This regulation's own expiry state (migration 140). `blocking` is the fact the page has
   * to lead with: it is why somebody's publish was refused, and this is where they land.
   */
  const lifecycle = useMemo(
    () => (regulation ? resolveReplacement(regulation, indexRegulations(library)) : null),
    [regulation, library],
  );
  /**
   * Obligations grouped by the clause imposing them, in document order, with anything
   * unassigned last — an obligation whose source line never named a clause is still real and
   * must not fall off the page.
   */
  const clauseGroups = useMemo(() => {
    const obligations = regulation?.obligations ?? [];
    if (obligations.length === 0) return [];
    const groups: Array<{ key: string; clause: RegulationClause | null; obligations: typeof obligations }> =
      (regulation?.clauses ?? [])
        .map(c => ({ key: c.id, clause: c, obligations: obligations.filter(o => o.clauseId === c.id) }))
        .filter(g => g.obligations.length > 0);
    const unassigned = obligations.filter(o => !o.clauseId);
    if (unassigned.length > 0) groups.push({ key: '__none__', clause: null, obligations: unassigned });
    return groups;
  }, [regulation?.clauses, regulation?.obligations]);

  const blockDetail = useMemo(
    () => (regulation ? collectBlocks([regulation], library)[0] ?? null : null),
    [regulation, library],
  );

  const handleCheck = async () => {
    if (!regulation) return;
    setChecking(true);
    setCheckError('');
    try {
      const outcome = await runVersionCheck([regulation]);
      if (outcome.error) setCheckError(outcome.error);
      else if (outcome.skipped.includes(regulation.id)) {
        setCheckError(
          'This regulation has no CELEX number, so there is nothing to query. EN, IEC and ISO ' +
          'standards have no free catalogue API — add a source link and a re-verify date instead.',
        );
      }
      await load();
    } catch (e) {
      setCheckError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  const handleEdit = () => {
    if (!regulation) return;
    setSaveError('');
    setDraft({
      id: regulation.id,
      title: regulation.title,
      referenceCode: regulation.referenceCode,
      jurisdiction: regulation.jurisdiction ?? '',
      summary: regulation.summary ?? '',
      tcfDescription: regulation.tcfDescription ?? '',
      notes: regulation.notes ?? '',
      checklist: regulation.checklist ?? '',
      summaryMd: regulation.summaryMd,
      summaryFileName: regulation.summaryFileName ?? null,
      applicableCategories: regulation.applicableCategories,
      status: regulation.status,
      supersededById: regulation.supersededById ?? null,
      expiredAt: regulation.expiredAt ?? '',
      expiredReason: regulation.expiredReason ?? '',
      version: regulation.version ?? '',
      editionYear: regulation.editionYear ?? null,
      issuedAt: regulation.issuedAt ?? '',
      lastAmendedAt: regulation.lastAmendedAt ?? '',
      reviewDueAt: regulation.reviewDueAt ?? '',
      sourceUrl: regulation.sourceUrl ?? '',
      celexId: regulation.celexId ?? '',
    });
  };

  const handleSave = async () => {
    if (!draft?.id) return;
    setSaving(true);
    setSaveError('');
    try {
      const { id, ...updates } = draft;
      await updateRegulation(id, updates, user?.email);
      await load();
      setDraft(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Layout><div className="text-center py-20 text-gray-400">Loading regulation…</div></Layout>;
  }

  if (notFound || !regulation) {
    return (
      <Layout>
        <div className="text-center py-20">
          <p className="text-gray-500">That regulation no longer exists.</p>
          <button onClick={() => navigate('/regulations')} className="text-indigo-600 text-sm mt-3 hover:underline">
            Back to the library
          </button>
        </div>
      </Layout>
    );
  }

  const detail = regulation.versionDetail;
  const checkedAgo = versionCheckAgeDays(regulation);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto space-y-4">
        <Link to="/regulations" className="text-xs text-gray-500 hover:text-indigo-600 inline-flex items-center gap-1">
          <ArrowLeft size={13} /> All regulations
        </Link>

        {/* --- 0. Why work is stopped, when it is -------------------------- */}
        {lifecycle?.blocking && blockDetail && (
          <div className="rounded-xl border border-rose-300 bg-rose-50 p-4">
            <div className="flex items-start gap-2.5">
              <Ban size={18} className="text-rose-600 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-rose-900">
                  This regulation is blocking work
                </h2>
                <p className="text-xs text-rose-800 mt-1 leading-relaxed">{blockDetail.message}</p>
                {regulation.expiredReason && (
                  <p className="text-xs text-rose-700 mt-1 italic">{regulation.expiredReason}</p>
                )}
                <p className="text-xs text-rose-800 mt-2">
                  While it stays this way, no manual citing it can be published and no new TCF
                  request can be created for a category that asks for it —{' '}
                  <strong>
                    {requirements.length} requirement{requirements.length === 1 ? '' : 's'} and{' '}
                    {templates.length} template{templates.length === 1 ? '' : 's'}
                  </strong>{' '}
                  are affected. Requests already sent are unaffected.
                </p>
                {isAdmin && (
                  <button
                    onClick={handleEdit}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                  >
                    <Edit2 size={13} /> Record the replacement
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* An expiry that IS replaced is not a problem — but it is the reason a template's
            obligations changed under someone, so it still gets said out loud. */}
        {lifecycle?.outcome === 'replaced' && lifecycle.chain.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
            <Ban size={14} className="text-amber-600 mt-0.5 shrink-0" />
            <span>
              Expired{regulation.expiredAt ? ` on ${regulation.expiredAt}` : ''} and replaced by{' '}
              <Link
                to={`/regulations/${lifecycle.effective.id}`}
                className="font-mono font-bold underline hover:text-amber-950"
              >
                {lifecycle.effective.referenceCode}
              </Link>
              {lifecycle.chain.length > 1 && ' (via a chain of replacements)'}. Nothing is
              blocked: everything that cites this regulation answers for the replacement
              instead. Relinking those is tidy-up, not urgent.
            </span>
          </div>
        )}

        {/* --- 1. Which document is this ---------------------------------- */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-base font-bold text-primary break-all">
                  {regulation.referenceCode}
                </span>
                {regulation.status === 'superseded' && (
                  <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-[10px] font-bold">
                    SUPERSEDED
                  </span>
                )}
                {regulation.status === 'expired' && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1 ${
                    lifecycle?.blocking ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-800'
                  }`}>
                    <Ban size={10} /> EXPIRED
                  </span>
                )}
                <VersionBadge regulation={regulation} />
              </div>
              <h1 className="text-lg font-bold text-gray-800 mt-1">{regulation.title}</h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {regulation.sourceUrl && (
                <a
                  href={regulation.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50"
                >
                  <ExternalLink size={13} /> Source
                </a>
              )}
              {isAdmin && (
                <button
                  onClick={handleEdit}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
                >
                  <Edit2 size={13} /> Edit
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mt-5 pt-4 border-t border-gray-100">
            <Fact label="Version">{regulation.version || <span className="text-gray-300">—</span>}</Fact>
            <Fact label="Year">{regulation.editionYear ?? <span className="text-gray-300">—</span>}</Fact>
            <Fact label="Issued">{regulation.issuedAt || <span className="text-gray-300">—</span>}</Fact>
            <Fact label="Last change">{regulation.lastAmendedAt || <span className="text-gray-300">—</span>}</Fact>
            <Fact label="Jurisdiction">
              {regulation.jurisdiction
                ? <span className="inline-flex items-center gap-1"><Globe size={12} /> {regulation.jurisdiction}</span>
                : <span className="text-gray-300">—</span>}
            </Fact>
          </div>

          {regulation.summary && (
            <p className="text-sm text-gray-600 mt-4 pt-4 border-t border-gray-100 leading-relaxed">
              {regulation.summary}
            </p>
          )}
        </div>

        {/* --- 2. Is it still current ------------------------------------- */}
        <Section
          icon={<RefreshCw size={14} />}
          title="Version check"
          subtitle="Asked live of EUR-Lex. EU legal acts only — EN, IEC and ISO standards publish no free catalogue API, so those are tracked by their source link and a re-verify date."
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-sm text-gray-700 min-w-0">
              <p>{versionBadgeTitle(regulation)}</p>
              {regulation.celexId ? (
                <p className="text-[11px] text-gray-400 mt-1">
                  CELEX <span className="font-mono">{regulation.celexId}</span>
                  {checkedAgo !== null && <> · last checked {checkedAgo === 0 ? 'today' : `${checkedAgo}d ago`}</>}
                </p>
              ) : (
                <p className="text-[11px] text-amber-600 mt-1 flex items-start gap-1.5">
                  <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                  No CELEX number, so this one cannot be checked automatically.
                </p>
              )}
              {regulation.reviewDueAt && (
                <p className="text-[11px] text-gray-500 mt-1 inline-flex items-center gap-1">
                  <CalendarClock size={11} /> A person should re-verify by {regulation.reviewDueAt}.
                </p>
              )}
            </div>
            <button
              onClick={handleCheck}
              disabled={checking || !regulation.celexId}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 bg-white hover:bg-gray-50 disabled:opacity-40 shrink-0"
            >
              {checking
                ? <><Loader2 size={13} className="animate-spin" /> Checking…</>
                : <><RefreshCw size={13} /> Check now</>}
            </button>
          </div>

          {detail && (detail.latestConsolidated || detail.amendments) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 pt-4 border-t border-gray-100">
              <Fact label="Latest consolidation">
                {detail.latestConsolidatedOn
                  ? <span title={detail.latestConsolidated}>{detail.latestConsolidatedOn}</span>
                  : <span className="text-gray-300">—</span>}
              </Fact>
              <Fact label="Amendments">{detail.amendments ?? <span className="text-gray-300">—</span>}</Fact>
              <Fact label="Last amended">{detail.lastAmendedOn ?? <span className="text-gray-300">—</span>}</Fact>
              <Fact label="In force">
                {detail.endOfValidity && detail.endOfValidity !== '9999-12-31'
                  ? `until ${detail.endOfValidity}`
                  : 'yes'}
              </Fact>
            </div>
          )}

          {/* EUR-Lex says repealed; WE have not said expired. The two are deliberately not
              wired together — an automated third-party lookup must never freeze production
              work on its own — so this is a prompt, and a person presses the button. */}
          {regulation.versionState === 'repealed' && regulation.status !== 'expired' && isAdmin && (
            <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-start justify-between gap-3">
              <p className="text-xs text-rose-800 min-w-0">
                EUR-Lex records this act as no longer in force
                {detail?.endOfValidity && detail.endOfValidity !== '9999-12-31'
                  ? ` since ${detail.endOfValidity}` : ''}, but it is still marked{' '}
                <strong>{regulation.status}</strong> here — so nothing is stopped and manuals
                citing it still publish.
              </p>
              <button
                onClick={handleEdit}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 shrink-0"
              >
                <Ban size={13} /> Mark expired
              </button>
            </div>
          )}

          {checkError && (
            <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mt-3">
              {checkError}
            </p>
          )}
        </Section>

        {/* --- 3. What it means for the technical file --------------------- */}
        <Section
          icon={<ShieldCheck size={14} className="text-sky-600" />}
          title="Technical file (TCF)"
          subtitle="The evidence this regulation obliges a supplier to provide, and every requirement that exists to satisfy it."
          accent="border-sky-200"
        >
          {regulation.tcfDescription ? (
            <p className="text-sm text-gray-700 leading-relaxed">{regulation.tcfDescription}</p>
          ) : (
            <p className="text-xs text-gray-400 italic">
              No TCF description yet. Add one and it will fill in the description of any new
              requirement created from this regulation.
            </p>
          )}

          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {requirements.length} requirement{requirements.length === 1 ? '' : 's'} cite this regulation
            </div>
            {requirements.length === 0 ? (
              <p className="text-xs text-gray-400">
                Nothing in the TCF asks for evidence against this regulation yet. Link a
                requirement to it from the{' '}
                <Link to="/compliance/library" className="text-indigo-600 hover:underline">compliance library</Link>.
              </p>
            ) : (
              <div className="space-y-3">
                {requirementsByCategory.map(([key, reqs]) => (
                  <div key={key}>
                    <div className="text-[11px] font-bold text-gray-600 flex items-center gap-1.5">
                      {key === '__global__' && <Globe size={11} className="text-amber-500" />}
                      {key === '__global__' ? 'Global — all categories' : categoryName(key)}
                    </div>
                    <ul className="mt-1 divide-y divide-gray-100 border border-gray-100 rounded-lg">
                      {reqs.map(r => (
                        <li key={r.id} className="px-3 py-2">
                          <div className="flex items-start gap-2">
                            <span className="text-sm text-gray-800 font-medium">{r.title}</span>
                            {r.isMandatory && (
                              <span className="bg-rose-100 text-rose-700 px-1.5 py-0.5 rounded-full text-[9px] font-bold shrink-0 mt-0.5">
                                REQUIRED
                              </span>
                            )}
                            {r.section && (
                              <span className="text-[10px] text-gray-400 ml-auto shrink-0">{r.section}</span>
                            )}
                          </div>
                          {r.description && (
                            <p className="text-[11px] text-gray-500 mt-0.5">{r.description}</p>
                          )}
                          <RequirementRules r={r} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Section>

        {/* --- 3b. The document's own structure ---------------------------- */}
        <Section
          icon={<ListTree size={14} />}
          title="Chapters &amp; obligations"
          subtitle="What the document actually says, clause by clause. Amendments land here rather than on the document as a whole — which is why a clause carries its own change date."
        >
          {isAdmin && (
            <div className="flex justify-end -mt-1 mb-3">
              <button
                onClick={() => setEditingObligations(true)}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-600 bg-indigo-50 hover:bg-indigo-100"
              >
                <Edit2 size={13} /> Edit chapters &amp; obligations
              </button>
            </div>
          )}
          {clauseGroups.length === 0 ? (
            <p className="text-xs text-gray-400">
              No obligations recorded yet. Breaking them out by clause is what lets an
              amendment be tracked where it actually happens, and lets a manual&apos;s checklist
              cite the clause it answers.
            </p>
          ) : (
            <div className="space-y-3">
              {clauseGroups.map(group => (
                <div key={group.key} className="border border-gray-100 rounded-lg overflow-hidden">
                  <div className="px-3 py-2 bg-light flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-mono text-sm font-bold text-primary">
                      {group.clause
                        ? [group.clause.number, group.clause.qualifier].filter(Boolean).join(' ')
                        : 'No clause recorded'}
                    </span>
                    {group.clause?.title && (
                      <span className="text-xs text-gray-600">{group.clause.title}</span>
                    )}
                    {group.clause?.amendedIn && (
                      <span className="text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded-full">
                        changed in {group.clause.amendedIn}
                      </span>
                    )}
                    {group.clause?.lastChangedAt && (
                      <span className="text-[10px] text-gray-400">{group.clause.lastChangedAt}</span>
                    )}
                    <span className="text-[10px] text-gray-400 ml-auto">
                      {group.obligations.length} obligation{group.obligations.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {group.obligations.map(o => (
                      <li key={o.id} className="px-3 py-2">
                        <p className="text-sm text-gray-800">{o.text}</p>
                        {/* Mandated wording is set apart because it is text that must survive
                            translation byte-for-byte, not a paraphrase of a duty. */}
                        {o.verbatim && (
                          <p className="mt-1 text-[11px] text-indigo-900 bg-indigo-50 border-l-2 border-indigo-300 pl-2 py-1 italic">
                            {o.verbatim}
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-1 mt-1.5">
                          {o.carriers.map(c => (
                            <span key={c} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                              {c}
                            </span>
                          ))}
                          {o.optionalCarriers.map(c => (
                            <span
                              key={c}
                              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-gray-50 text-gray-400 border border-dashed border-gray-300"
                              title="Optional carrier — this artifact may repeat the obligation but does not have to."
                            >
                              {c} (optional)
                            </span>
                          ))}
                          {o.carriers.length === 0 && o.optionalCarriers.length === 0 && (
                            <span
                              className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200"
                              title="Nobody has recorded which artifact carries this, so it is shown on every checklist rather than hidden from all of them."
                            >
                              unclassified
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* --- 4. What it means for the manual ----------------------------- */}
        <Section
          icon={<CheckSquare size={14} className="text-emerald-600" />}
          title="Instruction manual (IM)"
          subtitle="What the manual must contain, and which templates answer for this regulation."
          accent="border-emerald-200"
        >
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
            {checklistItems.length} IM requirement{checklistItems.length === 1 ? '' : 's'}
          </div>
          {checklistItems.length === 0 ? (
            <p className="text-xs text-gray-400">
              No IM requirements recorded. These are the obligations a person verifies by hand
              before a manual is published — the AI check reads the template text, so it can
              never see the rating plate or what is in the box.
            </p>
          ) : (
            <ul className="space-y-1">
              {checklistItems.map((item, i) => (
                <li key={i} className="text-sm text-gray-700 flex gap-2">
                  <CheckSquare size={13} className="text-emerald-500 shrink-0 mt-0.5" />
                  <span className="min-w-0">{item}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
              {templates.length} template{templates.length === 1 ? '' : 's'} answer for it
            </div>
            {templates.length === 0 ? (
              <p className="text-xs text-gray-400">
                No IM template answers for this regulation yet. Tick a category on it, or assign
                it to a template from the IM dashboard.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {templates.map(t => (
                  <Link
                    key={t.templateId}
                    to={`/im/template/${t.categoryId ?? ''}/${t.templateType}`}
                    className="text-[11px] px-2 py-1 rounded-lg border border-gray-200 bg-light hover:bg-gray-100 inline-flex items-center gap-1.5"
                    title={t.source === 'category'
                      ? 'Applies because one of this regulation\'s categories is ticked — there is no assignment row to remove.'
                      : 'Assigned to this template directly.'}
                  >
                    {t.source === 'category' && <Lock size={10} className="text-gray-400" />}
                    {t.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </Section>

        {/* --- 5. The source text ----------------------------------------- */}
        <Section
          icon={<FileText size={14} />}
          title="Source summary"
          subtitle="The only text the AI regulatory check is given about this regulation. Its quality is the ceiling on the quality of the check."
        >
          {scopeNotes.length > 0 && (
            <div className="mb-4">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1">
                Scope notes sent with every check
              </div>
              <ul className="space-y-0.5">
                {scopeNotes.map((n, i) => (
                  <li key={i} className="text-[11px] text-gray-600 flex gap-1.5">
                    <span className="text-gray-300 shrink-0">&bull;</span>
                    <span className="min-w-0 break-words">{n}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {regulation.summaryMd ? (
            <>
              <p className="text-[11px] text-gray-500 mb-2">
                {regulation.summaryFileName || 'summary.md'} · {kb(regulation.summaryBytes)}
                {regulation.summaryUploadedAt && ` · uploaded ${regulation.summaryUploadedAt.slice(0, 10)}`}
                {regulation.summaryUploadedBy && ` by ${regulation.summaryUploadedBy}`}
              </p>
              {/* Raw source on purpose: it is Markdown, there is no Markdown renderer in the
                  dependency list, and showing the source is honest and safe. */}
              <pre className="max-h-96 overflow-auto text-[11px] leading-relaxed bg-light border rounded p-3 whitespace-pre-wrap">
                {regulation.summaryMd}
              </pre>
            </>
          ) : (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              No Markdown summary. A regulatory check against this regulation is refused rather
              than returning a reassuring &ldquo;no findings&rdquo;.
            </p>
          )}
        </Section>

        <p className="text-[10px] text-gray-300 text-center pb-4 inline-flex items-center gap-1 justify-center w-full">
          <Scale size={10} /> One regulation, read by both the technical file and the manual.
        </p>
      </div>

      {editingObligations && (
        <ObligationsEditor
          regulation={regulation}
          actor={user?.email}
          onChanged={load}
          onClose={() => setEditingObligations(false)}
        />
      )}

      {draft && (
        <RegulationEditor
          draft={draft}
          categories={categories}
          library={library}
          saving={saving}
          error={saveError}
          onChange={setDraft}
          onSave={handleSave}
          onClose={() => setDraft(null)}
        />
      )}
    </Layout>
  );
};

export default RegulationDetail;
