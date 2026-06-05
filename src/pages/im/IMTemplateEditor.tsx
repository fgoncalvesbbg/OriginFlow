
/**
 * IMTemplateEditor — authoring UI for IM templates: section tree, block references, metadata,
 * per-language content, and live preview (with AI-assisted translation).
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import { getIMTemplateByCategoryId, getIMSections, saveIMSection, deleteIMSection, getCategories, updateIMTemplate, getCategoryAttributes, getIMBlocks } from '../../services';
import { uploadIMAsset } from '../../services/im/im-asset.service';
import { IMTemplate, IMTemplateType, IM_TEMPLATE_TYPE_LABELS, IMSection, CategoryL3, CategoryAttribute, IMTemplateMetadata, IMMasterLayoutName, IMBlock, BlockRef, SharedBlockRef, CalloutVariant, FeatureConditionFields, localizedSectionTitle } from '../../types';
import { Plus, Save, Trash2, ArrowLeft, LayoutTemplate, X, CheckCircle, Clock, User, ChevronUp, ChevronDown, Settings, List, Sparkles, Loader2, Type, Image as ImageIcon, GitBranch, Info, Upload, Grid, Layers, Globe } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getAttributesForCategory } from '../../utils';
import { skuSyntheticAttribute } from '../../config/compliance.constants';
import { GoogleGenAI } from "@google/genai";
import './styles/im-content.css';
import { getIMThemeVariables } from './styles/im-theme';
import { InlineHtmlRow, CALLOUT_VARIANTS } from './editor/InlineBlockEditor';
import { ConfirmationModal } from '../../components/common/ConfirmationModal';

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

const SECTION_LAYOUT_OPTIONS: { value: IMMasterLayoutName; label: string }[] = [
  { value: 'chapter', label: 'Chapter' },
  { value: 'body', label: 'Body' },
  { value: 'appendix', label: 'Appendix' },
  { value: 'cover', label: 'Cover' },
  { value: 'end', label: 'End' }
];

/** Stable serialization of a section, used to detect unsaved (dirty) changes. */
const sectionSnapshotKey = (s: IMSection): string => JSON.stringify(s);

