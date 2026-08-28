/**
 * Token-based supplier portal for a BATCH of SKU attribute requests — the side-by-side
 * counterpart to SupplierAttributePortal.tsx. Reached via one link
 * (/#/attribute-request-batch/:batchToken) covering every SKU a PM sent together in one
 * bulk action (see ProjectDetail.tsx's handleSendAllSkusForReview /
 * handleSendAllProductionRequests, and migration 136).
 *
 * Layout: attributes as rows (label + hint shown once), SKUs as columns — the same idea as
 * the internal AttributeViewer, but editable and public. Since every SKU in a batch shares
 * one category, the attribute set is identical across every column; only the values differ,
 * which is exactly what makes "fill one, copy across the row" worth offering per row.
 *
 * A SKU already submitted (individually, before or during this batch's life) renders as a
 * locked, read-only column — the batch submit never touches it (see
 * submit_attribute_batch_secure). Submitting sends only the still-pending columns.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getAttributeRequestsByBatchToken, submitAttributeBatch, getCategoryAttributes } from '../services';
import { ProjectAttributeRequest, CategoryAttribute } from '../types';
import { getSupplierVisibleAttributes, validateAttributeValue } from '../utils';
import AttributeInput from '../components/common/AttributeInput';
import * as XLSX from 'xlsx';
import { CheckCircle, Loader2, AlertTriangle, ClipboardList, Send, ArrowRightToLine, Download, Lock } from 'lucide-react';

type CellValues = Record<string, Record<string, string>>; // [skuToken][attributeId] -> value
type CellErrors = Record<string, Record<string, string>>; // [skuToken][attributeId] -> error message

const SupplierAttributeBatchPortal: React.FC = () => {
  const { batchToken } = useParams<{ batchToken: string }>();

  const [rows, setRows] = useState<ProjectAttributeRequest[]>([]);
  const [allAttributes, setAllAttributes] = useState<CategoryAttribute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [values, setValues] = useState<CellValues>({});
  const [errors, setErrors] = useState<CellErrors>({});
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!batchToken) { setError('Invalid link.'); setLoading(false); return; }
    (async () => {
      try {
        const [reqs, attrs] = await Promise.all([
          getAttributeRequestsByBatchToken(batchToken),
          getCategoryAttributes(),
        ]);
        if (!reqs.length) { setError('Batch not found or link expired.'); return; }
        setRows(reqs);
        setAllAttributes(attrs);

        // Prefill every SKU's own values — from a prior submission if it has one (production
        // validation, or a re-visit), otherwise blank. Already-submitted SKUs render read-only
        // from `rows` directly, so their initial values here are display-only.
        const initValues: CellValues = {};
        for (const r of reqs) {
          const cell: Record<string, string> = {};
          (r.submittedData ?? []).forEach(d => { cell[d.attributeId] = d.value; });
          initValues[r.token] = cell;
        }
        setValues(initValues);
      } catch (e: any) {
        setError('Failed to load batch data.');
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [batchToken]);

  const first = rows[0];
  const catAttrs = first ? getSupplierVisibleAttributes(allAttributes, first.categoryId ?? '') : [];
  const grouped = catAttrs.reduce<Record<string, CategoryAttribute[]>>((acc, a) => {
    const g = a.group || 'Category Specific';
    if (!acc[g]) acc[g] = [];
    acc[g].push(a);
    return acc;
  }, {});

  const pending = rows.filter(r => r.status === 'pending');
  const alreadySubmitted = rows.filter(r => r.status === 'submitted');
  const errorCount = Object.values(errors).reduce((n, row) => n + Object.values(row).filter(Boolean).length, 0);

  const setCell = (skuToken: string, attrId: string, v: string) => {
    setValues(prev => ({ ...prev, [skuToken]: { ...prev[skuToken], [attrId]: v } }));
    setErrors(prev => {
      if (!prev[skuToken]?.[attrId]) return prev;
      const nextRow = { ...prev[skuToken], [attrId]: '' };
      return { ...prev, [skuToken]: nextRow };
    });
  };

  // Copy the left-most pending SKU's value for this attribute into every OTHER pending SKU
  // that doesn't already have one. Never overwrites a value the supplier already typed.
  const fillAcross = (attrId: string) => {
    const source = pending.find(r => (values[r.token]?.[attrId] ?? '').trim());
    if (!source) return;
    const v = values[source.token][attrId];
    setValues(prev => {
      const next = { ...prev };
      for (const r of pending) {
        if (r.token === source.token) continue;
        if ((next[r.token]?.[attrId] ?? '').trim()) continue; // don't clobber an existing entry
        next[r.token] = { ...next[r.token], [attrId]: v };
      }
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!batchToken || pending.length === 0) return;

    const newErrors: CellErrors = {};
    let hasErrors = false;
    let firstBadToken: string | null = null;
    for (const r of pending) {
      const rowErrors: Record<string, string> = {};
      for (const a of catAttrs) {
        const v = values[r.token]?.[a.id] || '';
        const err = validateAttributeValue(a, v, 'text');
        if (err) {
          rowErrors[a.id] = err;
          hasErrors = true;
          if (!firstBadToken) firstBadToken = r.token;
        }
      }
      if (Object.keys(rowErrors).length) newErrors[r.token] = rowErrors;
    }
    if (hasErrors) {
      setErrors(newErrors);
      if (firstBadToken) {
        requestAnimationFrame(() => {
          rowRefs.current[firstBadToken!]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      const payload = pending.map(r => ({
        token: r.token,
        data: catAttrs
          .filter(a => values[r.token]?.[a.id])
          .map(a => ({ attributeId: a.id, name: a.name, value: values[r.token][a.id] })),
      }));
      const updated = await submitAttributeBatch(batchToken, payload);
      setRows(updated);
      setSubmitted(true);
    } catch (e: any) {
      alert('Error submitting: ' + (e.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadExcel = () => {
    // One matrix sheet: attribute rows, a SKU per column — mirrors the on-screen grid, so
    // the supplier's own record matches what they saw, not a reshaped export.
    const header = ['Attribute', 'Akeneo ID', ...rows.map(r => r.skuTitle ? `${r.skuNumber} (${r.skuTitle})` : r.skuNumber)];
    const body = catAttrs.map(a => [
      a.name,
      a.akeneoId ?? '',
      ...rows.map(r => {
        const submittedVal = r.submittedData?.find(d => d.attributeId === a.id)?.value;
        return submittedVal ?? values[r.token]?.[a.id] ?? '';
      }),
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Attributes');
    const stamp = new Date().toISOString().slice(0, 10);
    const name = [first?.projectIdCode || 'batch', `${rows.length}skus`, stamp].filter(Boolean).join('_');
    XLSX.writeFile(wb, `${name}.xlsx`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="animate-spin text-indigo-600" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow p-8 max-w-md w-full text-center">
          <AlertTriangle className="mx-auto text-rose-500 mb-4" size={40} />
          <h2 className="text-xl font-bold text-gray-800 mb-2">Link Error</h2>
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  const remainingPending = rows.filter(r => r.status === 'pending').length;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 px-4 py-5">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <ClipboardList className="text-indigo-600" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Product Attribute Data Request</h1>
              <p className="text-xs text-gray-400">OriginFlow · Product Lifecycle Management</p>
            </div>
          </div>
          {first && (
            <div className="mt-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-1.5 text-sm">
              <div>
                <span className="text-xs text-gray-400 uppercase tracking-wide block">Project</span>
                <span className="font-semibold text-gray-800">{first.projectName}</span>
                {first.projectIdCode && <span className="text-xs text-gray-400 ml-1">· {first.projectIdCode}</span>}
              </div>
              {first.categoryName && (
                <div>
                  <span className="text-xs text-gray-400 uppercase tracking-wide block">Category</span>
                  <span className="font-semibold text-gray-800">{first.categoryName}</span>
                </div>
              )}
              <div>
                <span className="text-xs text-gray-400 uppercase tracking-wide block">SKUs</span>
                <span className="font-semibold text-gray-800">
                  {rows.length} total{alreadySubmitted.length > 0 ? ` · ${alreadySubmitted.length} already submitted` : ''}
                </span>
              </div>
              <div>
                <span className="text-xs text-gray-400 uppercase tracking-wide block">Stage</span>
                <span className="font-semibold text-gray-800">
                  {first.step === 3 ? 'Production Validation' : 'Business Case & Development'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto p-4 pt-6">
        {submitted ? (
          // This browser session just completed a submit — the celebratory version.
          <div className="bg-white rounded-xl shadow p-8 text-center mb-6">
            <CheckCircle className="mx-auto text-emerald-500 mb-4" size={48} />
            <h2 className="text-2xl font-bold text-gray-800 mb-2">
              {remainingPending === 0 ? 'All SKUs Submitted' : `${rows.length - remainingPending} of ${rows.length} SKUs Submitted`}
            </h2>
            <p className="text-gray-500 text-sm">Thank you. Your product attribute data has been sent to the project manager.</p>
            <button
              type="button"
              onClick={handleDownloadExcel}
              className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg"
            >
              <Download size={12} /> Download Excel
            </button>
          </div>
        ) : pending.length === 0 ? (
          // Reopening a link (or a fresh visit) after everything was already submitted —
          // no submit bar, no "0 SKUs to fill in" nonsense, just a plain confirmation.
          <div className="mb-6 bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-sm text-emerald-800 flex items-center gap-2">
            <CheckCircle size={16} className="shrink-0" />
            All {rows.length} SKUs in this batch have already been submitted. Nothing left to do here.
          </div>
        ) : (
          <div className="mb-6 bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm text-violet-900">
            <strong className="block mb-0.5">{pending.length} SKUs to fill in</strong>
            <p className="text-violet-800">
              Fill in each column below. If a field is the same for every SKU, fill it once and click the{' '}
              <ArrowRightToLine size={12} className="inline -mt-0.5" /> icon at the end of that row to copy it into
              the others — it only fills SKUs that are still blank for that field.
            </p>
          </div>
        )}

        {catAttrs.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-8 text-center text-gray-400">
            <p>No attributes defined for this category.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).map(([group, attrs]) => (
              <div key={group} className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
                <div className="bg-light px-4 py-3 border-b border-gray-200">
                  <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">{group}</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-2.5 font-medium text-gray-500 sticky left-0 bg-gray-50 min-w-[220px] max-w-[260px]">
                          Attribute
                        </th>
                        {rows.map(r => (
                          <th key={r.token} className="text-left px-3 py-2.5 font-medium text-gray-600 min-w-[180px]">
                            <div className="flex items-center gap-1.5">
                              {r.status === 'submitted' && <Lock size={11} className="text-emerald-600 shrink-0" />}
                              <span className={r.status === 'submitted' ? 'text-emerald-700' : ''}>{r.skuNumber}</span>
                            </div>
                            {r.skuTitle && <div className="text-xs font-normal text-gray-400 truncate">{r.skuTitle}</div>}
                          </th>
                        ))}
                        {pending.length > 1 && <th className="w-8"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {attrs.map(attr => (
                        <tr key={attr.id} ref={el => { rowRefs.current[attr.id] = el; }}>
                          <td className="px-4 py-3 align-top sticky left-0 bg-white">
                            <div className="text-sm font-medium text-gray-700">
                              {attr.name}
                              {attr.validationRules?.required && <span className="text-rose-500 ml-1">*</span>}
                              {attr.validationRules?.unit && <span className="text-gray-400 ml-1 text-xs">({attr.validationRules.unit})</span>}
                            </div>
                            {attr.validationRules?.placeholder && (
                              <div className="text-xs text-gray-400 mt-0.5">{attr.validationRules.placeholder}</div>
                            )}
                          </td>
                          {rows.map(r => {
                            const isLocked = r.status === 'submitted';
                            if (isLocked) {
                              const v = r.submittedData?.find(d => d.attributeId === attr.id)?.value;
                              return (
                                <td key={r.token} className="px-3 py-3 align-top text-gray-500 bg-emerald-50/30">
                                  {v || <span className="text-gray-300">—</span>}
                                </td>
                              );
                            }
                            return (
                              <td key={r.token} className="px-3 py-3 align-top min-w-[180px]">
                                <AttributeInput
                                  attribute={attr}
                                  value={values[r.token]?.[attr.id] || ''}
                                  onChange={v => setCell(r.token, attr.id, v)}
                                  mode="text"
                                  hideCaption
                                  error={errors[r.token]?.[attr.id]}
                                />
                              </td>
                            );
                          })}
                          {pending.length > 1 && (
                            <td className="px-1 py-3 align-top">
                              <button
                                type="button"
                                onClick={() => fillAcross(attr.id)}
                                title="Copy this value into every other blank SKU"
                                className="p-1.5 text-gray-300 hover:text-violet-600 hover:bg-violet-50 rounded transition-colors"
                              >
                                <ArrowRightToLine size={14} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}

            {pending.length > 0 && (
              <div className="sticky bottom-4 space-y-2">
                {errorCount > 0 && (
                  <div className="w-full flex items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 shadow">
                    <AlertTriangle size={16} />
                    {errorCount} field{errorCount === 1 ? '' : 's'} across the batch need{errorCount === 1 ? 's' : ''} attention
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting || pending.length === 0}
                  className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2 text-base"
                >
                  {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                  {submitting ? 'Submitting…' : `Submit ${pending.length} SKU${pending.length === 1 ? '' : 's'}`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default SupplierAttributeBatchPortal;
