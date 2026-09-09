import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, EyeOff, FileText, Upload, Plus, Trash2 } from 'lucide-react';
import Layout from '../../components/Layout';
import { canEditRoadmap, getRoadmapCategories } from '../../services';
import { useRoadmapBoard } from './use-roadmap-board';
import { buildGrid, findOrphans } from './grid';
import { applyFilters, buildChart, bySupplier, filterOptions, supplierOptions } from './chart';
import type { ChartFilters as Filters, PriceMode } from './chart';
import { buildSummary } from './summary';
import { downloadText } from './download';
import { slugify } from './format';
import { readHideMetrics, writeHideMetrics } from './prefs';
import { exportRoadmapPdf } from './export-pdf';
import {
  ALL_CATEGORIES,
  ALL_CATEGORIES_LABEL,
  AXIS_FIELDS,
  DEFAULT_X_FIELD,
  DEFAULT_Y_FIELD,
  ITEM_FLAGS,
  PLACER_TYPES,
} from './roadmap.constants';
import RoadmapGrid from './components/RoadmapGrid';
import ActionMenu from './components/ActionMenu';
import type { ActionMenuItem, ActionMenuSeparator } from './components/ActionMenu';
import ImportPanel from './components/ImportPanel';
import CategoryCombo from './components/CategoryCombo';
import SummaryPreviewPanel from './components/SummaryPreviewPanel';
import StepUpChart from './components/StepUpChart';
import ChartFilters from './components/ChartFilters';
import HistoryView from './components/HistoryView';
import SummaryTab from './components/SummaryTab';
import DetailPanel from './components/DetailPanel';
import { useAuth } from '../../context/AuthContext';
import type { RoadmapAxisKind, RoadmapCategory, RoadmapPlacer } from '../../types';
import './roadmap.css';

/**
 * ROADMAP CREATOR — the SKU Roadmap board.
 *
 * Pivots the product catalogue into a per-category grid, marks what is being replaced or retired,
 * and plans the gaps with placeholder cards. Ported from ProductToolkit's `apps/roadmap`, with
 * both halves of its state in Postgres: reference data refreshed by uploading a
 * ProductFactoryPrices_Analysis export, and the planning annotations typed on top of it.
 *
 * The original prototype kept annotations in one `localStorage` blob, so the work was per-browser
 * and one cleared cache from gone. Here every edit is written to the shared database as it is
 * made and an import can never damage it — see db_migrations/167_roadmap_creator.sql for why that
 * is structural rather than careful.
 *
 * FOUR TABS. SKU Roadmap and Step-Up Chart are single-category pivots; History and Summary read
 * flat lists and work across every category at once, which is why "All categories" is offered at
 * all. Picking it puts a "pick one category" notice on the two pivots rather than pretending.
 */

type Tab = 'roadmap' | 'chart' | 'history' | 'summary';

const EMPTY_FILTERS = {
  families: new Set<string>(),
  suppliers: new Set<string>(),
  segField: '',
  segVals: new Set<string>(),
  title: '',
};

interface MenuState {
  anchor: DOMRect;
  title: string;
  items: (ActionMenuItem | ActionMenuSeparator)[];
}

