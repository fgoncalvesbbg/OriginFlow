import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { getRoadmapAudit, getRoadmapImports } from '../../../services';
import { findOrphans } from '../grid';
import type { OrphanResult } from '../grid';
import type { RoadmapAuditEntry, RoadmapBoard, RoadmapImport } from '../../../types';

/**
 * Three things that only make sense together: what has been imported, what people have changed,
 * and which annotations no longer line up with any live SKU.
 *
 * THE ORPHAN LIST is the safety net for the one way a refresh can still hurt. Annotations are
 * addressed by VALUE (family name, segment value), so a rename upstream leaves them pointing at a
 * cell no SKU occupies. The board keeps rendering them — clause (3) of the union rule in grid.ts
 * unions their values back into the axes — and this is where somebody notices and cleans up.
 * Without this list the guarantee would be silently hoarding invisible annotations.
 *
 * Orphans are derived CLIENT-SIDE from the board that is already loaded (the source had a
 * `/orphans` endpoint; here `findOrphans` is the same derivation, unit-tested, with no round
 * trip). Imports and the audit log are read fresh, because they change without the board doing.
 */

const ENTITY_LABEL: Record<string, string> = {
  flag: 'SKU mark',
  placer: 'Placeholder',
  axis: 'Axis value',
  import: 'Import',
};

const ACTION_LABEL: Record<string, string> = {
  set: 'set',
  clear: 'cleared',
  add: 'added',
  remove: 'removed',
  edit: 'edited',
  import: 'imported',
};

function describe(entry: RoadmapAuditEntry): string {
  const a = (entry.after ?? {}) as Record<string, unknown>;
  const b = (entry.before ?? {}) as Record<string, unknown>;
  if (entry.entity === 'import') {
    return `${a.fileName || '(unnamed file)'} — ${a.rowCount ?? 0} rows, ${a.inserted ?? 0} new, ${a.updated ?? 0} updated, ${a.delisted ?? 0} delisted`;
  }
  if (entry.entity === 'flag') {
    if (entry.action === 'clear') return `${entry.sku || entry.entityKey}: mark removed`;
    return [`${entry.sku}: ${a.flag || 'comment only'}`, a.comment].filter(Boolean).join(' — ');
  }
  if (entry.entity === 'placer') {
    const cell = [a.family ?? b.family, a.yValue ?? b.yValue, a.xValue ?? b.xValue]
      .filter(Boolean)
      .join(' / ');
    const note = a.comment || b.comment || '';
    return [cell, a.type || b.type, note].filter(Boolean).join(' · ');
  }
  if (entry.entity === 'axis') {
    const v = a.value || b.value;
    const f = a.field || b.field;
    return [v, f && `(${f})`].filter(Boolean).join(' ');
  }
  return '';
}

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '—');

export interface HistoryViewProps {
  /** '' means every category. */
  category: string;
  board: RoadmapBoard;
  onJumpToSku: (sku: string) => void;
  onRemovePlacer?: (id: number) => Promise<unknown>;
}

export default function HistoryView({
  category,
  board,
  onJumpToSku,
  onRemovePlacer,
}: HistoryViewProps) {
  const [imports, setImports] = useState<RoadmapImport[]>([]);
  const [audit, setAudit] = useState<RoadmapAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const orphans: OrphanResult = findOrphans({
    skus: board.skus,
    placers: board.placers,
    flags: board.flags,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [i, a] = await Promise.all([
        getRoadmapImports(25),
        getRoadmapAudit(category || undefined, 200),
      ]);
      setImports(i);
      setAudit(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the history.');
    } finally {
      setLoading(false);
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  const orphanCount = orphans.placers.length + orphans.flags.length;

  return (
    <div className="rdmp-history">
      <div className="rdmp-history-top">
        <button type="button" className="rdmp-btn" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={13} /> {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {error && <p className="rdmp-error">{error}</p>}

      <section className="rdmp-panel-card">
        <h3>
          Orphaned annotations{' '}
          {orphanCount > 0 && <span className="rdmp-badge is-warn">{orphanCount}</span>}
        </h3>
        {orphanCount === 0 ? (
          <p className="rdmp-muted">
            Every mark and placeholder in this category still matches a SKU in the latest file.
          </p>
        ) : (
          <>
            <p className="rdmp-muted">
              <AlertTriangle size={13} /> These still show on the board, but the product data they
              were pinned to has moved or gone. Nothing has been deleted — review and clear them
              when you&apos;re done with them.
            </p>
            {orphans.placers.length > 0 && (
              <table className="rdmp-table">
                <thead>
                  <tr>
                    <th>Cell</th>
                    <th>Axes</th>
                    <th>Type</th>
                    <th>Comment</th>
                    <th>By</th>
                    {onRemovePlacer && <th />}
                  </tr>
                </thead>
                <tbody>
                  {orphans.placers.map(p => (
                    <tr key={p.id}>
                      <td>
                        {p.family} / {p.yValue} / {p.xValue}
                      </td>
                      <td className="rdmp-muted">
                        {p.yField} × {p.xField}
                      </td>
                      <td>{p.type}</td>
                      <td>{p.comment || '—'}</td>
                      <td className="rdmp-muted">{p.updatedBy || '—'}</td>
                      {onRemovePlacer && (
                        <td>
                          <button
                            type="button"
                            className="rdmp-btn is-sm is-danger"
                            onClick={() => void onRemovePlacer(p.id).then(load)}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {orphans.flags.length > 0 && (
              <>
                <h4>Marks on SKUs not in the latest file</h4>
                <table className="rdmp-table">
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Mark</th>
                      <th>Comment</th>
                      <th>By</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orphans.flags.map(f => (
                      <tr key={f.sku}>
                        <td>
                          <button
                            type="button"
                            className="rdmp-linkbtn"
                            onClick={() => onJumpToSku(f.sku)}
                          >
                            {f.sku}
                          </button>
                        </td>
                        <td>{f.flag || 'comment only'}</td>
                        <td>{f.comment || '—'}</td>
                        <td className="rdmp-muted">{f.updatedBy || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </section>

      <section className="rdmp-panel-card">
        <h3>Imports</h3>
        {imports.length === 0 ? (
          <p className="rdmp-muted">Nothing imported yet.</p>
        ) : (
          <table className="rdmp-table">
            <thead>
              <tr>
                <th>When</th>
                <th>File</th>
                <th>Rows</th>
                <th>New</th>
                <th>Updated</th>
                <th>Delisted</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {imports.map(i => (
                <tr key={i.importId}>
                  <td>{when(i.importedAt)}</td>
                  <td>{i.fileName || '—'}</td>
                  <td>{i.rowCount.toLocaleString()}</td>
                  <td>{i.insertedCount.toLocaleString()}</td>
                  <td>{i.updatedCount.toLocaleString()}</td>
                  <td>{i.delistedCount.toLocaleString()}</td>
                  <td className="rdmp-muted">{i.importedBy || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="rdmp-panel-card">
        <h3>Edit history{category ? ` — ${category}` : ''}</h3>
        {audit.length === 0 ? (
          <p className="rdmp-muted">No changes recorded yet.</p>
        ) : (
          <table className="rdmp-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Change</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {audit.map(e => (
                <tr key={e.id}>
                  <td>{when(e.changedAt)}</td>
                  <td className={e.changedBy ? undefined : 'rdmp-muted'}>
                    {e.changedBy || 'unattributed'}
                  </td>
                  <td>{ENTITY_LABEL[e.entity] || e.entity}</td>
                  <td>{ACTION_LABEL[e.action] || e.action}</td>
                  <td>{describe(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
