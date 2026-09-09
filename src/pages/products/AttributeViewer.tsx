/**
 * Attribute Viewer — every SKU in a category and every attribute that category defines.
 *
 * One row per attribute, one column per SKU. Values come from `sku_attribute_values`
 * (migration 155), one row per (SKU record, attribute) — not from the
 * `project_skus.attribute_values` JSONB array, which is now a mirror. That is what lets this
 * screen tell a cell nobody has touched apart from one somebody deliberately emptied, report
 * per-attribute coverage, and say where each value came from.
 *
 * It also absorbed the SKU Catalog (Phase 3): adding, deleting, sheet upload, roster paste,
 * finalize/unlock, the change log and the row export all live here now.
 *
 * ROUTING LIVES IN THE URL. `l3` (what is open) and `sku` (which SKU panel) are query params,
 * not local state, so each is a real address — back and forward walk through them and a link
 * can be shared straight to one.
 *
 * See docs/originflow-attribute-viewer-merge-plan.md.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import Layout from '../../components/Layout';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../hooks';
import {
  CategoryAttribute,
  CategoryL3,
  SkuAttributeFlag,
  SkuAttributeValueRecord,
  SkuCellState,
} from '../../types';
import {
  CategorySku,
  CategorySkuSummary,
  getCategories,
  getCategoryAttributes,
  getCategorySkuIndex,
  getSkusByCategory,
  getFlagsForSkus,
  getValuesForSkus,
  setSkuAttributeValue,
  clearSkuAttributeValue,
  isValueStoreAvailable,
  upsertSkuAttributeFlag,
  setSkuAttributeFlagResolved,
  deleteSkuAttributeFlag,
  compareAttributes,
  createCatalogSku,
  deleteProjectSku,
  bulkUpsertCatalogSkus,
  bulkSetSkuAttributeValue,
  copySkuAttributeValues,
  setSkuFinal,
  logSkuDeleted,
  logSkuChanges,
  markSkusExported,
  updateProjectSku,
  lookupEprelRecords,
} from '../../services';
import { getAttributesForCategory } from '../../utils/attribute-validation.utils';
import { findEprelIdAttribute } from '../../config/compliance.constants';
import {
  compareRecordToEprel,
  summariseEprel,
  type EprelComparison,
} from '../../components/products/attribute-grid/eprel-compare.utils';
import { parseSkuRoster } from '../../utils';
import type { SkuCsvParseResult } from '../../utils';
import {
  NO_VALUES,
  cellKey,
  classifyCell,
  coverageFor,
  indexByCell,
} from '../../utils/sku-attribute-value.utils';
import SkuAttributeCellDrawer from '../../components/products/SkuAttributeCellDrawer';
import SkuDialog from '../../components/products/SkuDialog';
import {
  AddSkuDialog,
  SkuSheetUploadDialog,
  SkuRosterDialog,
} from '../../components/products/SkuImportDialogs';
import { BulkFillDialog, CopyFromDialog } from '../../components/products/BulkValueDialogs';
import ExportBlockedDialog from '../../components/products/ExportBlockedDialog';
import { CELL_STATES, CELL_STATE_ORDER } from '../../components/products/attribute-grid/cell-state';
import AttributeGrid from '../../components/products/attribute-grid/AttributeGrid';
import CategoryBrowser from '../../components/products/attribute-grid/CategoryBrowser';
import SummaryTiles from '../../components/products/attribute-grid/SummaryTiles';
import FilterRail from '../../components/products/attribute-grid/FilterRail';
import {
  nextSort,
  pageColumns,
  sortSkusByAttribute,
  type GridSort,
} from '../../components/products/attribute-grid/grid.utils';
import {
  buildExportRows,
  emptyColumns,
  validateExport,
  type ExportBlocker,
} from '../../components/products/attribute-grid/export-validation.utils';
import {
  EMPTY_FILTERS,
  cellSurvivesValueFilter,
  columnSurvivesFilter,
  rowSurvivesFilter,
  summarise,
  type GridFilterState,
} from '../../components/products/attribute-grid/grid-filters.utils';
import {
  Search,
  X,
  Loader2,
  Table2,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Upload,
  ListPlus,
  Download,
  Plus,
  ArrowLeft,
  Wand2,
  Copy,
} from 'lucide-react';

const AttributeViewer: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();
  const actor = useMemo(
    () => ({ id: user?.id ?? null, name: user?.name ?? '' }),
    [user?.id, user?.name],
  );

  // ── URL as state ──────────────────────────────────────────────────────────
  const [params, setParams] = useSearchParams();
  const categoryId = params.get('l3') ?? '';
  const openSkuId = params.get('sku');

  /** Replace, not push, when only the open panel changes — a drawer is not a place. */
  const setParam = useCallback(
    (key: 'l3' | 'sku', value: string | null, replace = false) => {
      setParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (value) next.set(key, value);
          else next.delete(key);
          // Opening a different category cannot keep the old category's SKU panel open.
          if (key === 'l3') next.delete('sku');
          return next;
        },
        { replace },
      );
    },
    [setParams],
  );

  // ── Loaded data ───────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [allAttrs, setAllAttrs] = useState<CategoryAttribute[]>([]);
  const [skuIndex, setSkuIndex] = useState<Map<string, CategorySkuSummary>>(new Map());
  const [skus, setSkus] = useState<CategorySku[]>([]);
  const [flagMap, setFlagMap] = useState<Record<string, SkuAttributeFlag>>({});
  const [values, setValues] = useState<readonly SkuAttributeValueRecord[]>(NO_VALUES);
  const [loading, setLoading] = useState(false);

  /**
   * Whether the row-level value store is reachable. `null` while unknown.
   *
   * Without this the failure mode is silent and wrong: reads go through `orEmpty`, so a
   * PostgREST 404 on an unapplied migration 155 returns `[]` and the grid renders every cell as
   * an untouched gap — a confident wrong answer, which is worse than an error.
   */
  const [storeAvailable, setStoreAvailable] = useState<boolean | null>(null);

  // ── View state ────────────────────────────────────────────────────────────
  const [filters, setFilters] = useState<GridFilterState>(EMPTY_FILTERS);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [sort, setSort] = useState<GridSort | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [comparing, setComparing] = useState(false);
  const [page, setPage] = useState(0);
  const [activeCell, setActiveCell] = useState<{ skuId: string; attrId: string } | null>(null);
  const [dialog, setDialog] = useState<null | 'add' | 'sheet' | 'roster' | 'bulk' | 'copy'>(null);
  const [exporting, setExporting] = useState(false);
  /** Non-null = the last export refused, and these are the reasons. */
  const [exportBlockers, setExportBlockers] = useState<ExportBlocker[] | null>(null);

  /**
   * The registry axis. `null` = not read yet, which the header strip says out loud — because
   * "not checked" and "the registry agrees" are different facts and only one of them is
   * evidence. Keyed by cellKey once read.
   */
  const [eprelByCell, setEprelByCell] = useState<Map<string, EprelComparison> | null>(null);
  const [eprelStatus, setEprelStatus] = useState<
    { state: 'idle' | 'loading' | 'ready' | 'off'; at?: string; error?: string; looked?: number; found?: number }
  >({ state: 'idle' });

  const toggleSelected = (skuId: string) =>
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(skuId)) next.delete(skuId);
      else next.add(skuId);
      return next;
    });

  // ── Loading ───────────────────────────────────────────────────────────────

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [cats, attrs, index, available] = await Promise.all([
        getCategories(),
        getCategoryAttributes(),
        getCategorySkuIndex(),
        isValueStoreAvailable(),
      ]);
      if (!mounted) return;
      setCategories(cats.filter(c => c.active).sort((a, b) => a.name.localeCompare(b.name)));
      setAllAttrs(attrs);
      setSkuIndex(index);
      setStoreAvailable(available);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  /**
   * Read the open category's SKUs, their stored values and their flags.
   *
   * A callback rather than only an effect, because every write that changes the SET of SKUs —
   * add, delete, bulk upload, roster import, finalize — has to refetch, and each doing its own
   * partial local patch is how a grid ends up disagreeing with the database.
   */
  const loadCategory = useCallback(async (id: string): Promise<void> => {
    if (!id) {
      setSkus([]);
      setFlagMap({});
      setValues(NO_VALUES);
      return;
    }
    setLoading(true);
    try {
      const loaded = await getSkusByCategory(id);
      setSkus(loaded);
      const ids = loaded.map(s => s.id);
      const [flags, loadedValues] = await Promise.all([
        getFlagsForSkus(ids),
        getValuesForSkus(ids),
      ]);
      const map: Record<string, SkuAttributeFlag> = {};
      for (const f of flags) map[cellKey(f.projectSkuId, f.attributeId)] = f;
      setFlagMap(map);
      setValues(loadedValues.length > 0 ? loadedValues : NO_VALUES);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCategory(categoryId);
  }, [categoryId, loadCategory]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const byCell = useMemo(() => indexByCell(values), [values]);

  /** The category's attributes, in group-then-name order. */
  const attributeRows = useMemo<CategoryAttribute[]>(() => {
    if (!categoryId) return [];
    return getAttributesForCategory(allAttrs, categoryId).slice().sort(compareAttributes);
  }, [allAttrs, categoryId]);

  /** Attribute count per category, for the browser. */
  const attributeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of categories) {
      counts.set(c.id, getAttributesForCategory(allAttrs, c.id).length);
    }
    return counts;
  }, [categories, allAttrs]);

  const browserSkuCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const [id, s] of skuIndex) m.set(id, s.count);
    return m;
  }, [skuIndex]);

  const browserSamples = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const [id, s] of skuIndex) m.set(id, s.samples);
    return m;
  }, [skuIndex]);

  /** How many SKU records share each item number. Counted across the whole category. */
  const duplicateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sku of skus) counts.set(sku.skuNumber, (counts.get(sku.skuNumber) ?? 0) + 1);
    return counts;
  }, [skus]);

  /**
   * Stored values in the JSONB mirror pointing at an attribute no longer defined anywhere.
   *
   * These cannot become rows — `sku_attribute_values.attribute_id` has a foreign key — so they
   * would otherwise be invisible. Counted and reported rather than dropped silently: a stored
   * value nobody can see is exactly the kind of gap this screen exists to surface.
   */
  const orphanedValueCount = useMemo(() => {
    if (!categoryId) return 0;
    const defined = new Set(allAttrs.map(a => a.id));
    let count = 0;
    for (const sku of skus) {
      for (const v of sku.attributeValues) {
        if ((v.value ?? '').trim() !== '' && !defined.has(v.attributeId)) count += 1;
      }
    }
    return count;
  }, [skus, allAttrs, categoryId]);

  const getRecord = (skuId: string, attrId: string) => byCell.get(cellKey(skuId, attrId));

  /** SKU columns surviving the search bar, the column filter and the per-attribute filters. */
  const filteredSkus = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    // Every stored value per SKU, so a match in a row that is currently filtered out still
    // keeps the SKU's column.
    const haystacks = new Map<string, string>();
    for (const v of values) {
      if (v.value === null) continue;
      haystacks.set(v.projectSkuId, `${haystacks.get(v.projectSkuId) ?? ''} ${v.value}`.toLowerCase());
    }
    return skus.filter(sku => {
      if (q) {
        const idHay = `${sku.skuNumber} ${sku.skuTitle} ${sku.projectName}`.toLowerCase();
        if (!idHay.includes(q) && !(haystacks.get(sku.id) ?? '').includes(q)) return false;
      }
      if (!columnSurvivesFilter(sku, attributeRows, byCell, duplicateCounts, filters.columnFilter)) {
        return false;
      }
      return filters.valueFilters.every(f =>
        cellSurvivesValueFilter(getRecord(sku.id, f.attributeId), f.value),
      );
    });
  }, [skus, values, filters, attributeRows, byCell, duplicateCounts]);

  /** Attribute rows surviving the search bar, the row filter and "flagged only". */
  const filteredRows = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    const skuIds = filteredSkus.map(s => s.id);
    return attributeRows.filter(attr => {
      if (q) {
        const nameMatch = attr.name.toLowerCase().includes(q);
        const valueMatch = skus.some(sku =>
          (getRecord(sku.id, attr.id)?.value ?? '').toLowerCase().includes(q),
        );
        if (!nameMatch && !valueMatch) return false;
      }
      if (filters.flaggedOnly) {
        const flagged = skuIds.some(id => flagMap[cellKey(id, attr.id)]?.status === 'open');
        if (!flagged) return false;
      }
      return rowSurvivesFilter(attr, skuIds, byCell, flagMap, filters.rowFilter);
    });
  }, [attributeRows, filters, filteredSkus, flagMap, byCell, skus]);

  /**
   * Coverage per attribute, over every filtered SKU — not the page on screen. "87 of 138
   * answer this question" is the useful number; "23 of the 25 the pager is on" is not.
   */
  const coverage = useMemo(() => {
    const ids = filteredSkus.map(s => s.id);
    const map = new Map<string, { filled: number; total: number }>();
    for (const attr of filteredRows) {
      const c = coverageFor(attr, ids, byCell);
      map.set(attr.id, { filled: c.filled, total: c.total });
    }
    return map;
  }, [filteredRows, filteredSkus, byCell]);

  /** The tiles describe the whole category, because a tile is how you get to a filtered view. */
  const summary = useMemo(
    () => summarise(skus, attributeRows, byCell, duplicateCounts),
    [skus, attributeRows, byCell, duplicateCounts],
  );

  /** Cell-state counts over what is on screen, for the legend. */
  const stateCounts = useMemo(() => {
    const counts: Record<SkuCellState, number> = { filled: 0, empty: 0, cleared: 0, invalid: 0 };
    for (const attr of filteredRows) {
      for (const sku of filteredSkus) counts[classifyCell(getRecord(sku.id, attr.id), attr)] += 1;
    }
    return counts;
  }, [filteredRows, filteredSkus, byCell]);

  /** Distinct stored values per attribute, for the value-filter dropdown. */
  const valueOptions = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const v of values) {
      if (v.value === null || v.value.trim() === '') continue;
      const set = map.get(v.attributeId) ?? new Set<string>();
      set.add(v.value);
      map.set(v.attributeId, set);
    }
    return new Map([...map].map(([k, set]) => [k, [...set].sort()]));
  }, [values]);

  const sortedSkus = useMemo(() => {
    if (!sort) return filteredSkus;
    const attr =
      filteredRows.find(a => a.id === sort.attributeId) ??
      attributeRows.find(a => a.id === sort.attributeId);
    if (!attr) return filteredSkus;
    return sortSkusByAttribute(filteredSkus, attr, sort.direction, byCell);
  }, [filteredSkus, filteredRows, attributeRows, sort, byCell]);

  const comparisonSkus = useMemo(
    () => (comparing ? sortedSkus.filter(s => selected.has(s.id)) : sortedSkus),
    [comparing, sortedSkus, selected],
  );

  const columnPage = useMemo(
    () => pageColumns(comparisonSkus, page, { comparing }),
    [comparisonSkus, page, comparing],
  );

  // A new category, or a filter that shrinks the set, must not leave the pager stranded.
  useEffect(() => setPage(0), [categoryId, filters, comparing]);
  useEffect(() => {
    if (selected.size === 0 && comparing) setComparing(false);
  }, [selected, comparing]);

  /** The ticked SKUs, as full records — what bulk fill and copy-from operate on. */
  const selectedSkus = useMemo(() => skus.filter(s => selected.has(s.id)), [skus, selected]);

  /**
   * The EPREL cross-check, fetched in its OWN effect AFTER the grid has painted.
   *
   * Deliberately not part of `loadCategory`: the registry is a public service we do not own,
   * and folding it into the main load would let a slow or rate-limited EPREL delay — or fail —
   * the whole page. Here the grid is already usable and the violet annotations arrive when they
   * arrive, or never, and the header strip says which.
   *
   * Keyed on the EPREL ID attribute's values, so a category where nobody has captured a
   * registration number does no work at all.
   */
  useEffect(() => {
    if (!categoryId || skus.length === 0) {
      setEprelByCell(null);
      setEprelStatus({ state: 'idle' });
      return;
    }
    const keyAttribute = findEprelIdAttribute(attributeRows);
    if (!keyAttribute) {
      setEprelByCell(null);
      setEprelStatus({ state: 'idle' });
      return;
    }

    // Which SKUs actually carry a registration number. A SKU without one is not a failure —
    // it simply cannot be looked up, and the strip reports how many were checked.
    const registrations = new Map<string, string>();
    for (const sku of skus) {
      const reg = byCell.get(cellKey(sku.id, keyAttribute.id))?.value?.trim();
      if (reg) registrations.set(sku.id, reg);
    }
    if (registrations.size === 0) {
      setEprelByCell(null);
      setEprelStatus({ state: 'idle' });
      return;
    }

    let mounted = true;
    setEprelStatus({ state: 'loading', looked: registrations.size });
    (async () => {
      const response = await lookupEprelRecords([...registrations.values()]);
      if (!mounted) return;

      if (!response.configured) {
        // Not set up is not an error: the axis is simply unavailable, and saying so is more
        // useful than an error banner on every page load.
        setEprelByCell(null);
        setEprelStatus({ state: 'off', error: response.error });
        return;
      }

      const map = new Map<string, EprelComparison>();
      let found = 0;
      for (const sku of skus) {
        const reg = registrations.get(sku.id);
        if (!reg) continue;
        const result = response.results[reg];
        if (!result?.found) continue;
        found += 1;
        const ours = new Map<string, string | null>();
        for (const attr of attributeRows) {
          ours.set(attr.id, byCell.get(cellKey(sku.id, attr.id))?.value ?? null);
        }
        for (const comparison of compareRecordToEprel(attributeRows, ours, result.record)) {
          map.set(cellKey(sku.id, comparison.attributeId), comparison);
        }
      }
      setEprelByCell(map);
      setEprelStatus({
        state: 'ready',
        at: new Date().toISOString(),
        looked: registrations.size,
        found,
        error: response.error,
      });
    })();
    return () => {
      mounted = false;
    };
  }, [categoryId, skus, attributeRows, byCell]);

  const eprelSummary = useMemo(
    () => (eprelByCell ? summariseEprel([...eprelByCell.values()]) : null),
    [eprelByCell],
  );

  const changedSkus = useMemo(() => skus.filter(s => s.pendingExport), [skus]);
  const exportableSkus = useMemo(() => changedSkus.filter(s => s.isFinal), [changedSkus]);

  const openSku = openSkuId ? skus.find(s => s.id === openSkuId) : undefined;
  const category = categories.find(c => c.id === categoryId);
  const categoryName = category?.name ?? 'this category';
  const activeSku = activeCell ? skus.find(s => s.id === activeCell.skuId) : undefined;
  const activeAttr = activeCell ? attributeRows.find(a => a.id === activeCell.attrId) : undefined;
  const openFlagCount = useMemo(
    () => Object.values(flagMap).filter(f => f.status === 'open').length,
    [flagMap],
  );

  // ── Value mutations ───────────────────────────────────────────────────────

  /** Replace one record in local state, so the grid reflects the write without a refetch. */
  const applyRecord = (saved: SkuAttributeValueRecord) =>
    setValues(prev => [
      ...prev.filter(
        v => !(v.projectSkuId === saved.projectSkuId && v.attributeId === saved.attributeId),
      ),
      saved,
    ]);

  const handleSaveValue = async (skuId: string, attr: CategoryAttribute, newValue: string) => {
    try {
      applyRecord(
        await setSkuAttributeValue({ projectSkuId: skuId, attribute: attr, value: newValue, actor }),
      );
      toast.success('Value updated');
    } catch (e: any) {
      // Covers both the validation refusal and the database's Final-SKU lock — the message
      // names which, so it is shown rather than replaced with something generic.
      toast.error(e?.message || 'Failed to update value');
    }
  };

  const handleClearValue = async (skuId: string, attr: CategoryAttribute) => {
    try {
      applyRecord(await clearSkuAttributeValue({ projectSkuId: skuId, attribute: attr, actor }));
      toast.success('Value cleared');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to clear value');
    }
  };

  const handleSaveFlag = async (skuId: string, attrId: string, comment: string) => {
    try {
      const flag = await upsertSkuAttributeFlag(skuId, attrId, comment, actor.id, actor.name);
      setFlagMap(prev => ({ ...prev, [cellKey(skuId, attrId)]: flag }));
      toast.success('Flag saved');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save flag');
    }
  };

  const handleResolveFlag = async (skuId: string, attrId: string, resolved: boolean) => {
    const flag = flagMap[cellKey(skuId, attrId)];
    if (!flag) return;
    try {
      const updated = await setSkuAttributeFlagResolved(flag.id, resolved);
      setFlagMap(prev => ({ ...prev, [cellKey(skuId, attrId)]: updated }));
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update flag');
    }
  };

  const handleDeleteFlag = async (skuId: string, attrId: string) => {
    const flag = flagMap[cellKey(skuId, attrId)];
    if (!flag) return;
    try {
      await deleteSkuAttributeFlag(flag.id);
      setFlagMap(prev => {
        const next = { ...prev };
        delete next[cellKey(skuId, attrId)];
        return next;
      });
      toast.success('Flag removed');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to remove flag');
    }
  };

  // ── SKU-level actions, absorbed from the SKU Catalog page ─────────────────

  const handleAddSku = async (skuNumber: string, skuTitle: string) => {
    await createCatalogSku(categoryId, skuNumber, skuTitle);
    await loadCategory(categoryId);
    toast.success(`Added ${skuNumber}`);
  };

  const handleDeleteSku = async (sku: CategorySku) => {
    // Logged BEFORE the delete: sku_change_log's FK is ON DELETE SET NULL, so a row written
    // afterwards would lose the SKU it describes. The log keeps sku_number either way.
    await logSkuDeleted(sku.id, sku.skuNumber, actor);
    await deleteProjectSku(sku.id);
    setParam('sku', null, true);
    await loadCategory(categoryId);
    toast.success(`Deleted ${sku.skuNumber}`);
  };

  const handleRenameSku = async (sku: CategorySku, skuNumber: string, skuTitle: string) => {
    const changes = [
      ...(skuNumber !== sku.skuNumber
        ? [{ field: 'SKU number', oldValue: sku.skuNumber, newValue: skuNumber }]
        : []),
      ...(skuTitle !== sku.skuTitle
        ? [{ field: 'Title', oldValue: sku.skuTitle, newValue: skuTitle }]
        : []),
    ];
    await updateProjectSku(sku.id, { skuNumber, skuTitle });
    // These are SKU columns, not attribute values, so the value trigger never sees them.
    // Logged explicitly so a renamed SKU still has a trail.
    if (changes.length > 0) await logSkuChanges(sku.id, skuNumber, changes, actor);
    await loadCategory(categoryId);
    toast.success('SKU updated');
  };

  const handleSetFinal = async (sku: CategorySku, isFinal: boolean, reason: string) => {
    await setSkuFinal(sku.id, sku.skuNumber, isFinal, actor, reason);
    await loadCategory(categoryId);
    toast.success(isFinal ? `${sku.skuNumber} marked final` : `${sku.skuNumber} unlocked`);
  };

  const handleSheetUpload = async (result: SkuCsvParseResult): Promise<string> => {
    const res = await bulkUpsertCatalogSkus(categoryId, result.rows, actor);
    await loadCategory(categoryId);
    return (
      `${res.created} created, ${res.updated} updated` +
      (res.lockedSkipped ? `, ${res.lockedSkipped} skipped (final)` : '') +
      (res.skipped ? `, ${res.skipped} skipped` : '') +
      '.'
    );
  };

  const handleRosterImport = async (text: string): Promise<string> => {
    const parsed = parseSkuRoster(text);
    const res = await bulkUpsertCatalogSkus(categoryId, parsed.rows, actor);
    await loadCategory(categoryId);
    return (
      `${res.created} added, ${res.updated} already present` +
      (res.lockedSkipped ? `, ${res.lockedSkipped} skipped (final)` : '') +
      (parsed.duplicates ? `, ${parsed.duplicates} duplicate line(s) collapsed` : '') +
      (parsed.skipped ? `, ${parsed.skipped} line(s) ignored` : '') +
      '.'
    );
  };

  /**
   * Set one attribute across the ticked SKUs, then reload.
   *
   * A full reload rather than patching each written cell into local state: a bulk write touches
   * up to 138 cells and its audit rows and mirror are written server-side, so re-reading is both
   * simpler and the only way to be sure the grid matches what actually landed.
   */
  const handleBulkFill = async (
    attribute: CategoryAttribute,
    value: string,
    includeFilled: boolean,
  ) => {
    const result = await bulkSetSkuAttributeValue({
      skus: selectedSkus,
      attribute,
      value,
      includeFilled,
      actor,
      existing: values,
    });
    await loadCategory(categoryId);
    const set = result.targets.filter(t => t.outcome === 'set').length;
    const skipped = result.targets.length - set;
    toast.success(
      `${attribute.name}: ${set} set` + (skipped > 0 ? `, ${skipped} skipped` : ''),
    );
  };

  const handleCopyFrom = async (
    sourceSkuId: string,
    attributes: CategoryAttribute[],
    includeFilled: boolean,
  ) => {
    const plan = await copySkuAttributeValues({
      sourceSkuId,
      targets: selectedSkus,
      attributes,
      includeFilled,
      actor,
      existing: values,
    });
    await loadCategory(categoryId);
    const set = plan.reduce(
      (n, e) => n + e.targets.filter(t => t.outcome === 'set').length,
      0,
    );
    toast.success(`Copied ${set} value${set === 1 ? '' : 's'}`);
  };

  /**
   * Export the signed-off, changed SKUs — or refuse, and say why.
   *
   * Only a FINAL SKU is exportable, carried over from the SKU Catalog: a hand-off file should
   * contain signed-off data, not work in progress. The refusal names WHICH problem it is,
   * because "nothing changed" and "changed but nobody signed it off" have different fixes.
   *
   * Then the all-or-nothing rule: if any value in the file would be wrong, there is NO file —
   * only the list of problems. See export-validation.utils.ts for why, and for the two ways the
   * old builder failed silently.
   *
   * Rows are built from the row store, not the `attribute_values` mirror, so a downstream
   * system gets first-hand data rather than a derived copy.
   */
  const handleExport = async () => {
    if (exportableSkus.length === 0) {
      toast.error(
        changedSkus.length > 0
          ? `Nothing to export: ${changedSkus.length} changed SKU${changedSkus.length === 1 ? ' is' : 's are'} not marked Final.`
          : 'No final SKUs with changes to export in this category.',
      );
      return;
    }

    const blockers = validateExport(exportableSkus, attributeRows, byCell);
    if (blockers.length > 0) {
      setExportBlockers(blockers);
      return;
    }

    setExporting(true);
    try {
      // A column nothing fills is left out entirely: including it would hand the consumer a
      // blank column, which many importers read as "clear this field for every product".
      const populated = attributeRows.filter(
        a => !emptyColumns(exportableSkus, attributeRows, byCell).some(e => e.id === a.id),
      );
      const titles = new Map(exportableSkus.map(s => [s.id, s.skuTitle]));
      const { headers, rows } = buildExportRows(exportableSkus, populated, byCell, titles);

      const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Products');
      const stamp = new Date().toISOString().slice(0, 10);
      XLSX.writeFile(wb, `${categoryName.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}_${stamp}.csv`, {
        bookType: 'csv',
      });

      await markSkusExported(exportableSkus.map(s => ({ id: s.id, skuNumber: s.skuNumber })), actor);
      await loadCategory(categoryId);
      toast.success(
        `Exported ${exportableSkus.length} final SKU${exportableSkus.length === 1 ? '' : 's'} · ` +
          `${populated.length} of ${attributeRows.length} attributes carried a value`,
      );
    } catch (e: any) {
      toast.error(e?.message || 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  /** The refusal list as plain text, so it can be pasted into a ticket. */
  const copyBlockers = async () => {
    if (!exportBlockers) return;
    const text = exportBlockers
      .map(b => {
        const subject = [b.skuNumber, b.attributeName].filter(Boolean).join(' · ');
        return [subject, `  ${b.detail}`, `  → ${b.remedy}`].join('\n');
      })
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy — select the list and copy it manually.');
    }
  };

  const attrName = (id: string) => attributeRows.find(a => a.id === id)?.name ?? id;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Layout>
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-primary">
          <Table2 className="text-indigo-500" /> Attribute Viewer
        </h1>
        {categoryId ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
            <button
              onClick={() => setParam('l3', null)}
              className="inline-flex items-center gap-1 text-indigo-600 hover:underline"
            >
              <ArrowLeft size={13} /> All categories
            </button>
            <span className="text-gray-300">/</span>
            {category?.l1Name && (
              <>
                <span>{category.l1Name}</span>
                <span className="text-gray-300">›</span>
              </>
            )}
            {category?.l2Name && (
              <>
                <span>{category.l2Name}</span>
                <span className="text-gray-300">›</span>
              </>
            )}
            <span className="font-semibold text-primary">{categoryName}</span>
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted">
            Pick a category to compare, review, edit and flag its attributes. Nothing loads until
            you do — opening one reads every attribute of every SKU in it.
          </p>
        )}
      </div>

      {/* The value store is a migration away from not existing. Reads degrade to empty, which
          would render as "no values anywhere" — so say it plainly instead. */}
      {storeAvailable === false && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">The value store is not reachable.</p>
            <p className="mt-0.5 text-xs">
              Cells will read as empty whether or not values exist. Check that migration 155
              (<code>sku_attribute_values</code>) has been applied before trusting this grid.
            </p>
          </div>
        </div>
      )}

      {!categoryId ? (
        <CategoryBrowser
          categories={categories}
          skuCounts={browserSkuCounts}
          attributeCounts={attributeCounts}
          sampleSkus={browserSamples}
          onPick={id => setParam('l3', id)}
        />
      ) : (
        <>
          <SummaryTiles
            summary={summary}
            rowFilter={filters.rowFilter}
            columnFilter={filters.columnFilter}
            onRowFilter={f => setFilters(prev => ({ ...prev, rowFilter: f }))}
            onColumnFilter={f => setFilters(prev => ({ ...prev, columnFilter: f }))}
          />

          {/* Toolbar: search plus the SKU-level actions absorbed from the SKU Catalog. */}
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3">
            <div className="relative min-w-[220px] flex-1">
              <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input
                value={filters.search}
                onChange={e => setFilters(prev => ({ ...prev, search: e.target.value }))}
                placeholder="SKU number, title, project, attribute name or value…"
                className="w-full rounded border border-gray-300 p-2 pl-8 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <button
              onClick={() => setDialog('add')}
              className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Plus size={13} /> Add SKU
            </button>
            <button
              onClick={() => setDialog('sheet')}
              className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <Upload size={13} /> Upload values sheet
            </button>
            <button
              onClick={() => setDialog('roster')}
              className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <ListPlus size={13} /> Paste roster
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="inline-flex items-center gap-1 rounded border border-gray-300 bg-white px-2 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40"
              title="Only SKUs that are both changed and marked Final are exported"
            >
              <Download size={13} /> Export
              {exportableSkus.length > 0 ? ` (${exportableSkus.length})` : ''}
            </button>

            {/* The refusal, stated before it happens: changed-but-not-signed-off is the common
                case, and the Export button alone cannot say so. */}
            {changedSkus.length > exportableSkus.length && (
              <span className="text-[11px] text-amber-700">
                {changedSkus.length - exportableSkus.length} changed, not Final — not exportable
              </span>
            )}
            {openFlagCount > 0 && (
              <span className="text-[11px] text-amber-700">{openFlagCount} open flags</span>
            )}
          </div>

          <div className="flex items-start">
            <FilterRail
              collapsed={railCollapsed}
              onToggleCollapsed={() => setRailCollapsed(v => !v)}
              filters={filters}
              onChange={setFilters}
              attributes={attributeRows}
              valueOptions={valueOptions}
            />

            <div className="min-w-0 flex-1 overflow-hidden rounded-r-xl border border-gray-200 bg-white">
              {loading ? (
                <div className="flex items-center justify-center py-20 text-muted">
                  <Loader2 className="mr-2 animate-spin" size={18} /> Loading SKUs…
                </div>
              ) : filteredSkus.length === 0 || filteredRows.length === 0 ? (
                <div className="py-20 text-center text-sm text-muted">
                  {skus.length === 0
                    ? 'No SKUs in this category yet — add one, paste a roster, or upload a values sheet.'
                    : attributeRows.length === 0
                      ? 'This category has no attributes defined yet. Add them in the Admin panel.'
                      : 'Nothing matches the current filters.'}
                </div>
              ) : (
                <>
                  {/* Column toolbar: what is shown, what is ticked, how to move through it. */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-100 px-3 py-2 text-[11px] text-muted">
                    <span>
                      Showing <strong className="tabular-nums">{columnPage.columns.length}</strong>{' '}
                      of <strong className="tabular-nums">{sortedSkus.length}</strong> SKU
                      {sortedSkus.length === 1 ? '' : 's'}
                      {filteredSkus.length !== skus.length && ` (${skus.length} in category)`}
                      {' · '}
                      <strong className="tabular-nums">{filteredRows.length}</strong> of{' '}
                      {attributeRows.length} attributes
                    </span>

                    {!columnPage.showingAll && (
                      <span className="flex items-center gap-1.5">
                        <button
                          onClick={() => setPage(p => Math.max(0, p - 1))}
                          disabled={columnPage.page === 0}
                          className="rounded border border-gray-300 px-1.5 py-0.5 hover:bg-gray-50 disabled:opacity-40"
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <span className="tabular-nums">
                          page {columnPage.page + 1} / {columnPage.pageCount}
                        </span>
                        <button
                          onClick={() => setPage(p => Math.min(columnPage.pageCount - 1, p + 1))}
                          disabled={columnPage.page >= columnPage.pageCount - 1}
                          className="rounded border border-gray-300 px-1.5 py-0.5 hover:bg-gray-50 disabled:opacity-40"
                        >
                          <ChevronRight size={12} />
                        </button>
                      </span>
                    )}

                    {sort && (
                      <button
                        onClick={() => setSort(null)}
                        className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2 py-0.5 font-medium text-indigo-700"
                      >
                        sorted by {attrName(sort.attributeId)}{' '}
                        {sort.direction === 'asc' ? '▲' : '▼'}
                        <X size={11} />
                      </button>
                    )}

                    {selected.size > 0 && (
                      <span className="ml-auto flex items-center gap-2">
                        <strong className="tabular-nums">{selected.size} selected</strong>
                        <button
                          onClick={() => setComparing(v => !v)}
                          aria-pressed={comparing}
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
                            comparing
                              ? 'border-indigo-300 bg-indigo-600 text-white'
                              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          <Columns3 size={11} />
                          {comparing ? 'Comparing' : 'Compare'}
                        </button>
                        <button
                          onClick={() => setDialog('bulk')}
                          className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50"
                          title="Set one attribute across every ticked SKU"
                        >
                          <Wand2 size={11} /> Bulk fill
                        </button>
                        <button
                          onClick={() => setDialog('copy')}
                          className="inline-flex items-center gap-1 rounded-full border border-gray-300 bg-white px-2 py-0.5 font-medium text-gray-700 hover:bg-gray-50"
                          title="Copy a reference SKU's values onto every ticked SKU"
                        >
                          <Copy size={11} /> Copy from…
                        </button>
                        <button
                          onClick={() => {
                            setSelected(new Set());
                            setComparing(false);
                          }}
                          className="text-gray-500 hover:text-gray-700"
                        >
                          Clear
                        </button>
                      </span>
                    )}
                  </div>

                  <AttributeGrid
                    skus={columnPage.columns}
                    attributes={filteredRows}
                    byCell={byCell}
                    flagMap={flagMap}
                    duplicateCounts={duplicateCounts}
                    rowCoverage={coverage}
                    eprelByCell={eprelByCell ?? undefined}
                    sort={sort}
                    onToggleSort={id => setSort(prev => nextSort(prev, id))}
                    selected={selected}
                    onToggleSelected={toggleSelected}
                    onOpenSku={id => setParam('sku', id, true)}
                    onOpenCell={(skuId, attrId) => setActiveCell({ skuId, attrId })}
                    onCommitValue={handleSaveValue}
                  />

                  {/* Legend: every state named as well as coloured, each with its own count, so
                      the grid says what it is made of rather than leaving it to be eyeballed. */}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-gray-100 px-3 py-2 text-[11px] text-muted">
                    {CELL_STATE_ORDER.map(state => (
                      <span
                        key={state}
                        className="inline-flex items-center gap-1.5"
                        title={CELL_STATES[state].description}
                      >
                        <span
                          className={`inline-block h-2.5 w-2.5 rounded-sm border ${CELL_STATES[state].pill}`}
                          aria-hidden="true"
                        />
                        {CELL_STATES[state].label}
                        <span className="tabular-nums text-gray-400">{stateCounts[state]}</span>
                      </span>
                    ))}
                    {/* SAY HOW EACH AXIS WAS READ AND WHEN. A page that shows data without
                        saying how old it is gets trusted as live — and for the registry the
                        difference between "agrees" and "not checked" is the whole point. */}
                    <span className="inline-flex items-center gap-1.5 border-l border-gray-200 pl-3">
                      <span className="text-gray-400">EPREL:</span>
                      {eprelStatus.state === 'idle' && (
                        <span title="No SKU in this category has an EPREL ID captured, so there is nothing to look up.">
                          not checked
                        </span>
                      )}
                      {eprelStatus.state === 'loading' && (
                        <span className="inline-flex items-center gap-1">
                          <Loader2 className="animate-spin" size={10} /> checking{' '}
                          {eprelStatus.looked}
                        </span>
                      )}
                      {eprelStatus.state === 'off' && (
                        <span
                          className="text-gray-400"
                          title={eprelStatus.error || 'The EPREL API key is not configured on the server.'}
                        >
                          unavailable
                        </span>
                      )}
                      {eprelStatus.state === 'ready' && eprelSummary && (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-violet-700">
                            {eprelSummary.differs} differ
                          </span>
                          <span className="text-violet-600">
                            {eprelSummary.onlyEprel} fillable
                          </span>
                          <span className="text-gray-400">
                            {eprelSummary.agree} agree
                          </span>
                          <span
                            className="text-gray-400"
                            title={`${eprelStatus.found} of ${eprelStatus.looked} registrations found in the public registry. Only verified models are retrievable.`}
                          >
                            · {eprelStatus.found}/{eprelStatus.looked} found at{' '}
                            {eprelStatus.at ? new Date(eprelStatus.at).toLocaleTimeString() : '—'}
                          </span>
                        </span>
                      )}
                    </span>
                    <span className="ml-auto">click a cell to select · double-click to edit</span>
                  </div>

                  {orphanedValueCount > 0 && (
                    <div className="border-t border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">
                      {orphanedValueCount} stored value
                      {orphanedValueCount === 1 ? '' : 's'} on these SKUs point at an attribute
                      that is no longer defined, so {orphanedValueCount === 1 ? 'it has' : 'they have'}{' '}
                      no row above. Re-add the attribute to see{' '}
                      {orphanedValueCount === 1 ? 'it' : 'them'}.
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}

      {openSku && (
        <SkuDialog
          sku={openSku}
          duplicates={skus.filter(s => s.skuNumber === openSku.skuNumber && s.id !== openSku.id)}
          attributes={attributeRows}
          byCell={byCell}
          flagMap={flagMap}
          eprelByCell={eprelByCell ?? undefined}
          onSaveValue={(attr, v) => handleSaveValue(openSku.id, attr, v)}
          onClearValue={attr => handleClearValue(openSku.id, attr)}
          onOpenCell={attrId => setActiveCell({ skuId: openSku.id, attrId })}
          onSetFinal={(isFinal, reason) => handleSetFinal(openSku, isFinal, reason)}
          onRename={(n, t) => handleRenameSku(openSku, n, t)}
          onDelete={() => handleDeleteSku(openSku)}
          onClose={() => setParam('sku', null, true)}
        />
      )}

      {dialog === 'add' && (
        <AddSkuDialog
          categoryName={categoryName}
          onAdd={handleAddSku}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'sheet' && (
        <SkuSheetUploadDialog
          attributes={attributeRows}
          onApply={handleSheetUpload}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'roster' && (
        <SkuRosterDialog
          categoryName={categoryName}
          onApply={handleRosterImport}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'bulk' && (
        <BulkFillDialog
          skus={selectedSkus}
          attributes={attributeRows}
          values={values}
          onApply={handleBulkFill}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'copy' && (
        <CopyFromDialog
          skus={selectedSkus}
          allSkus={skus}
          attributes={attributeRows}
          values={values}
          onApply={handleCopyFrom}
          onClose={() => setDialog(null)}
        />
      )}

      {exportBlockers && (
        <ExportBlockedDialog
          blockers={exportBlockers}
          skuCount={exportableSkus.length}
          onCopy={copyBlockers}
          onClose={() => setExportBlockers(null)}
        />
      )}

      {activeCell && activeSku && activeAttr && (
        <SkuAttributeCellDrawer
          sku={activeSku}
          attribute={activeAttr}
          value={getRecord(activeCell.skuId, activeCell.attrId)?.value ?? ''}
          record={getRecord(activeCell.skuId, activeCell.attrId)}
          state={classifyCell(getRecord(activeCell.skuId, activeCell.attrId), activeAttr)}
          eprel={eprelByCell?.get(cellKey(activeCell.skuId, activeCell.attrId))}
          flag={flagMap[cellKey(activeCell.skuId, activeCell.attrId)]}
          onSaveValue={v => handleSaveValue(activeCell.skuId, activeAttr, v)}
          onClearValue={() => handleClearValue(activeCell.skuId, activeAttr)}
          onSaveFlag={c => handleSaveFlag(activeCell.skuId, activeCell.attrId, c)}
          onResolveFlag={r => handleResolveFlag(activeCell.skuId, activeCell.attrId, r)}
          onDeleteFlag={() => handleDeleteFlag(activeCell.skuId, activeCell.attrId)}
          onClose={() => setActiveCell(null)}
        />
      )}
    </Layout>
  );
};

export default AttributeViewer;
