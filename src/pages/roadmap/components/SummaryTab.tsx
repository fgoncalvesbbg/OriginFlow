import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, RefreshCw, XCircle } from 'lucide-react';
import { getRoadmapApprovers, lookupJiraIssues } from '../../../services';
import { fmtK } from '../format';
import { STATUSES, STATUS_LABELS } from '../roadmap.constants';
import type {
  JiraLookup,
  RoadmapApprover,
  RoadmapBoard,
  RoadmapItemFlag,
  RoadmapPlacer,
  RoadmapSku,
  RoadmapStatus,
} from '../../../types';

/**
 * The Summary tab: three review tables built straight from board state.
 *
 * No fetch of its own for the ROWS — they are derived from `board`, matching RoadmapGrid and
 * StepUpChart. It does fetch two things that depend on the outside world: who may approve, and
 * whether Jira has an Epic for each Project Code.
 *
 * TWO DEPARTURES FROM THE SOURCE, both deliberate:
 *
 *  1. APPROVERS ARE DERIVED. The source hardcoded `MANAGERS = ["Fabio","Nicolas"]`. Here the list
 *     comes from `roadmap_approvers()` — admins, by `profiles.role` — which is the same definition
 *     the `roadmap_validate_approver` trigger enforces, so the dropdown cannot offer a name the
 *     database will reject.
 *  2. JIRA IS BATCHED. The source checked one Epic per cell, one request each. OriginFlow already
 *     has `lookupJiraIssues`, which resolves up to 60 codes per round trip and fails soft — so
 *     every code on the tab is looked up in one go, and a cell reads from the result.
 */

/**
 * Status and approver are TWO INDEPENDENT dropdowns — picking one never resets the other, so
 * "who is reviewing it" can be set before or after the decision itself.
 */
