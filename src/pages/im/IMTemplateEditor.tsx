
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import { getIMTemplateByCategoryId, getIMSections, saveIMSection, deleteIMSection, getCategories, updateIMTemplate, getProductFeatures } from '../../services';
import { IMTemplate, IMSection, CategoryL3, ProductFeature, IMTemplateMetadata } from '../../types';
import { Plus, Save, Trash2, ArrowLeft, LayoutTemplate, X, CheckCircle, Clock, User, ChevronUp, ChevronDown, Settings, Bold, Italic, Underline, List, Sparkles, Loader2, Type, Image as ImageIcon, GitBranch, Table as TableIcon, AlertTriangle, Info, Upload, Grid, Layers, Zap, AlertOctagon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { GoogleGenAI } from "@google/genai";

const ALL_LANGUAGES = [
  { code: 'en', label: 'English (Default)' },
  { code: 'de', label: 'German (DE)' },
  { code: 'fr', label: 'French (FR)' },
  { code: 'es', label: 'Spanish (ES)' },
  { code: 'it', label: 'Italian (IT)' },
  { code: 'pt', label: 'Portuguese (PT)' },
  { code: 'nl', label: 'Dutch (NL)' },
  { code: 'pl', label: 'Polish (PL)' },
  { code: 'zh', label: 'Chinese (Simplified)' },
  { code: 'ja', label: 'Japanese (JP)' },
  { code: 'tr', label: 'Turkish (TR)' },
  { code: 'ru', label: 'Russian (RU)' }
];

// --- Internal Confirmation Modal ---
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
          <button onClick={onConfirm} className="px-4 py-2 bg-rose-600 text-white hover:bg-red-700 rounded text-sm font-medium">Delete</button>
        </div>
      </div>
    </div>
  );
};

// --- Simple Rich Text Editor Component ---
interface EditorProps {
  initialContent: string;
  onChange: (html: string) => void;
  placeholder?: string;
  onInsertPlaceholder?: (type: 'text' | 'image') => void;
  onInsertCondition?: () => void;
  onInsertBlock?: (type: 'warning' | 'info' | 'table' | 'caution' | 'electric') => void;
  minimal?: boolean;
}

