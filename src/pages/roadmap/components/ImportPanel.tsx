import { useRef, useState } from 'react';
import { Upload, ShieldCheck } from 'lucide-react';
import { parseWorkbook, summarizeRows } from '../parse-workbook';
import type { ParsedRoadmapRow, RowSummary } from '../parse-workbook';
import { importRoadmapSkus } from '../../../services';
import type { RoadmapImportResult } from '../../../types';

/**
 * Refresh the reference data from a new ProductFactoryPrices_Analysis export.
 *
 * TWO-STEP ON PURPOSE: parse and PREVIEW first, commit second. The parse happens entirely in the
 * browser, so a wrong file (or a renamed column) is caught before anything reaches the shared
 * database — and the person doing it sees the row and category counts they are about to commit
 * for everybody.
 */

interface Staged {
  rows: ParsedRoadmapRow[];
  fileName: string;
  summary: RowSummary;
}

export interface ImportPanelProps {
  onImported?: (result: RoadmapImportResult) => void;
  onClose?: () => void;
}

export default function ImportPanel({ onImported, onClose }: ImportPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [staged, setStaged] = useState<Staged | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<RoadmapImportResult | null>(null);

  async function handleFile(file: File) {
    setError('');
    setResult(null);
    setStaged(null);
    setStatus(`Reading ${file.name} — a full export takes a few seconds…`);
    const bytes = await file.arrayBuffer();
    // Yield twice so the status line above actually paints before the parse blocks the main
    // thread for a few seconds. Without this the UI looks frozen with no explanation.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      const rows = parseWorkbook(bytes);
      setStaged({ rows, fileName: file.name, summary: summarizeRows(rows) });
      setStatus('');
    } catch (err) {
      setStatus('');
      setError(err instanceof Error ? err.message : 'Could not read that workbook.');
    }
  }

  async function commit() {
    if (!staged) return;
    setCommitting(true);
    setError('');
    try {
      const res = await importRoadmapSkus(staged.rows, staged.fileName);
      setResult(res);
      setStaged(null);
      onImported?.(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The import failed.');
    } finally {
      setCommitting(false);
    }
  }

  return (
    <section className="rdmp-import">
      <header className="rdmp-import-head">
        <h2>Refresh product data</h2>
        {onClose && (
          <button type="button" className="rdmp-btn" onClick={onClose}>
            Close
          </button>
        )}
      </header>

      {/* Says the guarantee out loud, at the moment somebody is about to overwrite 2,500 rows
          for everyone. It is the one place the promise most needs to be legible. */}
      <p className="rdmp-safety">
        <ShieldCheck size={14} />
        <span>
          An import only adds and updates product data. Flags, comments, placeholders and added
          rows are never touched, and no SKU is ever deleted — one that has dropped out of the new
          file is kept and tagged <b>not in latest file</b>.
        </span>
      </p>

      <div
        className={`rdmp-dropzone${dragging ? ' is-drag' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files[0]) void handleFile(e.dataTransfer.files[0]);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
      >
        <Upload size={22} />
        <div className="rdmp-dropzone-title">Drop ProductFactoryPrices_Analysis .xlsx here</div>
        <div className="rdmp-dropzone-hint">
          or click to browse — reads the <b>FactoryPrice_A</b> table on the <b>Working Tab</b>{' '}
          sheet. The file is parsed in your browser; only the extracted rows are sent.
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm"
          style={{ display: 'none' }}
          onChange={e => {
            if (e.target.files?.[0]) void handleFile(e.target.files[0]);
            e.target.value = '';
          }}
        />
      </div>

      {status && <p className="rdmp-status">{status}</p>}
      {error && <p className="rdmp-error">{error}</p>}

      {staged && (
        <div className="rdmp-preview">
          <h3>Ready to import</h3>
          <dl className="rdmp-stats">
            <div>
              <dt>File</dt>
              <dd>{staged.fileName}</dd>
            </div>
            <div>
              <dt>SKU rows</dt>
              <dd>{staged.summary.rowCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Categories</dt>
              <dd>{staged.summary.categoryCount}</dd>
            </div>
            <div>
              <dt>Families</dt>
              <dd>{staged.summary.familyCount}</dd>
            </div>
          </dl>
          <div className="rdmp-preview-actions">
            <button
              type="button"
              className="rdmp-btn is-primary"
              onClick={commit}
              disabled={committing}
            >
              {committing ? 'Importing…' : 'Import to database'}
            </button>
            <button
              type="button"
              className="rdmp-btn"
              onClick={() => setStaged(null)}
              disabled={committing}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="rdmp-result">
          <h3>Import complete</h3>
          <dl className="rdmp-stats">
            <div>
              <dt>Rows in file</dt>
              <dd>{result.rowCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>New SKUs</dt>
              <dd>{result.insertedCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{result.updatedCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Not in latest file</dt>
              <dd>{result.delistedCount.toLocaleString()}</dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