const IMTemplateEditor: React.FC = () => {
  const { categoryId, templateType: templateTypeParam } = useParams<{ categoryId: string; templateType?: string }>();
  const templateType: IMTemplateType = templateTypeParam === 'warning_leaflet' ? 'warning_leaflet' : 'im';
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

  // Snapshot of each section as last persisted — diffing against it tells us
  // which sections have unsaved edits, so both manual Save and autosave only
  // write what actually changed.
  const savedSnapshot = useRef<Map<string, string>>(new Map());
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const [categoryAttributes, setCategoryAttributes] = useState<CategoryAttribute[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);

  const [activeSidebarTab, setActiveSidebarTab] = useState<'structure' | 'assets'>('structure');
  const [assets, setAssets] = useState<string[]>([]);

  const [isLangModalOpen, setIsLangModalOpen] = useState(false);
  const [langDraft, setLangDraft] = useState<string[]>(['en']);
  const [isConditionModalOpen, setIsConditionModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isPlaceholderModalOpen, setIsPlaceholderModalOpen] = useState(false);
  const [isSectionCondModalOpen, setIsSectionCondModalOpen] = useState(false);
  const [secCondAttrId, setSecCondAttrId] = useState('');
  const [secCondEnumSelected, setSecCondEnumSelected] = useState<string[]>([]);
  const [secCondNumMin, setSecCondNumMin] = useState('');
  const [secCondNumMax, setSecCondNumMax] = useState('');
  const [secCondBoolValue, setSecCondBoolValue] = useState('true');
  const [secCondTextValue, setSecCondTextValue] = useState('');
  
  // Use the Delete Modal state to trigger the custom modal instead of window.confirm
  const [deleteModal, setDeleteModal] = useState<{isOpen: boolean, sectionId: string | null}>({ isOpen: false, sectionId: null });

  const [condText, setCondText] = useState('');
  const [condFeatureId, setCondFeatureId] = useState('');
  const [condEnumSelected, setCondEnumSelected] = useState<string[]>([]);
  const [condNumMin, setCondNumMin] = useState('');
  const [condNumMax, setCondNumMax] = useState('');
  const [condBoolValue, setCondBoolValue] = useState('true');
  const [condTextValue, setCondTextValue] = useState('');
  const [condUseAttrValue, setCondUseAttrValue] = useState(false);
  const [condAnyValue, setCondAnyValue] = useState(false);
  const [placeholderConfig, setPlaceholderConfig] = useState<{type: 'text' | 'image', label: string}>({ type: 'text', label: '' });
  const [placeholderAttrId, setPlaceholderAttrId] = useState<string>('');

  // Block library state
  const [availableBlocks, setAvailableBlocks] = useState<IMBlock[]>([]);
  const [showBlockPicker, setShowBlockPicker] = useState(false);
  const [blockPickerSearch, setBlockPickerSearch] = useState('');

  // SKU slot state
  const [showSkuSlotForm, setShowSkuSlotForm] = useState(false);
  const [skuSlotDraft, setSkuSlotDraft] = useState<{ slot: string; schema: 'rich_text' | 'annotated_image_set' | 'legend_table' | 'step_sequence'; labelEn: string; required: boolean }>({ slot: '', schema: 'rich_text', labelEn: '', required: true });

  // Block condition modal state
  const [isBlockCondModalOpen, setIsBlockCondModalOpen] = useState(false);
  const [blockCondSectionId, setBlockCondSectionId] = useState('');
  const [blockCondRefIdx, setBlockCondRefIdx] = useState(0);
  const [blockCondMode, setBlockCondMode] = useState<'present' | 'absent'>('present');
  const [blockCondAttrId, setBlockCondAttrId] = useState('');
  const [blockCondEnumSelected, setBlockCondEnumSelected] = useState<string[]>([]);
  const [blockCondNumMin, setBlockCondNumMin] = useState('');
  const [blockCondNumMax, setBlockCondNumMax] = useState('');
  const [blockCondBoolValue, setBlockCondBoolValue] = useState('true');
  const [blockCondTextValue, setBlockCondTextValue] = useState('');

  const [metaSettings, setMetaSettings] = useState<IMTemplateMetadata>({
     pageSize: 'a4',
     primaryColor: '#0f172a',
     coverImageUrl: '',
     companyLogoUrl: '',
     companyName: '',
     backPageContent: '',
     footerText: '',
     fontFamily: 'Inter',
     masterPages: { cover: {}, chapter: {}, body: {}, appendix: {}, end: {} },
     sectionLayoutMap: {}
  });

  useEffect(() => {
    if (!categoryId) return;
    loadData();
  }, [categoryId, templateType]);

  const loadData = async () => {
    if (!categoryId) return;
    try {
      const [cats, temp, attrs, blks] = await Promise.all([
          getCategories(),
          getIMTemplateByCategoryId(categoryId, templateType),
          getCategoryAttributes(),
          getIMBlocks()
      ]);
      setCategory(cats.find(c => c.id === categoryId) || null);
      setCategoryAttributes(attrs);
      setAvailableBlocks(blks);

      if (temp) {
        setTemplate(temp);
        setTemplateLanguages(temp.languages || ['en', 'de', 'fr', 'es', 'it']);
        if (temp.metadata) {
          setMetaSettings({
            pageSize: temp.metadata.pageSize || 'a4',
            primaryColor: temp.metadata.primaryColor || '#0f172a',
            coverImageUrl: temp.metadata.coverImageUrl || '',
            companyLogoUrl: temp.metadata.companyLogoUrl || '',
            companyName: temp.metadata.companyName || '',
            backPageContent: temp.metadata.backPageContent || '',
            footerText: temp.metadata.footerText || '',
            fontFamily: temp.metadata.fontFamily || 'Inter',
            masterPages: { cover: {}, chapter: {}, body: {}, appendix: {}, end: {}, ...(temp.metadata.masterPages || {}) },
            sectionLayoutMap: temp.metadata.sectionLayoutMap || {}
          });
        }

        const secs = await getIMSections(temp.id);
        // Sections with content but no block_refs get an auto inline row so the
        // row composer can display them without a separate data migration.
        const normalizedSecs = secs.map(s => {
          if ((s.blockRefs ?? []).length === 0 && Object.values(s.content || {}).some(v => v)) {
            return { ...s, blockRefs: [{ kind: 'inline' as const, content: s.content }] };
          }
          return s;
        });
        setSections(normalizedSecs);
        // Baseline snapshot — these match the DB, so nothing is dirty on load.
        savedSnapshot.current = new Map(normalizedSecs.map(s => [s.id, sectionSnapshotKey(s)]));
        if (normalizedSecs.length > 0 && !selectedSectionId) {
           setSelectedSectionId(normalizedSecs[0].id);
        }
      }
    } catch (e) {
      console.error('Failed to load template data', e);
    } finally {
      setLoading(false);
    }
  };

  const insertHtmlToCurrentEditor = (html: string) => {
      if ((window as any).currentEditorInsertHtml) {
          (window as any).currentEditorInsertHtml(html);
      }
  };

  const handleInsertPlaceholder = (type: 'text' | 'image') => {
    setPlaceholderConfig({ type, label: '' });
    setPlaceholderAttrId('');
    setIsPlaceholderModalOpen(true);
  };

  const handleConfirmPlaceholder = () => {
    const label = placeholderConfig.label.trim() || (placeholderConfig.type === 'text' ? 'Text' : 'Image');
    // When bound to an attribute, use the attribute id as data-id so the generator
    // resolves the value (e.g. a supplier-uploaded product image) automatically.
    const id = placeholderAttrId || Math.random().toString(36).substr(2, 9);
    const type = placeholderConfig.type;
    const colorClass = type === 'text' ? 'bg-amber-100 border-yellow-300 text-amber-800' : 'bg-indigo-100 border-indigo-300 text-blue-800';
    const labelAttr = encodeURIComponent(label);
    const attrAttr = placeholderAttrId ? ` data-attr-id="${placeholderAttrId}"` : '';
    const html = `&nbsp;<span class="im-placeholder ${colorClass} border px-2 py-0.5 rounded text-xs font-bold select-none mx-1" contenteditable="false" data-type="${type}" data-id="${id}"${attrAttr} data-label="${labelAttr}">[${label}]</span>&nbsp;`;
    // Prefer the row-aware fan-out (shares the placeholder across all languages);
    // fall back to a plain caret insert if no row registered one.
    if ((window as any).currentEditorCommitPlaceholder) {
      (window as any).currentEditorCommitPlaceholder(html);
    } else {
      insertHtmlToCurrentEditor(html);
    }
    setIsPlaceholderModalOpen(false);
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

  const resetCondValue = () => {
      setCondEnumSelected([]);
      setCondNumMin('');
      setCondNumMax('');
      setCondBoolValue('true');
      setCondTextValue('');
      setCondUseAttrValue(false);
      setCondAnyValue(false);
  };

  const buildSectionConditionValue = (): string => {
      const attr = categoryFeatures.find(f => f.id === secCondAttrId);
      if (!attr) return '';
      switch (attr.dataType) {
          case 'enum':    return secCondEnumSelected.join(', ');
          case 'integer':
          case 'decimal': {
              const unit = attr.validationRules?.unit ? ` ${attr.validationRules.unit}` : '';
              if (secCondNumMin && secCondNumMax) return `${secCondNumMin}–${secCondNumMax}${unit}`;
              return `${secCondNumMin || secCondNumMax}${unit}`;
          }
          case 'boolean': return secCondBoolValue === 'true' ? 'Yes' : 'No';
          case 'text':    return secCondTextValue;
          default:        return '';
      }
  };

  const openSectionCondModal = () => {
      const section = sections.find(s => s.id === selectedSectionId);
      if (!section) return;
      setSecCondAttrId(section.conditionFeatureId || '');
      setSecCondEnumSelected([]);
      setSecCondNumMin('');
      setSecCondNumMax('');
      setSecCondBoolValue('true');
      setSecCondTextValue('');
      // Prepopulate if already has a condition
      if (section.conditionFeatureId && section.conditionLabel) {
          const attr = categoryFeatures.find(f => f.id === section.conditionFeatureId);
          if (attr) {
              const cv = section.conditionLabel;
              if (attr.dataType === 'enum') setSecCondEnumSelected(cv.split(',').map(s => s.trim()).filter(Boolean));
              else if (attr.dataType === 'boolean') setSecCondBoolValue(cv === 'Yes' ? 'true' : 'false');
              else if (attr.dataType === 'integer' || attr.dataType === 'decimal') {
                  const rangeMatch = cv.match(/^([\d.]+)\s*[–-]\s*([\d.]+)/);
                  if (rangeMatch) { setSecCondNumMin(rangeMatch[1]); setSecCondNumMax(rangeMatch[2]); }
                  else setSecCondNumMin(cv.replace(/[^\d.]/g, ''));
              } else setSecCondTextValue(cv);
          }
      }
      setIsSectionCondModalOpen(true);
  };

  const handleSaveSectionCondition = () => {
      if (!secCondAttrId) return;
      const cv = buildSectionConditionValue();
      if (!cv) return;
      updateCurrentSection({ conditionFeatureId: secCondAttrId, conditionLabel: cv });
      setIsSectionCondModalOpen(false);
  };

  const handleClearSectionCondition = () => {
      updateCurrentSection({ conditionFeatureId: null, conditionLabel: null });
  };

  const handleOpenConditionModal = () => {
      setCondText('');
      setCondFeatureId('manual');
      resetCondValue();
      setIsConditionModalOpen(true);
  };

  const buildConditionValue = (): string => {
      const attr = categoryFeatures.find(f => f.id === condFeatureId);
      if (!attr) return '';
      switch (attr.dataType) {
          case 'enum':    return condEnumSelected.join(', ');
          case 'integer':
          case 'decimal': {
              const unit = attr.validationRules?.unit ? ` ${attr.validationRules.unit}` : '';
              if (condNumMin && condNumMax) return `${condNumMin}–${condNumMax}${unit}`;
              return `${condNumMin || condNumMax}${unit}`;
          }
          case 'boolean': return condBoolValue === 'true' ? 'Yes' : 'No';
          case 'text':    return condTextValue;
          default:        return '';
      }
  };

  const handleInsertCondition = () => {
      const id = Math.random().toString(36).substr(2, 9);
      let featureName = "";
      let conditionLabel = "";
      if (condFeatureId !== 'manual') {
          const feat = categoryAttributes.find(f => f.id === condFeatureId);
          if (feat) { featureName = feat.name; }
          if (!condAnyValue) conditionLabel = buildConditionValue();
      }

      // "Any value" mode: inserts an always-visible value placeholder
      if (condAnyValue && condFeatureId !== 'manual') {
          const safeFeatureName = encodeURIComponent(featureName);
          const html = `&nbsp;<span class="im-condition bg-amber-50 border-amber-300 text-amber-800 border border-dashed px-2 py-1 rounded text-sm mx-1" contenteditable="false" data-id="${id}" data-feature-id="${condFeatureId}" data-feature-name="${featureName}" data-content="${safeFeatureName}" data-condition-value="*" data-always="true" title="Value: ${featureName}"><span class="font-bold text-xs uppercase mr-1">[${featureName}]</span></span>&nbsp;`;
          insertHtmlToCurrentEditor(html);
          setIsConditionModalOpen(false);
          return;
      }

      const effectiveContent = condUseAttrValue && conditionLabel ? conditionLabel : condText;
      if (!effectiveContent.trim()) return;
      const displayLabel = condFeatureId === 'manual'
          ? 'Optional'
          : conditionLabel ? `${featureName}: ${conditionLabel}` : featureName;
      const safeText = encodeURIComponent(effectiveContent);
      const safeCondVal = encodeURIComponent(conditionLabel);
      const html = `&nbsp;<span class="im-condition bg-purple-50 border-indigo-300 text-purple-800 border border-dashed px-2 py-1 rounded text-sm mx-1" contenteditable="false" data-id="${id}" data-feature-id="${condFeatureId}" data-content="${safeText}" data-feature-name="${featureName}" data-condition-value="${safeCondVal}" title="Condition: ${displayLabel}"><span class="font-bold text-xs uppercase mr-1">[${displayLabel}]</span> ${effectiveContent.substring(0, 20)}${effectiveContent.length > 20 ? '...' : ''}</span>&nbsp;`;
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
        savedSnapshot.current.set(saved.id, sectionSnapshotKey(saved));
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
        savedSnapshot.current.set(saved.id, sectionSnapshotKey(saved));
        setSections([...sections, saved]);
        setSelectedSectionId(saved.id);
        setTemplate(prev => prev ? ({ ...prev, lastUpdatedBy: user?.name || 'User', updatedAt: new Date().toISOString() }) : null);
        setLastSaved(new Date());
    } catch (e) { console.error(e); }
  };

  /** Sections whose current state differs from the last persisted snapshot. */
  const getDirtySections = useCallback(
    () => sections.filter(s => savedSnapshot.current.get(s.id) !== sectionSnapshotKey(s)),
    [sections]
  );

  /** Persist the given sections in parallel and mark them clean. */
  const persistSections = useCallback(async (targets: IMSection[]): Promise<boolean> => {
    if (targets.length === 0) return true;
    // Capture the exact serialized state we're about to save, before any await,
    // so edits made during the save remain flagged dirty for the next pass.
    const pending = targets.map(s => ({ id: s.id, key: sectionSnapshotKey(s), section: s }));
    setSaving(true);
    try {
      await Promise.all(pending.map(p => saveIMSection(p.section)));
      pending.forEach(p => savedSnapshot.current.set(p.id, p.key));
      setTemplate(prev => prev ? ({ ...prev, lastUpdatedBy: user?.name || 'User', updatedAt: new Date().toISOString() }) : null);
      setLastSaved(new Date());
      return true;
    } catch (e) {
      console.error('Failed to save sections', e);
      return false;
    } finally {
      setSaving(false);
    }
  }, [user]);

  const handleSaveAll = async () => {
    if (autosaveTimer.current) { clearTimeout(autosaveTimer.current); autosaveTimer.current = null; }
    const dirty = getDirtySections();
    if (dirty.length === 0) { setLastSaved(new Date()); return; }
    const ok = await persistSections(dirty);
    if (!ok) alert('Error saving sections — see console for details.');
  };

  // Debounced autosave — persist dirty sections ~2.5s after the last edit.
  useEffect(() => {
    if (loading || saving) return;
    const dirty = getDirtySections();
    if (dirty.length === 0) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => { persistSections(dirty); }, 2500);
    return () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current); };
  }, [sections, loading, saving, getDirtySections, persistSections]);

  // Warn before leaving with unsaved edits (e.g. a slow/failed autosave).
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (getDirtySections().length > 0) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [getDirtySections]);

  const handleDeleteSection = (id: string) => {
    // Open modal instead of window.confirm
    setDeleteModal({ isOpen: true, sectionId: id });
  };

  const confirmDeleteSection = async () => {
    if (!deleteModal.sectionId) return;
    const id = deleteModal.sectionId;
    await deleteIMSection(id);
    const newSections = sections.filter(s => s.id !== id && s.parentId !== id);
    savedSnapshot.current.delete(id);
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
        // Re-baseline the moved sections so the new order isn't seen as dirty.
        updates.forEach(u => savedSnapshot.current.set(u.id, sectionSnapshotKey(u)));
        setLastSaved(new Date());
    } catch (e) {
        console.error("Reorder failed", e);
        loadData();
    }
  };

  const updateCurrentSection = (updates: Partial<IMSection>) => {
    setSections(prev => prev.map(s => s.id === selectedSectionId ? { ...s, ...updates } : s));
  };

  // Legacy single-editor update (kept for AI translate path which reads section.content)
  const updateContent = useCallback((htmlValue: string) => {
    setSections(prevSections => {
      if (!selectedSectionId) return prevSections;
      return prevSections.map(s => s.id === selectedSectionId ? { ...s, content: { ...s.content, [activeLang]: htmlValue } } : s);
    });
  }, [selectedSectionId, activeLang]);

  // Row composer handlers
  const updateInlineRefContent = useCallback((refIndex: number, lang: string, html: string) => {
    setSections(prev => prev.map(s => {
      if (s.id !== selectedSectionId) return s;
      const refs = [...(s.blockRefs ?? [])];
      const ref = refs[refIndex];
      if (!ref || ref.kind !== 'inline') return s;
      refs[refIndex] = { ...ref, content: { ...ref.content, [lang]: html } };
      // Keep section.content in sync for the PDF renderer's legacy path
      return { ...s, blockRefs: refs, content: { ...s.content, [lang]: html } };
    }));
  }, [selectedSectionId]);

  // Set/clear the ISO callout box that wraps an inline row's whole content.
  const updateInlineRefVariant = useCallback((refIndex: number, variant: CalloutVariant | undefined) => {
    setSections(prev => prev.map(s => {
      if (s.id !== selectedSectionId) return s;
      const refs = [...(s.blockRefs ?? [])];
      const ref = refs[refIndex];
      if (!ref || ref.kind !== 'inline') return s;
      const { variant: _drop, ...rest } = ref;
      refs[refIndex] = variant ? { ...rest, variant } : { ...rest };
      return { ...s, blockRefs: refs };
    }));
  }, [selectedSectionId]);

  const addInlineRow = () => {
    setSections(prev => prev.map(s => {
      if (s.id !== selectedSectionId) return s;
      const newRef: BlockRef = { kind: 'inline', content: {} };
      return { ...s, blockRefs: [...(s.blockRefs ?? []), newRef] };
    }));
  };

  const moveRow = (fromIdx: number, toIdx: number) => {
    setSections(prev => prev.map(s => {
      if (s.id !== selectedSectionId) return s;
      const refs = [...(s.blockRefs ?? [])];
      if (toIdx < 0 || toIdx >= refs.length) return s;
      const [moved] = refs.splice(fromIdx, 1);
      refs.splice(toIdx, 0, moved);
      return { ...s, blockRefs: refs };
    }));
  };

  const removeRef = (index: number) => {
    setSections(prev => prev.map(s =>
      s.id === selectedSectionId
        ? { ...s, blockRefs: (s.blockRefs ?? []).filter((_, i) => i !== index) }
        : s
    ));
  };

  const openBlockCondModal = (sectionId: string, refIdx: number, existing?: FeatureConditionFields) => {
    setBlockCondSectionId(sectionId);
    setBlockCondRefIdx(refIdx);
    if (existing?.requires_feature_absent) {
      setBlockCondMode('absent');
      setBlockCondAttrId(existing.requires_feature_absent);
    } else {
      setBlockCondMode('present');
      setBlockCondAttrId(existing?.requires_feature ?? '');
      // Restore value state from existing condition
      if (existing?.requires_feature_label) {
        const attr = categoryAttributes.find(a => a.id === existing.requires_feature);
        if (attr?.dataType === 'enum') setBlockCondEnumSelected(existing.requires_feature_label.split(',').map(s => s.trim()).filter(Boolean));
        else if (attr?.dataType === 'boolean') setBlockCondBoolValue(existing.requires_feature_label === 'Yes' ? 'true' : 'false');
        else setBlockCondTextValue(existing.requires_feature_label);
      } else {
        setBlockCondEnumSelected([]);
        setBlockCondTextValue('');
        setBlockCondBoolValue('true');
      }
      setBlockCondNumMin(existing?.requires_feature_num_min ?? '');
      setBlockCondNumMax(existing?.requires_feature_num_max ?? '');
    }
    setIsBlockCondModalOpen(true);
  };

  const buildBlockConditionValue = (): string => {
    const attr = categoryAttributes.find(a => a.id === blockCondAttrId);
    if (!attr) return '';
    switch (attr.dataType) {
      case 'enum':    return blockCondEnumSelected.join(', ');
      case 'integer':
      case 'decimal': {
        const unit = attr.validationRules?.unit ? ` ${attr.validationRules.unit}` : '';
        if (blockCondNumMin && blockCondNumMax) return `${blockCondNumMin}–${blockCondNumMax}${unit}`;
        return `${blockCondNumMin || blockCondNumMax}${unit}`;
      }
      case 'boolean': return blockCondBoolValue === 'true' ? 'Yes' : 'No';
      case 'text':    return blockCondTextValue;
      default:        return '';
    }
  };

  const handleSaveBlockCondition = () => {
    if (!blockCondAttrId) return;
    const attr = categoryAttributes.find(a => a.id === blockCondAttrId);
    const isNumeric = attr?.dataType === 'integer' || attr?.dataType === 'decimal';
    const label = buildBlockConditionValue();
    setSections(prev => prev.map(s => {
      if (s.id !== blockCondSectionId) return s;
      const refs = [...(s.blockRefs ?? [])];
      const ref = refs[blockCondRefIdx];
      if (!ref || ref.kind === 'sku_slot') return s;
      refs[blockCondRefIdx] = {
        ...ref,
        requires_feature: blockCondMode === 'present' ? blockCondAttrId : undefined,
        requires_feature_label: (blockCondMode === 'present' && !isNumeric && label) ? label : undefined,
        requires_feature_num_min: (blockCondMode === 'present' && isNumeric && blockCondNumMin) ? blockCondNumMin : undefined,
        requires_feature_num_max: (blockCondMode === 'present' && isNumeric && blockCondNumMax) ? blockCondNumMax : undefined,
        requires_feature_absent: blockCondMode === 'absent' ? blockCondAttrId : undefined,
      } as typeof ref;
      return { ...s, blockRefs: refs };
    }));
    setIsBlockCondModalOpen(false);
  };

  /** Human-readable "Show if" description for a ref's feature condition, or null when unconditioned. */
  const describeRefCondition = (ref: FeatureConditionFields): string | null => {
    const condAttrId = ref.requires_feature ?? ref.requires_feature_absent ?? null;
    if (!condAttrId) return null;
    const condAttr = categoryAttributes.find(a => a.id === condAttrId);
    if (!condAttr) return null;
    if (ref.requires_feature_absent) return `${condAttr.name}: absent`;
    if (ref.requires_feature_label) return `${condAttr.name} ∈ ${ref.requires_feature_label}`;
    if (ref.requires_feature_num_min && ref.requires_feature_num_max) return `${condAttr.name}: ${ref.requires_feature_num_min}–${ref.requires_feature_num_max}`;
    if (ref.requires_feature_num_min) return `${condAttr.name} ≥ ${ref.requires_feature_num_min}`;
    if (ref.requires_feature_num_max) return `${condAttr.name} ≤ ${ref.requires_feature_num_max}`;
    return `${condAttr.name}: has value`;
  };

  const clearBlockCondition = (sectionId: string, refIdx: number) => {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s;
      const refs = [...(s.blockRefs ?? [])];
      const ref = refs[refIdx];
      if (!ref || ref.kind === 'sku_slot') return s;
      refs[refIdx] = {
        ...ref,
        requires_feature: undefined,
        requires_feature_label: undefined,
        requires_feature_num_min: undefined,
        requires_feature_num_max: undefined,
        requires_feature_absent: undefined,
      } as typeof ref;
      return { ...s, blockRefs: refs };
    }));
  };

  const addBlockRef = (blockId: string) => {
    setSections(prev => prev.map(s => {
      if (s.id !== selectedSectionId) return s;
      const already = (s.blockRefs ?? []).some(r => r.kind === 'block' && r.block_id === blockId);
      if (already) return s;
      const newRef: BlockRef = { kind: 'block', block_id: blockId };
      return { ...s, blockRefs: [...(s.blockRefs ?? []), newRef] };
    }));
    setShowBlockPicker(false);
    setBlockPickerSearch('');
  };

  const removeBlockRef = (blockId: string) => {
    setSections(prev => prev.map(s =>
      s.id === selectedSectionId
        ? { ...s, blockRefs: (s.blockRefs ?? []).filter(r => !(r.kind === 'block' && r.block_id === blockId)) }
        : s
    ));
  };

  const addSkuSlotRef = () => {
    const { slot, schema, labelEn, required } = skuSlotDraft;
    if (!slot.trim() || !labelEn.trim()) return;
    const newRef: BlockRef = { kind: 'sku_slot', slot: slot.trim(), schema, label: { en: labelEn.trim() }, required };
    setSections(prev => prev.map(s =>
      s.id === selectedSectionId
        ? { ...s, blockRefs: [...(s.blockRefs ?? []), newRef] }
        : s
    ));
    setShowSkuSlotForm(false);
    setSkuSlotDraft({ slot: '', schema: 'rich_text', labelEn: '', required: true });
  };

  const removeSkuSlotRef = (slot: string) => {
    setSections(prev => prev.map(s =>
      s.id === selectedSectionId
        ? { ...s, blockRefs: (s.blockRefs ?? []).filter(r => !(r.kind === 'sku_slot' && r.slot === slot)) }
        : s
    ));
  };

  const openLangModal = () => {
    setLangDraft(templateLanguages);
    setIsLangModalOpen(true);
  };

  const handleSaveLanguages = async () => {
    if (!template) return;
    // English is always included; keep the canonical ALL_LANGUAGES ordering.
    const ordered = ALL_LANGUAGES.map(l => l.code).filter(c => c === 'en' || langDraft.includes(c));
    setSaving(true);
    try {
      await updateIMTemplate(template.id, { languages: ordered, lastUpdatedBy: user?.name });
      setTemplateLanguages(ordered);
      setTemplate(prev => prev ? ({ ...prev, languages: ordered }) : prev);
      if (!ordered.includes(activeLang)) setActiveLang('en');
      setLastSaved(new Date());
      setIsLangModalOpen(false);
    } catch (e) {
      console.error('Failed to save template languages', e);
      alert('Failed to save languages — see console for details.');
    } finally {
      setSaving(false);
    }
  };

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
    const hasContent = !!(englishContent && englishContent.trim());
    // Allow translating placeholder sections too — they may have no content but still
    // need their title localized. Only block when there's nothing at all to translate.
    if (!hasContent && !section.title?.trim()) { alert("Please add an English title or content first."); return; }
    setIsTranslating(true);
    try {
      const targetLangLabel = ALL_LANGUAGES.find(l => l.code === activeLang)?.label || activeLang;
      const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

      // Translate the section title (plain text) so titles localize alongside content.
      if (section.title?.trim()) {
        const titleResp = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: { parts: [{ text: `Translate this short UI section title to ${targetLangLabel}. Return ONLY the translated text, no quotes or extra words. Title: ${section.title}` }] },
        });
        const translatedTitle = titleResp.text?.trim().replace(/^["']|["']$/g, '') || '';
        if (translatedTitle) {
          updateCurrentSection({ titleI18n: { ...(section.titleI18n ?? {}), [activeLang]: translatedTitle } });
        }
      }

      // Translate the body HTML when present.
      if (hasContent) {
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: {
            parts: [{ text: `Translate HTML to ${targetLangLabel}. Preserve HTML tags, classes, styles, bullet points, and placeholder spans exactly. Content: ${englishContent}` }]
          }
        });
        const cleanText = response.text?.trim().replace(/^```html/, '').replace(/^```/, '').replace(/```$/, '') || '';
        updateContent(cleanText);
      }
    } catch (e: any) {
      alert("AI Translation failed: " + (e.message || e.toString()));
    } finally {
      setIsTranslating(false);
    }
  };


  const handleSectionLayoutChange = async (sectionId: string, layout: IMMasterLayoutName) => {
    if (!template) return;

    const nextMetadata: IMTemplateMetadata = {
      ...metaSettings,
      sectionLayoutMap: {
        ...(metaSettings.sectionLayoutMap || {}),
        [sectionId]: layout
      }
    };

    setMetaSettings(nextMetadata);
    setTemplate(prev => prev ? ({ ...prev, metadata: nextMetadata }) : prev);

    try {
      await updateIMTemplate(template.id, { metadata: nextMetadata, lastUpdatedBy: user?.name });
      setLastSaved(new Date());
    } catch (e) {
      console.error('Failed to save section layout mapping', e);
    }
  };

  const renderSidebarItem = (s: IMSection, indexPrefix: string, level: number) => {
     const children = sections.filter(sec => sec.parentId === s.id).sort((a, b) => (a.order || 0) - (b.order || 0));
     const selectedLayout = metaSettings.sectionLayoutMap?.[s.id] || 'body';
     return (
       <div key={s.id} className="flex flex-col">
           <div onClick={() => setSelectedSectionId(s.id)} className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm group transition-colors ${selectedSectionId === s.id ? 'bg-indigo-50 text-indigo-700 font-medium border border-indigo-200' : 'text-gray-600 hover:bg-light border border-transparent'}`} style={{ paddingLeft: `${(level * 12) + 8}px` }}>
              <span className="text-gray-400 text-xs font-mono min-w-[24px]">{indexPrefix}</span>
              <span className="truncate flex-1">{localizedSectionTitle(s, activeLang)}</span>
              <div className="flex items-center opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                  {level === 0 && <button onClick={(e) => { e.stopPropagation(); handleAddSubSection(s.id); }} className="text-gray-400 hover:text-indigo-600 p-1 hover:bg-indigo-100 rounded"><Plus size={12} /></button>}
                  <div className="flex flex-col">
                     <button onClick={(e) => handleReorder(e, s.id, 'up')} className="text-gray-400 hover:text-indigo-600 p-1 hover:bg-indigo-100 rounded"><ChevronUp size={12} /></button>
                     <button onClick={(e) => handleReorder(e, s.id, 'down')} className="text-gray-400 hover:text-indigo-600 p-1 hover:bg-indigo-100 rounded"><ChevronDown size={12} /></button>
                  </div>
                  <select
                    className="text-[10px] border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-600"
                    value={selectedLayout}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => handleSectionLayoutChange(s.id, e.target.value as IMMasterLayoutName)}
                  >
                    {SECTION_LAYOUT_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
              </div>
              {s.isPlaceholder && <LayoutTemplate size={12} className="text-gray-400 shrink-0" />}
              {s.conditionFeatureId && <span title="Conditional chapter"><GitBranch size={12} className="text-violet-400 shrink-0" /></span>}
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
  // Offer the synthetic SKU attribute first so authors can bind placeholders/conditions to the
  // project's SKU identifier; it resolves to the SKU number(s) at generation time.
  const categoryFeatures = [
    skuSyntheticAttribute(),
    ...(categoryId ? getAttributesForCategory(categoryAttributes, categoryId) : []),
  ];
  const imThemeVars = getIMThemeVariables(metaSettings);
  const unsavedCount = getDirtySections().length;

  return (
    <Layout>
       <div className="flex flex-col h-[calc(100vh-100px)]" style={imThemeVars}>
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
               <button onClick={() => navigate('/im')} className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20}/></button>
               <div>
                 <h2 className="text-xl font-bold text-primary flex items-center gap-2">
                   {category?.name} — {IM_TEMPLATE_TYPE_LABELS[templateType]}
                   {templateType === 'warning_leaflet' && (
                     <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">Leaflet</span>
                   )}
                 </h2>
                 <div className="flex items-center gap-4 text-xs text-muted mt-1">
                    {template.updatedAt && <span className="flex items-center gap-1"><Clock size={12} /> Saved: {new Date(template.updatedAt).toLocaleDateString()}</span>}
                    {template.lastUpdatedBy && <span className="flex items-center gap-1"><User size={12} /> By: {template.lastUpdatedBy}</span>}
                    {saving ? (
                      <span className="text-indigo-600 flex items-center gap-1 bg-indigo-50 px-2 py-0.5 rounded-full font-medium"><Loader2 size={10} className="animate-spin" /> Saving…</span>
                    ) : unsavedCount > 0 ? (
                      <span className="text-amber-600 flex items-center gap-1 bg-amber-50 px-2 py-0.5 rounded-full font-medium"><Clock size={10} /> {unsavedCount} unsaved</span>
                    ) : lastSaved ? (
                      <span className="text-emerald-600 flex items-center gap-1 bg-emerald-50 px-2 py-0.5 rounded-full font-medium"><CheckCircle size={10} /> Saved</span>
                    ) : null}
                 </div>
               </div>
            </div>

            <div className="flex gap-3 items-center">
               <button onClick={openLangModal} className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded-xl text-sm font-medium hover:bg-light shadow"><Globe size={16} /> Languages <span className="text-xs font-bold bg-indigo-100 text-indigo-700 rounded-full px-1.5">{templateLanguages.length}</span></button>
               <button onClick={() => setIsSettingsModalOpen(true)} className="flex items-center gap-2 bg-white border border-gray-300 text-gray-700 px-3 py-2 rounded-xl text-sm font-medium hover:bg-light shadow"><Settings size={16} /> Settings</button>
               <button onClick={handleSaveAll} disabled={saving} className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-70 shadow ml-2"><Save size={16} /> {saving ? 'Saving...' : unsavedCount > 0 ? `Save All (${unsavedCount})` : 'Save All'}</button>
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
                           <div className="text-xs font-bold text-gray-400 uppercase mb-1 flex items-center gap-2">
                              {currentSection.parentId ? 'Sub-Chapter' : 'Section'} title
                              {activeLang !== 'en' && <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] normal-case">{activeLang.toUpperCase()} translation</span>}
                           </div>
                           {activeLang === 'en' ? (
                             <input
                               className="w-full font-bold text-lg bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-500 outline-none text-primary"
                               value={currentSection.title}
                               onChange={(e) => updateCurrentSection({ title: e.target.value })}
                             />
                           ) : (
                             <input
                               className="w-full font-bold text-lg bg-transparent border-b border-transparent hover:border-gray-300 focus:border-indigo-500 outline-none text-primary"
                               value={currentSection.titleI18n?.[activeLang] ?? ''}
                               placeholder={currentSection.title || 'Section title'}
                               onChange={(e) => updateCurrentSection({ titleI18n: { ...(currentSection.titleI18n ?? {}), [activeLang]: e.target.value } })}
                             />
                           )}
                        </div>
                        <div className="flex items-center gap-4">
                           <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-600 select-none">
                              <input type="checkbox" checked={currentSection.isPlaceholder} onChange={(e) => updateCurrentSection({ isPlaceholder: e.target.checked })} className="rounded text-indigo-600 focus:ring-indigo-500" /> Placeholder?
                           </label>
                           <button onClick={() => handleDeleteSection(currentSection.id)} className="text-gray-400 hover:text-rose-600 p-2"><Trash2 size={16} /></button>
                        </div>
                     </div>
                     {/* Chapter condition row */}
                     <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-100 bg-light/40 text-xs">
                        <GitBranch size={13} className="text-gray-400 shrink-0" />
                        <span className="text-muted font-medium">Chapter condition:</span>
                        {currentSection.conditionFeatureId ? (() => {
                          const attr = categoryFeatures.find(a => a.id === currentSection.conditionFeatureId);
                          return (
                            <>
                              <span className="bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded font-medium">
                                {attr?.name ?? 'Unknown'}: {currentSection.conditionLabel}
                              </span>
                              <button onClick={openSectionCondModal} className="text-indigo-500 hover:text-indigo-700 hover:underline">Edit</button>
                              <button onClick={handleClearSectionCondition} className="text-rose-400 hover:text-rose-600 hover:underline">Remove</button>
                            </>
                          );
                        })() : (
                          <button onClick={openSectionCondModal} className="text-indigo-500 hover:text-indigo-700 hover:underline">Add condition…</button>
                        )}
                     </div>

                     <div className="flex items-center justify-between border-b border-gray-200 bg-light pr-2">
                        <div className="flex overflow-x-auto">
                           {availableLangsForTabs.map(lang => (
                           <button key={lang.code} onClick={() => setActiveLang(lang.code)} className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${activeLang === lang.code ? 'border-indigo-600 text-indigo-600 bg-white' : 'border-transparent text-muted hover:text-gray-700'}`}>{lang.label}</button>
                           ))}
                        </div>
                        {activeLang !== 'en' && (
                           <button onClick={handleAiTranslate} disabled={isTranslating} className="flex items-center gap-1.5 text-xs bg-purple-100 text-purple-700 px-3 py-1.5 rounded-md hover:bg-purple-200 font-medium transition-colors mr-2 disabled:opacity-60">
                              {isTranslating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                              {isTranslating ? 'Translating...' : 'AI Translate'}
                           </button>
                        )}
                     </div>

                     {/* Row composer */}
                     <div className="flex-1 flex flex-col overflow-hidden">
                       {/* Rows */}
                       <div className="flex-1 overflow-y-auto p-3 space-y-2">
                         {(currentSection.blockRefs ?? []).length === 0 && (
                           <div className="flex flex-col items-center justify-center py-10 text-gray-400 text-center">
                             <p className="text-sm font-medium mb-1">No rows yet</p>
                             <p className="text-xs">Use the buttons below to add content rows.</p>
                           </div>
                         )}
                         {(currentSection.blockRefs ?? []).map((ref, index) => {
                           const refs = currentSection.blockRefs ?? [];
                           const isFirst = index === 0;
                           const isLast = index === refs.length - 1;
                           return (
                             <div key={`${currentSection.id}-row-${index}`} className="flex gap-2 items-start">
                               {/* Reorder */}
                               <div className="flex flex-col gap-0.5 pt-2.5 shrink-0">
                                 <button onClick={() => moveRow(index, index - 1)} disabled={isFirst}
                                   className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed rounded">
                                   <ChevronUp size={13} />
                                 </button>
                                 <button onClick={() => moveRow(index, index + 1)} disabled={isLast}
                                   className="p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20 disabled:cursor-not-allowed rounded">
                                   <ChevronDown size={13} />
                                 </button>
                               </div>
                               {/* Card */}
                               <div className={`flex-1 rounded-xl border overflow-hidden ${
                                 ref.kind === 'inline'    ? 'border-gray-200 bg-white' :
                                 ref.kind === 'block'     ? 'border-indigo-200 bg-indigo-50/20' :
                                                            'border-violet-200 bg-violet-50/20'
                               }`}>
                                 {/* Card header */}
                                 <div className={`flex items-center justify-between px-3 py-1.5 border-b ${
                                   ref.kind === 'inline'    ? 'bg-gray-50 border-gray-100' :
                                   ref.kind === 'block'     ? 'bg-indigo-50 border-indigo-100' :
                                                              'bg-violet-50 border-violet-100'
                                 }`}>
                                   <div className="flex items-center gap-2 min-w-0">
                                     {ref.kind === 'inline' && (() => {
                                       const vCfg = ref.variant ? CALLOUT_VARIANTS.find(v => v.value === ref.variant) : undefined;
                                       return (
                                         <>
                                           <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Inline HTML</span>
                                           {vCfg && (
                                             <span className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${vCfg.chip}`}>
                                               <vCfg.Icon size={10} /> {vCfg.label.toUpperCase()}
                                             </span>
                                           )}
                                         </>
                                       );
                                     })()}
                                     {ref.kind === 'block' && (() => {
                                       const blk = availableBlocks.find(b => b.id === ref.block_id);
                                       return (
                                         <>
                                           <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                                             blk?.blockType === 'warning' ? 'bg-amber-100 text-amber-700' :
                                             blk?.blockType === 'caution' ? 'bg-orange-100 text-orange-700' :
                                             blk?.blockType === 'electric' ? 'bg-yellow-100 text-yellow-700' :
                                             blk?.blockType === 'flammable' ? 'bg-rose-100 text-orange-700' :
                                             blk?.blockType === 'info'    ? 'bg-sky-100 text-sky-700' :
                                                                             'bg-indigo-100 text-indigo-700'
                                           }`}>{(blk?.blockType ?? 'block').toUpperCase()}</span>
                                           <span className="text-xs font-semibold text-gray-800 truncate">{blk?.title ?? 'Unknown block'}</span>
                                           <span className="text-[10px] font-mono text-gray-400 hidden sm:block truncate">{blk?.slug}</span>
                                         </>
                                       );
                                     })()}
                                     {ref.kind === 'sku_slot' && (
                                       <>
                                         <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 shrink-0">
                                           {ref.schema.replace(/_/g, ' ').toUpperCase()}
                                         </span>
                                         <span className="text-xs font-semibold text-gray-800 truncate">{ref.label?.en ?? ref.slot}</span>
                                         <span className="text-[10px] font-mono text-gray-400 hidden sm:block truncate">{ref.slot}</span>
                                         {ref.required && <span className="text-[10px] text-rose-400 shrink-0">*required</span>}
                                       </>
                                     )}
                                   </div>
                                   <button onClick={() => removeRef(index)} className="text-gray-300 hover:text-rose-500 p-0.5 ml-2 shrink-0">
                                     <X size={13} />
                                   </button>
                                 </div>
                                 {/* Card body */}
                                 {ref.kind === 'inline' && (
                                   <>
                                     <InlineHtmlRow
                                       content={ref.content}
                                       variant={ref.variant}
                                       languages={availableLangsForTabs}
                                       sectionId={currentSection.id}
                                       index={index}
                                       onChange={(lang, html) => updateInlineRefContent(index, lang, html)}
                                       onVariantChange={(v) => updateInlineRefVariant(index, v)}
                                       onInsertPlaceholder={handleInsertPlaceholder}
                                       onInsertCondition={handleOpenConditionModal}
                                     />
                                     {/* Whole-row visibility condition — hides the row unless the condition is met */}
                                     {(() => {
                                       const condDesc = describeRefCondition(ref);
                                       return (
                                         <div className="px-3 pb-2 border-t border-gray-100 pt-2 flex items-center gap-1.5 flex-wrap">
                                           <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Show if:</span>
                                           {condDesc ? (
                                             <>
                                               <span className="text-[10px] bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full font-medium">{condDesc}</span>
                                               <button onClick={() => openBlockCondModal(currentSection.id, index, ref)}
                                                 className="text-[10px] text-indigo-400 hover:text-indigo-600 hover:underline">Edit</button>
                                               <button onClick={() => clearBlockCondition(currentSection.id, index)}
                                                 className="text-gray-300 hover:text-rose-500"><X size={11} /></button>
                                             </>
                                           ) : (
                                             <button onClick={() => openBlockCondModal(currentSection.id, index, ref)}
                                               className="text-[10px] text-indigo-400 hover:text-indigo-600 flex items-center gap-1">
                                               <GitBranch size={10} /> Add condition…
                                             </button>
                                           )}
                                         </div>
                                       );
                                     })()}
                                   </>
                                 )}
                                 {ref.kind === 'block' && (() => {
                                   const blk = availableBlocks.find(b => b.id === ref.block_id);
                                   const preview = (blk?.content['en'] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160);
                                   const condAttrId = ref.requires_feature ?? ref.requires_feature_absent ?? null;
                                   const isAbsent = !!ref.requires_feature_absent;
                                   const condAttr = condAttrId ? categoryAttributes.find(a => a.id === condAttrId) : null;

                                   // Build a human-readable condition description
                                   const condDesc = (() => {
                                     if (!condAttr) return null;
                                     if (isAbsent) return `${condAttr.name}: absent`;
                                     if (ref.requires_feature_label) return `${condAttr.name} ∈ ${ref.requires_feature_label}`;
                                     if (ref.requires_feature_num_min && ref.requires_feature_num_max) return `${condAttr.name}: ${ref.requires_feature_num_min}–${ref.requires_feature_num_max}`;
                                     if (ref.requires_feature_num_min) return `${condAttr.name} ≥ ${ref.requires_feature_num_min}`;
                                     if (ref.requires_feature_num_max) return `${condAttr.name} ≤ ${ref.requires_feature_num_max}`;
                                     return `${condAttr.name}: has value`;
                                   })();

                                   return (
                                     <>
                                       {preview ? (
                                         <div className="px-3 py-2 text-xs text-gray-500 italic leading-relaxed line-clamp-2">{preview}</div>
                                       ) : (
                                         <div className="px-3 py-2 text-xs text-gray-400 italic">No English content preview.</div>
                                       )}
                                       {/* Condition row */}
                                       <div className="px-3 pb-2 border-t border-indigo-100 pt-2 flex items-center gap-1.5 flex-wrap">
                                         <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wide">Show if:</span>
                                         {condDesc ? (
                                           <>
                                             <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full font-medium">{condDesc}</span>
                                             <button onClick={() => openBlockCondModal(currentSection.id, index, ref)}
                                               className="text-[10px] text-indigo-400 hover:text-indigo-600 hover:underline">Edit</button>
                                             <button onClick={() => clearBlockCondition(currentSection.id, index)}
                                               className="text-gray-300 hover:text-rose-500"><X size={11} /></button>
                                           </>
                                         ) : (
                                           <button onClick={() => openBlockCondModal(currentSection.id, index, ref)}
                                             className="text-[10px] text-indigo-400 hover:text-indigo-600 flex items-center gap-1">
                                             <GitBranch size={10} /> Add condition…
                                           </button>
                                         )}
                                       </div>
                                     </>
                                   );
                                 })()}
                                 {ref.kind === 'sku_slot' && (
                                   <div className="px-3 py-2 text-xs text-gray-500">
                                     Assembler fills: <span className="font-mono text-violet-700">{ref.slot}</span>
                                   </div>
                                 )}
                               </div>
                             </div>
                           );
                         })}
                       </div>

                       {/* Add-row bar */}
                       <div className="border-t border-gray-100 bg-light/40 px-3 py-2 flex flex-wrap items-center gap-2">
                         <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Add row:</span>
                         <button onClick={addInlineRow}
                           className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-600 hover:border-gray-400 hover:text-gray-800 font-medium">
                           <Plus size={11} /> Inline HTML
                         </button>
                         <button onClick={() => { setShowBlockPicker(true); setBlockPickerSearch(''); }}
                           className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-medium">
                           <Layers size={11} /> Shared Block
                         </button>
                         <button onClick={() => { setShowSkuSlotForm(true); setSkuSlotDraft({ slot: '', schema: 'rich_text', labelEn: '', required: true }); }}
                           className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 font-medium">
                           <Grid size={11} /> SKU Slot
                         </button>
                       </div>

                       {/* SKU slot form (inline, above add-row bar) */}
                       {showSkuSlotForm && (
                         <div className="border-t border-violet-200 bg-white px-4 py-3 space-y-2">
                           <p className="text-xs font-semibold text-violet-700">Configure SKU Slot</p>
                           <div className="grid grid-cols-2 gap-2">
                             <div>
                               <label className="text-[10px] uppercase font-bold text-gray-400 mb-0.5 block">Slot ID</label>
                               <input className="w-full border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-violet-400"
                                 placeholder="control_panel"
                                 value={skuSlotDraft.slot}
                                 onChange={e => setSkuSlotDraft(d => ({ ...d, slot: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
                               />
                             </div>
                             <div>
                               <label className="text-[10px] uppercase font-bold text-gray-400 mb-0.5 block">Schema</label>
                               <select className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
                                 value={skuSlotDraft.schema}
                                 onChange={e => setSkuSlotDraft(d => ({ ...d, schema: e.target.value as typeof d.schema }))}>
                                 <option value="rich_text">Rich Text</option>
                                 <option value="annotated_image_set">Annotated Images</option>
                                 <option value="legend_table">Legend Table</option>
                                 <option value="step_sequence">Step Sequence</option>
                               </select>
                             </div>
                           </div>
                           <div>
                             <label className="text-[10px] uppercase font-bold text-gray-400 mb-0.5 block">Label (EN)</label>
                             <input className="w-full border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
                               placeholder="Control panel"
                               value={skuSlotDraft.labelEn}
                               onChange={e => setSkuSlotDraft(d => ({ ...d, labelEn: e.target.value }))}
                             />
                           </div>
                           <label className="flex items-center gap-2 text-xs cursor-pointer">
                             <input type="checkbox" checked={skuSlotDraft.required}
                               onChange={e => setSkuSlotDraft(d => ({ ...d, required: e.target.checked }))} className="rounded" />
                             Required
                           </label>
                           <div className="flex gap-2 justify-end pt-1">
                             <button onClick={() => setShowSkuSlotForm(false)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1">Cancel</button>
                             <button onClick={addSkuSlotRef} disabled={!skuSlotDraft.slot || !skuSlotDraft.labelEn}
                               className="text-xs bg-violet-600 text-white px-3 py-1 rounded hover:bg-violet-700 disabled:opacity-40">
                               Add Slot
                             </button>
                           </div>
                         </div>
                       )}
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
                <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto">
                    <div className="flex justify-between mb-5">
                        <h3 className="font-bold text-lg">Template Settings</h3>
                        <button onClick={() => setIsSettingsModalOpen(false)}><X size={20} /></button>
                    </div>

                    {/* Branding */}
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Branding</h4>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                            <input className="w-full border rounded p-2 text-sm" value={metaSettings.companyName || ''} onChange={(e) => setMetaSettings({...metaSettings, companyName: e.target.value})} placeholder="e.g. Acme GmbH" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Company Logo URL</label>
                            <input className="w-full border rounded p-2 text-sm" value={metaSettings.companyLogoUrl || ''} onChange={(e) => setMetaSettings({...metaSettings, companyLogoUrl: e.target.value})} placeholder="https://…/logo.png" />
                        </div>
                        <div className="col-span-2">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Cover Image URL</label>
                            <input className="w-full border rounded p-2 text-sm" value={metaSettings.coverImageUrl || ''} onChange={(e) => setMetaSettings({...metaSettings, coverImageUrl: e.target.value})} placeholder="https://…/cover.jpg" />
                        </div>
                    </div>

                    {/* Appearance */}
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3 mt-5">Appearance</h4>
                    <div className="grid grid-cols-3 gap-4 mb-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Primary Color</label>
                            <input type="color" className="w-full h-10 rounded cursor-pointer" value={metaSettings.primaryColor || '#0f172a'} onChange={(e) => setMetaSettings({...metaSettings, primaryColor: e.target.value})} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Body Font</label>
                            <select className="w-full border rounded p-2 text-sm" value={metaSettings.fontFamily || 'Inter'} onChange={(e) => setMetaSettings({...metaSettings, fontFamily: e.target.value})}>
                                <option value="Inter">Inter (Default)</option>
                                <option value="Roboto">Roboto</option>
                                <option value="Open Sans">Open Sans</option>
                                <option value="Lato">Lato</option>
                                <option value="Montserrat">Montserrat</option>
                                <option value="Source Serif 4">Source Serif 4</option>
                                <option value="Noto Sans">Noto Sans</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Page Size</label>
                            <select className="w-full border rounded p-2 text-sm" value={metaSettings.pageSize || 'a4'} onChange={(e) => setMetaSettings({...metaSettings, pageSize: e.target.value as any})}>
                                <option value="a4">A4</option>
                                <option value="letter">US Letter</option>
                                <option value="a5">A5</option>
                            </select>
                        </div>
                    </div>

                    {/* Document */}
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3 mt-5">Document</h4>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Footer Text</label>
                        <input className="w-full border rounded p-2 text-sm" value={metaSettings.footerText || ''} onChange={(e) => setMetaSettings({...metaSettings, footerText: e.target.value})} placeholder="e.g. Copyright 2025 Company Name" />
                    </div>
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Back Page Content</label>
                        <textarea className="w-full border rounded p-2 text-sm font-mono" rows={4} value={metaSettings.backPageContent || ''} onChange={(e) => setMetaSettings({...metaSettings, backPageContent: e.target.value})} placeholder="HTML content for the back/last page (optional)" />
                    </div>

                    <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
                        <button onClick={() => setIsSettingsModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded">Cancel</button>
                        <button onClick={handleSaveMetadata} className="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700">Save Settings</button>
                    </div>
                </div>
              </div>
          )}
          {/* Language Selection Modal — defines which languages this category's manual supports */}
          {isLangModalOpen && (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                  <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
                      <div className="flex justify-between items-center mb-4">
                          <h3 className="font-bold text-lg flex items-center gap-2"><Globe size={18} className="text-indigo-500" /> Manual Languages</h3>
                          <button onClick={() => setIsLangModalOpen(false)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
                      </div>
                      <p className="text-xs text-muted mb-4">
                          Choose which languages this category's manual supports. Each enabled language gets its own tab on every inline content row. English is always included.
                      </p>
                      <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
                          {ALL_LANGUAGES.map(l => {
                            const checked = l.code === 'en' || langDraft.includes(l.code);
                            const locked = l.code === 'en';
                            return (
                              <label key={l.code} className={`flex items-center gap-2 text-sm p-2 rounded border transition-colors ${checked ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'} ${locked ? 'cursor-default' : 'cursor-pointer'}`}>
                                <input
                                  type="checkbox"
                                  className="rounded accent-indigo-600"
                                  checked={checked}
                                  disabled={locked}
                                  onChange={e => setLangDraft(prev => e.target.checked ? [...prev, l.code] : prev.filter(c => c !== l.code))}
                                />
                                <span className={locked ? 'text-gray-500' : ''}>{l.label}</span>
                                {locked && <span className="ml-auto text-[10px] text-gray-400 uppercase tracking-wide">required</span>}
                              </label>
                            );
                          })}
                      </div>
                      <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 mt-4">
                          <button onClick={() => setIsLangModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm">Cancel</button>
                          <button onClick={handleSaveLanguages} disabled={saving} className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
                              {saving ? 'Saving…' : 'Save Languages'}
                          </button>
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
                        <select className="w-full border p-2 rounded text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={condFeatureId} onChange={(e) => { setCondFeatureId(e.target.value); resetCondValue(); }}>
                            <option value="manual">Manual Selection (Optional Block)</option>
                            <optgroup label="Auto-include based on Attribute">
                                {categoryFeatures.map(f => <option key={f.id} value={f.id}>{f.name} ({f.dataType})</option>)}
                            </optgroup>
                        </select>
                        <p className="text-xs text-muted mt-1">{condFeatureId === 'manual' ? "User decides whether to include this text when generating the manual." : condAnyValue ? "The attribute's value will be injected inline — always visible, no condition needed." : "Text is automatically included if this attribute matches the selected value."}</p>
                      </div>

                      {condFeatureId !== 'manual' && (
                        <div className="mb-4 flex items-center gap-2 p-3 rounded border border-amber-200 bg-amber-50">
                          <input
                            id="condAnyValue"
                            type="checkbox"
                            className="rounded accent-amber-600"
                            checked={condAnyValue}
                            onChange={e => { setCondAnyValue(e.target.checked); if (e.target.checked) setCondUseAttrValue(false); }}
                          />
                          <label htmlFor="condAnyValue" className="text-sm text-amber-800 cursor-pointer select-none">
                            <span className="font-medium">Any value — always show</span>
                            <span className="text-amber-700 ml-1">Injects the live attribute value directly into the document, no condition match required.</span>
                          </label>
                        </div>
                      )}

                      {/* Type-adaptive condition value input */}
                      {!condAnyValue && condFeatureId !== 'manual' && (() => {
                        const attr = categoryFeatures.find(f => f.id === condFeatureId);
                        if (!attr) return null;
                        const enumOptions = attr.validationRules?.enumOptions || [];
                        const unit = attr.validationRules?.unit ? ` (${attr.validationRules.unit})` : '';
                        if (attr.dataType === 'enum') {
                          return (
                            <div className="mb-4 p-3 bg-indigo-50 rounded border border-indigo-200">
                              <label className="block text-sm font-medium text-gray-700 mb-2">Match Values (select one or more)</label>
                              {enumOptions.length === 0 ? (
                                <p className="text-xs text-gray-400 italic">No options defined for this attribute.</p>
                              ) : (
                                <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                                  {enumOptions.map(opt => (
                                    <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-indigo-100">
                                      <input
                                        type="checkbox"
                                        className="rounded accent-indigo-600"
                                        checked={condEnumSelected.includes(opt)}
                                        onChange={e => setCondEnumSelected(prev => e.target.checked ? [...prev, opt] : prev.filter(v => v !== opt))}
                                      />
                                      <span>{opt}</span>
                                    </label>
                                  ))}
                                </div>
                              )}
                              {condEnumSelected.length > 0 && (
                                <p className="text-xs text-indigo-600 mt-2">Selected: {condEnumSelected.join(', ')}</p>
                              )}
                            </div>
                          );
                        }
                        if (attr.dataType === 'integer' || attr.dataType === 'decimal') {
                          return (
                            <div className="mb-4 p-3 bg-indigo-50 rounded border border-indigo-200">
                              <label className="block text-sm font-medium text-gray-700 mb-2">Match Range{unit}</label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="number"
                                  className="flex-1 border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                  placeholder="Min"
                                  value={condNumMin}
                                  onChange={e => setCondNumMin(e.target.value)}
                                />
                                <span className="text-gray-400 text-sm">–</span>
                                <input
                                  type="number"
                                  className="flex-1 border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                                  placeholder="Max"
                                  value={condNumMax}
                                  onChange={e => setCondNumMax(e.target.value)}
                                />
                              </div>
                              <p className="text-xs text-gray-400 mt-1">Leave max empty for "greater than min" or min empty for "less than max".</p>
                            </div>
                          );
                        }
                        if (attr.dataType === 'boolean') {
                          return (
                            <div className="mb-4 p-3 bg-indigo-50 rounded border border-indigo-200">
                              <label className="block text-sm font-medium text-gray-700 mb-2">Match Value</label>
                              <div className="flex gap-3">
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input type="radio" name="condBool" value="true" checked={condBoolValue === 'true'} onChange={() => setCondBoolValue('true')} className="accent-indigo-600" />
                                  <span className="text-sm font-medium text-green-700">Yes</span>
                                </label>
                                <label className="flex items-center gap-2 cursor-pointer">
                                  <input type="radio" name="condBool" value="false" checked={condBoolValue === 'false'} onChange={() => setCondBoolValue('false')} className="accent-indigo-600" />
                                  <span className="text-sm font-medium text-rose-700">No</span>
                                </label>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <div className="mb-4 p-3 bg-indigo-50 rounded border border-indigo-200">
                            <label className="block text-sm font-medium text-gray-700 mb-2">Match Text</label>
                            <input
                              type="text"
                              className="w-full border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                              placeholder="Value to match..."
                              value={condTextValue}
                              onChange={e => setCondTextValue(e.target.value)}
                            />
                          </div>
                        );
                      })()}

                      {!condAnyValue && <div className="mb-4">
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-sm font-medium text-gray-700">Content to Show</label>
                          {condFeatureId !== 'manual' && (
                            <label className="flex items-center gap-1.5 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                className="rounded accent-indigo-600"
                                checked={condUseAttrValue}
                                onChange={e => setCondUseAttrValue(e.target.checked)}
                              />
                              <span className="text-xs text-indigo-600 font-medium">Use attribute value</span>
                            </label>
                          )}
                        </div>
                        {condUseAttrValue && condFeatureId !== 'manual' ? (
                          <div className="w-full border border-indigo-300 bg-indigo-50 p-2 rounded text-sm text-indigo-800 min-h-[72px] flex items-center">
                            {buildConditionValue() || <span className="text-gray-400 italic">Set a condition value above to preview...</span>}
                          </div>
                        ) : (
                          <textarea className="w-full border p-2 rounded outline-none focus:ring-2 focus:ring-indigo-500" rows={3} value={condText} onChange={(e) => setCondText(e.target.value)} placeholder="Text to show if condition matches..." />
                        )}
                      </div>}
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
                    {(() => {
                      // Image placeholders bind to image attributes (e.g. the Product Images
                      // group); text placeholders bind to the remaining attributes.
                      const attrOptions = categoryFeatures.filter(f =>
                        placeholderConfig.type === 'image' ? f.dataType === 'image' : f.dataType !== 'image'
                      );
                      if (attrOptions.length === 0) return null;
                      return (
                      <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">From Attribute (optional)</label>
                        <select
                          className="w-full border p-2 rounded text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                          value={placeholderAttrId}
                          onChange={e => {
                            const id = e.target.value;
                            setPlaceholderAttrId(id);
                            if (id) {
                              const attr = categoryFeatures.find(f => f.id === id);
                              if (attr) setPlaceholderConfig(prev => ({ ...prev, label: attr.name }));
                            } else {
                              setPlaceholderConfig(prev => ({ ...prev, label: '' }));
                            }
                          }}
                        >
                          <option value="">— Custom label —</option>
                          <optgroup label={placeholderConfig.type === 'image' ? 'Product Image Attributes' : 'Category Attributes'}>
                            {attrOptions.map(f => (
                              <option key={f.id} value={f.id}>{f.name} ({f.dataType})</option>
                            ))}
                          </optgroup>
                        </select>
                        <p className="text-xs text-muted mt-1">
                          {placeholderConfig.type === 'image'
                            ? 'Bind to a product image so the uploaded photo renders here automatically.'
                            : 'Select an attribute to pre-fill the label, or enter a custom one below.'}
                        </p>
                      </div>
                      );
                    })()}
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
                        <input className="w-full border p-2 rounded outline-none focus:ring-2 focus:ring-indigo-500" placeholder={placeholderConfig.type === 'text' ? "e.g. Product Name" : "e.g. Front View"} value={placeholderConfig.label} onChange={(e) => setPlaceholderConfig({...placeholderConfig, label: e.target.value})} autoFocus onKeyDown={(e) => e.key === 'Enter' && handleConfirmPlaceholder()} />
                        <p className="text-xs text-muted mt-1">This label will be shown when filling out the manual.</p>
                    </div>
                    <div className="flex justify-end gap-3">
                        <button onClick={() => setIsPlaceholderModalOpen(false)} className="text-gray-600 hover:bg-gray-100 px-4 py-2 rounded">Cancel</button>
                        <button onClick={handleConfirmPlaceholder} className="bg-indigo-600 text-white px-4 py-2 rounded">Insert</button>
                    </div>
                </div>
            </div>
          )}

          {/* Section Condition Modal */}
          {isSectionCondModalOpen && (() => {
            const attr = categoryFeatures.find(f => f.id === secCondAttrId);
            return (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 animate-in fade-in zoom-in duration-200">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-lg flex items-center gap-2"><GitBranch size={18} className="text-violet-500" /> Chapter Condition</h3>
                    <button onClick={() => setIsSectionCondModalOpen(false)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
                  </div>
                  <p className="text-xs text-muted mb-4">This chapter will only appear in the generated manual when the selected attribute matches the specified value.</p>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Attribute</label>
                      <select
                        className="w-full border p-2 rounded text-sm outline-none focus:ring-2 focus:ring-violet-500"
                        value={secCondAttrId}
                        onChange={e => { setSecCondAttrId(e.target.value); setSecCondEnumSelected([]); setSecCondNumMin(''); setSecCondNumMax(''); setSecCondBoolValue('true'); setSecCondTextValue(''); }}
                      >
                        <option value="">— Select attribute —</option>
                        {categoryFeatures.map(f => (
                          <option key={f.id} value={f.id}>{f.name} ({f.dataType})</option>
                        ))}
                      </select>
                    </div>

                    {attr && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Show chapter when value is…</label>
                        {attr.dataType === 'enum' && (
                          <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-gray-200 rounded p-2">
                            {(attr.validationRules?.enumOptions ?? []).map(opt => (
                              <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="checkbox" className="rounded text-violet-600" checked={secCondEnumSelected.includes(opt)}
                                  onChange={e => setSecCondEnumSelected(prev => e.target.checked ? [...prev, opt] : prev.filter(o => o !== opt))} />
                                {opt}
                              </label>
                            ))}
                          </div>
                        )}
                        {(attr.dataType === 'integer' || attr.dataType === 'decimal') && (
                          <div className="flex gap-2 items-center">
                            <input type="number" placeholder="Min" value={secCondNumMin} onChange={e => setSecCondNumMin(e.target.value)}
                              className="flex-1 border p-2 rounded text-sm outline-none focus:ring-2 focus:ring-violet-500" />
                            <span className="text-muted text-sm">–</span>
                            <input type="number" placeholder="Max" value={secCondNumMax} onChange={e => setSecCondNumMax(e.target.value)}
                              className="flex-1 border p-2 rounded text-sm outline-none focus:ring-2 focus:ring-violet-500" />
                            {attr.validationRules?.unit && <span className="text-xs text-muted">{attr.validationRules.unit}</span>}
                          </div>
                        )}
                        {attr.dataType === 'boolean' && (
                          <div className="flex gap-4">
                            {['true', 'false'].map(v => (
                              <label key={v} className="flex items-center gap-2 text-sm cursor-pointer">
                                <input type="radio" name="secCondBool" value={v} checked={secCondBoolValue === v} onChange={() => setSecCondBoolValue(v)} className="text-violet-600" />
                                {v === 'true' ? 'Yes' : 'No'}
                              </label>
                            ))}
                          </div>
                        )}
                        {attr.dataType === 'text' && (
                          <input type="text" placeholder="Exact value to match…" value={secCondTextValue} onChange={e => setSecCondTextValue(e.target.value)}
                            className="w-full border p-2 rounded text-sm outline-none focus:ring-2 focus:ring-violet-500" />
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 mt-4">
                    <button onClick={() => setIsSectionCondModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm">Cancel</button>
                    <button
                      onClick={handleSaveSectionCondition}
                      disabled={!secCondAttrId || !buildSectionConditionValue()}
                      className="px-4 py-2 bg-violet-600 text-white rounded text-sm font-medium hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Save Condition
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Delete Confirmation Modal */}
          <ConfirmationModal
            variant="danger"
            isOpen={deleteModal.isOpen}
            title="Delete Section?"
            message="Are you sure you want to delete this section? All content within it will be lost."
            onConfirm={confirmDeleteSection}
            onCancel={() => setDeleteModal({ isOpen: false, sectionId: null })}
          />

          {/* Block Picker Modal */}
          {showBlockPicker && (() => {
            const pickerBlocks = availableBlocks.filter(b => {
              if (blockPickerSearch) {
                const q = blockPickerSearch.toLowerCase();
                return b.title.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q);
              }
              return true;
            });
            const attachedIds = new Set(
              (sections.find(s => s.id === selectedSectionId)?.blockRefs ?? [])
                .filter(r => r.kind === 'block')
                .map(r => (r as any).block_id as string)
            );
            return (
              <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-xl w-full max-w-lg flex flex-col max-h-[80vh]">
                  <div className="flex justify-between items-center p-4 border-b border-gray-100">
                    <h3 className="font-bold text-gray-800 flex items-center gap-2"><Layers size={16} className="text-indigo-600" /> Add Shared Block</h3>
                    <button onClick={() => setShowBlockPicker(false)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
                  </div>
                  <div className="p-3 border-b border-gray-100">
                    <input
                      autoFocus
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      placeholder="Search by title or slug…"
                      value={blockPickerSearch}
                      onChange={e => setBlockPickerSearch(e.target.value)}
                    />
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {pickerBlocks.length === 0 && (
                      <p className="text-center py-8 text-sm text-gray-400">
                        {availableBlocks.length === 0
                          ? 'No blocks in the library yet. Go to Block Library to create some.'
                          : 'No blocks match your search.'}
                      </p>
                    )}
                    {pickerBlocks.map(blk => {
                      const already = attachedIds.has(blk.id);
                      return (
                        <button
                          key={blk.id}
                          onClick={() => !already && addBlockRef(blk.id)}
                          disabled={already}
                          className={`w-full text-left flex items-start gap-3 p-3 rounded-lg border transition-colors ${already ? 'bg-gray-50 border-gray-100 opacity-60 cursor-not-allowed' : 'border-gray-200 hover:border-indigo-400 hover:bg-indigo-50 cursor-pointer'}`}
                        >
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 mt-0.5 ${blk.blockType === 'warning' ? 'bg-amber-100 text-amber-700' : blk.blockType === 'caution' ? 'bg-orange-100 text-orange-700' : blk.blockType === 'electric' ? 'bg-yellow-100 text-yellow-700' : blk.blockType === 'flammable' ? 'bg-rose-100 text-orange-700' : blk.blockType === 'info' ? 'bg-sky-100 text-sky-700' : 'bg-blue-100 text-blue-700'}`}>
                            {blk.blockType.toUpperCase()}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-gray-800">{blk.title}</span>
                              {blk.approvalStatus === 'approved'
                                ? <span className="text-[10px] bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full font-bold">APPROVED</span>
                                : <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-bold">DRAFT</span>}
                              {already && <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">ADDED</span>}
                            </div>
                            <p className="text-[11px] font-mono text-gray-400 truncate">{blk.slug}</p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Block Condition Modal */}
          {isBlockCondModalOpen && (() => {
            const attr = categoryAttributes.find(a => a.id === blockCondAttrId);
            const canSave = !!blockCondAttrId && (blockCondMode === 'absent' || !!buildBlockConditionValue() ||
              (attr?.dataType === 'integer' || attr?.dataType === 'decimal' ? (!!blockCondNumMin || !!blockCondNumMax) : false));
            return (
              <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4 backdrop-blur-sm">
                <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5">
                  <div className="flex justify-between items-center mb-1">
                    <h3 className="font-bold text-gray-800 flex items-center gap-2"><GitBranch size={16} className="text-indigo-600" /> Block Show Condition</h3>
                    <button onClick={() => setIsBlockCondModalOpen(false)} className="text-gray-400 hover:text-gray-700"><X size={18} /></button>
                  </div>
                  <p className="text-xs text-gray-500 mb-4">This block renders only when the selected attribute matches.</p>

                  {/* Present / Absent toggle */}
                  <div className="flex gap-2 mb-4">
                    {(['present', 'absent'] as const).map(m => (
                      <button key={m} onClick={() => setBlockCondMode(m)}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${blockCondMode === m ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-200 text-gray-500 hover:border-gray-400'}`}>
                        {m === 'present' ? 'Has a value' : 'Has no value (absent)'}
                      </button>
                    ))}
                  </div>

                  {/* Attribute selector */}
                  <div className="mb-4">
                    <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Attribute</label>
                    <select className="w-full border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      value={blockCondAttrId}
                      onChange={e => { setBlockCondAttrId(e.target.value); setBlockCondEnumSelected([]); setBlockCondNumMin(''); setBlockCondNumMax(''); setBlockCondTextValue(''); setBlockCondBoolValue('true'); }}
                    >
                      <option value="">— select attribute —</option>
                      {categoryAttributes.map(a => (
                        <option key={a.id} value={a.id}>{a.name} ({a.dataType})</option>
                      ))}
                    </select>
                  </div>

                  {/* Value input — only shown for 'present' mode */}
                  {blockCondMode === 'present' && attr && (
                    <div className="mb-4">
                      <label className="block text-xs font-semibold text-gray-500 uppercase mb-2">
                        {attr.dataType === 'enum' ? 'Match any of' : attr.dataType === 'integer' || attr.dataType === 'decimal' ? 'Value range' : 'Expected value'}
                      </label>
                      {attr.dataType === 'enum' && (
                        <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                          {(attr.validationRules?.enumOptions ?? []).map(opt => (
                            <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input type="checkbox" checked={blockCondEnumSelected.includes(opt)}
                                onChange={e => setBlockCondEnumSelected(prev => e.target.checked ? [...prev, opt] : prev.filter(v => v !== opt))}
                                className="rounded text-indigo-600" />
                              {opt}
                            </label>
                          ))}
                        </div>
                      )}
                      {(attr.dataType === 'integer' || attr.dataType === 'decimal') && (
                        <div className="flex items-center gap-2">
                          <input type="number" placeholder="Min" value={blockCondNumMin} onChange={e => setBlockCondNumMin(e.target.value)}
                            className="flex-1 border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                          <span className="text-gray-400">–</span>
                          <input type="number" placeholder="Max" value={blockCondNumMax} onChange={e => setBlockCondNumMax(e.target.value)}
                            className="flex-1 border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                          {attr.validationRules?.unit && <span className="text-xs text-gray-500">{attr.validationRules.unit}</span>}
                        </div>
                      )}
                      {attr.dataType === 'boolean' && (
                        <div className="flex gap-4">
                          {['true', 'false'].map(v => (
                            <label key={v} className="flex items-center gap-2 text-sm cursor-pointer">
                              <input type="radio" name="blockCondBool" value={v} checked={blockCondBoolValue === v} onChange={() => setBlockCondBoolValue(v)} className="text-indigo-600" />
                              {v === 'true' ? 'Yes' : 'No'}
                            </label>
                          ))}
                        </div>
                      )}
                      {attr.dataType === 'text' && (
                        <input type="text" placeholder="Exact value to match…" value={blockCondTextValue} onChange={e => setBlockCondTextValue(e.target.value)}
                          className="w-full border p-2 rounded text-sm outline-none focus:ring-2 focus:ring-indigo-500" />
                      )}
                    </div>
                  )}

                  <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
                    <button onClick={() => setIsBlockCondModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm">Cancel</button>
                    <button onClick={handleSaveBlockCondition} disabled={!canSave}
                      className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed">
                      Save Condition
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}
       </div>
    </Layout>
  );
};

export default IMTemplateEditor;
