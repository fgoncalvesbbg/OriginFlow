
import React, { useEffect, useState } from 'react';
import Layout from '../../components/Layout';
import { 
  getCategories, getProductFeatures, getComplianceRequirements, 
  saveRequirement, deleteRequirement, addStandardRequirements,
  COMPLIANCE_SECTIONS
} from '../../services/apiService';
import { CategoryL3, ProductFeature, ComplianceRequirement } from '../../types';
// Added comment above fix: Adding missing X icon to lucide-react imports
import { Plus, Edit2, Trash2, ArrowLeft, CheckCircle, Sparkles, Loader2, RefreshCw, Folder, FolderOpen, Clock, Building, FileCheck, X } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
};

const ConfirmationModal: React.FC<{
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  isAlert?: boolean;
}> = ({ isOpen, title, message, onConfirm, onCancel, isAlert }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-primary mb-2">{title}</h3>
        <p className="text-sm text-gray-600 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          {!isAlert && (
            <button onClick={onCancel} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm">Cancel</button>
          )}
          <button onClick={onConfirm} className="px-4 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded text-sm font-medium">
            {isAlert ? 'OK' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ComplianceLibrary: React.FC = () => {
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [features, setFeatures] = useState<ProductFeature[]>([]);
  const [requirements, setRequirements] = useState<ComplianceRequirement[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedCategoryForReqs, setSelectedCategoryForReqs] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(COMPLIANCE_SECTIONS));
  
  const [editingItem, setEditingItem] = useState<any>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const [isAiModalOpen, setIsAiModalOpen] = useState(false);
  const [aiProductDesc, setAiProductDesc] = useState('');
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Partial<ComplianceRequirement>[]>([]);
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set());

  const [newSectionName, setNewSectionName] = useState('');

  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    isAlert?: boolean;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [c, f, r] = await Promise.all([
        getCategories(), getProductFeatures(), getComplianceRequirements()
      ]);
      setCategories(c);
      setFeatures(f);
      setRequirements(r);
    } catch (error) {
      console.error("Failed to load library data", error);
    } finally {
      setLoading(false);
    }
  };

  const showAlert = (title: string, message: string) => {
    setModalState({
      isOpen: true,
      title,
      message,
      isAlert: true,
      onConfirm: () => setModalState(prev => ({ ...prev, isOpen: false }))
    });
  };

  const showConfirm = (title: string, message: string, onConfirmAction: () => Promise<void> | void) => {
    setModalState({
      isOpen: true,
      title,
      message,
      isAlert: false,
      onConfirm: async () => {
        await onConfirmAction();
        setModalState(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const handleSaveRequirement = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
        const item = editingItem as ComplianceRequirement;
        const catId = item.categoryId || selectedCategoryForReqs;
        
        if (!catId) throw new Error("Category ID is missing.");
        
        await saveRequirement({ 
            ...item, 
            categoryId: catId, 
            id: item.id || generateUUID() 
        });
        setIsModalOpen(false);
        loadData();
    } catch (err: any) {
        console.error(err);
        showAlert('Error', `Error saving: ${err.message}`);
    }
  };

  const handleDeleteRequirement = (id: string) => {
    showConfirm('Delete Requirement', 'Are you sure you want to delete this requirement?', async () => {
      try {
        await deleteRequirement(id);
        loadData();
      } catch (e: any) {
        console.error(e);
        showAlert('Error', `Failed to delete: ${e.message}`);
      }
    });
  };

  const openAddModal = (sectionName?: string) => {
    const catId = selectedCategoryForReqs || categories[0]?.id;
    if (!catId) { showAlert("Notice", "No category selected"); return; }
    setEditingItem({ 
      categoryId: catId, 
      section: sectionName || '',
      title: '', 
      description: '', 
      isMandatory: true, 
      appliesByDefault: true, 
      conditionFeatureIds: [],
      timingType: 'ETD',
      timingWeeks: 0,
      testReportOrigin: 'third_party_mandatory',
      selfDeclarationAccepted: false
    });
    setNewSectionName(sectionName || '');
    setIsModalOpen(true);
  };

  const handleEditRequirement = (req: ComplianceRequirement) => {
    setEditingItem({ 
        ...req,
        timingType: req.timingType || 'ETD',
        timingWeeks: req.timingWeeks || 0,
        testReportOrigin: req.testReportOrigin || 'third_party_mandatory',
        selfDeclarationAccepted: req.selfDeclarationAccepted || false
    });
    setNewSectionName(req.section || '');
    setIsModalOpen(true);
  };

  const handlePreloadDefaults = () => {
      if (!selectedCategoryForReqs) return;
      
      showConfirm('Preload Standards', "This will add standard TCF requirements to this category. Continue?", async () => {
          setLoading(true);
          try {
              await addStandardRequirements(selectedCategoryForReqs);
              await loadData();
          } catch (e: any) {
              console.error(e);
              showAlert('Error', "Failed to preload.");
          } finally {
              setLoading(false);
          }
      });
  }

  const toggleFeatureCondition = (featureId: string) => {
    const current = editingItem.conditionFeatureIds || [];
    if (current.includes(featureId)) {
      setEditingItem({ ...editingItem, conditionFeatureIds: current.filter((id: string) => id !== featureId) });
    } else {
      setEditingItem({ ...editingItem, conditionFeatureIds: [...current, featureId] });
    }
  };

  const toggleSection = (section: string) => {
      const next = new Set(expandedSections);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      setExpandedSections(next);
  };

  const handleAiGenerate = async () => {
    if (!aiProductDesc.trim()) return;
    setIsAiGenerating(true);
    setAiSuggestions([]);

    try {
      const categoryName = categories.find(c => c.id === selectedCategoryForReqs)?.name || 'Unknown Category';
      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
      
      // Upgrade to gemini-3-pro-preview for complex regulatory reasoning
      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: `Generate 5 key regulatory compliance requirements for a product in the category "${categoryName}". 
        The product is described as: "${aiProductDesc}".
        Consider safety standards (like IEC/EN), chemical restrictions (RoHS/REACH), and packaging rules.
        Return a JSON array where each object has: title (string), description (string), section (string - e.g. "General", "Safety", "Chemical", "Mechanical"), isMandatory (boolean), referenceCode (string).`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                description: { type: Type.STRING },
                section: { type: Type.STRING },
                isMandatory: { type: Type.BOOLEAN },
                referenceCode: { type: Type.STRING }
              }
            }
          }
        }
      });

      const jsonStr = response.text || '[]';
      const parsed = JSON.parse(jsonStr);
      setAiSuggestions(parsed);
      
      const allIndices = new Set<number>(parsed.map((_: any, i: number) => i));
      setSelectedSuggestions(allIndices);

    } catch (e: any) {
      console.error(e);
      showAlert('AI Error', "AI Generation failed: " + e.message);
    } finally {
      setIsAiGenerating(false);
    }
  };

  const handleSaveAiSuggestions = async () => {
    if (!selectedCategoryForReqs) return;
    try {
      const toSave = aiSuggestions.filter((_, i) => selectedSuggestions.has(i));
      
      await Promise.all(toSave.map(item => saveRequirement({
        id: generateUUID(),
        categoryId: selectedCategoryForReqs,
        section: item.section || 'General',
        title: item.title || 'New Req',
        description: item.description || '',
        isMandatory: item.isMandatory || false,
        referenceCode: item.referenceCode,
        appliesByDefault: true,
        conditionFeatureIds: [],
        timingType: 'ETD',
        timingWeeks: 0,
        selfDeclarationAccepted: false,
        testReportOrigin: 'third_party_mandatory'
      })));

      setIsAiModalOpen(false);
      setAiSuggestions([]);
      setAiProductDesc('');
      loadData();
    } catch (e) {
      console.error(e);
      showAlert('Error', "Failed to save suggestions.");
    }
  };

  const renderRequirementsView = () => {
    if (!selectedCategoryForReqs) {
      return (
        <div>
            <h3 className="text-lg font-bold text-gray-800 mb-4">Select a Category to Manage Requirements</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {categories.map(cat => {
                const count = requirements.filter(r => r.categoryId === cat.id).length;
                return (
                <div 
                    key={cat.id} 
                    onClick={() => setSelectedCategoryForReqs(cat.id)}
                    className={`p-6 rounded-xl border shadow cursor-pointer hover:shadow-md transition-all group relative overflow-hidden ${cat.isFinalized ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-200 hover:border-indigo-400'}`}
                >
                    {cat.isFinalized && (
                    <div className="absolute top-0 right-0 bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded-bl-lg">
                        FINALIZED
                    </div>
                    )}
                    <h3 className="font-bold text-lg text-primary group-hover:text-indigo-600 transition-colors">{cat.name}</h3>
                    <p className="text-muted text-sm mt-2">{count} Requirement{count !== 1 ? 's' : ''}</p>
                    <div className="mt-4 text-xs font-medium text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    Manage Requirements <ArrowLeft className="rotate-180" size={12} />
                    </div>
                </div>
                );
            })}
            {categories.length === 0 && !loading && (
                <div className="col-span-3 text-center py-12 bg-light rounded-xl border border-dashed">
                    No categories found.
                </div>
            )}
            </div>
        </div>
      );
    }

    const catReqs = requirements.filter(r => r.categoryId === selectedCategoryForReqs);
    const category = categories.find(c => c.id === selectedCategoryForReqs);

    const groupedReqs = catReqs.reduce((acc, req) => {
        const sec = req.section || 'General Requirements';
        if (!acc[sec]) acc[sec] = [];
        acc[sec].push(req);
        return acc;
    }, {} as Record<string, ComplianceRequirement[]>);
    
    const sortedSections = Object.keys(groupedReqs).sort((a, b) => {
        const indexA = COMPLIANCE_SECTIONS.indexOf(a);
        const indexB = COMPLIANCE_SECTIONS.indexOf(b);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a.localeCompare(b);
    });

    return (
      <div>
        <button 
          onClick={() => setSelectedCategoryForReqs(null)} 
          className="mb-6 text-sm text-muted hover:text-gray-800 flex items-center gap-2 px-3 py-1.5 rounded-md hover:bg-gray-100 w-fit"
        >
          <ArrowLeft size={16} /> Back to Categories
        </button>

        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
          <div>
            <h3 className="text-2xl font-bold text-primary flex items-center gap-3">
              {category?.name}
              {category?.isFinalized && (
                <span title="Finalized Category">
                  <CheckCircle className="text-indigo-600" size={20} />
                </span>
              )}
            </h3>
            <p className="text-muted text-sm">Managing requirements for this category.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button 
              onClick={handlePreloadDefaults}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md hover:bg-light text-sm font-medium shadow"
              title="Add standard template requirements"
            >
              <RefreshCw size={16} /> Preload Standard
            </button>
            <button 
              onClick={() => setIsAiModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-purple-700 text-sm font-medium shadow"
            >
              <Sparkles size={16} /> AI Suggest
            </button>
            <button 
              onClick={() => openAddModal()} 
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 text-sm font-medium shadow"
            >
              <Plus size={16} /> Add Requirement
            </button>
          </div>
        </div>

        <div className="space-y-6">
          {sortedSections.length === 0 ? (
            <div className="text-center py-12 bg-light rounded-xl border border-dashed border-gray-200">
              <p className="text-muted">No requirements found for this category yet.</p>
            </div>
          ) : (
            sortedSections.map((section) => {
                const isExpanded = expandedSections.has(section);
                const items = groupedReqs[section];
                return (
                    <div key={section} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow">
                        <div 
                            className="bg-light px-5 py-3 border-b border-gray-200 flex justify-between items-center cursor-pointer hover:bg-gray-100 transition-colors"
                            onClick={() => toggleSection(section)}
                        >
                            <div className="flex items-center gap-2">
                                {isExpanded ? <FolderOpen size={18} className="text-indigo-500" /> : <Folder size={18} className="text-gray-400" />}
                                <h4 className="font-bold text-gray-700 text-sm uppercase tracking-wide">{section}</h4>
                                <span className="text-xs text-gray-400 ml-1">({items.length})</span>
                            </div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); openAddModal(section); }}
                                className="text-xs flex items-center gap-1 bg-white border border-gray-300 px-2 py-1 rounded text-indigo-600 hover:text-blue-800 hover:bg-indigo-50 font-medium"
                            >
                                <Plus size={14} /> Add to Section
                            </button>
                        </div>
                        
                        {isExpanded && (
                            <div className="divide-y divide-slate-100">
                                {items.map(r => (
                                <div key={r.id} className="bg-white p-5 hover:bg-light transition-colors group">
                                    <div className="flex justify-between items-start gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-center gap-3 mb-1">
                                        <h4 className="font-bold text-primary text-sm">{r.title}</h4>
                                        {r.isMandatory && <span className="bg-rose-100 text-rose-700 text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide">Mandatory</span>}
                                        </div>
                                        <p className="text-gray-600 text-xs leading-relaxed mb-3">{r.description}</p>
                                        
                                        <div className="bg-light p-2.5 rounded-xl border border-gray-100 flex flex-wrap gap-x-6 gap-y-2 items-center">
                                            <div className="flex items-center gap-1.5 min-w-[120px]">
                                                <Clock size={12} className="text-gray-400" />
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter leading-none">Timing</span>
                                                    <span className="text-[10px] font-bold text-gray-700">{r.timingType === 'POST_ETD' ? `ETD + ${r.timingWeeks}w` : 'At ETD'}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 min-w-[140px]">
                                                <Building size={12} className="text-gray-400" />
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter leading-none">Origin</span>
                                                    <span className="text-[10px] font-bold text-gray-700">{r.testReportOrigin === 'supplier_inhouse' ? 'In-House Accepted' : '3rd Party Lab Only'}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-1.5 min-w-[140px]">
                                                <FileCheck size={12} className="text-gray-400" />
                                                <div className="flex flex-col">
                                                    <span className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter leading-none">Declaration</span>
                                                    <span className="text-[10px] font-bold text-gray-700">{r.selfDeclarationAccepted ? 'Accepted' : 'Report Mandatory'}</span>
                                                </div>
                                            </div>
                                            
                                            {r.conditionFeatureIds.length > 0 && (
                                                <div className="flex items-center gap-1.5">
                                                    <Sparkles size={12} className="text-purple-400" />
                                                    <div className="flex flex-wrap gap-1">
                                                        {r.conditionFeatureIds.map(fid => {
                                                            const fName = features.find(f => f.id === fid)?.name;
                                                            return <span key={fid} className="text-[9px] bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-bold">{fName}</span>;
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    
                                    <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <button 
                                        onClick={() => handleEditRequirement(r)}
                                        className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-colors"
                                        >
                                        <Edit2 size={14} />
                                        </button>
                                        <button 
                                        onClick={() => handleDeleteRequirement(r.id)}
                                        className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-full transition-colors"
                                        >
                                        <Trash2 size={14} />
                                        </button>
                                    </div>
                                    </div>
                                </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })
          )}
        </div>
      </div>
    );
  };

  return (
    <Layout>
      <ConfirmationModal
        isOpen={modalState.isOpen}
        title={modalState.title}
        message={modalState.message}
        onConfirm={modalState.onConfirm}
        onCancel={() => setModalState(prev => ({ ...prev, isOpen: false }))}
        isAlert={modalState.isAlert}
      />

      <div className="mb-6">
        <h1 className="text-3xl font-bold text-primary">Compliance Library</h1>
        <p className="text-muted">Manage regulatory requirements for your product categories.</p>
      </div>

      <div className="bg-white rounded-xl shadow border border-gray-200 p-6 min-h-[400px]">
        {loading ? <div>Loading...</div> : renderRequirementsView()}
      </div>

      {/* AI Suggestion Modal */}
      {isAiModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl animate-in fade-in zoom-in duration-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-indigo-600 px-6 py-4 text-white flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Sparkles size={20} />
                <h3 className="font-bold text-lg">AI Requirement Suggestion</h3>
              </div>
              {/* Added comment above fix: Fixing missing icon X import */}
              <button onClick={() => setIsAiModalOpen(false)}><X size={20} /></button>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <p className="text-sm text-gray-600 mb-4">Describe the product in the <strong>{categories.find(c => c.id === selectedCategoryForReqs)?.name}</strong> category to get tailored compliance suggestions.</p>
              
              <div className="flex gap-2 mb-6">
                <textarea 
                  className="flex-1 border rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
                  rows={3}
                  placeholder="e.g. A battery-powered wireless kitchen scale with tempered glass top and Bluetooth connectivity."
                  value={aiProductDesc}
                  onChange={(e) => setAiProductDesc(e.target.value)}
                />
                <button 
                  onClick={handleAiGenerate}
                  disabled={isAiGenerating || !aiProductDesc.trim()}
                  className="bg-indigo-600 text-white px-6 rounded-xl font-bold hover:bg-purple-700 disabled:opacity-50 flex flex-col items-center justify-center gap-1"
                >
                  {isAiGenerating ? <Loader2 className="animate-spin" size={20} /> : <Sparkles size={20} />}
                  <span className="text-[10px] uppercase">Analyze</span>
                </button>
              </div>

              {aiSuggestions.length > 0 && (
                <div className="space-y-3 animate-in slide-in-from-bottom-2">
                  <h4 className="font-bold text-gray-700 text-sm uppercase tracking-wide">Suggested Requirements</h4>
                  {aiSuggestions.map((suggestion, idx) => {
                    const isSelected = selectedSuggestions.has(idx);
                    return (
                      <div 
                        key={idx} 
                        onClick={() => {
                          const next = new Set(selectedSuggestions);
                          if (next.has(idx)) next.delete(idx); else next.add(idx);
                          setSelectedSuggestions(next);
                        }}
                        className={`p-4 rounded-xl border cursor-pointer transition-all ${isSelected ? 'bg-purple-50 border-indigo-300' : 'bg-white border-gray-200 hover:bg-light'}`}
                      >
                        <div className="flex justify-between items-start gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h5 className="font-bold text-primary text-sm">{suggestion.title}</h5>
                              {suggestion.referenceCode && <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-mono">{suggestion.referenceCode}</span>}
                            </div>
                            <p className="text-xs text-gray-600">{suggestion.description}</p>
                            <div className="mt-2 text-[10px] font-bold text-indigo-600 uppercase">{suggestion.section || 'General'}</div>
                          </div>
                          <div className={`w-5 h-5 rounded border flex items-center justify-center ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-gray-300'}`}>
                            {isSelected && <CheckCircle size={14} />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="p-4 bg-light border-t flex justify-end gap-3">
               <button onClick={() => setIsAiModalOpen(false)} className="px-4 py-2 text-gray-600">Cancel</button>
               <button 
                 onClick={handleSaveAiSuggestions}
                 disabled={selectedSuggestions.size === 0}
                 className="bg-indigo-600 text-white px-6 py-2 rounded-xl font-bold hover:bg-purple-700 disabled:opacity-50"
               >
                 Add {selectedSuggestions.size} Selected
               </button>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl animate-in fade-in zoom-in duration-200 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="bg-light px-6 py-4 border-b border-gray-200 flex justify-between items-center flex-shrink-0">
               <h3 className="font-bold text-lg text-gray-800 capitalize">
                 {editingItem.id ? 'Edit' : 'Add'} Requirement
               </h3>
               <span className="text-xs bg-indigo-100 text-blue-800 px-2 py-1 rounded font-medium">
                   {categories.find(c => c.id === (editingItem.categoryId || selectedCategoryForReqs))?.name || 'No Category'}
               </span>
            </div>
            
            <div className="overflow-y-auto p-6 flex-1">
            <form id="reqForm" onSubmit={handleSaveRequirement} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Section Group</label>
                <div className="flex gap-2">
                    <select 
                        className="flex-1 border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={editingItem.section || ''}
                        onChange={e => {
                            setEditingItem({...editingItem, section: e.target.value});
                            setNewSectionName(e.target.value);
                        }}
                    >
                        <option value="">-- Select or Type New --</option>
                        {COMPLIANCE_SECTIONS.map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                    <input 
                        type="text" 
                        placeholder="Or Type New Section Name"
                        className="flex-1 border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                        value={newSectionName}
                        onChange={e => {
                            setNewSectionName(e.target.value);
                            setEditingItem({...editingItem, section: e.target.value});
                        }}
                    />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Requirement Title</label>
                <input 
                  placeholder="e.g. Power Cord Safety" 
                  required 
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none" 
                  value={editingItem.title} 
                  onChange={e => setEditingItem({...editingItem, title: e.target.value})} 
                />
              </div>
              
              <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Reference Code (Optional)</label>
                    <input 
                        placeholder="e.g. EN-60335-1" 
                        className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none" 
                        value={editingItem.referenceCode || ''} 
                        onChange={e => setEditingItem({...editingItem, referenceCode: e.target.value})} 
                    />
                </div>
                <div className="flex items-end pb-2">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input 
                        type="checkbox" 
                        className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                        checked={editingItem.isMandatory}
                        onChange={e => setEditingItem({...editingItem, isMandatory: e.target.checked})}
                    />
                    <span className="text-sm font-medium text-gray-700">Mandatory Requirement</span>
                    </label>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Long Description</label>
                <textarea 
                  placeholder="Full details of the requirement..." 
                  rows={3}
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none" 
                  value={editingItem.description} 
                  onChange={e => setEditingItem({...editingItem, description: e.target.value})} 
                />
              </div>

              <div className="bg-light border border-gray-200 p-4 rounded-xl shadow space-y-4">
                  <h4 className="font-bold text-sm text-gray-800 border-b pb-2 border-gray-200">Submission Rules</h4>
                  
                  <div className="grid grid-cols-2 gap-4">
                      <div>
                          <label className="block text-[10px] font-bold text-muted uppercase mb-1">Timing</label>
                          <select 
                             className="w-full border rounded text-sm p-2 bg-white"
                             value={editingItem.timingType}
                             onChange={(e) => setEditingItem({...editingItem, timingType: e.target.value})}
                          >
                              <option value="ETD">Mandatory at ETD</option>
                              <option value="POST_ETD">Deferred (Post-ETD)</option>
                          </select>
                          {editingItem.timingType === 'POST_ETD' && (
                              <div className="mt-2 flex items-center gap-2">
                                  <span className="text-xs text-gray-600">Due</span>
                                  <input 
                                    type="number" 
                                    min="1"
                                    className="w-16 border rounded p-1 text-center text-sm"
                                    value={editingItem.timingWeeks || ''}
                                    onChange={(e) => setEditingItem({...editingItem, timingWeeks: parseInt(e.target.value) || 0})}
                                  />
                                  <span className="text-xs text-gray-600">weeks after ETD</span>
                              </div>
                          )}
                      </div>

                      <div>
                          <label className="block text-[10px] font-bold text-muted uppercase mb-1">Report Origin</label>
                          <select 
                             className="w-full border rounded text-sm p-2 bg-white"
                             value={editingItem.testReportOrigin}
                             onChange={(e) => setEditingItem({...editingItem, testReportOrigin: e.target.value})}
                          >
                              <option value="third_party_mandatory">3rd Party Lab (Mandatory)</option>
                              <option value="supplier_inhouse">Supplier In-House Test</option>
                          </select>
                      </div>
                  </div>

                  <div className="pt-1">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input 
                            type="checkbox" 
                            className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                            checked={editingItem.selfDeclarationAccepted}
                            onChange={e => setEditingItem({...editingItem, selfDeclarationAccepted: e.target.checked})}
                        />
                        <span className="text-sm font-medium text-gray-700">Supplier Self-Declaration Accepted</span>
                      </label>
                  </div>
              </div>

              <div className="bg-light p-4 rounded-xl border border-gray-200">
                <label className="block text-sm font-bold text-gray-700 mb-2">Applicable Features (Conditions)</label>
                <div className="flex flex-wrap gap-2">
                  {features.filter(f => f.categoryId === (editingItem.categoryId || selectedCategoryForReqs)).map(feat => {
                    const isSelected = editingItem.conditionFeatureIds?.includes(feat.id);
                    return (
                      <button
                        key={feat.id}
                        type="button"
                        onClick={() => toggleFeatureCondition(feat.id)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                          isSelected 
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow' 
                            : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                        }`}
                      >
                        {feat.name} {isSelected && '✓'}
                      </button>
                    );
                  })}
                </div>
              </div>
            </form>
            </div>
              
            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 bg-white p-4 rounded-b-xl flex-shrink-0">
                <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)} 
                  className="px-5 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium"
                >
                  Cancel
                </button>
                <button 
                  type="submit" 
                  form="reqForm"
                  className="px-5 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-md text-sm font-medium shadow"
                >
                  Save Requirement
                </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default ComplianceLibrary;
