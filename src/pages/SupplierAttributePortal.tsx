/** Token-based supplier portal for submitting requested project attribute values. */
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getAttributeRequestByToken, getSiblingAttributeRequests, submitAttributeRequest, getCategoryAttributes } from '../services';
import type { SiblingAttributeRequest } from '../services';
import { ProjectAttributeRequest, CategoryAttribute } from '../types';
import { getSupplierVisibleAttributes, validateAttributeValue } from '../utils';
import AttributeInput from '../components/common/AttributeInput';
import * as XLSX from 'xlsx';
import { CheckCircle, Loader2, AlertTriangle, ClipboardList, Send, Copy, Download, Printer, Layers, Check } from 'lucide-react';

type SubmittedRow = { attributeId: string; name: string; value: string; type?: string };

const SupplierAttributePortal: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  const [request, setRequest] = useState<ProjectAttributeRequest | null>(null);
  const [allAttributes, setAllAttributes] = useState<CategoryAttribute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // What was actually sent, so the confirmation screen can show the supplier their
  // own record. On a revisit this falls back to request.submittedData.
  const [submittedValues, setSubmittedValues] = useState<SubmittedRow[] | null>(null);

  const [values, setValues] = useState<Record<string, string>>({});
  const [types, setTypes] = useState<Record<string, 'fixed' | 'range' | 'text'>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Per-attribute wrappers, so a failed submit can scroll to the first bad field.
  const fieldRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // Image attributes that already have a value: a supplier may upload an image once,
  // but once set only a PM can replace it (locked read-only here).
  const [lockedImageIds, setLockedImageIds] = useState<Set<string>>(new Set());

  // Other requests created together with this one (same project + category + step).
  // Populated even for a lone SKU (then empty) — see getSiblingAttributeRequests.
  const [siblings, setSiblings] = useState<SiblingAttributeRequest[]>([]);
  // Attributes the supplier has marked identical across the batch. Only ever offered when
  // there is at least one PENDING sibling to actually copy into.
  const [sharedAttrIds, setSharedAttrIds] = useState<Set<string>>(new Set());
  // Sibling SKUs the just-completed submit copied values into, for the confirmation screen.
  const [appliedTo, setAppliedTo] = useState<SiblingAttributeRequest[]>([]);

  useEffect(() => {
    if (!token) { setError('Invalid link.'); setLoading(false); return; }
    (async () => {
      try {
        const [req, attrs, sibs] = await Promise.all([
          getAttributeRequestByToken(token),
          getCategoryAttributes(),
          getSiblingAttributeRequests(token),
        ]);
        if (!req) { setError('Request not found or link expired.'); return; }
        setRequest(req);
        setAllAttributes(attrs);
        setSiblings(sibs);

        if (req.status === 'submitted') { setSubmitted(true); return; }

        const catAttrs = getSupplierVisibleAttributes(attrs, req.categoryId ?? '');
        const initValues: Record<string, string> = {};
        const initTypes: Record<string, 'fixed' | 'range' | 'text'> = {};
        catAttrs.forEach(a => {
          const isNum = a.dataType === 'integer' || a.dataType === 'decimal';
          initTypes[a.id] = isNum ? 'fixed' : 'text';
          initValues[a.id] = '';
        });
        // Pre-fill if previously submitted
        const locked = new Set<string>();
        if (req.submittedData) {
          req.submittedData.forEach(d => {
            initValues[d.attributeId] = d.value;
            if (d.type) initTypes[d.attributeId] = d.type as any;
            // An image carried over from a previous submission/stage is locked for suppliers.
            const attr = catAttrs.find(a => a.id === d.attributeId);
            if (attr?.dataType === 'image' && d.value) locked.add(d.attributeId);
          });
        }
        setLockedImageIds(locked);
        setValues(initValues);
        setTypes(initTypes);
      } catch (e: any) {
        setError('Failed to load request data.');
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const catAttrs = request ? getSupplierVisibleAttributes(allAttributes, request.categoryId ?? '') : [];
  const errorCount = Object.values(errors).filter(Boolean).length;
  // Siblings that can actually receive a copied value — a submitted one is locked.
  const pendingSiblings = siblings.filter(s => s.status === 'pending');

  const toggleShared = (attrId: string) => {
    setSharedAttrIds(prev => {
      const next = new Set(prev);
      if (next.has(attrId)) next.delete(attrId); else next.add(attrId);
      return next;
    });
  };

  // Relative due-date label, matching the colouring the compliance portal already uses.
  const dueLabel = (() => {
    if (!request?.deadline) return null;
    const days = Math.ceil((new Date(request.deadline).getTime() - Date.now()) / 86400000);
    if (days < 0) return { text: `${Math.abs(days)} days overdue`, tone: 'text-rose-600' };
    if (days === 0) return { text: 'due today', tone: 'text-amber-600' };
    if (days <= 7) return { text: `in ${days} day${days === 1 ? '' : 's'}`, tone: 'text-amber-600' };
    return { text: `in ${days} days`, tone: 'text-emerald-700' };
  })();

  // Group attributes by their group field
  const grouped = catAttrs.reduce<Record<string, CategoryAttribute[]>>((acc, a) => {
    const g = a.group || 'Category Specific';
    if (!acc[g]) acc[g] = [];
    acc[g].push(a);
    return acc;
  }, {});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!request || !token) return;

    const newErrors: Record<string, string> = {};
    catAttrs.forEach(a => {
      const err = validateAttributeValue(a, values[a.id] || '', types[a.id] || 'text');
      if (err) newErrors[a.id] = err;
    });
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // The submit button is pinned to the bottom while the fields run well above it,
      // so an inline error alone can land off-screen and the click reads as a no-op.
      // Show a count next to the button and jump to the first offending field.
      const firstBadId = catAttrs.find(a => newErrors[a.id])?.id;
      if (firstBadId) {
        requestAnimationFrame(() => {
          fieldRefs.current[firstBadId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      const payload = catAttrs
        .filter(a => values[a.id])
        .map(a => ({ attributeId: a.id, name: a.name, value: values[a.id], type: types[a.id] }));
      // Only ids the supplier both marked AND actually filled in reach the server — an
      // empty marked field has nothing to copy.
      const sharedIds = Array.from(sharedAttrIds).filter(id => payload.some(p => p.attributeId === id));
      const pending = siblings.filter(s => s.status === 'pending');
      await submitAttributeRequest(token, payload, sharedIds);
      setSubmittedValues(payload);
      setAppliedTo(sharedIds.length > 0 ? pending : []);
      setSubmitted(true);
    } catch (e: any) {
      alert('Error submitting: ' + (e.message || 'Unknown error'));
    } finally {
      setSubmitting(false);
    }
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

  if (submitted) {
    // The PM can export this data to Excel; the supplier who typed it could not see
    // it again at all. Without a copy they keep a shadow spreadsheet, and that
    // spreadsheet quietly becomes the real source of truth.
    const rows: SubmittedRow[] = submittedValues ?? request?.submittedData ?? [];
    const akeneoOf = (attributeId: string) =>
      allAttributes.find(a => a.id === attributeId)?.akeneoId ?? '';

    const handleDownloadExcel = () => {
      const sheet = rows.map(d => ({
        Attribute: d.name,
        'Akeneo ID': akeneoOf(d.attributeId),
        Value: d.value,
        Type: d.type || '',
      }));
      const ws = XLSX.utils.json_to_sheet(sheet);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Attributes');
      const stamp = new Date().toISOString().slice(0, 10);
      const name = [request?.skuNumber || 'attributes', request?.projectIdCode, stamp]
        .filter(Boolean).join('_');
      XLSX.writeFile(wb, `${name}.xlsx`);
    };

    return (
      <div className="min-h-screen bg-gray-50 py-8 px-4">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white rounded-xl shadow p-8 text-center mb-6 print-avoid-break">
            <CheckCircle className="mx-auto text-emerald-500 mb-4" size={48} />
            <h2 className="text-2xl font-bold text-gray-800 mb-2">Data Submitted</h2>
            <p className="text-gray-500 text-sm">
              Thank you. Your product attribute data has been sent to the project manager.
            </p>
            {request?.submittedAt && (
              <p className="text-xs text-gray-400 mt-2">
                Submitted {new Date(request.submittedAt).toLocaleString()}
              </p>
            )}
            {appliedTo.length > 0 && (
              <p className="text-xs text-sky-700 bg-sky-50 border border-sky-200 rounded-lg px-3 py-2 mt-4 inline-flex items-center gap-1.5">
                <Copy size={13} />
                The values you marked "same for all" were also copied to{' '}
                {appliedTo.map(s => s.skuNumber).join(', ')}. Please still open each of those
                and submit — only this SKU is finalized so far.
              </p>
            )}
          </div>

          {rows.length > 0 && (
            <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden print-plain">
              <div className="px-4 py-3 border-b border-gray-200 bg-light flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-gray-700">Your submission</h3>
                  <p className="text-xs text-gray-400">
                    {request?.skuNumber}
                    {request?.skuTitle ? ` · ${request.skuTitle}` : ''}
                    {request?.projectName ? ` · ${request.projectName}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 no-print">
                  <button
                    type="button"
                    onClick={handleDownloadExcel}
                    className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 px-3 py-1.5 rounded-lg"
                  >
                    <Download size={12} /> Excel
                  </button>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 text-xs font-medium text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50"
                  >
                    <Printer size={12} /> Print
                  </button>
                </div>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {rows.map(d => (
                    <tr key={d.attributeId}>
                      <td className="px-4 py-2 text-gray-500 align-top w-1/2">{d.name}</td>
                      <td className="px-4 py-2 font-medium text-gray-800 break-words">{d.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-5">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-indigo-100 rounded-lg">
              <ClipboardList className="text-indigo-600" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">Product Attribute Data Request</h1>
              <p className="text-xs text-gray-400">OriginFlow · Product Lifecycle Management</p>
            </div>
          </div>
          {request && (
            <div className="mt-3 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
              <div>
                <span className="text-xs text-gray-400 uppercase tracking-wide block">Project</span>
                <span className="font-semibold text-gray-800">{request.projectName}</span>
                {request.projectIdCode && (
                  <span className="text-xs text-gray-400 ml-1">· {request.projectIdCode}</span>
                )}
              </div>
              {(request.skuNumber || request.skuTitle) && (
                <div>
                  <span className="text-xs text-gray-400 uppercase tracking-wide block">SKU</span>
                  <span className="font-semibold text-gray-800">{request.skuNumber}</span>
                  {request.skuTitle && <span className="text-xs text-gray-500 ml-1">{request.skuTitle}</span>}
                </div>
              )}
              {request.categoryName && (
                <div>
                  <span className="text-xs text-gray-400 uppercase tracking-wide block">Category</span>
                  <span className="font-semibold text-gray-800">{request.categoryName}</span>
                </div>
              )}
              <div>
                <span className="text-xs text-gray-400 uppercase tracking-wide block">Stage</span>
                <span className="font-semibold text-gray-800">
                  {request.step === 3 ? 'Production Validation' : 'Business Case & Development'}
                </span>
              </div>
              <div>
                <span className="text-xs text-gray-400 uppercase tracking-wide block">Requested on</span>
                <span className="font-semibold text-gray-800">{new Date(request.createdAt).toLocaleDateString()}</span>
              </div>
              {request.deadline && (
                <div>
                  <span className="text-xs text-gray-400 uppercase tracking-wide block">Due</span>
                  <span className={`font-semibold ${dueLabel?.tone ?? 'text-gray-800'}`}>
                    {new Date(request.deadline).toLocaleDateString()}
                    {dueLabel && <span className="text-xs font-medium ml-1">({dueLabel.text})</span>}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 pt-6">
        {/* This SKU was requested together with others. Offer to copy identical fields
            across the batch instead of making the supplier retype them on every SKU. */}
        {request?.status === 'pending' && pendingSiblings.length > 0 && (
          <div className="mb-6 bg-violet-50 border border-violet-200 rounded-xl p-4 text-sm text-violet-900">
            <div className="flex gap-3">
              <Layers size={18} className="shrink-0 mt-0.5 text-violet-600" />
              <div className="flex-1">
                <strong className="block mb-0.5">
                  Part of a batch of {pendingSiblings.length + 1} SKUs
                </strong>
                <p className="text-violet-800">
                  Requested together with {pendingSiblings.map(s => s.skuNumber).join(', ')}.
                  For any field that is the same across all of them, tick <strong>Same for all</strong> next
                  to it — we'll copy the value into the others when you submit, so you only type it once.
                  You'll still open each SKU to submit it, but the shared fields will already be filled in.
                </p>
                <div className="flex items-center gap-3 mt-3">
                  {sharedAttrIds.size < catAttrs.length && (
                    <button
                      type="button"
                      onClick={() => setSharedAttrIds(new Set(catAttrs.map(a => a.id)))}
                      className="text-xs font-medium text-violet-700 hover:text-violet-900 underline"
                    >
                      Mark all as same
                    </button>
                  )}
                  {sharedAttrIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setSharedAttrIds(new Set())}
                      className="text-xs font-medium text-violet-700 hover:text-violet-900 underline"
                    >
                      Clear all ({sharedAttrIds.size} marked)
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Values seeded from a sibling regional variant. Say so explicitly — otherwise
            the supplier cannot tell prefilled guesses from confirmed data for this SKU. */}
        {request?.status === 'pending' && request.copiedFromSku && (
          <div className="mb-6 bg-sky-50 border border-sky-200 rounded-xl p-4 text-sm text-sky-900 flex gap-3">
            <Copy size={18} className="shrink-0 mt-0.5 text-sky-600" />
            <div>
              <strong className="block mb-0.5">Copied from SKU {request.copiedFromSku}</strong>
              This is the same product for a different market, so the fields below start from the
              values you submitted for <strong>{request.copiedFromSku}</strong>. Please check each one
              and correct anything that differs for this market before submitting.
            </div>
          </div>
        )}

        {/* Validation banner: shown when this is a production-stage request pre-filled with prior data */}
        {request?.status === 'pending' && request.submittedData && request.submittedData.length > 0 && !request.note && !request.copiedFromSku && (
          <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 flex gap-3">
            <span className="text-lg leading-none">⚠️</span>
            <div>
              <strong className="block mb-0.5">Production Validation</strong>
              The fields below are pre-filled with data from a previous stage. Please review each value, update anything that has changed, and submit to confirm for production.
            </div>
          </div>
        )}
        {request?.note && (
          <div className="mb-6 bg-indigo-50 border border-indigo-200 rounded-xl p-4 text-sm text-indigo-800">
            <strong className="block mb-1">Message from Project Manager:</strong>
            {request.note}
          </div>
        )}

        {catAttrs.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-8 text-center text-gray-400">
            <p>No attributes defined for this category.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            {Object.entries(grouped).map(([group, attrs]) => (
              <div key={group} className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
                <div className="bg-light px-4 py-3 border-b border-gray-200">
                  <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wide">{group}</h2>
                </div>
                <div className="p-4 space-y-5">
                  {attrs.map(attr => (
                    <div key={attr.id} ref={el => { fieldRefs.current[attr.id] = el; }} className="scroll-mt-24">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <label className="block text-sm font-medium text-gray-700">
                          {attr.name}
                          {attr.validationRules?.required && <span className="text-rose-500 ml-1">*</span>}
                          {attr.validationRules?.unit && <span className="text-gray-400 ml-1 text-xs">({attr.validationRules.unit})</span>}
                        </label>
                        {pendingSiblings.length > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleShared(attr.id)}
                            title={`Copy this value to ${pendingSiblings.map(s => s.skuNumber).join(', ')} on submit`}
                            className={`shrink-0 flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                              sharedAttrIds.has(attr.id)
                                ? 'bg-violet-600 border-violet-600 text-white'
                                : 'bg-white border-gray-200 text-gray-400 hover:border-violet-300 hover:text-violet-600'
                            }`}
                          >
                            {sharedAttrIds.has(attr.id) ? <Check size={11} /> : <Layers size={11} />}
                            Same for all
                          </button>
                        )}
                      </div>
                      <AttributeInput
                        attribute={attr}
                        value={values[attr.id] || ''}
                        onChange={v => {
                          setValues(prev => ({ ...prev, [attr.id]: v }));
                          setErrors(prev => (prev[attr.id] ? { ...prev, [attr.id]: '' } : prev));
                        }}
                        mode={types[attr.id] || 'text'}
                        onModeChange={mode => {
                          setTypes(prev => ({ ...prev, [attr.id]: mode }));
                          setValues(prev => ({ ...prev, [attr.id]: '' }));
                        }}
                        disabled={attr.dataType === 'image' && lockedImageIds.has(attr.id)}
                        error={errors[attr.id]}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}

            <div className="sticky bottom-4 space-y-2">
              {errorCount > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const firstBadId = catAttrs.find(a => errors[a.id])?.id;
                    if (firstBadId) fieldRefs.current[firstBadId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm font-medium text-rose-700 shadow hover:bg-rose-100"
                >
                  <AlertTriangle size={16} />
                  {errorCount} field{errorCount === 1 ? '' : 's'} need{errorCount === 1 ? 's' : ''} attention — go to the first
                </button>
              )}
              <button
                type="submit"
                disabled={submitting}
                className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold shadow-lg hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2 text-base"
              >
                {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
                {submitting ? 'Submitting...' : 'Submit Attribute Data'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default SupplierAttributePortal;
