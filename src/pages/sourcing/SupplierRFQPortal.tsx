
/** Token-based supplier portal for submitting a quote in response to an RFQ. */
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getRFQEntryByToken, submitRFQEntry } from '../../services';
import { uploadIMAsset } from '../../services/im/im-asset.service';
import { RFQ, RFQEntry, RFQEntryStatus, RFQAttributeResponse, RFQAttachment } from '../../types';
import { ShoppingBag, CheckCircle, Loader2, AlertTriangle, Calendar, DollarSign, Package, Truck, Wrench, FileText, Upload, Paperclip, Sliders, X, Tag } from 'lucide-react';
import RFQAttributeComparison from '../../components/sourcing/RFQAttributeComparison';

const SupplierRFQPortal: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [rfq, setRfq] = useState<RFQ | null>(null);
  const [entry, setEntry] = useState<RFQEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  // Form
  const [formData, setFormData] = useState({
      unitPrice: '',
      moq: '',
      leadTimeWeeks: '',
      toolingCost: '',
      currency: 'USD',
      supplierNotes: ''
  });

  // Per-attribute responses: keyed by attributeId
  const [attrResponses, setAttrResponses] = useState<Record<string, string>>({});

  // Quote documents (multiple allowed)
  const [attachments, setAttachments] = useState<RFQAttachment[]>([]);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [linkInput, setLinkInput] = useState('');

  useEffect(() => {
    if (!token) { setError('Invalid link'); setLoading(false); return; }

    let mounted = true;
    const controller = new AbortController();

    const load = async () => {
        try {
            const res = await getRFQEntryByToken(token);

            if (!mounted || controller.signal.aborted) return;

            if (!res) {
              setError('RFQ not found or link expired');
            }
            else {
                setRfq(res.rfq);
                setEntry(res.entry);
                if (res.entry.status === RFQEntryStatus.SUBMITTED || res.entry.status === RFQEntryStatus.AWARDED) {
                    setSuccess(true);
                }
                // Prefill from any previously saved values.
                const init: Record<string, string> = {};
                (res.entry.attributeResponses ?? []).forEach(r => { init[r.attributeId] = r.proposedValue; });
                setAttrResponses(init);
                const existing = res.entry.attachments?.length
                    ? res.entry.attachments
                    : (res.entry.quoteFileUrl ? [{ name: 'Quote document', url: res.entry.quoteFileUrl, type: '' }] : []);
                setAttachments(existing);
                setFormData(prev => ({
                    ...prev,
                    unitPrice: res.entry.unitPrice != null ? String(res.entry.unitPrice) : '',
                    moq: res.entry.moq != null ? String(res.entry.moq) : '',
                    leadTimeWeeks: res.entry.leadTimeWeeks != null ? String(res.entry.leadTimeWeeks) : '',
                    toolingCost: res.entry.toolingCost != null ? String(res.entry.toolingCost) : '',
                    currency: res.entry.currency ?? 'USD',
                    supplierNotes: res.entry.supplierNotes ?? ''
                }));
            }
        } catch (e: any) {
            if (!mounted || controller.signal.aborted) return;
            if (e.name === 'AbortError') {
              console.debug('RFQ portal load cancelled');
              return;
            }
            console.error('RFQ portal load error:', e);
            setError('Failed to load data');
        } finally {
            if (mounted && !controller.signal.aborted) {
              setLoading(false);
            }
        }
    };
    load();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [token]);

  // Upload one or more quote documents to storage and append them to the attachment list.
  const handleFilesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? []);
      e.target.value = ''; // allow re-selecting the same file(s)
      if (!files.length) return;
      setUploadingFile(true);
      try {
          const uploaded: RFQAttachment[] = [];
          for (const file of files) {
              const url = await uploadIMAsset(file, 'rfq-quotes');
              uploaded.push({ name: file.name, url, type: file.type || file.name.split('.').pop() || '' });
          }
          setAttachments(prev => [...prev, ...uploaded]);
      } catch (err: any) {
          console.error('Quote file upload failed:', err);
          alert('One or more files failed to upload. Please try again.');
      } finally {
          setUploadingFile(false);
      }
  };

  const addLink = () => {
      const url = linkInput.trim();
      if (!url) return;
      setAttachments(prev => [...prev, { name: url.split('/').pop() || url, url, type: 'link' }]);
      setLinkInput('');
  };

  const removeAttachment = (idx: number) => {
      setAttachments(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!entry) return;
      setSubmitting(true);
      try {
          // Build attribute responses from per-attribute inputs
          const attributeResponses: RFQAttributeResponse[] = (rfq?.attributes ?? [])
              .map(attr => ({
                  attributeId: attr.attributeId,
                  name: attr.name,
                  proposedValue: attrResponses[attr.attributeId] ?? ''
              }))
              .filter(r => r.proposedValue !== '');

          await submitRFQEntry(token!, {
              unitPrice: parseFloat(formData.unitPrice),
              moq: formData.moq ? parseInt(formData.moq) : undefined,
              leadTimeWeeks: formData.leadTimeWeeks ? parseInt(formData.leadTimeWeeks) : undefined,
              toolingCost: formData.toolingCost ? parseFloat(formData.toolingCost) : undefined,
              currency: formData.currency,
              supplierNotes: formData.supplierNotes,
              attachments,
              quoteFileUrl: attachments[0]?.url ?? '', // legacy single-file fallback
              attributeResponses
          });
          setSuccess(true);
      } catch (e: any) {
          if (e.name === 'AbortError') {
            console.debug('Quote submission cancelled');
            return;
          }
          console.error('Quote submission error:', e);
          alert("Failed to submit quote. Please try again.");
      } finally {
          setSubmitting(false);
      }
  };

  if (loading) return <div className="min-h-screen bg-light flex items-center justify-center"><Loader2 className="animate-spin text-gray-400" /></div>;
  if (error) return <div className="min-h-screen bg-light flex items-center justify-center text-red-500 font-medium">{error}</div>;

  if (!rfq || !entry) {
      return (
          <div className="min-h-screen bg-light flex items-center justify-center text-muted">
              <div className="text-center">
                  <AlertTriangle size={48} className="mx-auto mb-4 text-gray-300" />
                  <h3 className="text-lg font-bold text-gray-700">Portal Unavailable</h3>
                  <p>The RFQ link may be invalid or expired.</p>
              </div>
          </div>
      );
  }

  if (success) {
      return (
          <div className="min-h-screen bg-light flex items-center justify-center p-4">
              <div className="bg-white p-8 rounded-xl shadow max-w-md w-full text-center">
                  <CheckCircle className="w-16 h-16 text-emerald-500 mx-auto mb-4" />
                  <h1 className="text-3xl font-bold text-primary mb-2">Quote Submitted</h1>
                  <p className="text-gray-600 mb-6">Thank you for your submission to <strong>{rfq.title}</strong>.</p>
                  <div className="bg-light p-4 rounded text-sm text-muted">
                      We will notify you if your quote is selected.
                  </div>
              </div>
          </div>
      );
  }

  const inputClass = 'w-full border border-gray-300 rounded p-3 focus:ring-2 focus:ring-indigo-500 outline-none';

  return (
    <div className="min-h-screen bg-light py-10 px-4">
        <div className="max-w-4xl mx-auto space-y-6">

            {/* 1. Header — RFQ identity */}
            <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden">
                <div className="bg-indigo-600 px-6 py-4 flex items-center gap-3">
                    <ShoppingBag className="text-white shrink-0" />
                    <div>
                        <h1 className="text-lg font-bold text-white">Request For Quotation</h1>
                        <p className="text-indigo-100 text-xs font-mono">{rfq.rfqId}</p>
                    </div>
                </div>
                <div className="p-6">
                    <h2 className="text-2xl sm:text-3xl font-bold text-primary">{rfq.title}</h2>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-xs text-gray-500">
                        {rfq.categoryName && (
                            <span className="inline-flex items-center gap-1 bg-indigo-50 text-indigo-700 px-2 py-1 rounded font-medium">
                                <Tag size={12} /> {rfq.categoryName}
                            </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                            <Calendar size={13} /> Created {new Date(rfq.createdAt).toLocaleDateString()}
                        </span>
                    </div>
                </div>
            </div>

            {/* 2. Description */}
            {rfq.description && (
                <div className="bg-white rounded-xl shadow border border-gray-200 p-6">
                    <h3 className="text-sm font-bold text-gray-800 mb-3 uppercase tracking-wide flex items-center gap-2">
                        <FileText size={14} /> Description
                    </h3>
                    <div className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">
                        {rfq.description}
                    </div>

                    {/* PM reference attachments */}
                    {rfq.attachments && rfq.attachments.length > 0 && (
                        <div className="mt-5 pt-5 border-t border-gray-100">
                            <h4 className="text-xs font-bold text-gray-800 mb-2 uppercase tracking-wide flex items-center gap-2">
                                <Paperclip size={13} /> Reference Documents
                            </h4>
                            <div className="flex flex-wrap gap-2">
                                {rfq.attachments.map((file, idx) => (
                                    <a key={idx} href={file.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs text-indigo-600 hover:underline bg-indigo-50 px-3 py-2 rounded border border-indigo-100 font-medium">
                                        <FileText size={12} /> {file.name}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* 3. Image */}
            {rfq.thumbnailUrl && (
                <div className="bg-white rounded-xl shadow border border-gray-200 p-6">
                    <h3 className="text-sm font-bold text-gray-800 mb-3 uppercase tracking-wide flex items-center gap-2">
                        <ShoppingBag size={14} /> Product Reference
                    </h3>
                    <div className="flex justify-center bg-light rounded border border-gray-100 p-4">
                        <img src={rfq.thumbnailUrl} alt="Product Reference" className="max-h-80 max-w-full object-contain" />
                    </div>
                </div>
            )}

            {/* 4. Attributes — buyer requirement vs. supplier's proposed value */}
            {rfq.attributes && rfq.attributes.length > 0 && (
                <div className="bg-white rounded-xl shadow border border-gray-200 p-6">
                    <RFQAttributeComparison
                        attributes={rfq.attributes}
                        responses={attrResponses}
                        onChange={(id, v) => setAttrResponses(prev => ({ ...prev, [id]: v }))}
                    />
                </div>
            )}

            {/* 5. Supplier quote information */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 font-bold text-gray-700 flex items-center gap-2">
                    <Sliders size={16} /> Your Quote
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><DollarSign size={14}/> Unit Price</label>
                            <div className="flex gap-2">
                                <select
                                    value={formData.currency}
                                    onChange={e => setFormData({ ...formData, currency: e.target.value })}
                                    className="border border-gray-300 rounded p-3 focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                >
                                    <option value="USD">USD</option>
                                    <option value="EUR">EUR</option>
                                    <option value="GBP">GBP</option>
                                    <option value="CNY">CNY</option>
                                </select>
                                <input
                                    required type="number" step="0.01" min="0"
                                    className={`flex-1 ${inputClass}`}
                                    placeholder="0.00"
                                    value={formData.unitPrice}
                                    onChange={e => setFormData({ ...formData, unitPrice: e.target.value })}
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><Package size={14}/> MOQ</label>
                            <input
                                type="number" min="1"
                                className={inputClass}
                                placeholder="e.g. 1000"
                                value={formData.moq}
                                onChange={e => setFormData({ ...formData, moq: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><Truck size={14}/> Lead Time (Weeks)</label>
                            <input
                                type="number" min="1"
                                className={inputClass}
                                placeholder="e.g. 4"
                                value={formData.leadTimeWeeks}
                                onChange={e => setFormData({ ...formData, leadTimeWeeks: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><Wrench size={14}/> Tooling Cost</label>
                            <input
                                type="number" step="0.01" min="0"
                                className={inputClass}
                                placeholder="0.00 (Optional)"
                                value={formData.toolingCost}
                                onChange={e => setFormData({ ...formData, toolingCost: e.target.value })}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><FileText size={14}/> Notes / Conditions</label>
                        <textarea
                            className={`${inputClass} h-24`}
                            placeholder="Payment terms, validity, inclusions..."
                            value={formData.supplierNotes}
                            onChange={e => setFormData({ ...formData, supplierNotes: e.target.value })}
                        />
                    </div>

                    {/* Quote documents (multiple) */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2 flex items-center gap-1"><Upload size={14}/> Quote Documents</label>
                        <div className="border border-gray-300 rounded-lg p-3 space-y-3">
                            {attachments.length > 0 && (
                                <div className="space-y-2">
                                    {attachments.map((att, idx) => (
                                        <div key={idx} className="flex items-center justify-between gap-3 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                                            <a
                                                href={att.url}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="flex items-center gap-2 text-sm font-medium text-green-700 hover:underline min-w-0"
                                            >
                                                <FileText size={16} className="flex-shrink-0" />
                                                <span className="truncate">{att.name}</span>
                                            </a>
                                            <button
                                                type="button"
                                                onClick={() => removeAttachment(idx)}
                                                className="text-gray-400 hover:text-red-500 flex-shrink-0"
                                                aria-label="Remove document"
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <label className={`flex items-center justify-center gap-2 px-3 py-3 border-2 border-dashed rounded-lg cursor-pointer transition text-sm font-medium ${uploadingFile ? 'border-gray-200 text-gray-400' : 'border-indigo-300 text-indigo-700 hover:bg-indigo-50'}`}>
                                <input
                                    type="file"
                                    multiple
                                    className="hidden"
                                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.png,.jpg,.jpeg"
                                    onChange={handleFilesUpload}
                                    disabled={uploadingFile}
                                />
                                {uploadingFile ? (
                                    <>
                                        <Loader2 size={16} className="animate-spin" /> Uploading…
                                    </>
                                ) : (
                                    <>
                                        <Upload size={16} /> {attachments.length > 0 ? 'Add more documents' : 'Upload quote documents'}
                                    </>
                                )}
                            </label>

                            <div className="flex items-center gap-2">
                                <span className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">or link</span>
                                <input
                                    type="url"
                                    value={linkInput}
                                    onChange={e => setLinkInput(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLink(); } }}
                                    placeholder="https://example.com/quote.pdf"
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                                <button
                                    type="button"
                                    onClick={addLink}
                                    disabled={!linkInput.trim()}
                                    className="px-3 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                                >
                                    Add
                                </button>
                            </div>
                            <p className="text-xs text-muted">Upload one or more PDF/Excel documents, or add links.</p>
                        </div>
                    </div>

                    <div className="pt-2">
                        <button
                            type="submit"
                            disabled={submitting || uploadingFile}
                            className="w-full bg-indigo-600 text-white font-bold py-4 rounded-xl hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 disabled:opacity-70"
                        >
                            {submitting ? <Loader2 className="animate-spin" /> : 'Submit Quote'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>
  );
};

export default SupplierRFQPortal;