const SimpleRichTextEditor: React.FC<EditorProps> = ({ initialContent, onChange, placeholder, onInsertPlaceholder, onInsertCondition, onInsertBlock, minimal }) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const savedRange = useRef<Range | null>(null);

  useEffect(() => {
    if (contentRef.current && contentRef.current.innerHTML !== initialContent) {
      if (Math.abs(contentRef.current.innerHTML.length - initialContent.length) > 5) {
          contentRef.current.innerHTML = initialContent;
      } else if (!contentRef.current.innerHTML) {
          contentRef.current.innerHTML = initialContent;
      }
    }
  }, [initialContent]);

  const saveSelection = () => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          if (contentRef.current && contentRef.current.contains(range.commonAncestorContainer)) {
             savedRange.current = range.cloneRange();
          }
      }
  };

  const restoreSelection = () => {
      const selection = window.getSelection();
      if (savedRange.current && selection) {
          selection.removeAllRanges();
          selection.addRange(savedRange.current);
      }
  };

  const exec = (command: string, value: string | undefined = undefined) => {
    restoreSelection();
    contentRef.current?.focus();
    document.execCommand(command, false, value);
    handleChange();
  };

  const handleChange = () => {
    if (contentRef.current) {
        const html = contentRef.current.innerHTML;
        if (html === '<br>' || html.trim() === '') {
           onChange('');
        } else {
           onChange(html);
        }
        saveSelection();
    }
  };

  useEffect(() => {
    (window as any).currentEditorInsertHtml = (htmlString: string) => {
        if (!contentRef.current) return;
        contentRef.current.focus();
        const selection = window.getSelection();
        if (!selection) return;

        if (savedRange.current) {
            try {
                selection.removeAllRanges();
                selection.addRange(savedRange.current);
            } catch (e) { }
        }

        let range: Range | null = null;
        if (selection.rangeCount > 0 && contentRef.current.contains(selection.anchorNode)) {
            range = selection.getRangeAt(0);
        } else {
            range = document.createRange();
            range.selectNodeContents(contentRef.current);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        }

        if (range) {
            range.deleteContents();
            const el = document.createElement('div');
            el.innerHTML = htmlString;
            const frag = document.createDocumentFragment();
            let node, lastNode;
            while ((node = el.firstChild)) {
                lastNode = frag.appendChild(node);
            }
            range.insertNode(frag);

            if (lastNode) {
                range = range.cloneRange();
                range.setStartAfter(lastNode);
                range.collapse(true);
                selection.removeAllRanges();
                selection.addRange(range);
                savedRange.current = range;
            }
        }
        handleChange();
    };
    return () => { (window as any).currentEditorInsertHtml = undefined; };
  }, [onChange]);

  return (
    <div className={`flex flex-col h-full border rounded-xl transition-colors overflow-hidden ${isFocused ? 'border-indigo-400 ring-1 ring-indigo-100' : 'border-gray-300'}`}>
      <style>{`
        .im-editor-content ul { list-style-type: disc !important; padding-left: 1.5em !important; margin-bottom: 1em !important; }
        .im-editor-content ol { list-style-type: decimal !important; padding-left: 1.5em !important; margin-bottom: 1em !important; }
        .im-editor-content li { display: list-item !important; margin-bottom: 0.25em !important; }
        .im-editor-content b, .im-editor-content strong { font-weight: bold !important; }
        .im-editor-content i, .im-editor-content em { font-style: italic !important; }
        .im-editor-content u { text-decoration: underline !important; }
        .im-editor-content p { margin-bottom: 1em !important; display: block !important; }
        .im-placeholder { display: inline-block; vertical-align: middle; cursor: default; user-select: none; white-space: nowrap; }
        .im-condition { display: inline-block; vertical-align: middle; cursor: default; border-style: dashed; user-select: none; }
        
        .im-block-wrapper { display: flex; align-items: flex-start; gap: 1.5rem; padding: 1.5rem; margin: 1.5rem 0; border-radius: 6px; border-left: 6px solid; background-color: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
        .im-block-icon { flex-shrink: 0; width: 64px; height: 64px; display: flex; align-items: center; justify-content: center; }
        .im-block-content { flex: 1; min-width: 0; }
        .im-block-title { display: block; font-weight: 800; text-transform: uppercase; font-size: 0.9rem; margin-bottom: 0.5rem; letter-spacing: 0.05em; }

        .im-block-warning { background-color: #fff7ed; border-left-color: #f97316; }
        .im-block-warning .im-block-title { color: #c2410c; }
        .im-block-caution { background-color: #fefce8; border-left-color: #eab308; }
        .im-block-caution .im-block-title { color: #854d0e; }
        .im-block-electric { background-color: #fef2f2; border-left-color: #dc2626; }
        .im-block-electric .im-block-title { color: #b91c1c; }
        .im-block-info { background-color: #eff6ff; border-left-color: #3b82f6; }
        .im-block-info .im-block-title { color: #1d4ed8; }

        /* Improved Table Styles */
        .im-table { width: 100%; border-collapse: collapse; margin: 1rem 0; table-layout: auto; }
        .im-table th, .im-table td { border: 1px solid #cbd5e1; padding: 0.5rem; vertical-align: top; }
        .im-table th { background-color: #f1f5f9; font-weight: bold; text-align: left; }
      `}</style>

      <div className="flex-none flex items-center gap-1 p-2 bg-light border-b border-gray-200 select-none z-10 flex-wrap">
        <button onMouseDown={(e) => { e.preventDefault(); exec('bold'); }} className="p-1.5 hover:bg-gray-200 rounded text-gray-600" title="Bold"><Bold size={16} /></button>
        <button onMouseDown={(e) => { e.preventDefault(); exec('italic'); }} className="p-1.5 hover:bg-gray-200 rounded text-gray-600" title="Italic"><Italic size={16} /></button>
        <button onMouseDown={(e) => { e.preventDefault(); exec('underline'); }} className="p-1.5 hover:bg-gray-200 rounded text-gray-600" title="Underline"><Underline size={16} /></button>
        <div className="w-px h-4 bg-gray-300 mx-1"></div>
        <button onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList'); }} className="p-1.5 hover:bg-gray-200 rounded text-gray-600" title="Bullet List"><List size={16} /></button>
        {!minimal && (
          <>
            <div className="w-px h-4 bg-gray-300 mx-1"></div>
            <button onMouseDown={(e) => { e.preventDefault(); onInsertBlock?.('warning'); }} className="p-1.5 hover:bg-orange-100 hover:text-amber-600 rounded text-gray-600" title="Warning Block"><AlertTriangle size={16} /></button>
            <button onMouseDown={(e) => { e.preventDefault(); onInsertBlock?.('caution'); }} className="p-1.5 hover:bg-amber-100 hover:text-amber-600 rounded text-gray-600" title="Caution Block"><AlertOctagon size={16} /></button>
            <button onMouseDown={(e) => { e.preventDefault(); onInsertBlock?.('electric'); }} className="p-1.5 hover:bg-rose-100 hover:text-rose-600 rounded text-gray-600" title="Electric Hazard"><Zap size={16} /></button>
            <button onMouseDown={(e) => { e.preventDefault(); onInsertBlock?.('info'); }} className="p-1.5 hover:bg-indigo-100 hover:text-indigo-600 rounded text-gray-600" title="Info Block"><Info size={16} /></button>
            <button onMouseDown={(e) => { e.preventDefault(); onInsertBlock?.('table'); }} className="p-1.5 hover:bg-gray-200 rounded text-gray-600" title="Insert Table"><TableIcon size={16} /></button>
            <div className="w-px h-4 bg-gray-300 mx-1"></div>
            <button onMouseDown={(e) => { e.preventDefault(); onInsertPlaceholder?.('text'); }} className="flex items-center gap-1 px-2 py-1 bg-amber-50 text-yellow-700 hover:bg-amber-100 rounded text-xs font-medium border border-amber-200" title="Insert User Input Field"><Type size={14} /> Text</button>
            <button onMouseDown={(e) => { e.preventDefault(); onInsertPlaceholder?.('image'); }} className="flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded text-xs font-medium border border-indigo-200" title="Insert Image Upload Field"><ImageIcon size={14} /> Img</button>
            <button onMouseDown={(e) => { e.preventDefault(); onInsertCondition?.(); }} className="flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded text-xs font-medium border border-purple-200" title="Insert Optional/Conditional Text"><GitBranch size={14} /> Cond</button>
          </>
        )}
      </div>
      
      <div className="flex-1 relative bg-white cursor-text" onClick={() => { contentRef.current?.focus(); }}>
        {!initialContent && !isFocused && placeholder && (
           <div className="absolute top-4 left-4 text-gray-400 pointer-events-none select-none z-10">{placeholder}</div>
        )}
        <div className="absolute inset-0 overflow-y-auto">
          <div 
            ref={contentRef}
            className="min-h-full p-4 outline-none im-editor-content max-w-none font-sans"
            contentEditable
            onInput={handleChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => { setIsFocused(false); saveSelection(); }}
            onMouseUp={saveSelection}
            onKeyUp={saveSelection}
          />
        </div>
      </div>
    </div>
  );
};

