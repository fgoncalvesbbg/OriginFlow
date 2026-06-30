/**
 * Attribute Viewer — review and compare product attributes across SKUs.
 *
 * Aggregates every project_sku in a selected L3 category into a comparison grid (attributes as rows,
 * SKUs as columns). Internal users can search/filter SKUs, edit a value inline (written back to the
 * SKU), and flag any cell with a comment for follow-up. SKUs live inside projects, so this pulls in
 * SKUs from every project that carries the chosen category.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../../components/Layout';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../hooks';
import { CategoryAttribute, CategoryL3, SkuAttributeFlag, SkuAttributeValue } from '../../types';
import {
  CategorySku,
  getCategories,
  getCategoryAttributes,
  getSkusByCategory,
  getFlagsForSkus,
  updateProjectSku,
  upsertSkuAttributeFlag,
  setSkuAttributeFlagResolved,
  deleteSkuAttributeFlag,
  ATTRIBUTE_GROUPS,
} from '../../services';
import { getAttributesForCategory } from '../../utils/attribute-validation.utils';
import SkuAttributeCellDrawer from '../../components/products/SkuAttributeCellDrawer';
import { Search, Flag, Plus, X, Loader2, Table2 } from 'lucide-react';

const cellKey = (skuId: string, attrId: string) => `${skuId}::${attrId}`;
const groupRank = (group?: string) => {
  const i = (ATTRIBUTE_GROUPS as readonly string[]).indexOf(group ?? 'Category Specific');
  return i === -1 ? ATTRIBUTE_GROUPS.length : i;
};

const AttributeViewer: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();

  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [allAttrs, setAllAttrs] = useState<CategoryAttribute[]>([]);
  const [categoryId, setCategoryId] = useState('');

  const [skus, setSkus] = useState<CategorySku[]>([]);
  const [flagMap, setFlagMap] = useState<Record<string, SkuAttributeFlag>>({});
  const [loading, setLoading] = useState(false);

  // Filters
  const [skuSearch, setSkuSearch] = useState('');
  const [attrSearch, setAttrSearch] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [valueFilters, setValueFilters] = useState<{ attributeId: string; value: string }[]>([]);
  const [newFilterAttr, setNewFilterAttr] = useState('');
  const [newFilterValue, setNewFilterValue] = useState('');

  const [activeCell, setActiveCell] = useState<{ skuId: string; attrId: string } | null>(null);

  // Load categories + attribute definitions once.
  useEffect(() => {
    let mounted = true;
    (async () => {
      const [cats, attrs] = await Promise.all([getCategories(), getCategoryAttributes()]);
      if (!mounted) return;
      setCategories(cats.filter(c => c.active).sort((a, b) => a.name.localeCompare(b.name)));
      setAllAttrs(attrs);
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Load SKUs + flags whenever the category changes.
  useEffect(() => {
    if (!categoryId) {
      setSkus([]);
      setFlagMap({});
      return;
    }
    let mounted = true;
    setLoading(true);
    (async () => {
      try {
        const loaded = await getSkusByCategory(categoryId);
        if (!mounted) return;
        setSkus(loaded);
        const flags = await getFlagsForSkus(loaded.map(s => s.id));
        if (!mounted) return;
        const map: Record<string, SkuAttributeFlag> = {};
        for (const f of flags) map[cellKey(f.projectSkuId, f.attributeId)] = f;
        setFlagMap(map);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [categoryId]);

  // Rows: the category's defined attributes, plus any attribute present on a SKU but not defined
  // (legacy values), so nothing stored is hidden. Sorted by attribute group then name.
  const attributeRows = useMemo<CategoryAttribute[]>(() => {
    if (!categoryId) return [];
    const byId = new Map<string, CategoryAttribute>();
    for (const a of getAttributesForCategory(allAttrs, categoryId)) byId.set(a.id, a);
    for (const sku of skus) {
      for (const v of sku.attributeValues) {
        if (!byId.has(v.attributeId)) {
          byId.set(v.attributeId, {
            id: v.attributeId,
            categoryId: null,
            name: v.name || v.attributeId,
            dataType: 'text',
          });
        }
      }
    }
    return Array.from(byId.values()).sort(
      (a, b) => groupRank(a.group) - groupRank(b.group) || a.name.localeCompare(b.name),
    );
  }, [allAttrs, categoryId, skus]);

  const getValue = (sku: CategorySku, attrId: string) =>
    sku.attributeValues.find(v => v.attributeId === attrId)?.value ?? '';

  // SKU columns surviving the search box + value filters.
  const filteredSkus = useMemo(() => {
    const q = skuSearch.trim().toLowerCase();
    return skus.filter(sku => {
      if (q) {
        const hay = `${sku.skuNumber} ${sku.skuTitle} ${sku.projectName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return valueFilters.every(f =>
        getValue(sku, f.attributeId).toLowerCase().includes(f.value.trim().toLowerCase()),
      );
    });
  }, [skus, skuSearch, valueFilters]);

  // Attribute rows surviving the name search + "flagged only".
  const filteredRows = useMemo(() => {
    const q = attrSearch.trim().toLowerCase();
    return attributeRows.filter(attr => {
      if (q && !attr.name.toLowerCase().includes(q)) return false;
      if (flaggedOnly && !filteredSkus.some(sku => flagMap[cellKey(sku.id, attr.id)])) return false;
      return true;
    });
  }, [attributeRows, attrSearch, flaggedOnly, filteredSkus, flagMap]);

  const openFlagCount = useMemo(
    () => Object.values(flagMap).filter(f => f.status === 'open').length,
    [flagMap],
  );

  const activeSku = activeCell ? skus.find(s => s.id === activeCell.skuId) : undefined;
  const activeAttr = activeCell ? attributeRows.find(a => a.id === activeCell.attrId) : undefined;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const handleSaveValue = async (skuId: string, attr: CategoryAttribute, newValue: string) => {
    const sku = skus.find(s => s.id === skuId);
    if (!sku) return;
    const exists = sku.attributeValues.some(v => v.attributeId === attr.id);
    const nextValues: SkuAttributeValue[] = exists
      ? sku.attributeValues.map(v => (v.attributeId === attr.id ? { ...v, value: newValue } : v))
      : [...sku.attributeValues, { attributeId: attr.id, name: attr.name, value: newValue }];
    try {
      await updateProjectSku(skuId, { attributeValues: nextValues });
      setSkus(prev => prev.map(s => (s.id === skuId ? { ...s, attributeValues: nextValues } : s)));
      toast.success('Value updated');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update value');
    }
  };

  const handleSaveFlag = async (skuId: string, attrId: string, comment: string) => {
    try {
      const flag = await upsertSkuAttributeFlag(
        skuId,
        attrId,
        comment,
        user?.id ?? null,
        user?.name ?? '',
      );
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

  const addValueFilter = () => {
    if (!newFilterAttr || !newFilterValue.trim()) return;
    setValueFilters(prev => [...prev, { attributeId: newFilterAttr, value: newFilterValue.trim() }]);
    setNewFilterAttr('');
    setNewFilterValue('');
  };

  const attrName = (id: string) => attributeRows.find(a => a.id === id)?.name ?? id;

  return (
    <Layout>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-primary flex items-center gap-2">
          <Table2 className="text-indigo-500" /> Attribute Viewer
        </h1>
        <p className="text-sm text-muted mt-1">
          Compare, review, edit and flag product attributes across every SKU in a category.
        </p>
      </div>

      {/* Controls */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[260px]">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
              Category
            </label>
            <select
              value={categoryId}
              onChange={e => setCategoryId(e.target.value)}
              className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="">— Select a category —</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
              Search SKUs
            </label>
            <div className="relative">
              <Search size={15} className="absolute left-2.5 top-2.5 text-gray-400" />
              <input
                value={skuSearch}
                onChange={e => setSkuSearch(e.target.value)}
                placeholder="SKU number, title, project…"
                className="w-full border border-gray-300 rounded p-2 pl-8 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>
          </div>

          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-bold text-gray-500 uppercase tracking-wide mb-1">
              Find attribute
            </label>
            <input
              value={attrSearch}
              onChange={e => setAttrSearch(e.target.value)}
              placeholder="Filter attribute rows…"
              className="w-full border border-gray-300 rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>

          <button
            onClick={() => setFlaggedOnly(v => !v)}
            aria-pressed={flaggedOnly}
            className={`flex items-center gap-1.5 px-3 py-2 rounded text-sm font-medium border transition-colors ${
              flaggedOnly
                ? 'bg-amber-50 text-amber-700 border-amber-300'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <Flag size={14} />
            Flagged only{openFlagCount > 0 ? ` (${openFlagCount})` : ''}
          </button>
        </div>

        {/* Value filters */}
        {categoryId && (
          <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3">
            <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
              Value filters
            </span>
            {valueFilters.map((f, i) => (
              <span
                key={`${f.attributeId}-${i}`}
                className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 text-xs font-medium px-2 py-1 rounded-full"
              >
                {attrName(f.attributeId)}: “{f.value}”
                <button
                  onClick={() => setValueFilters(prev => prev.filter((_, idx) => idx !== i))}
                  aria-label="Remove filter"
                  className="hover:text-indigo-900"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <select
              value={newFilterAttr}
              onChange={e => setNewFilterAttr(e.target.value)}
              className="border border-gray-300 rounded p-1.5 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              <option value="">Attribute…</option>
              {attributeRows.map(a => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <input
              value={newFilterValue}
              onChange={e => setNewFilterValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addValueFilter()}
              placeholder="contains…"
              className="border border-gray-300 rounded p-1.5 text-xs w-32 focus:ring-2 focus:ring-indigo-500 outline-none"
            />
            <button
              onClick={addValueFilter}
              disabled={!newFilterAttr || !newFilterValue.trim()}
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-40"
            >
              <Plus size={13} /> Add filter
            </button>
          </div>
        )}
      </div>

      {/* Grid */}
      {!categoryId ? (
        <div className="text-center py-20 text-muted text-sm">
          Select a category to view its SKUs and attributes.
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center py-20 text-muted">
          <Loader2 className="animate-spin mr-2" size={18} /> Loading SKUs…
        </div>
      ) : filteredSkus.length === 0 ? (
        <div className="text-center py-20 text-muted text-sm">
          {skus.length === 0
            ? 'No SKUs found for this category yet.'
            : 'No SKUs match the current filters.'}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-340px)]">
            <table className="border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-30 bg-gray-50 border-b border-r border-gray-200 px-3 py-2 text-left text-xs font-bold text-gray-500 uppercase tracking-wide min-w-[200px]">
                    Attribute
                  </th>
                  {filteredSkus.map(sku => (
                    <th
                      key={sku.id}
                      className="sticky top-0 z-20 bg-gray-50 border-b border-r border-gray-200 px-3 py-2 text-left align-top min-w-[150px]"
                    >
                      <div className="text-sm font-semibold text-primary truncate">
                        {sku.skuNumber || '—'}
                      </div>
                      <div className="text-[11px] text-gray-400 truncate font-normal" title={sku.projectName}>
                        {sku.skuTitle || sku.projectName}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(attr => (
                  <tr key={attr.id} className="hover:bg-indigo-50/20">
                    <th className="sticky left-0 z-10 bg-white border-b border-r border-gray-200 px-3 py-2 text-left text-xs font-medium text-gray-700 align-top min-w-[200px]">
                      {attr.name}
                      {attr.validationRules?.unit && (
                        <span className="text-gray-400 font-normal"> ({attr.validationRules.unit})</span>
                      )}
                    </th>
                    {filteredSkus.map(sku => {
                      const value = getValue(sku, attr.id);
                      const flag = flagMap[cellKey(sku.id, attr.id)];
                      return (
                        <td
                          key={sku.id}
                          onClick={() => setActiveCell({ skuId: sku.id, attrId: attr.id })}
                          className={`border-b border-r border-gray-100 px-3 py-2 align-top cursor-pointer relative group ${
                            flag?.status === 'open' ? 'bg-amber-50' : ''
                          }`}
                          title={flag ? flag.comment : undefined}
                        >
                          {attr.dataType === 'image' && value ? (
                            <img
                              src={value}
                              alt={attr.name}
                              className="h-12 w-12 object-cover rounded border border-gray-200 bg-gray-50"
                            />
                          ) : (
                            <span className="text-gray-800 break-words">
                              {value || <span className="text-gray-300">—</span>}
                            </span>
                          )}
                          {flag && (
                            <Flag
                              size={11}
                              className={`absolute top-1 right-1 ${
                                flag.status === 'open' ? 'text-amber-500' : 'text-emerald-500'
                              }`}
                              fill="currentColor"
                            />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-3 py-2 border-t border-gray-100 text-[11px] text-muted">
            {filteredSkus.length} SKU{filteredSkus.length === 1 ? '' : 's'} · {filteredRows.length}{' '}
            attribute{filteredRows.length === 1 ? '' : 's'} · click any cell to edit or flag
          </div>
        </div>
      )}

      {activeCell && activeSku && activeAttr && (
        <SkuAttributeCellDrawer
          sku={activeSku}
          attribute={activeAttr}
          value={getValue(activeSku, activeAttr.id)}
          flag={flagMap[cellKey(activeCell.skuId, activeCell.attrId)]}
          onSaveValue={v => handleSaveValue(activeCell.skuId, activeAttr, v)}
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
