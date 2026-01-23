
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { getRFQEntryByToken, submitRFQEntry } from '../../services/apiService';
import { RFQ, RFQEntry, RFQStatus, RFQEntryStatus } from '../../types';
import { ShoppingBag, CheckCircle, Loader2, AlertTriangle, Calendar, DollarSign, Package, Truck, Wrench, FileText, List, Upload, Paperclip } from 'lucide-react';

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
      supplierNotes: '',
      quoteFileUrl: ''
  });

  useEffect(() => {
    if (!token) { setError('Invalid link'); setLoading(false); return; }
    
    const load = async () => {
        try {
            const res = await getRFQEntryByToken(token);
            if (!res) { setError('RFQ not found or link expired'); }
            else {
                setRfq(res.rfq);
                setEntry(res.entry);
                if (res.entry.status === RFQEntryStatus.SUBMITTED || res.entry.status === RFQEntryStatus.AWARDED) {
                    setSuccess(true);
                }
            }
        } catch (e) {
            setError('Failed to load data');
        } finally {
            setLoading(false);
        }
    };
    load();
  }, [token]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          const reader = new FileReader();
          reader.onloadend = () => {
              setFormData(prev => ({ ...prev, quoteFileUrl: reader.result as string }));
          };
          reader.readAsDataURL(file);
      }
  };

  const handleSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!entry) return;
      setSubmitting(true);
      try {
          await submitRFQEntry(entry.id, {
              unitPrice: parseFloat(formData.unitPrice),
              moq: parseInt(formData.moq),
              leadTimeWeeks: parseInt(formData.leadTimeWeeks),
              toolingCost: formData.toolingCost ? parseFloat(formData.toolingCost) : 0,
              supplierNotes: formData.supplierNotes,
              quoteFileUrl: formData.quoteFileUrl
          });
          setSuccess(true);
      } catch (e) {
          alert("Failed to submit quote");
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
                  <h1 className="text-3xl font-bold text-primary mb-2">Quote Submitted</h2>
                  <p className="text-gray-600 mb-6">Thank you for your submission to <strong>{rfq.title}</strong>.</p>
                  <div className="bg-light p-4 rounded text-sm text-muted">
                      We will notify you if your quote is selected.
                  </div>
              </div>
          </div>
      );
  }

  return (
    <div className="min-h-screen bg-light py-10 px-4">
        <div className="max-w-3xl mx-auto">
            {/* Header */}
            <div className="bg-white rounded-xl shadow border border-gray-200 overflow-hidden mb-6">
                <div className="bg-indigo-600 px-6 py-4 flex items-center gap-3">
                    <ShoppingBag className="text-white" />
                    <div>
                        <h1 className="text-xl font-bold text-white">Request For Quotation</h1>
                        <p className="text-indigo-100 text-xs font-mono">{rfq.rfqId}</p>
                    </div>
                </div>
                <div className="p-6">
                    {rfq.thumbnailUrl && (
                        <div className="mb-6 flex justify-center bg-light rounded border border-gray-100 p-4">
                            <img src={rfq.thumbnailUrl} alt="Product Reference" className="max-h-64 max-w-full object-contain" />
                        </div>
                    )}

                    <h1 className="text-3xl font-bold text-primary mb-4">{rfq.title}</h2>
                    <div className="bg-light p-4 rounded border border-gray-100 text-sm text-gray-600 whitespace-pre-wrap leading-relaxed mb-4">
                        {rfq.description}
                    </div>
                    
                    {rfq.attachments && rfq.attachments.length > 0 && (
                        <div className="mb-6">
                            <h3 className="text-sm font-bold text-gray-800 mb-2 uppercase tracking-wide flex items-center gap-2">
                                <Paperclip size={14}/> Attachments
                            </h3>
                            <div className="flex flex-wrap gap-2">
                                {rfq.attachments.map((file, idx) => (
                                    <a key={idx} href={file.url} download={file.name} className="flex items-center gap-2 text-xs text-indigo-600 hover:underline bg-indigo-50 px-3 py-2 rounded border border-indigo-100 font-medium">
                                        <FileText size={12}/> {file.name}
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {rfq.attributes && rfq.attributes.length > 0 && (
                        <div className="mb-4">
                            <h3 className="text-sm font-bold text-gray-800 mb-2 uppercase tracking-wide flex items-center gap-2">
                                <List size={14}/> Technical Specifications
                            </h3>
                            <div className="bg-indigo-50 rounded-xl border border-indigo-100 p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {rfq.attributes.map((attr, idx) => (
                                    <div key={idx} className="flex flex-col">
                                        <span className="text-xs text-indigo-600 font-medium uppercase">{attr.name}</span>
                                        <span className="text-gray-800 font-semibold">
                                            {attr.value}
                                            {attr.type === 'range' && <span className="text-xs text-gray-400 font-normal ml-1">(Range)</span>}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex items-center gap-2 text-xs text-gray-400 mt-4 border-t border-gray-100 pt-4">
                        <Calendar size={14} /> Created: {new Date(rfq.createdAt).toLocaleDateString()}
                    </div>
                </div>
            </div>

            {/* Form */}
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 font-bold text-gray-700">
                    Submit Your Quote
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><DollarSign size={14}/> Unit Price (USD)</label>
                            <input 
                                required type="number" step="0.01" min="0" 
                                className="w-full border border-gray-300 rounded p-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="0.00"
                                value={formData.unitPrice}
                                onChange={e => setFormData({...formData, unitPrice: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><Package size={14}/> MOQ</label>
                            <input 
                                required type="number" min="1" 
                                className="w-full border border-gray-300 rounded p-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="e.g. 1000"
                                value={formData.moq}
                                onChange={e => setFormData({...formData, moq: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><Truck size={14}/> Lead Time (Weeks)</label>
                            <input 
                                required type="number" min="1" 
                                className="w-full border border-gray-300 rounded p-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="e.g. 4"
                                value={formData.leadTimeWeeks}
                                onChange={e => setFormData({...formData, leadTimeWeeks: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><Wrench size={14}/> Tooling Cost (USD)</label>
                            <input 
                                type="number" step="0.01" min="0" 
                                className="w-full border border-gray-300 rounded p-3 focus:ring-2 focus:ring-indigo-500 outline-none"
                                placeholder="0.00 (Optional)"
                                value={formData.toolingCost}
                                onChange={e => setFormData({...formData, toolingCost: e.target.value})}
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center gap-1"><FileText size={14}/> Notes / Conditions</label>
                        <textarea 
                            className="w-full border border-gray-300 rounded p-3 focus:ring-2 focus:ring-indigo-500 outline-none h-24"
                            placeholder="Payment terms, validity, inclusions..."
                            value={formData.supplierNotes}
                            onChange={e => setFormData({...formData, supplierNotes: e.target.value})}
                        />
                    </div>

                    <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100">
                        <label className="block text-sm font-bold text-gray-700 mb-2 flex items-center gap-2">
                            <Upload size={16} /> Official Quote File
                        </label>
                        <input 
                            type="file" 
                            className="w-full text-sm text-muted file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-100 file:text-indigo-700 hover:file:bg-indigo-200"
                            onChange={handleFileUpload}
                        />
                        <p className="text-xs text-muted mt-1">Upload PDF or Excel version of your quote.</p>
                    </div>

                    <div className="pt-4">
                        <button 
                            type="submit" 
                            disabled={submitting}
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