const IMTemplateEditor: React.FC = () => {
  const { categoryId } = useParams<{ categoryId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [template, setTemplate] = useState<IMTemplate | null>(null);
  const [category, setCategory] = useState<CategoryL3 | null>(null);
  const [sections, setSections] = useState<IMSection[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [activeLang, setActiveLang] = useState('en');
  const [templateLanguages, setTemplateLanguages] = useState<string[]>(['en']);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  
  const [complianceFeatures, setComplianceFeatures] = useState<ProductFeature[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);

  const [activeSidebarTab, setActiveSidebarTab] = useState<'structure' | 'assets'>('structure');
  const [assets, setAssets] = useState<string[]>([]);

  const [isLangModalOpen, setIsLangModalOpen] = useState(false);
  const [isConditionModalOpen, setIsConditionModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isPlaceholderModalOpen, setIsPlaceholderModalOpen] = useState(false);
  
  // Use the Delete Modal state to trigger the custom modal instead of window.confirm
  const [deleteModal, setDeleteModal] = useState<{isOpen: boolean, sectionId: string | null}>({ isOpen: false, sectionId: null });

  const [condText, setCondText] = useState('');
  const [condFeatureId, setCondFeatureId] = useState('');
  const [placeholderConfig, setPlaceholderConfig] = useState<{type: 'text' | 'image', label: string}>({ type: 'text', label: '' });

  const [metaSettings, setMetaSettings] = useState<IMTemplateMetadata>({
     pageSize: 'a4',
     primaryColor: '#0f172a',
     coverImageUrl: '',
     companyLogoUrl: '',
     companyName: '',
     backPageContent: '',
     footerText: ''
  });

  useEffect(() => {
    if (!categoryId) return;
    loadData();
  }, [categoryId]);

  const loadData = async () => {
    if (!categoryId) return;
    const [cats, temp, feats] = await Promise.all([
        getCategories(), 
        getIMTemplateByCategoryId(categoryId),
        getProductFeatures()
    ]);
    setCategory(cats.find(c => c.id === categoryId) || null);
    setComplianceFeatures(feats);
    
    if (temp) {
      setTemplate(temp);
      setTemplateLanguages(temp.languages || ['en', 'de', 'fr', 'es', 'it']);
      if (temp.metadata) setMetaSettings(temp.metadata);
      
      const secs = await getIMSections(temp.id);
      setSections(secs);
      if (secs.length > 0 && !selectedSectionId) {
         setSelectedSectionId(secs[0].id);
      }
    }
    setLoading(false);
  };

  const insertHtmlToCurrentEditor = (html: string) => {
      if ((window as any).currentEditorInsertHtml) {
          (window as any).currentEditorInsertHtml(html);
      }
  };

  const handleInsertPlaceholder = (type: 'text' | 'image') => {
    setPlaceholderConfig({ type, label: '' });
    setIsPlaceholderModalOpen(true);
  };

  const handleConfirmPlaceholder = () => {
    const label = placeholderConfig.label.trim() || (placeholderConfig.type === 'text' ? 'Text' : 'Image');
    const id = Math.random().toString(36).substr(2, 9);
    const type = placeholderConfig.type;
    const colorClass = type === 'text' ? 'bg-amber-100 border-yellow-300 text-amber-800' : 'bg-indigo-100 border-indigo-300 text-blue-800';
    const labelAttr = encodeURIComponent(label);
    const html = `&nbsp;<span class="im-placeholder ${colorClass} border px-2 py-0.5 rounded text-xs font-bold select-none mx-1" contenteditable="false" data-type="${type}" data-id="${id}" data-label="${labelAttr}">[${label}]</span>&nbsp;`;
    insertHtmlToCurrentEditor(html);
    setIsPlaceholderModalOpen(false);
  };

  const handleInsertBlock = (type: 'warning' | 'info' | 'table' | 'caution' | 'electric') => {
      let html = '';
      const isoWarningIcon = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:100%;"><path d="M12 2L2 22h20L12 2z" fill="#FACC15" stroke="black" stroke-width="2" stroke-linejoin="round"/><path d="M12 8v6M12 17v.5" stroke="black" stroke-width="2.5" stroke-linecap="round"/></svg>`;
      const isoElectricIcon = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:100%;"><path d="M12 2L2 22h20L12 2z" fill="#FACC15" stroke="black" stroke-width="2" stroke-linejoin="round"/><path d="M13 7l-3 6h2.5l-2 5 4-7h-2.5l1-4z" fill="black"/></svg>`;

      if (type === 'warning') {
          html = `<div class="im-block-wrapper im-block-warning"><div class="im-block-icon">${isoWarningIcon}</div><div class="im-block-content"><strong class="im-block-title">WARNING</strong><p>Indicates a hazardous situation which, if not avoided, could result in serious injury or death.</p></div></div><p></p>`;
      } else if (type === 'caution') {
          html = `<div class="im-block-wrapper im-block-caution"><div class="im-block-icon">${isoWarningIcon}</div><div class="im-block-content"><strong class="im-block-title">CAUTION</strong><p>Indicates a potentially hazardous situation which may result in minor injury or damage to the appliance.</p></div></div><p></p>`;
      } else if (type === 'electric') {
          html = `<div class="im-block-wrapper im-block-electric"><div class="im-block-icon">${isoElectricIcon}</div><div class="im-block-content"><strong class="im-block-title">ELECTRIC HAZARD</strong><p>Risk of electric shock. Disconnect power before servicing.</p></div></div><p></p>`;
      } else if (type === 'info') {
           html = `<div class="im-block-wrapper im-block-info"><div class="im-block-content"><strong class="im-block-title">ℹ️ Note</strong><p>Offers helpful tips and information for using your product.</p></div></div><p></p>`;
      } else if (type === 'table') {
          html = `<table class="im-table"><thead><tr><th>Header 1</th><th>Header 2</th></tr></thead><tbody><tr><td>Row 1 Col 1</td><td>Row 1 Col 2</td></tr><tr><td>Row 2 Col 1</td><td>Row 2 Col 2</td></tr></tbody></table><p></p>`;
      }
      insertHtmlToCurrentEditor(html);
  };

  const handleUploadAsset = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          const reader = new FileReader();
          reader.onloadend = () => {
              setAssets(prev => [...prev, reader.result as string]);
          };
          reader.readAsDataURL(file);
      }
  };

  const handleInsertAsset = (src: string) => {
      const html = `<img src="${src}" style="max-width: 100%; height: auto; border-radius: 0.375rem; margin: 1rem 0;" /><p></p>`;
      insertHtmlToCurrentEditor(html);
  };

  const handleOpenConditionModal = () => {
      setCondText('');
      setCondFeatureId('manual');
      setIsConditionModalOpen(true);
  };

  const handleInsertCondition = () => {
      if (!condText.trim()) return;
      const id = Math.random().toString(36).substr(2, 9);
      let label = "Optional";
      let featureName = "";
      if (condFeatureId !== 'manual') {
          const feat = complianceFeatures.find(f => f.id === condFeatureId);
          if (feat) { label = "Auto-Spec"; featureName = feat.name; }
      }
      const safeText = encodeURIComponent(condText);
      const html = `&nbsp;<span class="im-condition bg-purple-50 border-indigo-300 text-purple-800 border border-dashed px-2 py-1 rounded text-sm mx-1" contenteditable="false" data-id="${id}" data-feature-id="${condFeatureId}" data-content="${safeText}" data-feature-name="${featureName}" title="Condition: ${featureName || 'Manual'}"><span class="font-bold text-xs uppercase mr-1">[${label}]</span> ${condText.substring(0, 20)}${condText.length > 20 ? '...' : ''}</span>&nbsp;`;
      insertHtmlToCurrentEditor(html);
      setIsConditionModalOpen(false);
  };

  const handleAddSection = async () => {
    if (!template) return;
    const rootSections = sections.filter(s => !s.parentId);
    if (rootSections.length >= 15) { alert("Maximum limit of 15 root sections reached."); return; }
    
    const maxOrder = rootSections.reduce((max, s) => Math.max(max, s.order || 0), 0);
    const newOrder = maxOrder + 10;
    
    const newSection: Partial<IMSection> = { templateId: template.id, title: 'New Section', order: newOrder, isPlaceholder: false, content: { en: '' } };
    try {
        const saved = await saveIMSection(newSection as any);
        setSections([...sections, saved]);
        setSelectedSectionId(saved.id);
        setTemplate(prev => prev ? ({ ...prev, lastUpdatedBy: user?.name || 'User', updatedAt: new Date().toISOString() }) : null);
        setLastSaved(new Date());
    } catch(e) { console.error(e); }
  };

  const handleAddSubSection = async (parentId: string) => {
    if (!template) return;
    const siblings = sections.filter(s => s.parentId === parentId);
    const maxOrder = siblings.reduce((max, s) => Math.max(max, s.order || 0), 0);
    const newOrder = maxOrder + 10;
    
    const newSection: Partial<IMSection> = { templateId: template.id, parentId: parentId, title: 'New Sub-Section', order: newOrder, isPlaceholder: false, content: { en: '' } };
    try {
        const saved = await saveIMSection(newSection as any);
        setSections([...sections, saved]);
        setSelectedSectionId(saved.id);
        setTemplate(prev => prev ? ({ ...prev, lastUpdatedBy: user?.name || 'User', updatedAt: new Date().toISOString() }) : null);
        setLastSaved(new Date());
    } catch (e) { console.error(e); }
  };

  const handleSaveSection = async () => {
    const section = sections.find(s => s.id === selectedSectionId);
    if (!section) return;
    setSaving(true);
    try {
      await saveIMSection(section);
      setTemplate(prev => prev ? ({ ...prev, lastUpdatedBy: user?.name || 'User', updatedAt: new Date().toISOString() }) : null);
      setLastSaved(new Date());
    } catch (e) { console.error(e); alert("Error saving section."); } finally { setSaving(false); }
  };

  const handleDeleteSection = (id: string) => {
    // Open modal instead of window.confirm
    setDeleteModal({ isOpen: true, sectionId: id });
  };

  const confirmDeleteSection = async () => {
    if (!deleteModal.sectionId) return;
    const id = deleteModal.sectionId;
    await deleteIMSection(id);
    const newSections = sections.filter(s => s.id !== id && s.parentId !== id);
    setSections(newSections);
    if (selectedSectionId === id) setSelectedSectionId(newSections[0]?.id || null);
    setLastSaved(new Date());
    setDeleteModal({ isOpen: false, sectionId: null });
  };
  
  // Robust reorder logic
  const handleReorder = async (e: React.MouseEvent, id: string, direction: 'up' | 'down') => {
    e.stopPropagation();
    e.preventDefault();
    if (!template) return;
    
    const currentSection = sections.find(s => s.id === id);
    if (!currentSection) return;
    
    const getParentId = (p?: string | null) => p || 'root';
    const currentParentId = getParentId(currentSection.parentId);
    
    // Get siblings sorted by order
    const siblings = sections
        .filter(s => getParentId(s.parentId) === currentParentId)
        .sort((a, b) => (a.order || 0) - (b.order || 0));
        
    const currentIndex = siblings.findIndex(s => s.id === id);
    if (currentIndex === -1) return;
    
    const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= siblings.length) return;
    
    // Swap items in the list
    const item = siblings[currentIndex];
    siblings.splice(currentIndex, 1);
    siblings.splice(targetIndex, 0, item);
    
    // Reassign sequential orders to avoid collision (10, 20, 30...)
    const updates = siblings.map((s, idx) => ({
        ...s,
        order: (idx + 1) * 10
    }));
    
    // Optimistic update
    const newSections = sections.map(s => {
        const update = updates.find(u => u.id === s.id);
        return update ? update : s;
    });
    setSections(newSections);
    
    // Save all modified siblings
    try {
        await Promise.all(updates.map(u => saveIMSection({ id: u.id, templateId: template.id, order: u.order })));
        setLastSaved(new Date());
    } catch (e) { 
        console.error("Reorder failed", e); 
        loadData(); 
    }
  };

  const updateCurrentSection = (updates: Partial<IMSection>) => {
    setSections(prev => prev.map(s => s.id === selectedSectionId ? { ...s, ...updates } : s));
  };

  const updateContent = useCallback((htmlValue: string) => {
    setSections(prevSections => {
      if (!selectedSectionId) return prevSections;
      return prevSections.map(s => s.id === selectedSectionId ? { ...s, content: { ...s.content, [activeLang]: htmlValue } } : s);
    });
  }, [selectedSectionId, activeLang]);

  const handleSaveMetadata = async () => {
      if (!template) return;
      setSaving(true);
      try {
          await updateIMTemplate(template.id, { metadata: metaSettings, lastUpdatedBy: user?.name });
          setTemplate(prev => prev ? ({ ...prev, metadata: metaSettings }) : null);
          setLastSaved(new Date());
          setIsSettingsModalOpen(false);
      } catch (e) {
          alert("Failed to save template settings.");
      } finally {
          setSaving(false);
      }
  };

  const handleAiTranslate = async () => {
    if (activeLang === 'en') return;
    const section = sections.find(s => s.id === selectedSectionId);
    if (!section) return;
    const englishContent = section.content['en'];
    if (!englishContent || !englishContent.trim()) { alert("Please add English content first."); return; }
    setIsTranslating(true);
    try {
      const targetLangLabel = ALL_LANGUAGES.find(l => l.code === activeLang)?.label || activeLang;
      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
      // Added comment above fix: Using gemini-3-flash-preview for translations
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
          parts: [{ text: `Translate HTML to ${targetLangLabel}. Preserve HTML tags, classes, styles, bullet points, and placeholder spans exactly. Content: ${englishContent}` }]
        }
      });
      const cleanText = response.text?.trim().replace(/^```html/, '').replace(/^```/, '').replace(/```$/, '') || '';
      updateContent(cleanText);
    } catch (e: any) { 
      alert("AI Translation failed: " + (e.message || e.toString())); 
    } finally { 
      setIsTranslating(false); 
    }
  };

  const renderSidebarItem = (s: IMSection, indexPrefix: string, level: number) => {
     const children = sections.filter(sec => sec.parentId === s.id).sort((a, b) => (a.order || 0) - (b.order || 0));
     return (
       <div key={s.id} className="flex flex-col">
           <div onClick={() => setSelectedSectionId(s.id)} className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm group transition-colors ${selectedSectionId === s.id ? 'bg-indigo-50 text-indigo-700 font-medium border border-indigo-200' : 'text-gray-600 hover:bg-light border border-transparent'}`} style={{ paddingLeft: `${(level * 12) + 8}px` }}>
              <span className="text-gray-400 text-xs font-mono min-w-[24px]">{indexPrefix}</span>
              <span className="truncate flex-1">{s.title}</span>
              <div className="flex opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                  {level === 0 && <button onClick={(e) => { e.stopPropagation(); handleAddSubSection(s.id); }} className="text-gray-400 hover:text-indigo-600 p-1 hover:bg-indigo-100 rounded"><Plus size={12} /></button>}
                  <div className="flex flex-col">
                     <button onClick={(e) => handleReorder(e, s.id, 'up')} className="text-gray-400 hover:text-indigo-600 p-1 hover:bg-indigo-100 rounded"><ChevronUp size={12} /></button>
                     <button onClick={(e) => handleReorder(e, s.id, 'down')} className="text-gray-400 hover:text-indigo-600 p-1 hover:bg-indigo-100 rounded"><ChevronDown size={12} /></button>
                  </div>
              </div>
              {s.isPlaceholder && <LayoutTemplate size={12} className="text-gray-400 shrink-0" />}
           </div>
           {children.map((child, idx) => renderSidebarItem(child, `${indexPrefix}${idx + 1}.`, level + 1))}
       </div>
     );
  };

  if (loading) return <Layout><div>Loading...</div></Layout>;
  if (!template) return <Layout><div>Template not found.</div></Layout>;

  const currentSection = sections.find(s => s.id === selectedSectionId);
  const availableLangsForTabs = ALL_LANGUAGES.filter(l => templateLanguages.includes(l.code));
  const rootSections = sections.filter(s => !s.parentId).sort((a, b) => (a.order || 0) - (b.order || 0));
  const categoryFeatures = complianceFeatures.filter(f => f.categoryId === categoryId);

  return (
    <Layout>
       <div className="flex flex-col h-[calc(100vh-100px)]">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
               <button onClick={() => navigate('/im')} className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20}/></button>
               <div>
                 <h2 className="text-xl font-bold text-primary">{category?.name} Manual</h2>
                 <div className="flex items-center gap-4 text-xs text-muted mt-1">
                    {template.updatedAt && <span className="flex items-center gap-1"><Clock size={12} /> Saved: {new Date(template.updatedAt).toLocaleDateString()}</span>}
                    {template.lastUpdatedBy && <span className="flex items-center gap-1"><User size={12} /> By: {template.lastUpdatedBy}</span>}
                    {lastSaved && <span className="text-emerald-600 flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-full font-medium"><CheckCircle size={10} /> Saved</span>}
                 </div>
               </div>
            </div>

            <div className="flex gap-3 items-center">
               <button onClick={() => setIsSettingsModalOpen(true)} className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded-xl text-sm font-medium hover:bg-light shadow"><Settings size={16} /> Settings</button>
               <button onClick={handleSaveSection} disabled={saving} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-70 shadow ml-2"><Save size={16} /> {saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>

          <div className="flex flex-1 gap-6 overflow-hidden">
             {/* Sidebar */}
             <div className="w-64 bg-white border border-gray-200 rounded-xl shadow flex flex-col overflow-hidden">
                <div className="flex border-b border-gray-200">
                   <button onClick={() => setActiveSidebarTab('structure')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 ${activeSidebarTab === 'structure' ? 'bg-light text-indigo-600 border-b-2 border-indigo-600' : 'text-muted hover:bg-light'}`}><Layers size={14} /> Structure</button>
                   <button onClick={() => setActiveSidebarTab('assets')} className={`flex-1 py-3 text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 ${activeSidebarTab === 'assets' ? 'bg-light text-indigo-600 border-b-2 border-indigo-600' : 'text-muted hover:bg-light'}`}><Grid size={14} /> Assets</button>
                </div>

                {activeSidebarTab === 'structure' && (
                   <>
                     <div className="p-3 border-b border-gray-100 bg-light flex justify-between items-center">
                        <span className="text-xs font-bold text-muted uppercase">Section Tree</span>
                        <button onClick={handleAddSection} className={`text-indigo-600 hover:bg-indigo-100 p-1 rounded transition-colors ${rootSections.length >= 15 ? 'opacity-50' : ''}`} disabled={rootSections.length >= 15}><Plus size={14}/></button>
                     </div>
                     <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                        {rootSections.map((s, idx) => renderSidebarItem(s, `${idx + 1}.`, 0))}
                     </div>
                   </>
                )}

                {activeSidebarTab === 'assets' && (
                   <div className="flex-col flex h-full">
                      <div className="p-3 border-b border-gray-100 bg-light">
                         <label className="w-full flex items-center justify-center gap-2 bg-white border border-gray-300 border-dashed rounded-xl p-3 cursor-pointer hover:bg-indigo-50 hover:border-indigo-300 transition-colors">
                            <Upload size={16} className="text-gray-400" />
                            <span className="text-xs font-medium text-gray-600">Upload Image</span>
                            <input type="file" className="hidden" accept="image/*" onChange={handleUploadAsset} />
                         </label>
                      </div>
                      <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2">
                         {assets.map((src, i) => (
                            <div key={i} className="group relative aspect-square rounded-xl border border-gray-200 overflow-hidden cursor-pointer hover:ring-2 hover:ring-indigo-400" onClick={() => handleInsertAsset(src)}>
                               <img src={src} alt={`Asset ${i}`} className="w-full h-full object-cover" />
                               <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"><Plus size={20} className="text-white" /></div>
                            </div>
                         ))}
                         {assets.length === 0 && <div className="col-span-2 text-center py-8 text-gray-400 text-xs">No assets uploaded yet.</div>}
                      </div>
                   </div>
                )}
             </div>

             {/* Editor Area */}
             <div className="flex-1 bg-white border border-gray-200 rounded-xl shadow flex flex-col overflow-hidden">
                {currentSection ? (
                   <>
                     <div className="p-4 border-b border-gray-100 bg-light/50 flex justify-between items-start">
                        <div className="flex-1 max-w-md">
                           <div className="text-xs font-bold text-gray-400 uppercase mb-1 flex items-center gap-2">{currentSection.parentId ? 'Sub-Chapter' : 'Section'}</div>
                           <input className="w-full font-bold text-lg bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-500 outline-none text-primary" value={currentSection.title} onChange={(e) => updateCurrentSection({ title: e.target.value })} />
                        </div>
                        <div className="flex items-center gap-4">
                           <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 select-none">
                              <input type="checkbox" checked={currentSection.isPlaceholder} onChange={(e) => updateCurrentSection({ isPlaceholder: e.target.checked })} className="rounded text-indigo-600 focus:ring-indigo-500" /> Placeholder?
                           </label>
                           <button onClick={() => handleDeleteSection(currentSection.id)} className="text-gray-400 hover:text-rose-600 p-2"><Trash2 size={16} /></button>
                        </div>
                     </div>

                     <div className="flex items-center justify-between border-b border-gray-200 bg-light pr-2">
                        <div className="flex overflow-x-auto">
                           {availableLangsForTabs.map(lang => (
                           <button key={lang.code} onClick={() => setActiveLang(lang.code)} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeLang === lang.code ? 'border-indigo-600 text-indigo-600 bg-white' : 'border-transparent text-muted hover:text-gray-700'}`}>{lang.label}</button>
                           ))}
                        </div>
                        {activeLang !== 'en' && !currentSection.isPlaceholder && (
                           <button onClick={handleAiTranslate} disabled={isTranslating} className="flex items-center gap-1.5 text-xs bg-purple-100 text-purple-700 px-3 py-1.5 rounded-md hover:bg-purple-200 font-medium transition-colors mr-2 disabled:opacity-60">
                              {isTranslating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                              {isTranslating ? 'Translating...' : 'AI Translate'}
                           </button>
                        )}
                     </div>

                     <div className="flex-1 relative flex flex-col">
                        <div className="flex-1 overflow-hidden flex flex-col relative p-4">
                           <SimpleRichTextEditor
                              key={`${currentSection.id}-${activeLang}`}
                              initialContent={currentSection.content[activeLang] || ''}
                              onChange={updateContent}
                              placeholder="Enter content..."
                              onInsertPlaceholder={handleInsertPlaceholder}
                              onInsertCondition={handleOpenConditionModal}
                              onInsertBlock={handleInsertBlock}
                           />
                        </div>
                     </div>
                   </>
                ) : (
                   <div className="flex-1 flex items-center justify-center text-gray-400">Select a section to edit</div>
                )}
             </div>
          </div>
          
          {/* Modals */}
          {isSettingsModalOpen && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6">
                    <div className="flex justify-between mb-4">
                        <h3 className="font-bold text-lg">Template Settings</h3>
                        <button onClick={() => setIsSettingsModalOpen(false)}><X size={20} /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Primary Color</label>
                            <input type="color" className="w-full h-10 rounded cursor-pointer" value={metaSettings.primaryColor} onChange={(e) => setMetaSettings({...metaSettings, primaryColor: e.target.value})} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Page Size</label>
                            <select className="w-full border rounded p-2 text-sm" value={metaSettings.pageSize} onChange={(e) => setMetaSettings({...metaSettings, pageSize: e.target.value as any})}>
                                <option value="a4">A4</option>
                                <option value="letter">US Letter</option>
                                <option value="a5">A5</option>
                            </select>
                        </div>
                    </div>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Footer Text (Global)</label>
                        <input className="w-full border rounded p-2 text-sm" value={metaSettings.footerText || ''} onChange={(e) => setMetaSettings({...metaSettings, footerText: e.target.value})} placeholder="e.g. Copyright 2025 Company Name" />
                    </div>
                    <div className="flex justify-end gap-2 mt-6">
                        <button onClick={() => setIsSettingsModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                        <button onClick={handleSaveMetadata} className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700">Save Settings</button>
                    </div>
                </div>
              </div>
          )}
          {isConditionModalOpen && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                  <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
                      <h3 className="font-bold text-lg mb-4">Add Condition</h3>
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Condition Trigger</label>
                        <select className="w-full border p-2 rounded text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={condFeatureId} onChange={(e) => setCondFeatureId(e.target.value)}>
                            <option value="manual">Manual Selection (Optional Block)</option>
                            <optgroup label="Auto-include based on Feature">
                                {categoryFeatures.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </optgroup>
                        </select>
                        <p className="text-xs text-muted mt-1">{condFeatureId === 'manual' ? "User decides whether to include this text when generating the manual." : "Text is automatically included if the project has this feature active."}</p>
                      </div>
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Content to Show</label>
                        <textarea className="w-full border p-2 rounded outline-none focus:ring-2 focus:ring-indigo-500" rows={3} value={condText} onChange={(e) => setCondText(e.target.value)} placeholder="Text to show if condition matches..." />
                      </div>
                      <div className="flex justify-end gap-3">
                        <button onClick={() => setIsConditionModalOpen(false)} className="text-gray-600">Cancel</button>
                        <button onClick={handleInsertCondition} className="bg-indigo-600 text-white px-4 py-2 rounded">Insert</button>
                      </div>
                  </div>
              </div>
          )}
          {isPlaceholderModalOpen && (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in fade-in zoom-in duration-200">
                    <h3 className="font-bold text-lg mb-4">Add {placeholderConfig.type === 'text' ? 'Text' : 'Image'} Placeholder</h3>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Description / Label</label>
                        <input className="w-full border p-2 rounded outline-none focus:ring-2 focus:ring-indigo-500" placeholder={placeholderConfig.type === 'text' ? "e.g. Product Name" : "e.g. Front View"} value={placeholderConfig.label} onChange={(e) => setPlaceholderConfig({...placeholderConfig, label: e.target.value})} autoFocus onKeyDown={(e) => e.key === 'Enter' && handleConfirmPlaceholder()} />
                        <p className="text-xs text-muted mt-1">This label will be shown to the user when they fill out the manual.</p>
                    </div>
                    <div className="flex justify-end gap-3">
                        <button onClick={() => setIsPlaceholderModalOpen(false)} className="text-gray-600 hover:bg-gray-100 px-4 py-2 rounded">Cancel</button>
                        <button onClick={handleConfirmPlaceholder} className="bg-indigo-600 text-white px-4 py-2 rounded">Insert</button>
                    </div>
                </div>
            </div>
          )}

          {/* Delete Confirmation Modal */}
          <ConfirmationModal 
            isOpen={deleteModal.isOpen}
            title="Delete Section?"
            message="Are you sure you want to delete this section? All content within it will be lost."
            onConfirm={confirmDeleteSection}
            onCancel={() => setDeleteModal({ isOpen: false, sectionId: null })}
          />
       </div>
    </Layout>
  );
};

export default IMTemplateEditor;