function ApprovalCell({
  status,
  approvedBy,
  approvers,
  disabled,
  onChangeStatus,
  onChangeApprovedBy,
}: {
  status: RoadmapStatus;
  approvedBy: string | null;
  approvers: RoadmapApprover[];
  disabled?: boolean;
  onChangeStatus: (s: RoadmapStatus) => void;
  onChangeApprovedBy: (name: string | null) => void;
}) {
  return (
    <div className="rdmp-approval">
      <select
        className={`rdmp-select is-sm is-status-${status}`}
        value={status || 'pending'}
        disabled={disabled}
        onChange={e => onChangeStatus(e.target.value as RoadmapStatus)}
      >
        {STATUSES.map(s => (
          <option key={s} value={s}>
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <select
        className="rdmp-select is-sm"
        value={approvedBy || ''}
        disabled={disabled}
        onChange={e => onChangeApprovedBy(e.target.value || null)}
      >
        <option value="">—</option>
        {/* A name already on the row that is no longer an admin stays selectable, so an old
            approval still renders as itself rather than silently reverting to "—". */}
        {approvedBy && !approvers.some(a => a.name === approvedBy) && (
          <option value={approvedBy}>{approvedBy} (no longer an admin)</option>
        )}
        {approvers.map(a => (
          <option key={a.userId} value={a.name}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}

function ProjectCodeCell({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled?: boolean;
  onCommit: (v: string | null) => void;
}) {
  return (
    <input
      // Keyed on the value so an external update (or an optimistic rollback) reseeds the input.
      key={value}
      className="rdmp-input is-sm"
      defaultValue={value || ''}
      placeholder="e.g. PC-1234"
      disabled={disabled}
      onBlur={e => {
        const v = e.target.value.trim();
        if (v !== (value || '')) onCommit(v || null);
      }}
    />
  );
}

function NumberCell({
  value,
  disabled,
  onCommit,
  placeholder,
}: {
  value: number | null;
  disabled?: boolean;
  onCommit: (v: number | null) => void;
  placeholder?: string;
}) {
  return (
    <input
      key={String(value)}
      type="number"
      step="any"
      className="rdmp-input is-sm rdmp-num"
      defaultValue={value ?? ''}
      placeholder={placeholder}
      disabled={disabled}
      onBlur={e => {
        const raw = e.target.value.trim();
        const next = raw === '' ? null : Number(raw);
        if (next !== value) onCommit(Number.isFinite(next as number) ? next : null);
      }}
    />
  );
}

interface JiraState {
  configured: boolean;
  results: Record<string, JiraLookup>;
  loading: boolean;
  error?: string;
}

function JiraEpicCell({ projectCode, jira }: { projectCode: string; jira: JiraState }) {
  const code = (projectCode || '').trim();
  if (!code) return <span className="rdmp-muted">—</span>;
  if (jira.loading) return <span className="rdmp-muted">Checking…</span>;
  // Degrades to a sentence, never an error: Jira being unconfigured is a normal state here.
  if (!jira.configured) return <span className="rdmp-muted">Jira not configured</span>;
  if (jira.error) {
    return (
      <span className="rdmp-jira is-error" title={jira.error}>
        Check failed
      </span>
    );
  }
  const issue = jira.results[code]?.issue;
  if (!issue) {
    return (
      <span className="rdmp-jira is-missing">
        <XCircle size={12} /> No Epic found
      </span>
    );
  }
  return (
    <a
      className="rdmp-jira is-found"
      href={issue.url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      title={issue.summary}
    >
      <CheckCircle2 size={12} /> {issue.key}
    </a>
  );
}

export interface SummaryTabProps {
  board: RoadmapBoard;
  hideMetrics?: boolean;
  canEdit?: boolean;
  onUpdatePlacer: (id: number, values: Record<string, unknown>) => Promise<unknown>;
  onSetFlagStatus: (sku: string, values: Record<string, unknown>) => Promise<unknown>;
  onJumpToSku: (sku: string, category?: string) => void;
}

export default function SummaryTab({
  board,
  hideMetrics = false,
  canEdit = false,
  onUpdatePlacer,
  onSetFlagStatus,
  onJumpToSku,
}: SummaryTabProps) {
  const [approvers, setApprovers] = useState<RoadmapApprover[]>([]);
  const [jira, setJira] = useState<JiraState>({ configured: true, results: {}, loading: false });

  useEffect(() => {
    void getRoadmapApprovers().then(setApprovers);
  }, []);

  const newPlacers = useMemo(
    () =>
      [...board.placers]
        .filter(p => p.type === 'new')
        .sort(
          (a, b) =>
            (a.category || '').localeCompare(b.category || '') ||
            `${a.family}/${a.yValue}/${a.xValue}`.localeCompare(
              `${b.family}/${b.yValue}/${b.xValue}`,
            ),
        ),
    [board.placers],
  );

  const bySku = useMemo(() => new Map(board.skus.map(s => [s.sku, s])), [board.skus]);

  const flagRows = useCallback(
    (key: string): { f: RoadmapItemFlag; s: RoadmapSku }[] =>
      board.flags
        .filter(f => f.flag === key && bySku.has(f.sku))
        .map(f => ({ f, s: bySku.get(f.sku) as RoadmapSku }))
        .sort(
          (a, b) =>
            (a.s.systemIndex || '').localeCompare(b.s.systemIndex || '') ||
            (a.s.family || '').localeCompare(b.s.family || '') ||
            a.s.sku.localeCompare(b.s.sku),
        ),
    [board.flags, bySku],
  );

  const replacements = useMemo(() => flagRows('replace'), [flagRows]);
  // 'aeol' (Already EOL) is a distinct existing mark and is intentionally excluded here — this
  // table is about decisions still to be made, not about what already happened.
  const eol = useMemo(() => flagRows('eol'), [flagRows]);

  // Every Project Code on the tab, looked up in one round trip.
  const codes = useMemo(() => {
    const out = new Set<string>();
    for (const p of newPlacers) if (p.projectCode?.trim()) out.add(p.projectCode.trim());
    for (const { f } of replacements) if (f.projectCode?.trim()) out.add(f.projectCode.trim());
    return [...out].sort();
  }, [newPlacers, replacements]);

  const refreshJira = useCallback(async (wanted: string[]) => {
    if (!wanted.length) {
      setJira({ configured: true, results: {}, loading: false });
      return;
    }
    setJira(s => ({ ...s, loading: true }));
    const res = await lookupJiraIssues(wanted);
    setJira({ configured: res.configured, results: res.results, loading: false, error: res.error });
  }, []);

  // Re-runs whenever the set of codes changes — i.e. right after a Project Code is typed and
  // saved. No button needed for the common case.
  useEffect(() => {
    void refreshJira(codes);
  }, [codes, refreshJira]);

  const newProjectsNicTotal = newPlacers
    .filter(p => p.status === 'approved')
    .reduce((sum, p) => sum + (p.expected2027Nic || 0), 0);

  const eolFcTotal = eol
    .filter(({ f }) => f.status === 'approved')
    .reduce((sum, { s }) => sum + (s.novfc26 || 0), 0);

  const ro = !canEdit;

  const approvalFor = (
    row: { status: RoadmapStatus; approvedBy: string | null },
    commit: (patch: Record<string, unknown>) => void,
  ) => (
    <ApprovalCell
      status={row.status}
      approvedBy={row.approvedBy}
      approvers={approvers}
      disabled={ro}
      onChangeStatus={status => commit({ status })}
      onChangeApprovedBy={approvedBy => commit({ approvedBy })}
    />
  );

  return (
    <div className="rdmp-history">
      {codes.length > 0 && (
        <div className="rdmp-history-top">
          <button
            type="button"
            className="rdmp-btn"
            onClick={() => void refreshJira(codes)}
            disabled={jira.loading}
          >
            <RefreshCw size={13} /> {jira.loading ? 'Checking Jira…' : 'Re-check Jira'}
          </button>
        </div>
      )}

      <section className="rdmp-panel-card">
        <h3>
          New Projects{' '}
          {newPlacers.length > 0 && (
            <span className="rdmp-badge is-count">{newPlacers.length}</span>
          )}
        </h3>
        {newPlacers.length === 0 ? (
          <p className="rdmp-muted">No new-item spots flagged.</p>
        ) : (
          <table className="rdmp-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Family</th>
                <th>X Axis</th>
                <th>Y Axis</th>
                <th>Notes</th>
                <th>Project Code</th>
                <th>Jira</th>
                {!hideMetrics && <th className="rdmp-num">Expected 2027 NIC</th>}
                <th>Approval</th>
              </tr>
            </thead>
            <tbody>
              {newPlacers.map((p: RoadmapPlacer) => (
                <tr key={p.id}>
                  <td>{p.category}</td>
                  <td>{p.family}</td>
                  <td>
                    {p.xValue} <span className="rdmp-muted">({p.xField})</span>
                  </td>
                  <td>
                    {p.yValue} <span className="rdmp-muted">({p.yField})</span>
                  </td>
                  <td>{p.comment || '—'}</td>
                  <td>
                    <ProjectCodeCell
                      value={p.projectCode}
                      disabled={ro}
                      onCommit={v => void onUpdatePlacer(p.id, { projectCode: v })}
                    />
                  </td>
                  <td>
                    <JiraEpicCell projectCode={p.projectCode} jira={jira} />
                  </td>
                  {!hideMetrics && (
                    <td>
                      <NumberCell
                        value={p.expected2027Nic}
                        placeholder="e.g. 150000"
                        disabled={ro}
                        onCommit={v => void onUpdatePlacer(p.id, { expected2027Nic: v })}
                      />
                    </td>
                  )}
                  <td>
                    {approvalFor(p, patch => void onUpdatePlacer(p.id, patch))}
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Approved only — a total that counted pending rows would read as a commitment. */}
            {!hideMetrics && (
              <tfoot>
                <tr className="rdmp-table-total">
                  <td colSpan={7}>Total Expected 2027 NIC (Approved only)</td>
                  <td className="rdmp-num">{fmtK(newProjectsNicTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </section>

      <section className="rdmp-panel-card">
        <h3>
          Replacements{' '}
          {replacements.length > 0 && (
            <span className="rdmp-badge is-count">{replacements.length}</span>
          )}
        </h3>
        {replacements.length === 0 ? (
          <p className="rdmp-muted">No items marked for replacement.</p>
        ) : (
          <table className="rdmp-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Family</th>
                <th>SKU</th>
                <th>Notes</th>
                <th>Project Code</th>
                <th>Jira</th>
                <th>Approval</th>
              </tr>
            </thead>
            <tbody>
              {replacements.map(({ f, s }) => (
                <tr key={f.sku}>
                  <td>{s.systemIndex}</td>
                  <td>{s.family}</td>
                  <td>
                    <button
                      type="button"
                      className="rdmp-linkbtn"
                      onClick={() => onJumpToSku(f.sku, s.systemIndex)}
                    >
                      {f.sku}
                    </button>
                  </td>
                  <td>{f.comment || '—'}</td>
                  <td>
                    <ProjectCodeCell
                      value={f.projectCode}
                      disabled={ro}
                      onCommit={v => void onSetFlagStatus(f.sku, { projectCode: v })}
                    />
                  </td>
                  <td>
                    <JiraEpicCell projectCode={f.projectCode} jira={jira} />
                  </td>
                  <td>
                    {approvalFor(f, patch => void onSetFlagStatus(f.sku, patch))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rdmp-panel-card">
        <h3>EOL {eol.length > 0 && <span className="rdmp-badge is-count">{eol.length}</span>}</h3>
        {eol.length === 0 ? (
          <p className="rdmp-muted">No items marked EOL.</p>
        ) : (
          <table className="rdmp-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Family</th>
                <th>SKU</th>
                <th>Notes</th>
                {!hideMetrics && <th className="rdmp-num">2026 FC</th>}
                <th>Approval</th>
              </tr>
            </thead>
            <tbody>
              {eol.map(({ f, s }) => (
                <tr key={f.sku}>
                  <td>{s.systemIndex}</td>
                  <td>{s.family}</td>
                  <td>
                    <button
                      type="button"
                      className="rdmp-linkbtn"
                      onClick={() => onJumpToSku(f.sku, s.systemIndex)}
                    >
                      {f.sku}
                    </button>
                  </td>
                  <td>{f.comment || '—'}</td>
                  {!hideMetrics && <td className="rdmp-num">{fmtK(s.novfc26)}</td>}
                  <td>
                    {approvalFor(f, patch => void onSetFlagStatus(f.sku, patch))}
                  </td>
                </tr>
              ))}
            </tbody>
            {!hideMetrics && (
              <tfoot>
                <tr className="rdmp-table-total">
                  <td colSpan={4}>Total 2026 FC being EOL&apos;d (Approved only)</td>
                  <td className="rdmp-num">{fmtK(eolFcTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </section>
    </div>
  );
}
