/** Token-based supplier portal for submitting requested project attribute values. */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getAttributeRequestByToken, submitAttributeRequest, getCategoryAttributes } from '../services';
import { ProjectAttributeRequest, CategoryAttribute } from '../types';
import { getAttributesForCategory, validateAttributeValue } from '../utils';
import AttributeInput from '../components/common/AttributeInput';
import { CheckCircle, Loader2, AlertTriangle, ClipboardList, Send } from 'lucide-react';

const SupplierAttributePortal: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  const [request, setRequest] = useState<ProjectAttributeRequest | null>(null);
  const [allAttributes, setAllAttributes] = useState<CategoryAttribute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [values, setValues] = useState<Record<string, string>>({});
  const [types, setTypes] = useState<Record<string, 'fixed' | 'range' | 'text'>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Image attributes that already have a value: a supplier may upload an image once,
  // but once set only a PM can replace it (locked read-only here).
  const [lockedImageIds, setLockedImageIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!token) { setError('Invalid link.'); setLoading(false); return; }
    (async () => {
      try {
        const [req, attrs] = await Promise.all([
          getAttributeRequestByToken(token),
          getCategoryAttributes()
        ]);
        if (!req) { setError('Request not found or link expired.'); return; }
        setRequest(req);
        setAllAttributes(attrs);

        if (req.status === 'submitted') { setSubmitted(true); return; }

        const catAttrs = getAttributesForCategory(attrs, req.categoryId ?? '');
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

  const catAttrs = request ? getAttributesForCategory(allAttributes, request.categoryId ?? '') : [];

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
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    setSubmitting(true);
    try {
      const payload = catAttrs
        .filter(a => values[a.id])
        .map(a => ({ attributeId: a.id, name: a.name, value: values[a.id], type: types[a.id] }));
      await submitAttributeRequest(token, payload);
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
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow p-8 max-w-md w-full text-center">
          <CheckCircle className="mx-auto text-emerald-500 mb-4" size={48} />
          <h2 className="text-2xl font-bold text-gray-800 mb-2">Data Submitted!</h2>
          <p className="text-gray-500 text-sm">Thank you. Your product attribute data has been sent to the project manager.</p>
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
            </div>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto p-4 pt-6">
        {/* Validation banner: shown when this is a production-stage request pre-filled with prior data */}
        {request?.status === 'pending' && request.submittedData && request.submittedData.length > 0 && !request.note && (
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
                    <div key={attr.id}>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        {attr.name}
                        {attr.validationRules?.required && <span className="text-rose-500 ml-1">*</span>}
                        {attr.validationRules?.unit && <span className="text-gray-400 ml-1 text-xs">({attr.validationRules.unit})</span>}
                      </label>
                      <AttributeInput
                        attribute={attr}
                        value={values[attr.id] || ''}
                        onChange={v => setValues(prev => ({ ...prev, [attr.id]: v }))}
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

            <div className="sticky bottom-4">
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
