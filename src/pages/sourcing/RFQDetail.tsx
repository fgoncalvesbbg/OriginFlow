/** RFQ detail page: view entries/quotes and award the RFQ. */
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import { getRFQById, awardRFQ, deleteRFQ } from '../../services';
import { RFQ, RFQEntry, RFQEntryStatus, RFQStatus, UserRole } from '../../types';
import { ArrowLeft, Link as LinkIcon, Award, CheckCircle, DollarSign, Package, Truck, Wrench, Plus, Copy, List, Paperclip, FileText, Download, Trash2, Eye, X, Sliders } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useRefetchOnFocus } from '../../hooks';

const ConfirmationModal: React.FC<{
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ isOpen, title, message, onConfirm, onCancel }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-primary mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-rose-600 text-white hover:bg-red-700 rounded text-sm font-medium">Delete RFQ</button>
        </div>
      </div>
    </div>
  );
};

const RFQDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [rfq, setRfq] = useState<RFQ | null>(null);
  const [loading, setLoading] = useState(true);
  const [awarding, setAwarding] = useState(false);
  const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [drawerEntry, setDrawerEntry] = useState<RFQEntry | null>(null);

  useEffect(() => {
    if (id) loadData();
  }, [id]);

  const loadData = async () => {
    setLoading(true);
    try {
      const data = await getRFQById(id!);
      if (data) setRfq(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useRefetchOnFocus(() => { if (id) loadData(); });

  const handleCopyLink = (entry: RFQEntry) => {
      const url = `${window.location.origin}/#/sourcing/supplier/${entry.token}`;
      navigator.clipboard.writeText(url);
      setCopiedEntryId(entry.id);
      setTimeout(() => setCopiedEntryId(null), 2000);
  };

  const handleAward = async (entry: RFQEntry) => {
      if (!confirm(`Are you sure you want to award this project to ${entry.supplierName}? This will close the RFQ.`)) return;
      setAwarding(true);
      try {
          await awardRFQ(rfq!.id, entry.id);
          await loadData();
          
          // Offer to create project
          if (confirm(`RFQ Awarded to ${entry.supplierName}. Create a new Project now?`)) {
              navigate(`/create?supplierId=${entry.supplierId}&name=${encodeURIComponent(rfq!.title)}`);
          }
      } catch (e: any) {
          alert("Error awarding: " + e.message);
      } finally {
          setAwarding(false);
      }
  };

  const handleDeleteRFQ = async () => {
    if (!rfq) return;
    try {
        await deleteRFQ(rfq.id);
        navigate('/sourcing');
    } catch (e: any) {
        alert(`Failed to delete RFQ: ${e.message}`);
    }
  };

  if (loading || !rfq) return <Layout><div>Loading...</div></Layout>;

  const isClosed = rfq.status !== RFQStatus.OPEN;

  // Find best prices for highlighting
  const validEntries = rfq.entries?.filter(e => e.status === RFQEntryStatus.SUBMITTED || e.status === RFQEntryStatus.AWARDED) || [];
  const minPrice = validEntries.length > 0 ? Math.min(...validEntries.map(e => e.unitPrice || Infinity)) : 0;
  const minLeadTime = validEntries.length > 0 ? Math.min(...validEntries.map(e => e.leadTimeWeeks || Infinity)) : 0;

  const canDelete = user?.role === UserRole.ADMIN || user?.role === UserRole.PM;

  return (
    <Layout>
      <ConfirmationModal 
        isOpen={isDeleteModalOpen}
        title="Delete RFQ?"
        message={`Are you sure you want to permanently delete this RFQ? All quotes and technical specs associated with it will be removed. This action cannot be undone.`}
        onConfirm={handleDeleteRFQ}
        onCancel={() => setIsDeleteModalOpen(false)}
      />

      <div className="flex justify-between items-start mb-6">
         <div className="flex items-center gap-3">
            <button onClick={() => navigate('/sourcing')} className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></button>
            <div>
                <div className="flex items-center gap-3 mb-1">
                    <h1 className="text-3xl font-bold text-primary">{rfq.title}</h1>
                    <span className={`text-xs px-2 py-1 rounded font-bold uppercase ${rfq.status === RFQStatus.OPEN ? 'bg-indigo-100 text-indigo-700' : rfq.status === RFQStatus.AWARDED ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                        {rfq.status}
                    </span>
                </div>
                <div className="text-sm text-muted font-mono">{rfq.rfqId} {rfq.categoryName && `• ${rfq.categoryName}`}</div>
            </div>
         </div>
         <div className="flex gap-2">
            {canDelete && (
                <button 
                    onClick={() => setIsDeleteModalOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 border border-rose-200 text-rose-600 bg-white rounded-xl text-sm font-medium hover:bg-rose-50 transition-colors shadow"
                >
                    <Trash2 size={16} /> Delete RFQ
                </button>
            )}
         </div>
      </div>

      {/* Supplier submission drawer */}
      {drawerEntry && (
          <div className="fixed inset-0 z-50 flex justify-end">
              {/* Backdrop */}
              <div className="absolute inset-0 bg-black/30" onClick={() => setDrawerEntry(null)} />
              {/* Panel */}
              <div className="relative w-full max-w-md bg-white shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200">
                  {/* Header */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-indigo-600">
                      <div>
                          <h2 className="text-lg font-bold text-white">{drawerEntry.supplierName}</h2>
                          <p className="text-indigo-200 text-xs capitalize">{drawerEntry.status} submission</p>
                      </div>
                      <button onClick={() => setDrawerEntry(null)} className="text-indigo-200 hover:text-white p-1 rounded">
                          <X size={20} />
                      </button>
                  </div>

                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                      {/* Pricing */}
                      <div>
                          <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-2">
                              <DollarSign size={13} /> Pricing & Logistics
                          </h3>
                          <div className="grid grid-cols-2 gap-3">
                              {[
                                  { label: 'Unit Price', value: drawerEntry.unitPrice != null ? `${drawerEntry.currency ?? 'USD'} ${drawerEntry.unitPrice}` : null },
                                  { label: 'MOQ', value: drawerEntry.moq != null ? `${drawerEntry.moq} units` : null },
                                  { label: 'Lead Time', value: drawerEntry.leadTimeWeeks != null ? `${drawerEntry.leadTimeWeeks} weeks` : null },
                                  { label: 'Tooling Cost', value: drawerEntry.toolingCost != null && drawerEntry.toolingCost > 0 ? `${drawerEntry.currency ?? 'USD'} ${drawerEntry.toolingCost}` : null },
                              ].map(({ label, value }) => (
                                  <div key={label} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                                      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                                      <p className="text-sm font-semibold text-gray-800">{value ?? '—'}</p>
                                  </div>
                              ))}
                          </div>
                      </div>

                      {/* Proposed Specifications */}
                      {drawerEntry.attributeResponses && drawerEntry.attributeResponses.length > 0 && (
                          <div>
                              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-2">
                                  <Sliders size={13} /> Proposed Specifications
                              </h3>
                              <div className="space-y-2">
                                  {drawerEntry.attributeResponses.map((resp, idx) => {
                                      // Find the matching RFQ attribute to show the requirement alongside
                                      const rfqAttr = rfq?.attributes.find(a => a.attributeId === resp.attributeId);
                                      return (
                                          <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-100">
                                              <p className="text-xs text-gray-400 mb-1">{resp.name}</p>
                                              <div className="flex items-center justify-between gap-2 flex-wrap">
                                                  <span className="text-sm font-semibold text-indigo-700">{resp.proposedValue}</span>
                                                  {rfqAttr && (
                                                      <span className="text-xs text-gray-400">
                                                          {rfqAttr.type === 'range'
                                                              ? `Req: ${rfqAttr.value.replace('-', ' – ')}`
                                                              : rfqAttr.type === 'multi-select' && rfqAttr.values?.length
                                                              ? `Options: ${rfqAttr.values.join(', ')}`
                                                              : `Req: ${rfqAttr.value}`}
                                                      </span>
                                                  )}
                                              </div>
                                          </div>
                                      );
                                  })}
                              </div>
                          </div>
                      )}

                      {/* Notes */}
                      {drawerEntry.supplierNotes && (
                          <div>
                              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-2">
                                  <FileText size={13} /> Notes / Conditions
                              </h3>
                              <div className="bg-gray-50 rounded-lg p-3 border border-gray-100 text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                                  {drawerEntry.supplierNotes}
                              </div>
                          </div>
                      )}

                      {/* Quote File */}
                      {drawerEntry.quoteFileUrl && (
                          <div>
                              <h3 className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-3 flex items-center gap-2">
                                  <Paperclip size={13} /> Quote File
                              </h3>
                              <a
                                  href={drawerEntry.quoteFileUrl}
                                  download={`Quote_${drawerEntry.supplierName}`}
                                  className="flex items-center gap-2 text-sm text-indigo-600 hover:underline bg-indigo-50 p-3 rounded-lg border border-indigo-100 font-medium"
                              >
                                  <Download size={14} /> Download quote file
                              </a>
                          </div>
                      )}

                      {drawerEntry.status === RFQEntryStatus.PENDING && (
                          <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 text-sm text-amber-700">
                              This supplier has not submitted their quote yet.
                          </div>
                      )}
                  </div>

                  {/* Footer — Award button */}
                  {!isClosed && drawerEntry.status === RFQEntryStatus.SUBMITTED && (
                      <div className="px-6 py-4 border-t border-gray-200">
                          <button
                              onClick={() => { handleAward(drawerEntry); setDrawerEntry(null); }}
                              disabled={awarding}
                              className="w-full bg-emerald-600 text-white py-2.5 rounded-xl font-bold hover:bg-emerald-700 flex items-center justify-center gap-2 shadow"
                          >
                              <Award size={16} /> Award to {drawerEntry.supplierName}
                          </button>
                      </div>
                  )}
              </div>
          </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Specs Panel */}
          <div className="lg:col-span-1 space-y-6">
              {rfq.thumbnailUrl && (
                  <div className="bg-white p-4 rounded-xl border border-gray-200 shadow flex justify-center">
                      <img src={rfq.thumbnailUrl} alt="Product Reference" className="max-h-64 max-w-full object-contain rounded" />
                  </div>
              )}

              <div className="bg-white p-6 rounded-xl border border-gray-200 shadow">
                  <h3 className="font-bold text-gray-800 mb-4 text-sm uppercase tracking-wide">Description</h3>
                  <div className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap bg-light p-4 rounded border border-gray-100 max-h-60 overflow-y-auto">
                      {rfq.description}
                  </div>
              </div>

              {rfq.attachments && rfq.attachments.length > 0 && (
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow">
                      <h3 className="font-bold text-gray-800 mb-4 text-sm uppercase tracking-wide flex items-center gap-2">
                          <Paperclip size={16}/> Attachments
                      </h3>
                      <div className="space-y-2">
                          {rfq.attachments.map((file, idx) => (
                              <a key={idx} href={file.url} download={file.name} className="flex items-center gap-2 text-sm text-indigo-600 hover:underline bg-indigo-50 p-2 rounded border border-indigo-100">
                                  <FileText size={14}/> {file.name}
                              </a>
                          ))}
                      </div>
                  </div>
              )}

              {rfq.attributes && rfq.attributes.length > 0 && (
                  <div className="bg-white p-6 rounded-xl border border-gray-200 shadow">
                      <h3 className="font-bold text-gray-800 mb-4 text-sm uppercase tracking-wide flex items-center gap-2">
                          <List size={16}/> Technical Specs
                      </h3>
                      <div className="space-y-3">
                          {rfq.attributes.map((attr, idx) => (
                              <div key={idx} className="flex justify-between items-start text-sm border-b border-slate-50 pb-2 last:border-0 flex-wrap gap-2">
                                  <span className="text-muted shrink-0">{attr.name}</span>
                                  {attr.type === 'multi-select' && attr.values?.length ? (
                                      <div className="flex flex-wrap gap-1 justify-end">
                                          {attr.values.map(v => (
                                              <span key={v} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium border border-indigo-200">{v}</span>
                                          ))}
                                      </div>
                                  ) : attr.type === 'range' ? (
                                      <span className="font-medium text-gray-800">
                                          {attr.value.replace('-', ' – ')}
                                          <span className="text-xs text-gray-400 font-normal ml-1">(range)</span>
                                      </span>
                                  ) : (
                                      <span className="font-medium text-gray-800">{attr.value}</span>
                                  )}
                              </div>
                          ))}
                      </div>
                  </div>
              )}
          </div>

          {/* Comparison Table */}
          <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 shadow overflow-hidden h-fit">
              <div className="px-6 py-4 bg-light border-b border-gray-200 font-bold text-gray-700">
                  Quote Comparison
              </div>
              <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                      <thead className="bg-white text-muted border-b border-gray-100">
                          <tr>
                              <th className="px-4 py-3">Supplier</th>
                              <th className="px-4 py-3">Status</th>
                              <th className="px-4 py-3 text-right">Unit Price</th>
                              <th className="px-4 py-3 text-right">MOQ</th>
                              <th className="px-4 py-3 text-right">Lead Time</th>
                              <th className="px-4 py-3 text-right">Quote File</th>
                              <th className="px-4 py-3"></th>
                          </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                          {rfq.entries?.map(entry => {
                              const isBestPrice = entry.unitPrice === minPrice && entry.status === RFQEntryStatus.SUBMITTED;
                              const isBestTime = entry.leadTimeWeeks === minLeadTime && entry.status === RFQEntryStatus.SUBMITTED;
                              const isWinner = entry.status === RFQEntryStatus.AWARDED;

                              return (
                                  <tr key={entry.id} className={`group ${isWinner ? 'bg-emerald-50/50' : 'hover:bg-light'}`}>
                                      <td className="px-4 py-3 font-medium text-primary">
                                          {entry.supplierName}
                                          {isWinner && <span className="ml-2 text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">WINNER</span>}
                                      </td>
                                      <td className="px-4 py-3">
                                          {entry.status === RFQEntryStatus.PENDING ? (
                                              <div className="flex items-center gap-2">
                                                  <span className="text-gray-400 italic">Pending</span>
                                                  <button onClick={() => handleCopyLink(entry)} className="text-indigo-600 hover:bg-indigo-50 p-1 rounded" title="Copy Link">
                                                      {copiedEntryId === entry.id ? <CheckCircle size={14} /> : <LinkIcon size={14} />}
                                                  </button>
                                              </div>
                                          ) : (
                                              <span className="text-gray-700 font-medium capitalize">{entry.status}</span>
                                          )}
                                      </td>
                                      <td className="px-4 py-3 text-right">
                                          {entry.unitPrice ? (
                                              <div className={isBestPrice ? 'text-emerald-600 font-bold' : ''}>
                                                  {entry.currency} {entry.unitPrice}
                                              </div>
                                          ) : '-'}
                                      </td>
                                      <td className="px-4 py-3 text-right">{entry.moq || '-'}</td>
                                      <td className="px-4 py-3 text-right">
                                          {entry.leadTimeWeeks ? (
                                              <div className={isBestTime ? 'text-emerald-600 font-bold' : ''}>
                                                  {entry.leadTimeWeeks} wks
                                              </div>
                                          ) : '-'}
                                      </td>
                                      <td className="px-4 py-3 text-right">
                                          {entry.quoteFileUrl ? (
                                              <a href={entry.quoteFileUrl} download={`Quote_${entry.supplierName}`} className="text-indigo-600 hover:text-blue-800 inline-flex items-center gap-1">
                                                  <Download size={14} />
                                              </a>
                                          ) : '-'}
                                      </td>
                                      <td className="px-4 py-3 text-right">
                                          <div className="flex items-center justify-end gap-2">
                                              <button
                                                  onClick={() => setDrawerEntry(entry)}
                                                  className="text-gray-400 hover:text-indigo-600 p-1 rounded hover:bg-indigo-50 transition-colors"
                                                  title="View submission details"
                                              >
                                                  <Eye size={15} />
                                              </button>
                                              {!isClosed && entry.status === RFQEntryStatus.SUBMITTED && (
                                                  <button
                                                    onClick={() => handleAward(entry)}
                                                    disabled={awarding}
                                                    className="bg-emerald-600 text-white px-3 py-1 rounded text-xs font-bold hover:bg-green-700 shadow flex items-center gap-1"
                                                  >
                                                      <Award size={12} /> Award
                                                  </button>
                                              )}
                                          </div>
                                      </td>
                                  </tr>
                              );
                          })}
                      </tbody>
                  </table>
              </div>
          </div>
      </div>
    </Layout>
  );
};

export default RFQDetail;