export default function RoadmapDashboard() {
  const { user } = useAuth();
  const actor = user?.email ?? null;

  const [categories, setCategories] = useState<RoadmapCategory[]>([]);
  const [catError, setCatError] = useState('');
  const [category, setCategory] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [showSummaryPreview, setShowSummaryPreview] = useState(false);
  const [canEdit, setCanEdit] = useState(false);

  const [tab, setTab] = useState<Tab>('roadmap');
  const [yField, setYField] = useState<string>(DEFAULT_Y_FIELD);
  const [xField, setXField] = useState<string>(DEFAULT_X_FIELD);
  const [laneField, setLaneField] = useState<string>(DEFAULT_X_FIELD);
  const [priceMode, setPriceMode] = useState<PriceMode>('asp');
  const [filters, setFilters] = useState(EMPTY_FILTERS);

  // '' = every supplier. A VIEW filter, never a data filter: marks, placeholders and Clear marks
  // keep working against the whole category, so narrowing the board to one supplier can never
  // quietly narrow what an edit applies to.
  const [supplier, setSupplier] = useState('');

  // Presentation mode, read from localStorage on mount so a reload during a supplier meeting does
  // not put our economics back on the projector — see prefs.ts.
  const [hideMetrics, setHideMetrics] = useState(readHideMetrics);
  useEffect(() => writeHideMetrics(hideMetrics), [hideMetrics]);

  const [jump, setJump] = useState('');
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [detailSkus, setDetailSkus] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);

  const boardRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const {
    board,
    loading,
    busy,
    error,
    setError,
    reload,
    setFlag,
    setFlagStatus,
    addPlacer,
    updatePlacer,
    removePlacer,
    addAxisValue,
    removeAxisValue,
    clearCategory,
  } = useRoadmapBoard(category, actor);

  const isAllCategories = category === ALL_CATEGORIES;

  /* ── categories ──────────────────────────────────────────────────────────── */

  const loadCategories = useCallback(async () => {
    setCatError('');
    try {
      const list = await getRoadmapCategories();
      setCategories(list);
      setCategory(cur => {
        if (cur && list.some(c => c.systemIndex === cur)) return cur;
        // Ceiling Fans is the category this tool was built against; the friendliest landing
        // point when there is no prior selection.
        const fans = list.find(c => c.systemIndex.includes('Ceiling Fans'));
        return fans?.systemIndex || list[0]?.systemIndex || '';
      });
      if (!list.length) setShowImport(true);
    } catch (err) {
      setCatError(err instanceof Error ? err.message : 'Could not load categories.');
    }
  }, []);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void canEditRoadmap().then(setCanEdit);
  }, []);

  /* ── derived models ──────────────────────────────────────────────────────── */

  const suppliers = useMemo(() => supplierOptions(board.skus), [board.skus]);

  // A supplier picked in one category usually does not exist in the next, so the selection is
  // DERIVED rather than reset in an effect: it falls back to "all suppliers" for a category that
  // has never heard of it, and comes back the moment you return to one that has. Resetting state
  // instead would forget the choice on every category hop, and would do it a render late — one
  // frame of a board filtered to a supplier that is not in the dropdown.
  const activeSupplier = suppliers.includes(supplier) ? supplier : '';

  const visibleSkus = useMemo(
    () => bySupplier(board.skus, activeSupplier),
    [board.skus, activeSupplier],
  );

  const grid = useMemo(
    () =>
      buildGrid({
        // Filtered SKUs, but the FULL placer and axis-value lists: the union rule keeps a planned
        // row, column or family on screen even when no visible SKU occupies it, so filtering to
        // one supplier can never hide someone's planning notes.
        skus: visibleSkus,
        yField,
        xField,
        placers: board.placers,
        axisValues: board.axisValues,
        flags: board.flags,
      }),
    [board, visibleSkus, yField, xField],
  );

  const chartOptions = useMemo(
    () => filterOptions(board.skus, filters.segField),
    [board.skus, filters.segField],
  );

  const chart = useMemo(() => {
    // The ladder reads LIVE SKUs only — a delisted product has no place on a forward-looking
    // price ladder, and letting one stretch the shared axis would distort every lane. The
    // toolbar's supplier filter is conjunctive with the chart's own chips, so switching to this
    // tab mid-presentation cannot put another supplier's range back on screen.
    const live = visibleSkus.filter(s => s.isCurrent !== false);
    return buildChart({ skus: applyFilters(live, filters), laneField, priceMode, hideMetrics });
  }, [visibleSkus, filters, laneField, priceMode, hideMetrics]);

  const orphanCount = useMemo(() => {
    const o = findOrphans({ skus: board.skus, placers: board.placers, flags: board.flags });
    return o.placers.length + o.flags.length;
  }, [board]);

  const staleCount = useMemo(
    () => board.skus.filter(s => s.isCurrent === false).length,
    [board.skus],
  );

  /* ── annotation actions ──────────────────────────────────────────────────── */

  const openSkuMenu = useCallback(
    (sku: string, rect: DOMRect) => {
      const flag = board.flags.find(f => f.sku === sku) || null;
      const item = board.skus.find(s => s.sku === sku);
      setMenu({
        anchor: rect,
        title: `${sku} — ${(item?.description || '').slice(0, 40)}`,
        items: [
          ...ITEM_FLAGS.map(f => ({
            key: f.key,
            label: `Mark: ${f.label}`,
            tone: f.tone,
            checked: flag?.flag === f.key,
            onSelect: () => {
              const next = flag?.flag === f.key ? null : f.key;
              // Marking something for replacement is the one case where a reason is nearly always
              // wanted, so offer the note in the same gesture rather than as a second step.
              let comment = flag?.comment || '';
              if (next === 'replace' && !flag?.comment) {
                const typed = window.prompt('Add a comment for this replacement (optional):', '');
                if (typed && typed.trim()) comment = typed.trim();
              }
              void setFlag(sku, next, comment);
            },
          })),
          { separator: true },
          {
            key: 'comment',
            label: flag?.comment ? 'Edit comment' : 'Add comment',
            tone: 'note',
            onSelect: () => {
              const typed = window.prompt('Comment for this SKU:', flag?.comment || '');
              if (typed !== null) void setFlag(sku, flag?.flag || null, typed.trim());
            },
          },
          ...(flag
            ? [
                {
                  key: 'clear',
                  label: 'Clear mark & comment',
                  tone: 'none',
                  onSelect: () => void setFlag(sku, null, ''),
                },
              ]
            : []),
        ],
      });
    },
    [board, setFlag],
  );

  const openAddPlacerMenu = useCallback(
    (cell: { family: string; yValue: string; xValue: string }, rect: DOMRect) => {
      setMenu({
        anchor: rect,
        title: `Flag an item — ${cell.family} / ${cell.yValue} / ${cell.xValue}`,
        items: PLACER_TYPES.map(t => ({
          key: t.key,
          label: t.label,
          tone: t.key === 'new' ? 'new' : 'upc',
          onSelect: () => {
            const comment = window.prompt(
              `Add a comment for this ${t.label.toLowerCase()} (optional):`,
              '',
            );
            if (comment === null) return;
            void addPlacer({ ...cell, yField, xField, type: t.key, comment: comment.trim() });
          },
        })),
      });
    },
    [addPlacer, yField, xField],
  );

  const editPlacer = useCallback(
    (placer: RoadmapPlacer) => {
      const typed = window.prompt('Comment for this flagged item:', placer.comment || '');
      if (typed !== null) void updatePlacer(placer.id, { comment: typed.trim() });
    },
    [updatePlacer],
  );

  const removeAxis = useCallback(
    (kind: RoadmapAxisKind, value: string) => {
      const id = grid.axisValueId(kind, value);
      if (id) void removeAxisValue(id);
    },
    [grid, removeAxisValue],
  );

  const promptAxisValue = useCallback(
    (kind: RoadmapAxisKind) => {
      const label =
        kind === 'family' ? 'family' : kind === 'row' ? `${yField} row` : `${xField} column`;
      const value = window.prompt(`Name of the new ${label}:`);
      if (!value || !value.trim()) return;
      void addAxisValue({
        kind,
        field: kind === 'family' ? null : kind === 'row' ? yField : xField,
        value: value.trim(),
      });
    },
    [addAxisValue, yField, xField],
  );

  /* ── summary ─────────────────────────────────────────────────────────────── */

  const summaryLabel = isAllCategories ? ALL_CATEGORIES_LABEL : category;

  const summaryText = useMemo(
    () =>
      buildSummary({
        category: summaryLabel,
        skus: board.skus,
        flags: board.flags,
        placers: board.placers,
        axisValues: board.axisValues,
      }),
    [board, summaryLabel],
  );

  const doExportPdf = useCallback(async () => {
    const el = tab === 'chart' ? chartRef.current : boardRef.current;
    if (!el) return;
    setExporting(true);
    setError('');
    // Let the `is-exporting` class paint — it hides the ⋮ buttons and unsticks the headers —
    // before html2canvas snapshots the DOM.
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    try {
      await exportRoadmapPdf(el, {
        category,
        kind: tab === 'chart' ? 'StepUpChart' : 'Roadmap',
      });
    } catch (err) {
      setError(`PDF export failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setExporting(false);
    }
  }, [tab, category, setError]);

  /* ── jump to SKU ─────────────────────────────────────────────────────────── */

  useEffect(() => {
    const q = jump.trim();
    if (q.length < 3) return;
    const prefix = tab === 'chart' ? 'rdmp-step-' : 'rdmp-sku-';
    const el =
      document.getElementById(prefix + q) ||
      [...document.querySelectorAll(`[id^="${prefix}"]`)].find(n =>
        n.id.replace(prefix, '').startsWith(q),
      );
    if (!el) return;
    el.classList.add('is-jump');
    el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    const t = setTimeout(() => el.classList.remove('is-jump'), 3500);
    return () => clearTimeout(t);
  }, [jump, tab, board]);

  // Called from Summary and History, which in "All categories" mode can point at a SKU outside
  // whatever category is selected; `skuCategory` switches to it first so the board the user
  // lands on actually contains that SKU.
  const jumpToSku = useCallback((sku: string, skuCategory?: string) => {
    if (skuCategory) setCategory(skuCategory);
    setTab('roadmap');
    setJump(sku);
  }, []);

  const detailRecords = detailSkus
    .map(s => board.skus.find(r => r.sku === s))
    .filter((r): r is NonNullable<typeof r> => Boolean(r));

  /* ── render ──────────────────────────────────────────────────────────────── */

  return (
    <Layout>
      <div className={`rdmp-root${exporting ? ' is-exporting' : ''}`}>
        <header className="rdmp-head">
          <h1>Roadmap Creator</h1>
          <p>
            Pivot the product catalogue into a category roadmap, mark what&apos;s being replaced or
            retired, and plan the gaps. Everything you mark is saved for the whole team.
          </p>
        </header>

        <div className="rdmp-toolbar">
          <div className="rdmp-field rdmp-field-wide">
            <span className="rdmp-fieldlabel">Category (System Index)</span>
            <CategoryCombo categories={categories} value={category} onChange={setCategory} />
          </div>

          {(tab === 'roadmap' || tab === 'chart') && (
            <Select
              label="Supplier"
              value={activeSupplier}
              onChange={setSupplier}
              options={suppliers}
              allowNone="— All suppliers"
            />
          )}

          {tab === 'roadmap' && (
            <>
              <Select
                label="Y axis (rows)"
                value={yField}
                onChange={setYField}
                options={AXIS_FIELDS as readonly string[]}
              />
              <Select
                label="X axis (columns)"
                value={xField}
                onChange={setXField}
                options={AXIS_FIELDS as readonly string[]}
              />
              <div className="rdmp-field">
                <span className="rdmp-fieldlabel">Jump to SKU</span>
                <input
                  className="rdmp-input"
                  style={{ width: 120 }}
                  value={jump}
                  placeholder="SKU…"
                  onChange={e => setJump(e.target.value)}
                />
              </div>
            </>
          )}

          {tab === 'chart' && (
            <>
              <Select
                label="Lanes (segment)"
                value={laneField}
                onChange={setLaneField}
                options={AXIS_FIELDS as readonly string[]}
                allowNone="— None (single lane)"
              />
              <div className="rdmp-field">
                <span className="rdmp-fieldlabel">Price axis</span>
                <select
                  className="rdmp-select"
                  value={priceMode}
                  onChange={e => setPriceMode(e.target.value as PriceMode)}
                >
                  <option value="asp">2026 Net ASP</option>
                  <option value="fp">Est. Factory Price</option>
                </select>
              </div>
            </>
          )}

          <div className="rdmp-toolbar-right">
            {/* Presentation mode. Deliberately always available and never disabled: the moment it
                is needed is the moment a supplier walks in, and hunting for the right tab first
                would defeat it. */}
            <button
              type="button"
              className={`rdmp-btn${hideMetrics ? ' is-hiding' : ''}`}
              aria-pressed={hideMetrics}
              title={
                hideMetrics
                  ? 'Show prices, margins and volumes again'
                  : 'Hide prices, margins and volumes — for presenting to suppliers'
              }
              onClick={() => setHideMetrics(v => !v)}
            >
              {hideMetrics ? <EyeOff size={13} /> : <Eye size={13} />}
              {hideMetrics ? 'Metrics hidden' : 'Hide metrics'}
            </button>

            {tab === 'roadmap' && canEdit && !isAllCategories && (
              <>
                <button type="button" className="rdmp-btn" onClick={() => promptAxisValue('family')}>
                  <Plus size={13} /> Family
                </button>
                <button type="button" className="rdmp-btn" onClick={() => promptAxisValue('row')}>
                  <Plus size={13} /> {yField} row
                </button>
                <button type="button" className="rdmp-btn" onClick={() => promptAxisValue('col')}>
                  <Plus size={13} /> {xField} column
                </button>
                <button
                  type="button"
                  className="rdmp-btn is-danger"
                  onClick={() => {
                    const n = board.flags.length + board.placers.length;
                    if (!n) {
                      window.alert('There are no marks or placeholders in this category.');
                      return;
                    }
                    if (
                      window.confirm(
                        `Clear all ${n} mark${n > 1 ? 's' : ''} and placeholder${n > 1 ? 's' : ''} in "${category}"? ` +
                          `This can't be undone, though the edit history keeps a record.`,
                      )
                    ) {
                      void clearCategory();
                    }
                  }}
                >
                  <Trash2 size={13} /> Clear marks
                </button>
              </>
            )}

            {tab !== 'history' && tab !== 'summary' && !isAllCategories && (
              <>
                <button
                  type="button"
                  className="rdmp-btn"
                  onClick={() => setShowSummaryPreview(true)}
                >
                  <FileText size={13} /> Summary
                </button>
                <button
                  type="button"
                  className="rdmp-btn is-primary"
                  onClick={() => void doExportPdf()}
                  disabled={exporting}
                >
                  <Download size={13} /> {exporting ? 'Generating…' : 'Export PDF'}
                </button>
              </>
            )}

            {canEdit && (
              <button type="button" className="rdmp-btn" onClick={() => setShowImport(v => !v)}>
                <Upload size={13} /> {showImport ? 'Hide import' : 'Refresh data'}
              </button>
            )}
          </div>
        </div>

        <nav className="rdmp-tabs">
          {(
            [
              ['roadmap', 'SKU Roadmap'],
              ['chart', 'Step-Up Chart'],
              ['history', `History${orphanCount ? ` (${orphanCount})` : ''}`],
              ['summary', 'Summary'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`rdmp-tab${tab === key ? ' is-active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
          <span className="rdmp-tabs-meta">
            {board.skus.length > 0 && (
              <>
                {board.skus.length} SKU{board.skus.length > 1 ? 's' : ''}
                {staleCount > 0 && ` · ${staleCount} not in latest file`}
                {busy && ' · saving…'}
              </>
            )}
          </span>
        </nav>

        {showImport && (
          <ImportPanel
            onClose={() => setShowImport(false)}
            onImported={() => {
              void loadCategories();
              void reload();
            }}
          />
        )}

        {/* Both errors get a Retry, not only a Dismiss: without one the only way back is a full
            page reload, which throws away the rest of the screen state for what is usually a
            transient failure. */}
        {catError && (
          <p className="rdmp-error" role="alert">
            {catError}
            <button
              type="button"
              className="rdmp-btn is-sm rdmp-retry"
              onClick={() => void loadCategories()}
            >
              Retry
            </button>
          </p>
        )}
        {error && (
          <p className="rdmp-error" role="alert">
            {error}
            <button
              type="button"
              className="rdmp-btn is-sm rdmp-retry"
              onClick={() => {
                setError('');
                void loadCategories();
                void reload();
              }}
            >
              Retry
            </button>
            <button type="button" className="rdmp-btn is-sm rdmp-retry" onClick={() => setError('')}>
              Dismiss
            </button>
          </p>
        )}

        {tab === 'chart' && (
          <ChartFilters
            options={chartOptions}
            filters={filters}
            onChange={setFilters}
            onClear={() => setFilters(EMPTY_FILTERS)}
          />
        )}

        <div className="rdmp-content">
          {loading ? (
            <p className="rdmp-muted rdmp-pad">Loading…</p>
          ) : tab === 'history' ? (
            // Reads flat lists, so it works in "All categories" mode too.
            <HistoryView
              category={isAllCategories ? '' : category}
              board={board}
              onJumpToSku={jumpToSku}
              onRemovePlacer={canEdit ? removePlacer : undefined}
            />
          ) : !category ? (
            <p className="rdmp-muted rdmp-pad">
              {categories.length
                ? 'Pick a category above to build the roadmap.'
                : 'No product data yet — use “Refresh data” to import a ProductFactoryPrices_Analysis export.'}
            </p>
          ) : tab === 'summary' ? (
            <SummaryTab
              board={board}
              hideMetrics={hideMetrics}
              canEdit={canEdit}
              onUpdatePlacer={updatePlacer}
              onSetFlagStatus={setFlagStatus}
              onJumpToSku={jumpToSku}
            />
          ) : isAllCategories ? (
            <p className="rdmp-muted rdmp-pad">
              Pick a single category above to use the{' '}
              {tab === 'chart' ? 'Step-Up Chart' : 'SKU Roadmap'} — both are per-category pivots.
              The Summary and History tabs work across every category at once.
            </p>
          ) : tab === 'chart' ? (
            chart.lanes.length === 0 ? (
              <p className="rdmp-muted rdmp-pad">
                No SKUs match the current filters in “{category}”.
              </p>
            ) : (
              <div className="rdmp-scroll">
                <StepUpChart
                  ref={chartRef}
                  chart={chart}
                  priceMode={priceMode}
                  hideMetrics={hideMetrics}
                  onOpenSku={sku => setDetailSkus([sku])}
                />
              </div>
            )
          ) : (
            <>
              {/* Honesty notes. Nothing is ever dropped from this board silently. */}
              {activeSupplier && (
                <p className="rdmp-note rdmp-pad">
                  Showing <b>{activeSupplier}</b> only — {visibleSkus.length} of{' '}
                  {board.skus.length} SKU{board.skus.length > 1 ? 's' : ''} in “{category}”.
                </p>
              )}
              {grid.skipped > 0 && (
                <p className="rdmp-note rdmp-pad">
                  {grid.skipped} SKU{grid.skipped > 1 ? 's' : ''}{' '}
                  {activeSupplier ? 'from this supplier' : 'in this category'} hidden — no “{yField}
                  ” or “{xField}” value.
                </p>
              )}
              {grid.families.length === 0 ? (
                <p className="rdmp-muted rdmp-pad">
                  No SKUs {activeSupplier ? `from “${activeSupplier}” ` : ''}in “{category}” have
                  values for both “{yField}” and “{xField}”. Try different axes
                  {activeSupplier ? ', another supplier,' : ''} or add a row/column by hand.
                </p>
              ) : (
                <div className="rdmp-scroll">
                  <RoadmapGrid
                    ref={boardRef}
                    grid={grid}
                    hideMetrics={hideMetrics}
                    onOpenSku={sku => setDetailSkus([sku])}
                    // A viewer who cannot edit gets no ⋮, no "+ flag item" and no ✕ — the
                    // components hide those entirely when the handler is absent, rather than
                    // showing controls that fail against RLS.
                    onSkuMenu={canEdit ? openSkuMenu : undefined}
                    onAddPlacer={canEdit ? openAddPlacerMenu : undefined}
                    onEditPlacer={canEdit ? editPlacer : undefined}
                    onRemovePlacer={canEdit ? p => void removePlacer(p.id) : undefined}
                    onRemoveAxisValue={canEdit ? removeAxis : undefined}
                  />
                </div>
              )}
            </>
          )}
        </div>

        {menu && (
          <ActionMenu
            anchor={menu.anchor}
            title={menu.title}
            items={menu.items}
            onClose={() => setMenu(null)}
          />
        )}

        <DetailPanel
          open={detailRecords.length > 0}
          skus={detailRecords}
          allSkus={board.skus}
          flags={board.flags}
          hideMetrics={hideMetrics}
          onClose={() => setDetailSkus([])}
          onAddCompare={sku => setDetailSkus(cur => (cur.includes(sku) ? cur : [...cur, sku]))}
          onRemoveCompare={sku => setDetailSkus(cur => cur.filter(x => x !== sku))}
        />

        <SummaryPreviewPanel
          open={showSummaryPreview}
          text={summaryText}
          category={summaryLabel}
          onClose={() => setShowSummaryPreview(false)}
          onDownload={() =>
            downloadText(`Klarstein_Summary_${slugify(summaryLabel)}.txt`, summaryText)
          }
        />
      </div>
    </Layout>
  );
}

function Select({
  label,
  value,
  onChange,
  options,
  allowNone,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  allowNone?: string;
}) {
  return (
    <div className="rdmp-field">
      <span className="rdmp-fieldlabel">{label}</span>
      <select className="rdmp-select" value={value} onChange={e => onChange(e.target.value)}>
        {allowNone && <option value="">{allowNone}</option>}
        {options.map(o => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  );
}
