
/**
 * ProjectIMGenerator — the per-project Information Memorandum editor/generator. Resolves a
 * template + the project's data into a previewable, publishable IM and exports it (PDF/JSON/XML).
 * Sub-components and pure helpers live under ./project-im-generator/.
 */
import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import {
    getProjectById, getIMTemplateById, getIMSections,
    getIMTemplates, getProjectIM, saveProjectIM, deleteProjectIM,
    addDocument, uploadFile, getCategoryAttributes, getAttributeRequestsByProject,
    getIMBlocks, resolveManual, publishResolvedManuals, normalizeResolverData,
    getProjectSkus, collapseSkuAttributeValues
} from '../../services';
import { skuSyntheticAttribute } from '../../config/compliance.constants';
import { wrapBlockCallout, passesFeatureGate } from '../../services/im/im-resolver';
import { uploadIMAsset } from '../../services/im/im-asset.service';
import { Project, IMTemplate, IMTemplateType, IM_TEMPLATE_TYPE_LABELS, IMSection, ProjectIM, DocStatus, ResponsibleParty, CategoryAttribute, IMMasterLayoutName, IMMasterPageOverride, SKUContentValue, SKUSlotRef, RichTextContent, LegendTableContent, StepSequenceContent, AnnotatedImageSetContent, AnnotatedImage, ProjectBlockAddition, ProjectExtraSection, CalloutVariant, InlineBlockRef, BlockRef, FeatureConditionFields, ProjectSku, ProjectAttributeRequest, localizedSectionTitle } from '../../types';
import type { PublishResult } from '../../services';
import { ArrowLeft, Save, FileDown, AlertCircle, Image as ImageIcon, CheckCircle, Settings, GitBranch, CheckSquare, Square, X, Printer, Globe, ChevronDown, Download, Code, FileJson, Loader2, Trash2, RotateCcw, Upload, Type, ChevronUp, FilePlus2, Lock, Boxes } from 'lucide-react';
import { InlineBlockEditor } from './editor/InlineBlockEditor';
import { getAttributesForCategory, sanitizeHtml } from '../../utils';
import { renderProjectIMPdf } from '../../services/im/im-print-renderer';
import { getIMThemeVariables } from './styles/im-theme';
import { DEFAULT_MASTER_PAGES, getBackgroundStyle, joinAttrValues } from './project-im-generator/im-layout.utils';
import { ConfirmationModal } from '../../components/common/ConfirmationModal';
import { BindableField } from './project-im-generator/BindableField';
import { AddProjectSection } from './project-im-generator/AddProjectSection';

const ProjectIMGenerator: React.FC = () => {
  const { projectId, templateType: templateTypeParam } = useParams<{ projectId: string; templateType?: string }>();
  const templateType: IMTemplateType = templateTypeParam === 'warning_leaflet' ? 'warning_leaflet' : 'im';
  const typeLabel = IM_TEMPLATE_TYPE_LABELS[templateType];
  const navigate = useNavigate();
  
  const [project, setProject] = useState<Project | null>(null);
  const [templates, setTemplates] = useState<IMTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  
  const [template, setTemplate] = useState<IMTemplate | null>(null);
  const [sections, setSections] = useState<IMSection[]>([]);
  const [instance, setInstance] = useState<ProjectIM | null>(null);
  
  // Form Data
  const [formData, setFormData] = useState<Record<string, string>>({});
  // fieldId -> linked attribute ids. Presence of a key = "attribute mode".
  const [fieldBindings, setFieldBindings] = useState<Record<string, string[]>>({});
  const [conditions, setConditions] = useState<Record<string, boolean>>({});
  const [sectionVisibility, setSectionVisibility] = useState<Record<string, boolean>>({});
  // Per-ref Include/Exclude override for conditional inline rows + shared blocks,
  // keyed `<sectionId>:<index>`. undefined = follow the automatic feature gate.
  const [refVisibility, setRefVisibility] = useState<Record<string, boolean>>({});
  const [skuContent, setSkuContent] = useState<Record<string, SKUContentValue>>({});
  // Project-only content layered on top of the template (never edits the template).
  // sectionAdditions: inline blocks inserted into existing template sections (keyed by section id).
  // extraSections: brand-new sections that exist only for this project.
  const [sectionAdditions, setSectionAdditions] = useState<Record<string, ProjectBlockAddition[]>>({});
  const [extraSections, setExtraSections] = useState<ProjectExtraSection[]>([]);
  // Full project content for edited placeholder sections (keyed by section id).
  const [sectionOverrides, setSectionOverrides] = useState<Record<string, InlineBlockRef[]>>({});
  // Left panel mode: fill placeholder values, or author project-specific content.
  const [editorMode, setEditorMode] = useState<'fill' | 'content'>('fill');
  const [availableBlocks, setAvailableBlocks] = useState<Record<string, { content: Record<string, string>; blockType: string }>>({});
  const [uploadingSlot, setUploadingSlot] = useState<string | null>(null);

  // Context Data
  const [allAttributes, setAllAttributes] = useState<CategoryAttribute[]>([]);
  const [submittedAttrValues, setSubmittedAttrValues] = useState<Record<string, string>>({}); // attributeId -> value
  // The project's SKUs + their attribute submissions, kept in state so changing the
  // SKU binding live-recomputes the resolved attribute values.
  const [projectSkus, setProjectSkus] = useState<ProjectSku[]>([]);
  const [attrRequests, setAttrRequests] = useState<ProjectAttributeRequest[]>([]);
  // project_skus.id values this IM is bound to (the SKUs it covers). Drives resolution.
  const [boundSkuIds, setBoundSkuIds] = useState<string[]>([]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  // Pre-publish checklist: populated when the user clicks Publish and something is
  // missing, so they can review before confirming (or cancel and fix).
  const [checklist, setChecklist] = useState<{ blocking: string[]; values: string[]; slots: string[]; translations: { lang: string; items: string[] }[] } | null>(null);

  // Interactive Editing State
  const [textEditId, setTextEditId] = useState<string | null>(null);
  const [tempTextValue, setTempTextValue] = useState('');
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [activeLang, setActiveLang] = useState('en');

  // Modal State
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (projectId) loadData();
  }, [projectId, templateType]);

  // Derive the resolved attribute map from the BOUND SKUs (the SKUs this IM covers):
  // each attribute is resolved per SKU then collapsed (identical values once, differing
  // values joined), and SKU_ATTRIBUTE_ID becomes the bound SKU number(s). Re-runs when
  // the binding changes so the preview + {{__sku}} update live. No SKUs → legacy flatten.
  useEffect(() => {
    if (projectSkus.length > 0) {
      const imageAttrIds = new Set(allAttributes.filter(a => a.dataType === 'image').map(a => a.id));
      const bound = boundSkuIds.length ? projectSkus.filter(s => boundSkuIds.includes(s.id)) : projectSkus;
      const effective = bound.length ? bound : projectSkus;
      setSubmittedAttrValues(collapseSkuAttributeValues(effective, attrRequests, imageAttrIds));
    } else {
      const flat: Record<string, string> = {};
      attrRequests.forEach(req => (req.submittedData ?? []).forEach(item => {
        if (item.attributeId && item.value) flat[item.attributeId] = item.value;
      }));
      setSubmittedAttrValues(flat);
    }
  }, [projectSkus, attrRequests, boundSkuIds, allAttributes]);

  // Close export menu on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
        if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
            setShowExportMenu(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
        const proj = await getProjectById(projectId!);
        if (!proj) throw new Error("Project not found");
        setProject(proj);

        const [attrs, blks] = await Promise.all([getCategoryAttributes(), getIMBlocks()]);
        // Prepend the synthetic SKU attribute (categoryId: null → visible for every project)
        // so SKU placeholders/tokens resolve their label and appear in attribute pickers.
        setAllAttributes([skuSyntheticAttribute(), ...attrs]);
        // Build id→block lookup used by the preview renderer
        const blkMap: Record<string, { content: Record<string, string>; blockType: string }> = {};
        blks.forEach(b => { blkMap[b.id] = { content: b.content, blockType: b.blockType }; });
        setAvailableBlocks(blkMap);

        // The project's SKUs + attribute submissions feed resolution. The collapsed
        // attributeId -> value map (and the {{__sku}} token) is derived from the BOUND
        // SKUs by a dedicated effect, so changing the binding live-updates the preview.
        const [reqs, skus] = await Promise.all([
            getAttributeRequestsByProject(projectId!),
            getProjectSkus(projectId!),
        ]);
        setAttrRequests(reqs);
        setProjectSkus(skus);

        const existingInstance = await getProjectIM(projectId!, templateType);

        // Bind to the IM's stored SKUs (reconciled against SKUs that still exist);
        // default to ALL current SKUs when nothing valid is stored.
        const storedBound = (existingInstance?.boundSkuIds ?? []).filter(id => skus.some(s => s.id === id));
        setBoundSkuIds(storedBound.length ? storedBound : skus.map(s => s.id));

        if (existingInstance) {
            setInstance(existingInstance);
            const safeData = existingInstance.placeholderData || {};
            setFormData(safeData);
            if (existingInstance.skuContent) setSkuContent(existingInstance.skuContent);
            if (existingInstance.sectionAdditions) setSectionAdditions(existingInstance.sectionAdditions);
            if (existingInstance.extraSections) setExtraSections(existingInstance.extraSections);
            if (existingInstance.sectionOverrides) setSectionOverrides(existingInstance.sectionOverrides);
            
            // Restore conditions from saved data
            const loadedConds: Record<string, boolean> = {};
            const loadedSecVis: Record<string, boolean> = {};
            const loadedRefVis: Record<string, boolean> = {};
            Object.keys(safeData).forEach(key => {
                if (key.startsWith('cond_')) {
                    loadedConds[key.replace('cond_', '')] = safeData[key] === 'true';
                } else if (key.startsWith('refvis_')) {
                    loadedRefVis[key.replace('refvis_', '')] = safeData[key] === 'true';
                } else if (key.startsWith('secvis_')) {
                    loadedSecVis[key.replace('secvis_', '')] = safeData[key] === 'true';
                }
            });
            setConditions(loadedConds);
            setSectionVisibility(loadedSecVis);
            setRefVisibility(loadedRefVis);

            // Restore attribute bindings
            if (safeData['__field_bindings']) {
                try {
                    const parsed = JSON.parse(safeData['__field_bindings']);
                    if (parsed && typeof parsed === 'object') setFieldBindings(parsed);
                } catch (e) { console.warn('Failed to parse __field_bindings', e); }
            }
            
            // Restore language if saved
            if (safeData['__meta_language']) {
                setActiveLang(safeData['__meta_language']);
            }
            
            await loadTemplate(existingInstance.templateId);
        } else {
             const allTemps = (await getIMTemplates()).filter(t => t.templateType === templateType);
             setTemplates(allTemps);
        }
    } catch (e) {
        console.error(e);
    } finally {
        setLoading(false);
    }
  };

  const loadTemplate = async (tempId: string) => {
      setSelectedTemplateId(tempId);
      const temp = await getIMTemplateById(tempId);
      const secs = await getIMSections(tempId);
      setTemplate(temp || null);
      setSections(secs);
      
      // Ensure activeLang is valid
      if (temp && temp.languages && !temp.languages.includes(activeLang)) {
          // Only switch if current activeLang is NOT valid for this template
          // This preserves the restored language from loadData if valid
          const safeData = instance?.placeholderData || {};
          const savedLang = safeData['__meta_language'];
          
          if (savedLang && temp.languages.includes(savedLang)) {
              // If saved language is valid, keep it (it was set in loadData)
          } else {
              setActiveLang(temp.languages[0] || 'en');
          }
      }
  };

  // Auto-initialize conditions when sections load
  useEffect(() => {
      if (sections.length > 0 && Object.keys(conditions).length === 0) {
          const defaults: Record<string, boolean> = {};
          const parser = new DOMParser();

          sections.forEach(sec => {
              const html = sec.content['en'] || '';
              const doc = parser.parseFromString(html, 'text/html');
              doc.querySelectorAll('.im-condition').forEach((el) => {
                  const id = el.getAttribute('data-id');
                  if (id) defaults[id] = false;
              });
          });
          setConditions(defaults);
      }
  }, [sections]);

  const handleTemplateSelect = async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val) await loadTemplate(val);
  };

  const handleInputChange = (id: string, value: string) => {
      setFormData(prev => ({ ...prev, [id]: value }));
  };

  // Drop a PM override so the field falls back to the submitted attribute value.
  const clearInput = (id: string) => {
      setFormData(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  // Switch a field between manual input and attribute-linked mode.
  const setFieldMode = (fieldId: string, mode: 'manual' | 'attributes') => {
      setFieldBindings(prev => {
          const next = { ...prev };
          if (mode === 'attributes') { if (!next[fieldId]) next[fieldId] = []; }
          else { delete next[fieldId]; }
          return next;
      });
  };

  // Add/remove an attribute from a field's binding (order preserved).
  const toggleFieldAttr = (fieldId: string, attrId: string) => {
      setFieldBindings(prev => {
          const cur = prev[fieldId] ?? [];
          const nextArr = cur.includes(attrId) ? cur.filter(a => a !== attrId) : [...cur, attrId];
          return { ...prev, [fieldId]: nextArr };
      });
  };

  // Keep formData in sync for attribute-linked fields: the field value is the
  // joined values of its linked attributes, so the preview/save/resolve all see it.
  useEffect(() => {
      const entries = Object.entries(fieldBindings);
      if (entries.length === 0) return;
      setFormData(prev => {
          let changed = false;
          const next = { ...prev };
          for (const [fieldId, attrIds] of entries) {
              const val = joinAttrValues(attrIds, submittedAttrValues);
              if (next[fieldId] !== val) { next[fieldId] = val; changed = true; }
          }
          return changed ? next : prev;
      });
  }, [fieldBindings, submittedAttrValues]);

  const handleConditionToggle = (id: string) => {
      setConditions(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const handleImageUpload = (id: string, file: File) => {
      const reader = new FileReader();
      reader.onloadend = () => {
          setFormData(prev => ({ ...prev, [id]: reader.result as string }));
      };
      reader.readAsDataURL(file);
  };

  const handlePreviewImageClick = (id: string) => {
      setUploadId(id);
      if (fileInputRef.current) {
          fileInputRef.current.value = '';
          fileInputRef.current.click();
      }
  };

  const handlePreviewTextClick = (id: string) => {
      setTextEditId(id);
      setTempTextValue(formData[id] || '');
  };

  const handleSaveTextModal = () => {
      if (textEditId) {
          handleInputChange(textEditId, tempTextValue);
          setTextEditId(null);
          setTempTextValue('');
      }
  };

  const handlePreviewClick = (e: React.MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[data-interactive="true"]');
      if (!target) return;
      
      const id = target.getAttribute('data-id');
      const type = target.getAttribute('data-type');
      
      if (id && type) {
          e.stopPropagation();
          if (type === 'text') {
              handlePreviewTextClick(id);
          } else if (type === 'image') {
              handlePreviewImageClick(id);
          }
      }
  };

  const handleSaveDraft = async () => {
      if (!projectId || !selectedTemplateId) return;
      setSaving(true);
      
      // Base layer = submitted attribute values (keyed by attribute id) so bound
      // placeholders/tokens resolve in the saved manual; PM edits in formData win.
      const dataToSave = { ...submittedAttrValues, ...formData };
      Object.entries(conditions).forEach(([k, v]) => {
          dataToSave[`cond_${k}`] = String(v);
      });
      Object.entries(sectionVisibility).forEach(([k, v]) => {
          dataToSave[`secvis_${k}`] = String(v);
      });
      Object.entries(refVisibility).forEach(([k, v]) => {
          dataToSave[`refvis_${k}`] = String(v);
      });

      // Save current language
      dataToSave['__meta_language'] = activeLang;
      // Persist attribute bindings so manual/attribute mode is restored next time.
      dataToSave['__field_bindings'] = JSON.stringify(fieldBindings);

      try {
          const saved = await saveProjectIM(projectId, selectedTemplateId, dataToSave, 'draft', skuContent, templateType, sectionAdditions, extraSections, sectionOverrides, undefined, boundSkuIds);
          setInstance(saved);
          alert("Draft saved successfully!");
      } catch (e) {
          console.error(e);
          alert("Failed to save draft.");
      } finally {
          setSaving(false);
      }
  };

  const handleDeleteDraft = () => {
      setShowDeleteConfirm(true);
  };

  const confirmDeleteDraft = async () => {
      if (!project) return;
      setShowDeleteConfirm(false);
      setLoading(true);
      try {
          const isSavedDraft = !!instance;
          if (isSavedDraft) {
              await deleteProjectIM(project.id, templateType);
          }
          
          // Reset State completely
          setInstance(null);
          setFormData({});
          setFieldBindings({});
          setConditions({});
          setSectionVisibility({});
          setRefVisibility({});
          setSkuContent({});
          setSectionAdditions({});
          setExtraSections([]);
          setSectionOverrides({});
          setEditorMode('fill');
          setTemplate(null);
          setSections([]);
          setSelectedTemplateId('');
          setActiveLang('en'); // Reset language
          
          // Refresh templates for the selection screen
          const allTemps = (await getIMTemplates()).filter(t => t.templateType === templateType);
          setTemplates(allTemps);
          
      } catch (e: any) {
          console.error("Error deleting draft:", e);
          alert("Failed to delete draft: " + e.message);
      } finally {
          setLoading(false);
      }
  };

  const handleGenerate = async () => {
      if (!project) {
          console.error("Project missing");
          alert("Could not load project details to generate PDF.");
          return;
      }
      setGenerating(true);
      // Each publish bumps the version; it's stamped in the PDF footer and persisted.
      const nextVersion = (instance?.version ?? 0) + 1;

      try {
          const shouldUseLegacyRenderer =
              import.meta.env.VITE_IM_PDF_LEGACY_HTML2CANVAS === 'true' ||
              window.localStorage.getItem('im.export.legacyHtml2canvas') === 'true';

          // Compose every visible section (template sections + project chapters, in
          // document order) into final HTML for the active language. This feeds the
          // PDF's Contents page (so project chapters get their own TOC entry) and the
          // section bodies (so project text/blocks render). `order: i` keeps the
          // renderer's flat sort in the same hierarchical order as the preview.
          const renderSections = orderedSections
              .filter(s => isSectionVisible(s))
              .map((s, i) => ({ ...s, order: i, title: localizedSectionTitle(s, activeLang), content: { ...s.content, [activeLang]: buildSectionHtml(s) } }));

          const pdfBlob = await renderProjectIMPdf({
              previewElement: previewRef.current,
              projectName: project.name,
              language: activeLang,
              template,
              sections: renderSections,
              formData,
              conditions,
              useLegacyHtml2Canvas: shouldUseLegacyRenderer,
              version: nextVersion,
          });

          const docTypeSlug = templateType === 'warning_leaflet' ? 'Warning_Leaflet' : 'Manual';
          const fileName = `${project.name.replace(/\s+/g, '_')}_${docTypeSlug}_${activeLang.toUpperCase()}.pdf`;
          const file = new File([pdfBlob], fileName, { type: "application/pdf" });

          const docTitle = `Generated ${typeLabel} (${activeLang.toUpperCase()}) - ${new Date().toLocaleDateString()}`;
          const newDoc = await addDocument({
             projectId: project.id,
             stepNumber: project.currentStep || 3,
             title: docTitle,
             description: `Generated from ${typeLabel} template in ${activeLang.toUpperCase()}`,
             responsibleParty: ResponsibleParty.INTERNAL,
             isVisibleToSupplier: true,
             isRequired: false,
             status: DocStatus.APPROVED
          });
          
          await uploadFile(newDoc.id, file, false);
          
          // Base layer = submitted attribute values (keyed by attribute id) so bound
      // placeholders/tokens resolve in the saved manual; PM edits in formData win.
      const dataToSave = { ...submittedAttrValues, ...formData };
          Object.entries(conditions).forEach(([k, v]) => {
             dataToSave[`cond_${k}`] = String(v);
          });
          Object.entries(sectionVisibility).forEach(([k, v]) => {
             dataToSave[`secvis_${k}`] = String(v);
          });
          Object.entries(refVisibility).forEach(([k, v]) => {
             dataToSave[`refvis_${k}`] = String(v);
          });
          dataToSave['__meta_language'] = activeLang;
          dataToSave['__field_bindings'] = JSON.stringify(fieldBindings);

          const savedIM = await saveProjectIM(project.id, selectedTemplateId, dataToSave, 'generated', skuContent, templateType, sectionAdditions, extraSections, sectionOverrides, nextVersion, boundSkuIds);
          setInstance(savedIM);

          // Publish the structured ResolvedManual (one JSON per language + manifest) to the
          // public im-published bucket, for a separate web/PDF render service to consume by URL.
          // Non-fatal: the PDF is already generated and uploaded above.
          if (template) {
              try {
                  const result = await publishResolvedManuals(project.id, template, sections, savedIM);
                  setPublishResult(result);
              } catch (pubErr: any) {
                  console.error('Structured publish failed', pubErr);
                  alert(`${typeLabel} generated, but publishing the structured JSON failed: ${pubErr.message}`);
                  navigate(`/project/${project.id}`);
              }
          } else {
              alert(`${typeLabel} generated and uploaded successfully!`);
              navigate(`/project/${project.id}`);
          }

      } catch (e: any) {
          console.error("Generation failed", e);
          alert(`Failed to generate PDF: ${e.message}`);
      } finally {
          setGenerating(false);
      }
  };

  // ---------------- PROJECT CONTENT EDITOR ----------------
  // All edits below mutate project-only state (sectionAdditions / extraSections);
  // the template (sections / blocks) is never touched.

  const newInlineBlock = (): InlineBlockRef => ({ kind: 'inline', content: {} });

  // --- Additions inside existing template sections ---
  const addBlockToSection = (sectionId: string, position: number) => {
      setSectionAdditions(prev => {
          const list = [...(prev[sectionId] ?? [])];
          list.push({ id: `add-${Math.random().toString(36).slice(2, 11)}`, position, block: newInlineBlock() });
          return { ...prev, [sectionId]: list };
      });
  };

  const updateAdditionContent = (sectionId: string, addId: string, lang: string, html: string) => {
      setSectionAdditions(prev => ({
          ...prev,
          [sectionId]: (prev[sectionId] ?? []).map(a =>
              a.id === addId ? { ...a, block: { ...a.block, content: { ...a.block.content, [lang]: html } } } : a),
      }));
  };

  const setAdditionVariant = (sectionId: string, addId: string, variant: CalloutVariant | undefined) => {
      setSectionAdditions(prev => ({
          ...prev,
          [sectionId]: (prev[sectionId] ?? []).map(a =>
              a.id === addId ? { ...a, block: { ...a.block, variant } } : a),
      }));
  };

  const removeAddition = (sectionId: string, addId: string) => {
      setSectionAdditions(prev => {
          const list = (prev[sectionId] ?? []).filter(a => a.id !== addId);
          const next = { ...prev };
          if (list.length) next[sectionId] = list; else delete next[sectionId];
          return next;
      });
  };

  // Reorder two additions that sit at the same anchor position; swaps array order.
  const moveAddition = (sectionId: string, addId: string, dir: -1 | 1) => {
      setSectionAdditions(prev => {
          const list = [...(prev[sectionId] ?? [])];
          const i = list.findIndex(a => a.id === addId);
          const j = i + dir;
          if (i < 0 || j < 0 || j >= list.length) return prev;
          // Swap both array order and anchor position so movement is intuitive
          // regardless of whether the neighbours share a position.
          const pi = list[i].position, pj = list[j].position;
          [list[i], list[j]] = [list[j], list[i]];
          list[i] = { ...list[i], position: pi };
          list[j] = { ...list[j], position: pj };
          return { ...prev, [sectionId]: list };
      });
  };

  // --- Project-only extra sections ---
  const addExtraSection = (parentId: string | null) => {
      // Order it after the last existing sibling so it appends to that group.
      const siblings = [
          ...sections.filter(s => (s.parentId ?? null) === parentId),
          ...extraSections.filter(s => (s.parentId ?? null) === parentId),
      ];
      const maxOrder = siblings.reduce((m, s) => Math.max(m, s.order || 0), 0);
      setExtraSections(prev => [...prev, {
          id: `proj-${Math.random().toString(36).slice(2, 11)}`,
          parentId,
          title: 'New section',
          order: maxOrder + 10,
          blocks: [newInlineBlock()],
      }]);
  };

  // Insert a new chapter (titled section) as a sibling immediately after `section`,
  // at the same level, so it lands right where the user added it and shows up as a
  // new entry in the table of contents.
  const addChapterAfter = (section: { id: string; parentId?: string | null; order: number }) => {
      const parentId = section.parentId ?? null;
      const siblingOrders = [
          ...sections.filter(s => (s.parentId ?? null) === parentId),
          ...extraSections.filter(s => (s.parentId ?? null) === parentId),
      ].map(s => s.order || 0);
      const greater = siblingOrders.filter(o => o > (section.order || 0)).sort((a, b) => a - b);
      const newOrder = greater.length ? ((section.order || 0) + greater[0]) / 2 : (section.order || 0) + 10;
      setExtraSections(prev => [...prev, {
          id: `proj-${Math.random().toString(36).slice(2, 11)}`,
          parentId,
          title: 'New chapter',
          order: newOrder,
          blocks: [newInlineBlock()],
      }]);
  };

  const updateExtraSection = (id: string, patch: Partial<ProjectExtraSection>) => {
      setExtraSections(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };

  const removeExtraSection = (id: string) => {
      // Re-parent any project children to this section's parent so they aren't orphaned.
      setExtraSections(prev => {
          const removed = prev.find(s => s.id === id);
          return prev
              .filter(s => s.id !== id)
              .map(s => s.parentId === id ? { ...s, parentId: removed?.parentId ?? null } : s);
      });
      setSectionAdditions(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  const addBlockToExtra = (id: string) => {
      setExtraSections(prev => prev.map(s => s.id === id ? { ...s, blocks: [...s.blocks, newInlineBlock()] } : s));
  };

  const updateExtraBlock = (id: string, idx: number, lang: string, html: string) => {
      setExtraSections(prev => prev.map(s => s.id === id
          ? { ...s, blocks: s.blocks.map((b, i) => i === idx ? { ...b, content: { ...b.content, [lang]: html } } : b) }
          : s));
  };

  const setExtraBlockVariant = (id: string, idx: number, variant: CalloutVariant | undefined) => {
      setExtraSections(prev => prev.map(s => s.id === id
          ? { ...s, blocks: s.blocks.map((b, i) => i === idx ? { ...b, variant } : b) }
          : s));
  };

  const removeExtraBlock = (id: string, idx: number) => {
      setExtraSections(prev => prev.map(s => s.id === id
          ? { ...s, blocks: s.blocks.filter((_, i) => i !== idx) }
          : s));
  };

  // --- Placeholder section overrides (full project content for is_placeholder sections) ---
  // Derive the initial editable blocks for a placeholder section from the template:
  // its inline refs, else its legacy content as one block, else one empty block.
  const seedPlaceholderBlocks = (section: IMSection): InlineBlockRef[] => {
      const inlineRefs = (section.blockRefs ?? []).filter(r => r.kind === 'inline') as InlineBlockRef[];
      if (inlineRefs.length) return inlineRefs.map(r => ({ kind: 'inline', content: { ...r.content }, variant: r.variant }));
      if (Object.values(section.content || {}).some(v => v)) return [{ kind: 'inline', content: { ...section.content } }];
      return [{ kind: 'inline', content: {} }];
  };

  // The blocks currently shown for a placeholder section: the saved override if the
  // PM has started editing, otherwise the template-derived seed (not yet persisted).
  const getOverrideBlocks = (section: IMSection): InlineBlockRef[] =>
      sectionOverrides[section.id] ?? seedPlaceholderBlocks(section);

  // Mutate a placeholder section's override, seeding it from the template on first edit.
  const editOverride = (section: IMSection, fn: (blocks: InlineBlockRef[]) => InlineBlockRef[]) => {
      setSectionOverrides(prev => {
          const current = prev[section.id] ?? seedPlaceholderBlocks(section);
          return { ...prev, [section.id]: fn(current) };
      });
  };

  const updateOverrideBlock = (section: IMSection, idx: number, lang: string, html: string) =>
      editOverride(section, blocks => blocks.map((b, i) => i === idx ? { ...b, content: { ...b.content, [lang]: html } } : b));

  const setOverrideVariant = (section: IMSection, idx: number, variant: CalloutVariant | undefined) =>
      editOverride(section, blocks => blocks.map((b, i) => i === idx ? { ...b, variant } : b));

  const addOverrideBlock = (section: IMSection) =>
      editOverride(section, blocks => [...blocks, newInlineBlock()]);

  const removeOverrideBlock = (section: IMSection, idx: number) =>
      editOverride(section, blocks => blocks.filter((_, i) => i !== idx));

  const moveOverrideBlock = (section: IMSection, idx: number, dir: -1 | 1) =>
      editOverride(section, blocks => {
          const j = idx + dir;
          if (j < 0 || j >= blocks.length) return blocks;
          const next = [...blocks];
          [next[idx], next[j]] = [next[j], next[idx]];
          return next;
      });

  // ---------------- EXPORT HELPERS ----------------

  const escapeXml = (unsafe: string) => {
      if (!unsafe) return '';
      return unsafe.replace(/[<>&'"]/g, function (c) {
          switch (c) {
              case '<': return '&lt;';
              case '>': return '&gt;';
              case '&': return '&amp;';
              case '\'': return '&apos;';
              case '"': return '&quot;';
          }
          return c;
      });
  };

  const getCleanContent = (html: string) => {
      if (!html) return '';
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Process Conditions
      const conditionNodes = doc.querySelectorAll('.im-condition');
      conditionNodes.forEach((node) => {
          const el = node as HTMLElement;
          const id = el.getAttribute('data-id');
          const contentEncoded = el.getAttribute('data-content');
          const always = el.getAttribute('data-always') === 'true';

          if (always && id) {
              const value = formData[id] || '';
              const textNode = document.createTextNode(value);
              el.replaceWith(textNode);
          } else if (id && conditions[id] && contentEncoded) {
              try {
                  const content = decodeURIComponent(contentEncoded);
                  const textNode = document.createTextNode(content);
                  el.replaceWith(textNode);
              } catch(e) { el.remove(); }
          } else { el.remove(); }
      });

      // Process Placeholders (Clean replacement)
      const placeholderNodes = doc.querySelectorAll('.im-placeholder');
      placeholderNodes.forEach((node) => {
          const el = node as HTMLElement;
          const id = el.getAttribute('data-id');
          const type = el.getAttribute('data-type');
          
          if (!id || !type) return;
          const val = formData[id];

          if (type === 'image') {
             if (val) {
                 const img = document.createElement('img');
                 img.src = val;
                 // Base64 images might be huge for XML, but we keep them for data integrity or strip them for text exports
                 el.replaceWith(img);
             } else {
                 el.remove();
             }
          } else {
             const span = document.createElement('span');
             span.textContent = val || '';
             el.replaceWith(span);
          }
      });

      return doc.body.innerHTML;
  };

  const downloadData = (data: string, filename: string, type: string) => {
      const blob = new Blob([data], { type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleExport = async (format: 'json' | 'xml') => {
      if (!project) return;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${project.name.replace(/\s+/g, '_')}_${activeLang}_${timestamp}.${format}`;

      if (format === 'json') {
          // Canonical structured artifact: the same ResolvedManual that gets published to the
          // im-published bucket, so this download is byte-identical to the hosted file.
          if (!template) { alert('Template not loaded.'); return; }
          const exportData: Record<string, string> = { ...submittedAttrValues, ...formData };
          Object.entries(conditions).forEach(([k, v]) => { exportData[`cond_${k}`] = String(v); });
          Object.entries(sectionVisibility).forEach(([k, v]) => { exportData[`secvis_${k}`] = String(v); });
          Object.entries(refVisibility).forEach(([k, v]) => { exportData[`refvis_${k}`] = String(v); });
          const resolverIM: ProjectIM = {
              id: instance?.id ?? '',
              templateId: selectedTemplateId,
              templateType,
              placeholderData: normalizeResolverData(exportData),
              skuContent,
              status: 'generated',
              updatedAt: new Date().toISOString(),
          };
          const blocks = await getIMBlocks();
          const blocksById: Record<string, any> = {};
          for (const b of blocks) blocksById[b.id] = b;
          const resolved = resolveManual(template, sections, blocksById, resolverIM, activeLang);
          downloadData(JSON.stringify(resolved, null, 2), filename, 'application/json');
      } else if (format === 'xml') {
          // InDesign / Generic XML format
          let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<InstructionManual>\n`;
          xml += `  <Metadata>\n`;
          xml += `    <ProjectName>${escapeXml(project.name)}</ProjectName>\n`;
          xml += `    <ProjectId>${escapeXml(project.projectId)}</ProjectId>\n`;
          xml += `    <ExportDate>${new Date().toISOString()}</ExportDate>\n`;
          xml += `    <Language>${activeLang}</Language>\n`;
          xml += `    <CoverTitle>${escapeXml(formData['__cover_title'] || project.name)}</CoverTitle>\n`;
          xml += `    <CoverSubtitle>${escapeXml(formData['__cover_subtitle'] || 'INSTRUCTION MANUAL')}</CoverSubtitle>\n`;
          xml += `  </Metadata>\n`;
          xml += `  <Sections>\n`;
          
          orderedSections.forEach(s => {
              const rawContent = getCleanContent(s.content[activeLang] || '');
              // Strip tags for a clean text version
              const textContent = rawContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
              
              xml += `    <Section id="${s.id}">\n`;
              xml += `      <Title>${escapeXml(s.title)}</Title>\n`;
              xml += `      <Order>${s.order}</Order>\n`;
              xml += `      <HtmlContent><![CDATA[${rawContent}]]></HtmlContent>\n`;
              xml += `      <PlainText>${escapeXml(textContent)}</PlainText>\n`;
              xml += `    </Section>\n`;
          });
          
          xml += `  </Sections>\n`;
          xml += `</InstructionManual>`;
          downloadData(xml, filename, 'application/xml');
      }
      setShowExportMenu(false);
  };

  // ---------------- EDITOR LOGIC ----------------

  const processContent = (html: string) => {
      if (!html) return '';
      
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Process Conditions
      const conditionNodes = doc.querySelectorAll('.im-condition');
      conditionNodes.forEach((node) => {
          const el = node as HTMLElement;
          const id = el.getAttribute('data-id');
          const contentEncoded = el.getAttribute('data-content');
          const always = el.getAttribute('data-always') === 'true';

          if (always && id) {
              const value = formData[id] || '';
              const textNode = document.createTextNode(value);
              el.replaceWith(textNode);
          } else if (id && conditions[id] && contentEncoded) {
              try {
                  const content = decodeURIComponent(contentEncoded);
                  const textNode = document.createTextNode(content);
                  el.replaceWith(textNode);
              } catch(e) { el.remove(); }
          } else { el.remove(); }
      });

      // Process Placeholders
      const placeholderNodes = doc.querySelectorAll('.im-placeholder');
      placeholderNodes.forEach((node) => {
          const el = node as HTMLElement;
          const id = el.getAttribute('data-id');
          const type = el.getAttribute('data-type');
          const attrId = el.getAttribute('data-attr-id');

          if (!id || !type) return;

          // PM-entered value (formData) wins; otherwise fall back to the value submitted
          // for the bound attribute (e.g. a supplier-uploaded product image). The
          // attribute binding (data-attr-id) is also tried so resolution matches the
          // published output even when data-id has diverged across languages.
          const val = formData[id] || submittedAttrValues[id] || (attrId ? (formData[attrId] || submittedAttrValues[attrId]) : '');
          const wrapperClass = "im-interactive-placeholder cursor-pointer rounded transition-all inline-block align-middle hover:ring-2 hover:ring-offset-1 hover:ring-indigo-400";

          const wrapper = document.createElement(type === 'image' && val ? 'div' : 'span');
          wrapper.className = wrapperClass;
          wrapper.setAttribute('data-interactive', 'true');
          wrapper.setAttribute('data-id', id);
          wrapper.setAttribute('data-type', type);
          
          if (type === 'image') {
             if (val) {
                 wrapper.className += " relative group";
                 wrapper.innerHTML = `<img src="${val}" class="max-w-full h-auto" /><div class="absolute inset-0 bg-black/20 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-white font-bold text-xs">Change Image</div>`;
             } else {
                 let label = 'Image';
                 const labelAttr = el.getAttribute('data-label');
                 if (labelAttr) try { label = decodeURIComponent(labelAttr); } catch(e) {}
                 else {
                      const text = el.textContent?.trim() || '';
                      if (text.startsWith('[') && text.endsWith(']')) label = text.substring(1, text.length-1);
                 }

                 wrapper.className += " bg-indigo-50 text-indigo-600 px-3 py-2 text-xs font-bold border border-dashed border-indigo-300 hover:bg-indigo-100";
                 wrapper.innerHTML = `<span style="display:flex;align-items:center;gap:4px">🖼️ ${label}</span>`;
             }
          } else {
             if (val) {
                 wrapper.className += " border-b-2 border-indigo-100 hover:border-indigo-400 px-1 hover:bg-indigo-50";
                 wrapper.textContent = val;
             } else {
                 let label = 'Text';
                 const labelAttr = el.getAttribute('data-label');
                 if (labelAttr) try { label = decodeURIComponent(labelAttr); } catch(e) {}
                 else {
                      const text = el.textContent?.trim() || '';
                      if (text.startsWith('[') && text.endsWith(']')) label = text.substring(1, text.length-1);
                 }

                 wrapper.className += " bg-amber-50 text-yellow-700 px-2 py-0.5 text-xs font-bold border border-dashed border-yellow-300 hover:bg-amber-100 mx-1";
                 wrapper.textContent = `[ ${label} ]`;
             }
          }
          el.replaceWith(wrapper);
      });

      return doc.body.innerHTML;
  };

  const getItemsInSection = (html: string) => {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const items: { id: string; kind: 'placeholder' | 'condition'; type?: 'text' | 'image'; featureId?: string; label?: string; conditionLabel?: string; always?: boolean }[] = [];

      const placeholders = doc.querySelectorAll('.im-placeholder');
      placeholders.forEach((el) => {
          const id = el.getAttribute('data-id');
          const type = el.getAttribute('data-type');
          let label = type === 'text' ? 'Text Input' : 'Image Upload';
          
          const labelAttr = el.getAttribute('data-label');
          if (labelAttr) {
              try {
                  label = decodeURIComponent(labelAttr);
              } catch(e) {}
          } else {
              // Fallback to text content
              const text = el.textContent?.trim() || '';
              if (text.startsWith('[') && text.endsWith(']')) {
                  label = text.substring(1, text.length - 1);
              }
          }

          if (id && type) items.push({ id, kind: 'placeholder', type: type as 'text'|'image', label });
      });

      const conditionNodes = doc.querySelectorAll('.im-condition');
      conditionNodes.forEach((el) => {
          const id = el.getAttribute('data-id');
          const featureId = el.getAttribute('data-feature-id');
          const contentEncoded = el.getAttribute('data-content');
          if (id && featureId) {
              const always = el.getAttribute('data-always') === 'true';
              let snippet = '';
              let conditionLabel = '';
              if (contentEncoded) {
                  try {
                      const content = decodeURIComponent(contentEncoded);
                      snippet = content.length > 40 ? content.substring(0, 40) + '...' : content;
                  } catch (e) { snippet = 'Error decoding content'; }
              }
              try {
                  const cv = el.getAttribute('data-condition-value');
                  if (cv && cv !== '*') conditionLabel = decodeURIComponent(cv);
              } catch (e) {}
              const featureName = el.getAttribute('data-feature-name') || '';
              if (always) {
                  items.push({ id, kind: 'condition', featureId, label: featureName, conditionLabel: '', always: true });
              } else if (contentEncoded) {
                  items.push({ id, kind: 'condition', featureId, label: snippet, conditionLabel });
              }
          }
      });
      return items;
  };

  /** Extract {{attributeId}} token names from an HTML/text fragment. */
  const getTokensInFragment = (html: string): string[] => {
      const out: string[] = [];
      const re = /\{\{\s*([^}]+?)\s*\}\}/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) out.push(m[1].trim());
      return out;
  };

  /**
   * All content fragments that make up a section in a given language: its own
   * inline content plus every inline ref and shared block it references. Mirrors
   * buildSectionHtml so the config form sees exactly what the preview renders.
   */
  const getSectionFragments = (section: IMSection, lang: string): string[] => {
      const refs = section.blockRefs ?? [];
      const hasInlineRef = refs.some(r => r.kind === 'inline');
      const frags: string[] = [];
      if (!hasInlineRef) frags.push(section.content[lang] || section.content['en'] || '');
      for (const ref of refs) {
          if (ref.kind === 'inline') {
              frags.push((ref as any).content?.[lang] || (ref as any).content?.['en'] || '');
          } else if (ref.kind === 'block') {
              const blk = availableBlocks[(ref as any).block_id];
              if (blk) frags.push(blk.content[lang] || blk.content['en'] || '');
          }
      }
      return frags.filter(Boolean);
  };

  /**
   * Every input a section needs across all its content sources:
   *  - items: placeholders + conditions (deduped by id)
   *  - attrTokens: {{attributeId}} tokens (e.g. SKU number, power) pulled from
   *    inline content AND shared blocks, so bound spec values are verifiable here.
   */
  const collectSectionInputs = (section: IMSection, lang: string) => {
      const seenItems = new Set<string>();
      const items: ReturnType<typeof getItemsInSection> = [];
      const seenTokens = new Set<string>();
      const attrTokens: string[] = [];
      for (const html of getSectionFragments(section, lang)) {
          for (const it of getItemsInSection(html)) {
              if (!seenItems.has(it.id)) { seenItems.add(it.id); items.push(it); }
          }
          for (const tok of getTokensInFragment(html)) {
              if (!seenTokens.has(tok)) { seenTokens.add(tok); attrTokens.push(tok); }
          }
      }
      return { items, attrTokens };
  };

  const calculateCompletion = (lang: string) => {
      let total = 0;
      let filled = 0;
      
      sections.forEach(s => {
          const { items, attrTokens } = collectSectionInputs(s, lang);
          items.forEach(i => {
              if (i.kind === 'placeholder' || (i.kind === 'condition' && i.always)) {
                  total++;
                  if (formData[i.id] || submittedAttrValues[i.id]) filled++;
              }
          });
          // Spec tokens ({{attribute}}) bound inside content or blocks
          attrTokens.forEach(tok => {
              total++;
              if (formData[tok] || submittedAttrValues[tok]) filled++;
          });
      });
      
      if (total === 0) return { status: 'ready', label: 'Ready (No Inputs)' };
      return {
          status: filled === total ? 'ready' : 'incomplete',
          label: `${filled}/${total} Filled`
      };
  };

  if (loading) return <Layout><div>Loading...</div></Layout>;

  if (!selectedTemplateId) {
      return (
          <Layout>
              <div className="max-w-2xl mx-auto mt-10">
                  <h1 className="text-3xl font-bold text-primary mb-6">Generate {typeLabel}</h1>
                  <div className="bg-white p-8 rounded-xl border border-gray-200 shadow">
                      <label className="block font-medium text-gray-700 mb-2">Select a Template</label>
                      <select className="w-full p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" onChange={handleTemplateSelect} defaultValue="">
                          <option value="" disabled>-- Choose a Template --</option>
                          {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                  </div>
              </div>
          </Layout>
      );
  }

  const matchesConditionValue = (value: string, conditionLabel: string, attr: CategoryAttribute): boolean => {
    const v = value.trim();
    const cv = conditionLabel.trim();
    switch (attr.dataType) {
      case 'boolean':
        return (v === 'true' && cv === 'Yes') || (v === 'false' && cv === 'No');
      case 'enum':
        return cv.split(',').map(s => s.trim()).includes(v);
      case 'integer':
      case 'decimal': {
        const num = parseFloat(v);
        if (isNaN(num)) return false;
        const rangeMatch = cv.match(/^([\d.]+)\s*[–\-]\s*([\d.]+)/);
        if (rangeMatch) return num >= parseFloat(rangeMatch[1]) && num <= parseFloat(rangeMatch[2]);
        return parseFloat(cv.replace(/[^\d.]/g, '')) === num;
      }
      case 'text':
        return v.toLowerCase() === cv.toLowerCase();
      default:
        return true;
    }
  };

  const isSectionVisible = (section: IMSection): boolean => {
    const override = sectionVisibility[section.id];
    if (override !== undefined) return override;
    if (!section.conditionFeatureId || !section.conditionLabel) return true;
    const value = submittedAttrValues[section.conditionFeatureId];
    if (!value) return true; // no submitted data → include by default
    const attr = allAttributes.find(a => a.id === section.conditionFeatureId);
    if (!attr) return true;
    return matchesConditionValue(value, section.conditionLabel, attr);
  };

  // --- Conditional inline rows + shared blocks ("Show if" conditions) ---
  // A ref carries a condition when it requires (or requires the absence of) an attribute.
  const refHasCondition = (ref: BlockRef): boolean =>
    ref.kind !== 'sku_slot' && !!((ref as FeatureConditionFields).requires_feature || (ref as FeatureConditionFields).requires_feature_absent);

  // Auto visibility from the feature gate, evaluated against the same merged data the
  // resolver sees (submitted supplier values as the base, PM edits in formData on top).
  const refAutoVisible = (ref: BlockRef): boolean =>
    passesFeatureGate(ref as FeatureConditionFields, { ...submittedAttrValues, ...formData }, {});

  // Effective visibility: a manual Include/Exclude override wins; otherwise the gate.
  const isRefVisible = (sectionId: string, index: number, ref: BlockRef): boolean => {
    const override = refVisibility[`${sectionId}:${index}`];
    if (override !== undefined) return override;
    return refAutoVisible(ref);
  };

  // Human-readable description of a ref's condition (mirrors IMTemplateEditor).
  const describeRefCondition = (ref: FeatureConditionFields): string | null => {
    const condAttrId = ref.requires_feature ?? ref.requires_feature_absent ?? null;
    if (!condAttrId) return null;
    const condAttr = allAttributes.find(a => a.id === condAttrId);
    if (!condAttr) return null;
    if (ref.requires_feature_absent) return `${condAttr.name}: absent`;
    if (ref.requires_feature_label) return `${condAttr.name} ∈ ${ref.requires_feature_label}`;
    if (ref.requires_feature_num_min && ref.requires_feature_num_max) return `${condAttr.name}: ${ref.requires_feature_num_min}–${ref.requires_feature_num_max}`;
    if (ref.requires_feature_num_min) return `${condAttr.name} ≥ ${ref.requires_feature_num_min}`;
    if (ref.requires_feature_num_max) return `${condAttr.name} ≤ ${ref.requires_feature_num_max}`;
    return `${condAttr.name}: has value`;
  };

  // SKU content helpers
  const updateSkuSlot = (slot: string, value: SKUContentValue) =>
    setSkuContent(prev => ({ ...prev, [slot]: value }));

  const renderSkuSlotForm = (ref: SKUSlotRef) => {
    const label = ref.label[activeLang] ?? ref.label['en'] ?? ref.slot;
    const current = skuContent[ref.slot];

    if (ref.schema === 'rich_text') {
      const val = current as RichTextContent | undefined;
      const html = val?.value[activeLang] ?? val?.value['en'] ?? '';
      return (
        <div key={ref.slot} className="border border-violet-200 rounded-lg p-3 bg-violet-50/40">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">RICH TEXT</span>
            <span className="text-xs font-bold text-gray-700">{label}</span>
            {ref.required && <span className="text-rose-400 text-[10px]">*required</span>}
          </div>
          <textarea
            className="w-full border border-violet-200 rounded p-2 text-sm focus:ring-2 focus:ring-violet-400 outline-none bg-white font-mono"
            rows={4}
            placeholder={`<p>${label} content…</p>`}
            value={html}
            onChange={e => updateSkuSlot(ref.slot, { type: 'rich_text', value: { ...(val?.value ?? {}), [activeLang]: e.target.value } })}
          />
        </div>
      );
    }

    if (ref.schema === 'legend_table') {
      const val = current as LegendTableContent | undefined;
      const rows = val?.rows ?? [];
      return (
        <div key={ref.slot} className="border border-violet-200 rounded-lg p-3 bg-violet-50/40">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">LEGEND TABLE</span>
              <span className="text-xs font-bold text-gray-700">{label}</span>
              {ref.required && <span className="text-rose-400 text-[10px]">*required</span>}
            </div>
            <button
              onClick={() => updateSkuSlot(ref.slot, { type: 'legend_table', rows: [...rows, { number: rows.length + 1, label: { en: '' } }] })}
              className="text-xs text-violet-600 hover:text-violet-800 font-medium flex items-center gap-1"
            >+ Row</button>
          </div>
          <div className="space-y-1.5">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded w-8 text-center shrink-0">{row.number}</span>
                <input
                  className="flex-1 border rounded px-2 py-1 text-sm focus:ring-1 focus:ring-violet-400 outline-none"
                  placeholder={`Label (${activeLang.toUpperCase()})…`}
                  value={row.label[activeLang] ?? row.label['en'] ?? ''}
                  onChange={e => {
                    const newRows = rows.map((r, j) => j === i ? { ...r, label: { ...r.label, [activeLang]: e.target.value } } : r);
                    updateSkuSlot(ref.slot, { type: 'legend_table', rows: newRows });
                  }}
                />
                <button onClick={() => updateSkuSlot(ref.slot, { type: 'legend_table', rows: rows.filter((_, j) => j !== i).map((r, j) => ({ ...r, number: j + 1 })) })}
                  className="text-gray-300 hover:text-rose-500"><X size={13} /></button>
              </div>
            ))}
            {rows.length === 0 && <p className="text-xs text-gray-400 italic">No rows yet. Click "+ Row" to add parts.</p>}
          </div>
        </div>
      );
    }

    if (ref.schema === 'step_sequence') {
      const val = current as StepSequenceContent | undefined;
      const steps = val?.steps ?? [];
      return (
        <div key={ref.slot} className="border border-violet-200 rounded-lg p-3 bg-violet-50/40">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">STEPS</span>
              <span className="text-xs font-bold text-gray-700">{label}</span>
              {ref.required && <span className="text-rose-400 text-[10px]">*required</span>}
            </div>
            <button
              onClick={() => updateSkuSlot(ref.slot, { type: 'step_sequence', steps: [...steps, { text: { en: '' } }] })}
              className="text-xs text-violet-600 hover:text-violet-800 font-medium flex items-center gap-1"
            >+ Step</button>
          </div>
          <div className="space-y-2">
            {steps.map((step, i) => (
              <div key={i} className="bg-white border rounded-lg p-2 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-gray-400">STEP {i + 1}</span>
                  <button onClick={() => updateSkuSlot(ref.slot, { type: 'step_sequence', steps: steps.filter((_, j) => j !== i) })}
                    className="text-gray-300 hover:text-rose-500"><X size={12} /></button>
                </div>
                <textarea className="w-full border rounded px-2 py-1 text-sm focus:ring-1 focus:ring-violet-400 outline-none"
                  rows={2} placeholder={`Step text (${activeLang.toUpperCase()})…`}
                  value={step.text[activeLang] ?? step.text['en'] ?? ''}
                  onChange={e => {
                    const newSteps = steps.map((s, j) => j === i ? { ...s, text: { ...s.text, [activeLang]: e.target.value } } : s);
                    updateSkuSlot(ref.slot, { type: 'step_sequence', steps: newSteps });
                  }}
                />
                {/* Step image upload */}
                <div className="flex items-center gap-2">
                  {step.image?.url && (
                    <img src={step.image.url} alt="" className="h-12 w-16 object-cover rounded border shrink-0" />
                  )}
                  <label className={`flex items-center gap-1 text-xs px-2 py-1.5 rounded border cursor-pointer transition-colors ${step.image?.url ? 'border-gray-200 bg-white text-gray-500 hover:bg-gray-50' : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'} ${uploadingSlot === `${ref.slot}-step-${i}` ? 'opacity-60 pointer-events-none' : ''}`}>
                    {uploadingSlot === `${ref.slot}-step-${i}` ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                    {uploadingSlot === `${ref.slot}-step-${i}` ? 'Uploading…' : (step.image?.url ? 'Replace image' : 'Upload image')}
                    <input type="file" accept="image/*" className="hidden" onChange={async e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const key = `${ref.slot}-step-${i}`;
                      setUploadingSlot(key);
                      try {
                        const url = await uploadIMAsset(file, 'sku');
                        const newSteps = steps.map((s, j) => j === i ? { ...s, image: { url, width: 0, height: 0 } } : s);
                        updateSkuSlot(ref.slot, { type: 'step_sequence', steps: newSteps });
                      } catch (err: any) {
                        console.error('[ProjectIMGenerator] step image upload failed:', err);
                        alert(err?.message ?? 'Upload failed — see console.');
                      } finally { setUploadingSlot(null); e.target.value = ''; }
                    }} />
                  </label>
                  {step.image?.url && (
                    <button onClick={() => {
                      const newSteps = steps.map((s, j) => j === i ? { ...s, image: undefined } : s);
                      updateSkuSlot(ref.slot, { type: 'step_sequence', steps: newSteps });
                    }} className="text-gray-300 hover:text-rose-500"><X size={12} /></button>
                  )}
                </div>
              </div>
            ))}
            {steps.length === 0 && <p className="text-xs text-gray-400 italic">No steps yet. Click "+ Step" to add.</p>}
          </div>
        </div>
      );
    }

    if (ref.schema === 'annotated_image_set') {
      const val = current as AnnotatedImageSetContent | undefined;
      const images = val?.images ?? [];
      const firstImage = images[0] as AnnotatedImage | undefined;
      const annotations = firstImage?.annotations ?? [];
      return (
        <div key={ref.slot} className="border border-violet-200 rounded-lg p-3 bg-violet-50/40">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-bold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded-full">ANNOTATED IMAGE</span>
            <span className="text-xs font-bold text-gray-700">{label}</span>
            {ref.required && <span className="text-rose-400 text-[10px]">*required</span>}
          </div>
          {/* Image upload */}
          <div className="flex items-start gap-3 mb-3">
            {firstImage?.url && (
              <div className="relative shrink-0">
                <img src={firstImage.url} alt="" className="h-20 w-28 object-cover rounded border" />
                <button onClick={() => updateSkuSlot(ref.slot, { type: 'annotated_image_set', images: [] })}
                  className="absolute -top-1.5 -right-1.5 bg-white border rounded-full p-0.5 text-gray-400 hover:text-rose-500"><X size={11} /></button>
              </div>
            )}
            <label className={`flex flex-col items-center justify-center gap-1.5 px-4 py-3 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${firstImage?.url ? 'border-gray-200 hover:bg-gray-50' : 'border-violet-300 bg-violet-50/40 hover:bg-violet-50'} ${uploadingSlot === ref.slot ? 'opacity-60 pointer-events-none' : ''}`}>
              {uploadingSlot === ref.slot
                ? <Loader2 size={18} className="text-violet-500 animate-spin" />
                : <Upload size={18} className={firstImage?.url ? 'text-gray-400' : 'text-violet-500'} />}
              <span className={`text-xs font-medium ${firstImage?.url ? 'text-gray-500' : 'text-violet-700'}`}>
                {uploadingSlot === ref.slot ? 'Uploading…' : (firstImage?.url ? 'Replace image' : 'Upload image')}
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                setUploadingSlot(ref.slot);
                try {
                  const url = await uploadIMAsset(file, 'sku');
                  const img: AnnotatedImage = {
                    asset_id: '', url, width: 0, height: 0,
                    alt: firstImage?.alt ?? { en: label },
                    annotations: firstImage?.annotations ?? []
                  };
                  updateSkuSlot(ref.slot, { type: 'annotated_image_set', images: [img] });
                } catch (err: any) {
                  console.error('[ProjectIMGenerator] annotated image upload failed:', err);
                  alert(err?.message ?? 'Upload failed — see console.');
                } finally { setUploadingSlot(null); e.target.value = ''; }
              }} />
            </label>
          </div>
          {firstImage?.url && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-gray-400 uppercase">Annotations</span>
                <button
                  onClick={() => {
                    const newAnns = [...annotations, { number: annotations.length + 1, x: 0.5, y: 0.5, label: { en: '' } }];
                    const img: AnnotatedImage = { ...firstImage!, annotations: newAnns };
                    updateSkuSlot(ref.slot, { type: 'annotated_image_set', images: [img] });
                  }}
                  className="text-xs text-violet-600 hover:text-violet-800 font-medium"
                >+ Annotation</button>
              </div>
              {annotations.map((ann, ai) => (
                <div key={ai} className="flex items-center gap-1.5 bg-white rounded p-1.5 border">
                  <span className="text-[10px] font-mono bg-gray-100 px-1.5 rounded">{ann.number}</span>
                  <input className="w-14 border rounded px-1.5 py-0.5 text-xs" placeholder="X%" type="number" min="0" max="100" step="1"
                    value={Math.round(ann.x * 100)}
                    onChange={e => {
                      const newAnns = annotations.map((a, j) => j === ai ? { ...a, x: Number(e.target.value) / 100 } : a);
                      updateSkuSlot(ref.slot, { type: 'annotated_image_set', images: [{ ...firstImage!, annotations: newAnns }] });
                    }}
                  />
                  <input className="w-14 border rounded px-1.5 py-0.5 text-xs" placeholder="Y%" type="number" min="0" max="100" step="1"
                    value={Math.round(ann.y * 100)}
                    onChange={e => {
                      const newAnns = annotations.map((a, j) => j === ai ? { ...a, y: Number(e.target.value) / 100 } : a);
                      updateSkuSlot(ref.slot, { type: 'annotated_image_set', images: [{ ...firstImage!, annotations: newAnns }] });
                    }}
                  />
                  <input className="flex-1 border rounded px-1.5 py-0.5 text-xs"
                    placeholder={`Label (${activeLang.toUpperCase()})…`}
                    value={ann.label[activeLang] ?? ann.label['en'] ?? ''}
                    onChange={e => {
                      const newAnns = annotations.map((a, j) => j === ai ? { ...a, label: { ...a.label, [activeLang]: e.target.value } } : a);
                      updateSkuSlot(ref.slot, { type: 'annotated_image_set', images: [{ ...firstImage!, annotations: newAnns }] });
                    }}
                  />
                  <button onClick={() => {
                    const newAnns = annotations.filter((_, j) => j !== ai).map((a, j) => ({ ...a, number: j + 1 }));
                    updateSkuSlot(ref.slot, { type: 'annotated_image_set', images: [{ ...firstImage!, annotations: newAnns }] });
                  }} className="text-gray-300 hover:text-rose-500"><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      );
    }

    return null;
  };

  // Build preview HTML for a section: inline content + block refs in order.
  // Mirrors the resolver's hybrid-mode logic so the preview matches the final output.
  // Render a single inline block (project addition or extra-section block) to HTML.
  const renderInlineHtml = (content: Record<string, string> | undefined, variant?: CalloutVariant): string => {
    const html = processContent(content?.[activeLang] || content?.['en'] || '');
    if (!html) return '';
    return variant ? wrapBlockCallout(variant, html) : html;
  };

  const buildSectionHtml = (section: IMSection): string => {
    // A project-authored placeholder section: its override blocks fully replace the
    // template content (mirrors the resolver). Empty override = intentionally blank.
    const override = sectionOverrides[section.id];
    const refs = override ?? (section.blockRefs ?? []);
    const hasInlineRef = refs.some(r => r.kind === 'inline');
    const parts: string[] = [];
    // Project additions for this section, anchored by position among the template refs.
    const additions = [...(sectionAdditions[section.id] ?? [])].sort((a, b) => a.position - b.position);

    // If not overridden and no inline ref exists, the section's own content column is the leading content
    if (!override && !hasInlineRef) {
      const html = processContent(section.content[activeLang] || '');
      if (html) parts.push(html);
    }

    for (let i = 0; i < refs.length; i++) {
      // Emit project additions anchored before this template ref.
      for (const add of additions) {
        if (add.position === i) { const h = renderInlineHtml(add.block.content, add.block.variant); if (h) parts.push(h); }
      }

      const ref = refs[i];
      // Conditional inline rows + shared blocks: hidden when their condition isn't met
      // (unless a manual Include override forces them on). Mirrors the resolver.
      if ((ref.kind === 'inline' || ref.kind === 'block') && !isRefVisible(section.id, i, ref)) continue;
      if (ref.kind === 'inline') {
        const html = processContent((ref as any).content?.[activeLang] || (ref as any).content?.['en'] || '');
        // A row variant wraps its whole content in the ISO callout box (matches the resolver).
        if (html) parts.push((ref as any).variant ? wrapBlockCallout((ref as any).variant, html) : html);
      } else if (ref.kind === 'block') {
        const blk = availableBlocks[(ref as any).block_id];
        if (blk) {
          const baseHtml = processContent(blk.content[activeLang] || blk.content['en'] || '');
          // Substitute {{attributeId}} tokens: a PM override (formData) wins over the
          // submitted supplier value — matching what gets saved/generated.
          const rawHtml = baseHtml.replace(
            /\{\{\s*([^}]+?)\s*\}\}/g,
            (_, k) => formData[k.trim()] ?? submittedAttrValues[k.trim()] ?? `{{${k.trim()}}}`
          );
          if (rawHtml) parts.push(wrapBlockCallout(blk.blockType, rawHtml));
        }
      }
      // sku_slot — visible in the config form; not rendered in the text preview
    }

    // Additions anchored at (or past) the end of the section.
    for (const add of additions) {
      if (add.position >= refs.length) { const h = renderInlineHtml(add.block.content, add.block.variant); if (h) parts.push(h); }
    }

    return parts.join('');
  };

  // Flatten sections in the same hierarchical pre-order the resolver uses: roots
  // sorted by `order`, each immediately followed by its descendants (also sorted
  // by `order`). A flat global sort is wrong because `order` is assigned per
  // sibling-group (10/20/30 within each parent), so it would interleave children
  // of different parents and break the template's section order.
  // Project-only sections rendered as synthetic IMSections (their inline blocks
  // become blockRefs) so they flow through the same ordering + preview as template
  // sections. Mirrors the resolver. `__projectExtra` marks them for the editor UI.
  const extraAsSections: (IMSection & { __projectExtra?: true })[] = extraSections.map(ex => ({
    id: ex.id,
    templateId: template?.id ?? '',
    parentId: ex.parentId,
    title: ex.title,
    order: ex.order,
    isPlaceholder: false,
    content: {},
    blockRefs: ex.blocks,
    __projectExtra: true,
  }));

  const orderedSections = (() => {
    const all: (IMSection & { __projectExtra?: true })[] = [...sections, ...extraAsSections];
    const byParent = new Map<string | null, (IMSection & { __projectExtra?: true })[]>();
    for (const s of all) {
      const p = s.parentId ?? null;
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p)!.push(s);
    }
    for (const list of byParent.values()) list.sort((a, b) => (a.order || 0) - (b.order || 0));
    const out: (IMSection & { __projectExtra?: true })[] = [];
    const walk = (parent: string | null) => {
      for (const s of byParent.get(parent) ?? []) { out.push(s); walk(s.id); }
    };
    walk(null);
    return out;
  })();
  // Attributes selectable for this project (its category + global attributes).
  const projectAttributes = project?.categoryId
    ? getAttributesForCategory(allAttributes, project.categoryId)
    : allAttributes;

  // --- Per-project required languages ------------------------------------------
  // A project produces a subset of the template's languages (English always
  // included as source/fallback). Persisted as `__required_languages` in formData;
  // absent = all template languages. Drives the editor tabs, preview dropdown,
  // pre-publish checklist, and what gets published.
  const templateLangs = template?.languages || ['en'];
  const requiredLanguages = (() => {
    try {
      const raw = formData['__required_languages'];
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        const filtered = templateLangs.filter(l => l === 'en' || arr.includes(l));
        if (filtered.length) return filtered;
      }
    } catch { /* fall through to all template languages */ }
    return templateLangs;
  })();

  const toggleRequiredLanguage = (code: string) => {
    if (code === 'en') return; // English is always required (source/fallback).
    const next = requiredLanguages.includes(code)
      ? requiredLanguages.filter(l => l !== code)
      : [...requiredLanguages, code];
    // Store the explicit non-English subset; English stays implicit.
    handleInputChange('__required_languages', JSON.stringify(templateLangs.filter(l => l !== 'en' && next.includes(l))));
    if (!next.includes(activeLang)) setActiveLang('en');
  };

  // Language list for the project content editor (one tab per REQUIRED language).
  const editorLanguages = requiredLanguages.map(c => ({ code: c, label: c.toUpperCase() }));

  // Toggle a SKU in/out of this IM's binding. Enforces ≥1 bound SKU (can't remove the last).
  const toggleBoundSku = (skuId: string) => {
    setBoundSkuIds(prev => {
      if (prev.includes(skuId)) {
        const next = prev.filter(id => id !== skuId);
        return next.length ? next : prev;
      }
      return [...prev, skuId];
    });
  };

  // --- Pre-publish checklist ---------------------------------------------------
  // Surfaces what's missing before publishing: unfilled input values + required
  // SKU slots (both shared across languages), and per-language content gaps
  // (sections/rows/blocks that have English content but no translation). Returns
  // empty arrays when everything is complete.
  const buildPublishChecklist = () => {
    const blocking: string[] = [];
    const values: string[] = [];
    const slots: string[] = [];
    const seen = new Set<string>();

    // Hard requirement: an IM must be bound to at least one SKU (and the project must have one).
    const boundCount = boundSkuIds.length ? projectSkus.filter(s => boundSkuIds.includes(s.id)).length : projectSkus.length;
    if (projectSkus.length === 0) blocking.push('This project has no SKUs. Add at least one SKU, then bind it to this manual.');
    else if (boundCount === 0) blocking.push('No SKU is bound to this manual. Select at least one in “Bound SKUs”.');

    for (const section of orderedSections) {
      if (!isSectionVisible(section)) continue;
      const secTitle = localizedSectionTitle(section, 'en');
      const { items, attrTokens } = collectSectionInputs(section, 'en');
      // Placeholder values + value-conditions are filled once and shared across languages.
      for (const it of items) {
        if (it.kind === 'condition' && !it.always) continue; // visibility toggles, not required values
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        if (!(formData[it.id] || submittedAttrValues[it.id])) values.push(`${it.label} — ${secTitle}`);
      }
      for (const tok of attrTokens) {
        if (seen.has(tok)) continue;
        seen.add(tok);
        if (!(formData[tok] || submittedAttrValues[tok])) {
          const attr = allAttributes.find(a => a.id === tok);
          values.push(`${attr?.name ?? tok} — ${secTitle}`);
        }
      }
      // Required SKU slots.
      for (const ref of (section.blockRefs ?? [])) {
        if (ref.kind === 'sku_slot' && ref.required && !skuContent[ref.slot]) {
          slots.push(`${ref.label?.en ?? ref.slot} — ${secTitle}`);
        }
      }
    }

    // Per-language content gaps: anything authored in English but blank in another
    // REQUIRED language (non-required languages aren't part of this project's manual).
    const otherLangs = requiredLanguages.filter(l => l !== 'en');
    const translations: { lang: string; items: string[] }[] = [];
    for (const lang of otherLangs) {
      const missing = new Set<string>();
      for (const section of orderedSections) {
        if (!isSectionVisible(section)) continue;
        const secTitle = localizedSectionTitle(section, 'en');
        const refs = sectionOverrides[section.id] ?? section.blockRefs ?? [];
        const hasInlineRef = refs.some(r => r.kind === 'inline');
        if (!hasInlineRef && section.content['en']?.trim() && !section.content[lang]?.trim()) {
          missing.add(secTitle);
        }
        refs.forEach((ref, i) => {
          if ((ref.kind === 'inline' || ref.kind === 'block') && !isRefVisible(section.id, i, ref)) return;
          if (ref.kind === 'inline') {
            if ((ref as any).content?.['en']?.trim() && !(ref as any).content?.[lang]?.trim()) missing.add(secTitle);
          } else if (ref.kind === 'block') {
            const blk = availableBlocks[(ref as any).block_id];
            if (blk?.content['en']?.trim() && !blk.content[lang]?.trim()) missing.add(secTitle);
          }
        });
      }
      if (missing.size) translations.push({ lang, items: [...missing] });
    }

    return { blocking, values, slots, translations };
  };

  // Publish entry point: run the checklist first. If anything's missing (or blocked),
  // show it for review; otherwise publish straight away.
  const handlePublishClick = () => {
    const result = buildPublishChecklist();
    if (result.blocking.length || result.values.length || result.slots.length || result.translations.length) {
      setChecklist(result);
    } else {
      handleGenerate();
    }
  };

  // Read-only HTML for a single template block ref (shown as a locked card in the
  // content editor). Mirrors buildSectionHtml's per-ref rendering.
  const templateRefPreviewHtml = (ref: any): string => {
    if (ref.kind === 'inline') return renderInlineHtml(ref.content, ref.variant);
    if (ref.kind === 'block') {
      const blk = availableBlocks[ref.block_id];
      if (!blk) return '';
      const baseHtml = processContent(blk.content[activeLang] || blk.content['en'] || '');
      const rawHtml = baseHtml.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => formData[k.trim()] ?? submittedAttrValues[k.trim()] ?? `{{${k.trim()}}}`);
      return rawHtml ? wrapBlockCallout(blk.blockType, rawHtml) : '';
    }
    return '';
  };

  // An "+ Add text here" button that inserts a plain (header-less) project text
  // block at `position`. The alternative — a chapter with a header — is added via
  // the "Add chapter" button, which creates a titled section shown in the contents.
  const renderInsertButton = (sectionId: string, position: number) => (
    <button
      onClick={() => addBlockToSection(sectionId, position)}
      className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-indigo-400 border border-dashed border-indigo-200 rounded hover:bg-indigo-50 hover:text-indigo-600 transition-colors"
    ><Type size={12} /> Add text here</button>
  );

  // A "+ Add chapter after this" button — creates a titled project section that
  // appears as its own entry in the table of contents.
  const renderAddChapterButton = (section: { id: string; parentId?: string | null; order: number }) => (
    <button
      onClick={() => addChapterAfter(section)}
      className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-emerald-500 border border-dashed border-emerald-300 rounded hover:bg-emerald-50 hover:text-emerald-700 transition-colors"
    ><FilePlus2 size={12} /> Add chapter after this (with header)</button>
  );

  // Editable card for one project-authored inline block.
  const renderAdditionEditor = (
    block: InlineBlockRef,
    opts: { onChange: (lang: string, html: string) => void; onVariant: (v: CalloutVariant | undefined) => void; onRemove: () => void; onUp?: () => void; onDown?: () => void; rowKey: string },
  ) => (
    <div className="border border-indigo-200 rounded-lg bg-indigo-50/40">
      <div className="flex items-center justify-between px-2 py-1 border-b border-indigo-100">
        <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-500 flex items-center gap-1"><FilePlus2 size={11} /> Project content</span>
        <div className="flex items-center gap-1">
          {opts.onUp && <button onClick={opts.onUp} title="Move up" className="p-1 text-gray-400 hover:text-indigo-600"><ChevronUp size={13} /></button>}
          {opts.onDown && <button onClick={opts.onDown} title="Move down" className="p-1 text-gray-400 hover:text-indigo-600"><ChevronDown size={13} /></button>}
          <button onClick={opts.onRemove} title="Remove" className="p-1 text-gray-400 hover:text-rose-600"><Trash2 size={13} /></button>
        </div>
      </div>
      <InlineBlockEditor
        rowKey={opts.rowKey}
        content={block.content}
        variant={block.variant}
        languages={editorLanguages}
        attributes={projectAttributes}
        onChange={opts.onChange}
        onVariantChange={opts.onVariant}
      />
    </div>
  );

  const renderContentEditor = () => (
    <div className="flex-1 overflow-y-auto p-5 space-y-6">
      <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-800 flex items-start gap-2">
        <FilePlus2 size={14} className="mt-0.5 shrink-0" />
        <span>Add content that applies only to this project. Choose <strong>Add text</strong> for plain content within a section, or <strong>Add chapter</strong> for a titled section that gets its own heading and a new entry in the table of contents. Template blocks are <strong>locked</strong>; nothing here changes the shared template.</span>
      </div>

      {orderedSections.map(section => {
        // Internal metadata section is not user-facing content.
        if (section.title === '__METADATA__') return null;
        const isExtra = (section as any).__projectExtra === true;
        const refs = section.blockRefs ?? [];
        const additions = [...(sectionAdditions[section.id] ?? [])].sort((a, b) => a.position - b.position);

        if (isExtra) {
          const extra = extraSections.find(e => e.id === section.id);
          if (!extra) return null;
          return (
            <div key={section.id} className="border border-emerald-200 rounded-xl p-3 bg-emerald-50/30">
              <div className="flex items-center gap-2 mb-3">
                <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase">Project section</span>
                <input
                  value={extra.title}
                  onChange={e => updateExtraSection(extra.id, { title: e.target.value })}
                  className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm font-bold text-gray-800 outline-none focus:ring-2 focus:ring-emerald-400"
                  placeholder="Section title"
                />
                <button onClick={() => removeExtraSection(extra.id)} title="Delete section" className="p-1.5 text-gray-400 hover:text-rose-600"><Trash2 size={15} /></button>
              </div>
              <div className="space-y-3">
                {extra.blocks.map((block, idx) => (
                  <div key={`${extra.id}-${idx}`}>
                    {renderAdditionEditor(block, {
                      rowKey: `${extra.id}-${idx}`,
                      onChange: (lang, html) => updateExtraBlock(extra.id, idx, lang, html),
                      onVariant: (v) => setExtraBlockVariant(extra.id, idx, v),
                      onRemove: () => removeExtraBlock(extra.id, idx),
                    })}
                  </div>
                ))}
                <button onClick={() => addBlockToExtra(extra.id)} className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-indigo-400 border border-dashed border-indigo-200 rounded hover:bg-indigo-50 hover:text-indigo-600 transition-colors"><Type size={12} /> Add text block</button>
                {renderAddChapterButton(extra)}
              </div>
            </div>
          );
        }

        // Placeholder section: fully editable at project level. These are designed
        // to be authored per project, so we edit their blocks directly (stored as a
        // project override) instead of locking them.
        if (section.isPlaceholder) {
          const blocks = getOverrideBlocks(section);
          return (
            <div key={section.id} className="border border-amber-200 rounded-xl p-3 bg-amber-50/30">
              <div className="flex items-center gap-2 mb-3">
                <span className="bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase">Placeholder · editable</span>
                <span className="font-bold text-gray-800 text-sm">{localizedSectionTitle(section, activeLang)}</span>
              </div>
              <p className="text-[11px] text-amber-700 mb-2">This section is a placeholder meant to be filled in for this project. Edits here apply only to this project.</p>
              <div className="space-y-3">
                {blocks.map((block, idx) => (
                  <div key={`${section.id}-ov-${idx}`}>
                    {renderAdditionEditor(block, {
                      rowKey: `${section.id}-ov-${idx}`,
                      onChange: (lang, html) => updateOverrideBlock(section, idx, lang, html),
                      onVariant: (v) => setOverrideVariant(section, idx, v),
                      onRemove: () => removeOverrideBlock(section, idx),
                      onUp: idx > 0 ? () => moveOverrideBlock(section, idx, -1) : undefined,
                      onDown: idx < blocks.length - 1 ? () => moveOverrideBlock(section, idx, 1) : undefined,
                    })}
                  </div>
                ))}
                <button onClick={() => addOverrideBlock(section)} className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-indigo-400 border border-dashed border-indigo-200 rounded hover:bg-indigo-50 hover:text-indigo-600 transition-colors"><Type size={12} /> Add text block</button>
                {renderAddChapterButton(section)}
              </div>
            </div>
          );
        }

        // Template section: locked blocks + insertable project additions.
        return (
          <div key={section.id} className="border-b border-gray-100 pb-5 last:border-0">
            <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2 text-sm">
              <span className="bg-gray-100 px-1.5 py-0.5 rounded text-muted text-xs">Sec {section.order}</span> {localizedSectionTitle(section, activeLang)}
            </h4>
            <div className="space-y-2">
              {renderInsertButton(section.id, 0)}
              {additions.filter(a => a.position <= 0).map((a, i, arr) => (
                <div key={a.id}>{renderAdditionEditor(a.block, {
                  rowKey: a.id,
                  onChange: (lang, html) => updateAdditionContent(section.id, a.id, lang, html),
                  onVariant: (v) => setAdditionVariant(section.id, a.id, v),
                  onRemove: () => removeAddition(section.id, a.id),
                  onUp: i > 0 ? () => moveAddition(section.id, a.id, -1) : undefined,
                  onDown: i < arr.length - 1 ? () => moveAddition(section.id, a.id, 1) : undefined,
                })}</div>
              ))}

              {refs.map((ref, i) => (
                <React.Fragment key={i}>
                  {/* Locked template block */}
                  {ref.kind === 'sku_slot' ? (
                    <div className="flex items-center gap-2 text-xs text-gray-400 italic border border-gray-100 rounded px-2 py-1.5 bg-gray-50">
                      <Lock size={11} /> SKU slot: {(ref as SKUSlotRef).label?.[activeLang] || (ref as SKUSlotRef).slot}
                    </div>
                  ) : (
                    <div className="relative border border-gray-100 rounded bg-gray-50/60 px-3 py-2 opacity-90">
                      <span className="absolute top-1 right-1 text-gray-300" title="Template content (locked)"><Lock size={11} /></span>
                      <div className="im-content text-xs text-gray-600 pointer-events-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(templateRefPreviewHtml(ref) || '<span class="text-gray-300 italic">Empty template block</span>') }} />
                    </div>
                  )}
                  {renderInsertButton(section.id, i + 1)}
                  {additions.filter(a => a.position === i + 1).map((a, idx, arr) => (
                    <div key={a.id}>{renderAdditionEditor(a.block, {
                      rowKey: a.id,
                      onChange: (lang, html) => updateAdditionContent(section.id, a.id, lang, html),
                      onVariant: (v) => setAdditionVariant(section.id, a.id, v),
                      onRemove: () => removeAddition(section.id, a.id),
                      onUp: idx > 0 ? () => moveAddition(section.id, a.id, -1) : undefined,
                      onDown: idx < arr.length - 1 ? () => moveAddition(section.id, a.id, 1) : undefined,
                    })}</div>
                  ))}
                </React.Fragment>
              ))}
              <div className="pt-1">{renderAddChapterButton(section)}</div>
            </div>
          </div>
        );
      })}

      {/* Add a new top-level project chapter */}
      <div className="pt-2">
        <AddProjectSection sections={orderedSections} onAdd={addExtraSection} />
      </div>
    </div>
  );

  const imThemeVars = getIMThemeVariables(template?.metadata);
  const masterPages = {
    ...DEFAULT_MASTER_PAGES,
    ...(template?.metadata?.masterPages || {})
  };
  
  // Computed values for current language
  const displayTitle = formData['__cover_title'] !== undefined ? formData['__cover_title'] : (project?.name || 'Product Name');
  const displaySubtitle = formData['__cover_subtitle'] !== undefined ? formData['__cover_subtitle'] : 'INSTRUCTION MANUAL';
  const displayLogo = formData['__custom_logo'] || template?.metadata?.companyLogoUrl;
  const displayCoverImage = formData['__custom_cover_image'] || template?.metadata?.coverImageUrl;
  const displayFooter = formData['__custom_footer'] !== undefined ? formData['__custom_footer'] : (template?.metadata?.footerText || '');
  // Version the next publish will stamp (current persisted version + 1).
  const previewVersion = (instance?.version ?? 0) + 1;

  const completion = calculateCompletion(activeLang);

  return (
    <Layout>
       <ConfirmationModal
         variant="danger"
         isOpen={showDeleteConfirm}
         title={instance ? "Delete Draft?" : "Reset Template?"}
         message={instance ? "Are you sure you want to delete this saved draft? All progress will be lost permanently." : "Are you sure you want to reset? Any unsaved changes will be lost."}
         onConfirm={confirmDeleteDraft}
         onCancel={() => setShowDeleteConfirm(false)}
       />

       {publishResult && (
         <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
           <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-6">
             <div className="flex items-center gap-2 mb-1">
               <CheckCircle size={20} className="text-emerald-600" />
               <h3 className="text-lg font-bold text-gray-800">{typeLabel} published</h3>
             </div>
             <p className="text-sm text-muted mb-4">
               The structured IM has been generated for {publishResult.languages.length} language(s).
               Use the manifest link as the stable entry point for the web/PDF render service.
             </p>

             <label className="text-xs font-semibold text-gray-500 uppercase">Manifest (all languages)</label>
             <div className="flex items-center gap-2 mb-4 mt-1">
               <input readOnly value={publishResult.manifestUrl} className="flex-1 text-xs border rounded px-2 py-1.5 bg-gray-50 text-gray-700" />
               <button onClick={() => navigator.clipboard.writeText(publishResult.manifestUrl)} className="text-xs px-2 py-1.5 border rounded hover:bg-gray-50 whitespace-nowrap">Copy</button>
               <a href={publishResult.manifestUrl} target="_blank" rel="noreferrer" className="text-xs px-2 py-1.5 border rounded hover:bg-gray-50">Open</a>
             </div>

             <label className="text-xs font-semibold text-gray-500 uppercase">Per language</label>
             <div className="border rounded divide-y mt-1 mb-5 max-h-48 overflow-auto">
               {publishResult.languages.map(l => (
                 <div key={l.language} className="flex items-center justify-between px-3 py-2 text-sm">
                   <span className="font-medium uppercase">{l.language}</span>
                   <div className="flex items-center gap-2">
                     {l.warnings.length > 0 && (
                       <span className="text-amber-600 text-xs flex items-center gap-1" title={l.warnings.join('\n')}><AlertCircle size={12} />{l.warnings.length}</span>
                     )}
                     <button onClick={() => navigator.clipboard.writeText(l.url)} className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Copy link</button>
                     <a href={l.url} target="_blank" rel="noreferrer" className="text-xs px-2 py-1 border rounded hover:bg-gray-50">Open</a>
                   </div>
                 </div>
               ))}
             </div>

             <div className="flex justify-end gap-2">
               <button onClick={() => setPublishResult(null)} className="text-sm px-3 py-2 border rounded hover:bg-gray-50">Stay here</button>
               <button onClick={() => navigate(`/project/${project?.id}`)} className="text-sm px-3 py-2 bg-primary text-white rounded hover:opacity-90">Go to project</button>
             </div>
           </div>
         </div>
       )}

       {/* PRE-PUBLISH CHECKLIST */}
       {checklist && (
         <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
           <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[85vh] flex flex-col">
             <h3 className="font-bold text-lg mb-1 flex items-center gap-2"><AlertCircle size={18} className="text-amber-500" /> Before you publish</h3>
             <p className="text-sm text-muted mb-4">
               {checklist.blocking.length > 0
                 ? 'This manual can’t be published yet — resolve the blocking items below.'
                 : 'Some items look incomplete. Review them below — you can fix them first or publish anyway.'}
             </p>
             <div className="overflow-y-auto space-y-4 pr-1">
               {checklist.blocking.length > 0 && (
                 <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
                   <div className="text-xs font-bold uppercase tracking-wide text-rose-700 mb-1.5">Must fix before publishing</div>
                   <ul className="space-y-1">
                     {checklist.blocking.map((v, i) => (
                       <li key={i} className="text-sm text-rose-800 flex items-start gap-2"><AlertCircle size={14} className="text-rose-500 mt-0.5 shrink-0" /> {v}</li>
                     ))}
                   </ul>
                 </div>
               )}
               {checklist.values.length > 0 && (
                 <div>
                   <div className="text-xs font-bold uppercase tracking-wide text-rose-600 mb-1.5">Missing values ({checklist.values.length})</div>
                   <ul className="space-y-1">
                     {checklist.values.map((v, i) => (
                       <li key={i} className="text-sm text-gray-700 flex items-start gap-2"><Square size={14} className="text-rose-400 mt-0.5 shrink-0" /> {v}</li>
                     ))}
                   </ul>
                 </div>
               )}
               {checklist.slots.length > 0 && (
                 <div>
                   <div className="text-xs font-bold uppercase tracking-wide text-violet-600 mb-1.5">Required SKU content ({checklist.slots.length})</div>
                   <ul className="space-y-1">
                     {checklist.slots.map((v, i) => (
                       <li key={i} className="text-sm text-gray-700 flex items-start gap-2"><Square size={14} className="text-violet-400 mt-0.5 shrink-0" /> {v}</li>
                     ))}
                   </ul>
                 </div>
               )}
               {checklist.translations.map(t => (
                 <div key={t.lang}>
                   <div className="text-xs font-bold uppercase tracking-wide text-amber-600 mb-1.5">Missing {t.lang.toUpperCase()} translation ({t.items.length})</div>
                   <ul className="space-y-1">
                     {t.items.map((v, i) => (
                       <li key={i} className="text-sm text-gray-700 flex items-start gap-2"><Globe size={14} className="text-amber-400 mt-0.5 shrink-0" /> {v}</li>
                     ))}
                   </ul>
                 </div>
               ))}
             </div>
             <div className="flex justify-end gap-2 mt-5 pt-4 border-t border-gray-100">
               <button onClick={() => setChecklist(null)} className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel & fix</button>
               <button
                 onClick={() => { setChecklist(null); handleGenerate(); }}
                 disabled={checklist.blocking.length > 0}
                 title={checklist.blocking.length > 0 ? 'Resolve the blocking items first' : undefined}
                 className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
               >Publish anyway</button>
             </div>
           </div>
         </div>
       )}


       <input
          type="file" 
          ref={fileInputRef} 
          className="hidden" 
          accept="image/*" 
          onChange={(e) => e.target.files?.[0] && uploadId && handleImageUpload(uploadId, e.target.files[0])} 
       />

       <div className="h-[calc(100vh-100px)] flex flex-col" style={imThemeVars}>
           <div className="flex justify-between items-center mb-4">
               <div className="flex items-center gap-3">
                   <button onClick={() => navigate(`/project/${projectId}`)} className="text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></button>
                   <div>
                       <h2 className="text-xl font-bold text-primary">{template?.name}</h2>
                       <div className="flex items-center gap-2 text-xs text-muted">
                          <span>For: {project?.name}</span>
                          {instance?.status === 'generated' && <span className="bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold">GENERATED</span>}
                       </div>
                   </div>
               </div>
               <div className="flex gap-3 items-center">
                   <button 
                        onClick={handleDeleteDraft} 
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-rose-200 text-rose-600 rounded-xl text-sm font-medium hover:bg-rose-50 transition-colors"
                        disabled={loading || saving}
                   >
                       {instance ? <Trash2 size={16} /> : <RotateCcw size={16} />}
                       {instance ? 'Delete Draft' : 'Reset'}
                   </button>

                   <button onClick={handleSaveDraft} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-light"><Save size={16} /> Save Draft</button>
                   
                   {/* Export Menu */}
                   <div className="relative" ref={exportMenuRef}>
                       <button 
                          onClick={() => setShowExportMenu(!showExportMenu)}
                          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-light"
                       >
                          <Download size={16} /> Export Data <ChevronDown size={14} />
                       </button>
                       {showExportMenu && (
                           <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-200 z-50 py-1">
                               <button 
                                  onClick={() => handleExport('json')}
                                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-light flex items-center gap-2"
                               >
                                  <FileJson size={16} /> Export as JSON
                               </button>
                               <button 
                                  onClick={() => handleExport('xml')}
                                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-light flex items-center gap-2"
                               >
                                  <Code size={16} /> XML (InDesign)
                               </button>
                           </div>
                       )}
                   </div>

                   <button onClick={handlePublishClick} disabled={generating} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-70">
                      {generating ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} />}
                      {generating ? 'Publishing...' : `Publish (${activeLang.toUpperCase()})`}
                   </button>
               </div>
           </div>

           <div className="flex flex-1 gap-6 overflow-hidden">
               {/* LEFT: INPUTS */}
               <div className="w-1/3 bg-white border border-gray-200 rounded-xl shadow flex flex-col overflow-hidden">
                   <div className="bg-light border-b border-gray-200">
                       <div className="p-4 pb-2 font-bold text-gray-700 flex items-center justify-between">
                           <div className="flex items-center gap-2"><Settings size={16} /> Configuration</div>
                           <span className="text-xs font-normal text-muted bg-gray-200 px-2 py-0.5 rounded">Language: {activeLang.toUpperCase()}</span>
                       </div>
                       <div className="flex gap-1 px-4">
                           <button
                               onClick={() => setEditorMode('fill')}
                               className={`px-3 py-2 text-xs font-bold rounded-t-lg border-b-2 transition-colors ${editorMode === 'fill' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                           >Fill values</button>
                           <button
                               onClick={() => setEditorMode('content')}
                               className={`flex items-center gap-1 px-3 py-2 text-xs font-bold rounded-t-lg border-b-2 transition-colors ${editorMode === 'content' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}
                           ><FilePlus2 size={13} /> Add content</button>
                       </div>
                   </div>
                   {editorMode === 'fill' && (
                   <div className="flex-1 overflow-y-auto p-6 space-y-8">

                       {/* COVER PAGE CONFIG */}
                       <div className="border-b border-gray-100 pb-6">
                            <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2 text-sm">
                                <span className="bg-gray-800 text-white px-1.5 py-0.5 rounded">Cover</span> Cover Page & Branding
                            </h4>
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-xs font-bold text-muted uppercase tracking-wide mb-1">Manual Title</label>
                                    <input className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" value={displayTitle} onChange={(e) => handleInputChange('__cover_title', e.target.value)} placeholder={project?.name} />
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-muted uppercase tracking-wide mb-1">Subtitle</label>
                                    <input className="w-full border rounded p-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none" value={displaySubtitle} onChange={(e) => handleInputChange('__cover_subtitle', e.target.value)} />
                                </div>
                            </div>
                       </div>

                       {/* BOUND SKUs — the project SKUs this manual covers (drives attribute resolution) */}
                       <div className="border-b border-gray-100 pb-6">
                         <h4 className="font-bold text-gray-800 mb-1 flex items-center gap-2 text-sm">
                           <Boxes size={14} className="text-indigo-500" /> Bound SKUs
                         </h4>
                         <p className="text-xs text-muted mb-3">The project SKUs this manual covers. Its attribute values and SKU number come from these — at least one is required.</p>
                         {projectSkus.length === 0 ? (
                           <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 flex items-start gap-2">
                             <AlertCircle size={14} className="mt-0.5 shrink-0" />
                             <div>
                               This project has no SKUs yet — add at least one before publishing.
                               <button onClick={() => navigate(`/project/${projectId}`)} className="ml-1 font-semibold underline hover:text-amber-900">Manage SKUs</button>
                             </div>
                           </div>
                         ) : (
                           <div className="flex flex-wrap gap-1.5">
                             {projectSkus.map(sku => {
                               const on = boundSkuIds.includes(sku.id);
                               return (
                                 <button
                                   key={sku.id}
                                   type="button"
                                   onClick={() => toggleBoundSku(sku.id)}
                                   className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                                     on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                                   }`}
                                   title={sku.skuTitle ? `${sku.skuNumber} — ${sku.skuTitle}` : sku.skuNumber}
                                 >
                                   {sku.skuNumber}
                                 </button>
                               );
                             })}
                           </div>
                         )}
                       </div>

                       {/* REQUIRED LANGUAGES — the subset of template languages this project produces */}
                       {templateLangs.length > 1 && (
                         <div className="border-b border-gray-100 pb-6">
                           <h4 className="font-bold text-gray-800 mb-1 flex items-center gap-2 text-sm">
                             <Globe size={14} className="text-indigo-500" /> Required Languages
                           </h4>
                           <p className="text-xs text-muted mb-3">Pick the languages this manual must be published in. English is always included.</p>
                           <div className="flex flex-wrap gap-1.5">
                             {templateLangs.map(code => {
                               const on = requiredLanguages.includes(code);
                               const locked = code === 'en';
                               return (
                                 <button
                                   key={code}
                                   type="button"
                                   disabled={locked}
                                   onClick={() => toggleRequiredLanguage(code)}
                                   className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                                     on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                                   } ${locked ? 'opacity-90 cursor-default' : ''}`}
                                   title={locked ? 'English is always required' : on ? 'Click to exclude' : 'Click to include'}
                                 >
                                   {code.toUpperCase()}{locked && ' ·'}
                                 </button>
                               );
                             })}
                           </div>
                         </div>
                       )}

                       {/* CHAPTER CONDITIONS */}
                       {orderedSections.some(s => s.conditionFeatureId) && (
                         <div className="border-b border-gray-100 pb-6">
                           <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2 text-sm">
                             <span className="bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded text-xs font-bold">COND</span> Chapter Conditions
                           </h4>
                           <div className="space-y-2">
                             {orderedSections.filter(s => s.conditionFeatureId).map(s => {
                               const attr = allAttributes.find(a => a.id === s.conditionFeatureId);
                               const visible = isSectionVisible(s);
                               const hasOverride = sectionVisibility[s.id] !== undefined;
                               const autoResult = (() => {
                                 if (!s.conditionFeatureId || !s.conditionLabel) return true;
                                 const val = submittedAttrValues[s.conditionFeatureId];
                                 if (!val) return null; // no data
                                 return attr ? matchesConditionValue(val, s.conditionLabel, attr) : true;
                               })();
                               return (
                                 <div key={s.id} className={`p-3 rounded-lg border text-xs transition-colors ${visible ? 'bg-violet-50 border-violet-200' : 'bg-gray-50 border-gray-200 opacity-70'}`}>
                                   <div className="flex items-start justify-between gap-2">
                                     <div className="flex-1 min-w-0">
                                       <div className="font-semibold text-gray-800 truncate">{localizedSectionTitle(s, activeLang)}</div>
                                       <div className="text-muted mt-0.5">
                                         {attr?.name ?? '?'}: <span className="text-violet-600 font-medium">{s.conditionLabel}</span>
                                         {autoResult === null
                                           ? <span className="ml-1 text-amber-500">(no data yet)</span>
                                           : autoResult
                                             ? <span className="ml-1 text-emerald-600">✓ matches</span>
                                             : <span className="ml-1 text-rose-500">✗ no match</span>}
                                       </div>
                                     </div>
                                     <div className="flex items-center gap-1 shrink-0">
                                       {hasOverride && (
                                         <button onClick={() => setSectionVisibility(prev => { const next = {...prev}; delete next[s.id]; return next; })}
                                           className="text-[10px] text-amber-600 hover:underline">reset</button>
                                       )}
                                       <button
                                         onClick={() => setSectionVisibility(prev => ({ ...prev, [s.id]: !visible }))}
                                         className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors ${visible ? 'bg-violet-600 text-white border-violet-600' : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'}`}
                                       >
                                         {visible ? 'Include' : 'Exclude'}
                                       </button>
                                     </div>
                                   </div>
                                 </div>
                               );
                             })}
                           </div>
                         </div>
                       )}

                       {/* CONDITIONAL CONTENT — inline rows + shared blocks with a "Show if" condition */}
                       {(() => {
                         const condRefs = orderedSections.flatMap(section =>
                           (section.blockRefs ?? [])
                             .map((ref, index) => ({ section, ref, index }))
                             .filter(x => refHasCondition(x.ref))
                         );
                         if (condRefs.length === 0) return null;
                         const merged = { ...submittedAttrValues, ...formData };
                         return (
                           <div className="border-b border-gray-100 pb-6">
                             <h4 className="font-bold text-gray-800 mb-3 flex items-center gap-2 text-sm">
                               <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-xs font-bold">IF</span> Conditional Content
                             </h4>
                             <div className="space-y-2">
                               {condRefs.map(({ section, ref, index }) => {
                                 const key = `${section.id}:${index}`;
                                 const visible = isRefVisible(section.id, index, ref);
                                 const hasOverride = refVisibility[key] !== undefined;
                                 const desc = describeRefCondition(ref as FeatureConditionFields);
                                 const condAttrId = (ref as FeatureConditionFields).requires_feature ?? undefined;
                                 const noData = !!condAttrId && !merged[condAttrId];
                                 const auto = refAutoVisible(ref);
                                 const rawContent = ref.kind === 'block'
                                   ? (() => { const blk = availableBlocks[(ref as any).block_id]; return blk?.content?.[activeLang] || blk?.content?.['en'] || ''; })()
                                   : ((ref as any).content?.[activeLang] || (ref as any).content?.['en'] || '');
                                 const snippet = rawContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
                                 const label = snippet || (ref.kind === 'block' ? 'Shared block' : 'Inline content');
                                 return (
                                   <div key={key} className={`p-3 rounded-lg border text-xs transition-colors ${visible ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200 opacity-70'}`}>
                                     <div className="flex items-start justify-between gap-2">
                                       <div className="flex-1 min-w-0">
                                         <div className="font-semibold text-gray-800 truncate flex items-center gap-1">
                                           <GitBranch size={11} className="text-purple-400 shrink-0" />
                                           <span className="text-gray-400 font-normal">{localizedSectionTitle(section, activeLang)} ·</span> {label}
                                         </div>
                                         <div className="text-muted mt-0.5">
                                           {desc ?? 'Conditional'}
                                           {noData
                                             ? <span className="ml-1 text-amber-500">(no data yet)</span>
                                             : auto
                                               ? <span className="ml-1 text-emerald-600">✓ matches</span>
                                               : <span className="ml-1 text-rose-500">✗ no match</span>}
                                         </div>
                                       </div>
                                       <div className="flex items-center gap-1 shrink-0">
                                         {hasOverride && (
                                           <button onClick={() => setRefVisibility(prev => { const next = { ...prev }; delete next[key]; return next; })}
                                             className="text-[10px] text-amber-600 hover:underline">reset</button>
                                         )}
                                         <button
                                           onClick={() => setRefVisibility(prev => ({ ...prev, [key]: !visible }))}
                                           className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-colors ${visible ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'}`}
                                         >
                                           {visible ? 'Include' : 'Exclude'}
                                         </button>
                                       </div>
                                     </div>
                                   </div>
                                 );
                               })}
                             </div>
                           </div>
                         );
                       })()}

                       {orderedSections.map(section => {
                           // Collect inputs from ALL content sources for the ACTIVE language:
                           // inline content, inline refs, and shared blocks (incl. {{attribute}} tokens).
                           const contentHtml = section.content[activeLang] || '';
                           const { items, attrTokens } = collectSectionInputs(section, activeLang);
                           const slotRefs = (section.blockRefs ?? []).filter(r => r.kind === 'sku_slot') as SKUSlotRef[];

                           // Skip a section only when it has no inputs of any kind to configure
                           if (items.length === 0 && attrTokens.length === 0 && !section.isPlaceholder && slotRefs.length === 0) return null;

                           return (
                               <div key={section.id} className="border-b border-gray-100 pb-6 last:border-0">
                                   <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2 text-sm">
                                       <span className="bg-gray-100 px-1.5 py-0.5 rounded text-muted">Sec {section.order}</span> {localizedSectionTitle(section, activeLang)}
                                   </h4>
                                   {section.isPlaceholder && <div className="mb-4 bg-indigo-50 p-3 rounded border border-indigo-100 text-xs text-blue-800"><AlertCircle size={14} className="inline mr-1"/> Placeholder Section</div>}
                                   {!contentHtml && items.length === 0 && attrTokens.length === 0 && slotRefs.length === 0 && !section.isPlaceholder && <div className="text-xs text-gray-400 italic mb-2">No content defined for {activeLang.toUpperCase()}.</div>}

                                   <div className="space-y-5">
                                       {/* SKU slot forms */}
                                       {slotRefs.map(ref => renderSkuSlotForm(ref))}

                                       {/* Bound spec values ({{attribute}} tokens) — e.g. SKU, power.
                                           Auto-filled from supplier data; editable so PMs can verify/correct. */}
                                       {attrTokens.map(tok => {
                                           const attr = allAttributes.find(a => a.id === tok);
                                           const unit = attr?.validationRules?.unit ? ` ${attr.validationRules.unit}` : '';
                                           return (
                                               <BindableField
                                                   key={`tok-${tok}`}
                                                   label={attr?.name ?? tok}
                                                   badge={{ text: 'SPEC', className: 'bg-sky-100 text-sky-700' }}
                                                   unit={unit}
                                                   manualValue={formData[tok]}
                                                   inheritedValue={submittedAttrValues[tok]}
                                                   attributes={projectAttributes}
                                                   submittedAttrValues={submittedAttrValues}
                                                   boundAttrIds={fieldBindings[tok]}
                                                   onManualChange={(v) => handleInputChange(tok, v)}
                                                   onClearManual={() => clearInput(tok)}
                                                   onSetMode={(m) => setFieldMode(tok, m)}
                                                   onToggleAttr={(aid) => toggleFieldAttr(tok, aid)}
                                               />
                                           );
                                       })}

                                       {items.map((item, idx) => {
                                           const isFilled = !!formData[item.id];
                                           const featName = item.featureId !== 'manual' ? (allAttributes.find(f => f.id === item.featureId)?.name || 'Unknown Attribute') : null;
                                           return (
                                               <div key={`${item.id}-${idx}`} className="group">
                                                   {item.kind === 'condition' && item.always ? (
                                                       <BindableField
                                                           label={featName || item.label}
                                                           badge={{ text: 'VALUE', className: 'bg-amber-100 text-amber-700' }}
                                                           manualValue={formData[item.id]}
                                                           inheritedValue={submittedAttrValues[item.id]}
                                                           attributes={projectAttributes}
                                                           submittedAttrValues={submittedAttrValues}
                                                           boundAttrIds={fieldBindings[item.id]}
                                                           onManualChange={(v) => handleInputChange(item.id, v)}
                                                           onClearManual={() => clearInput(item.id)}
                                                           onSetMode={(m) => setFieldMode(item.id, m)}
                                                           onToggleAttr={(aid) => toggleFieldAttr(item.id, aid)}
                                                       />
                                                   ) : item.kind === 'condition' ? (
                                                       <div onClick={() => handleConditionToggle(item.id)} className={`p-3 rounded border cursor-pointer transition-all ${conditions[item.id] ? 'bg-purple-50 border-purple-200 shadow' : 'bg-white border-gray-200 hover:bg-light'}`}>
                                                          <div className="flex items-start gap-3">
                                                              <div className="mt-0.5 text-indigo-600">
                                                                  {conditions[item.id] ? <CheckSquare size={18} /> : <Square size={18} className="text-gray-400" />}
                                                              </div>
                                                              <div>
                                                                  <div className="text-xs font-bold uppercase text-muted mb-1 flex items-center gap-1 select-none flex-wrap"><GitBranch size={12}/> {item.featureId === 'manual' ? 'Optional Block' : 'Attribute Block'} {featName && <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] ml-1 truncate max-w-[120px]">{featName}</span>}{item.conditionLabel && <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded text-[10px] ml-1">= {item.conditionLabel}</span>}</div>
                                                                  <p className={`text-sm text-gray-700 select-none ${!conditions[item.id] && 'opacity-50 line-through'}`}>"{item.label}"</p>
                                                              </div>
                                                          </div>
                                                       </div>
                                                   ) : item.type === 'text' ? (
                                                       <BindableField
                                                           label={item.label}
                                                           multiline
                                                           placeholder="Content…"
                                                           manualValue={formData[item.id]}
                                                           inheritedValue={submittedAttrValues[item.id]}
                                                           attributes={projectAttributes}
                                                           submittedAttrValues={submittedAttrValues}
                                                           boundAttrIds={fieldBindings[item.id]}
                                                           onManualChange={(v) => handleInputChange(item.id, v)}
                                                           onClearManual={() => clearInput(item.id)}
                                                           onSetMode={(m) => setFieldMode(item.id, m)}
                                                           onToggleAttr={(aid) => toggleFieldAttr(item.id, aid)}
                                                       />
                                                   ) : (
                                                       <div>
                                                           <div className="flex justify-between items-center mb-1.5">
                                                               <label className="block text-xs font-bold text-muted uppercase tracking-wide">{item.label}</label>
                                                               {isFilled ? <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1 bg-emerald-50 px-1.5 py-0.5 rounded"><CheckCircle size={10}/> Filled</span> : <span className="text-[10px] font-bold text-orange-500 flex items-center gap-1 bg-amber-50 px-1.5 py-0.5 rounded"><AlertCircle size={10}/> Required</span>}
                                                           </div>
                                                           <div className="space-y-2">
                                                               <label className={`block w-full border-2 border-dashed rounded-xl p-3 text-center cursor-pointer transition-colors ${isFilled ? 'border-gray-200 hover:bg-light' : 'border-amber-200 bg-amber-50/30 hover:bg-amber-50'}`}>
                                                                   <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleImageUpload(item.id, e.target.files[0])} />
                                                                   <ImageIcon className={`mx-auto mb-1 ${isFilled ? 'text-gray-400' : 'text-orange-400'}`} size={20} />
                                                                   <span className={`text-xs ${isFilled ? 'text-muted' : 'text-amber-600 font-medium'}`}>{isFilled ? 'Replace Image' : 'Click to Upload Image'}</span>
                                                               </label>
                                                           </div>
                                                       </div>
                                                   )}
                                               </div>
                                           );
                                       })}
                                   </div>
                               </div>
                           );
                       })}
                   </div>
                   )}
                   {editorMode === 'content' && renderContentEditor()}
               </div>

               {/* RIGHT: PREVIEW */}
               <div className="flex-1 bg-white border border-gray-200 rounded-xl shadow flex flex-col overflow-hidden">
                   <div className="p-4 bg-light border-b border-gray-200 font-bold text-gray-700 flex justify-between items-center">
                       <span>Live Preview</span>
                       <div className="flex items-center gap-3">
                           {/* Status Badge */}
                           <div className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1.5 font-medium transition-colors ${completion.status === 'ready' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-orange-700 border-amber-200'}`}>
                               {completion.status === 'ready' ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                               {completion.label}
                           </div>

                           {/* Language Selector */}
                           <div className="flex items-center gap-1 bg-white border border-gray-300 rounded px-2 py-1 text-xs shadow">
                               <Globe size={12} className="text-gray-400"/>
                               <select 
                                  value={activeLang} 
                                  onChange={(e) => setActiveLang(e.target.value)}
                                  className="bg-transparent outline-none text-gray-700 font-bold cursor-pointer appearance-none pr-4 relative z-10"
                               >
                                  {requiredLanguages.map(code => (
                                     <option key={code} value={code}>{code.toUpperCase()}</option>
                                  ))}
                               </select>
                               <ChevronDown size={10} className="text-gray-400 -ml-3 z-0 pointer-events-none" />
                           </div>
                           <span className="text-xs text-muted border-l pl-2 border-gray-300 flex items-center gap-1"><Printer size={12}/> A4</span>
                       </div>
                   </div>
                   <div className="flex-1 overflow-y-auto bg-gray-100 p-8 flex justify-center" onClick={handlePreviewClick}>
                       <div ref={previewRef} className="bg-white shadow-lg w-[210mm] min-h-[297mm] origin-top">
                          {/* COVER PAGE */}
                          <div className="min-h-[297mm] flex flex-col relative bg-white mb-4 break-after-page" style={getBackgroundStyle(masterPages.cover)}>
                             {displayCoverImage && <div className="h-[400px] bg-cover bg-center" style={{ backgroundImage: `url(${displayCoverImage})` }} />}
                             <div className="flex-1 p-[20mm] flex flex-col justify-between">
                                <div>
                                   {displayLogo && <img src={displayLogo} alt="Logo" className="h-12 object-contain mb-10" />}
                                   <h1 className="text-4xl font-bold text-primary mb-4">{displayTitle}</h1>
                                   <p className="text-xl text-muted uppercase tracking-widest font-light">{displaySubtitle}</p>
                                </div>
                                <div className="border-t-4 pt-6" style={{ borderColor: 'var(--im-primary-color)' }}>
                                   <p className="text-sm font-bold text-primary uppercase mb-1">{template?.metadata?.companyName || 'Company Name'}</p>
                                   <p className="text-xs text-muted">Original Instructions</p>
                                </div>
                             </div>
                          </div>
                          {/* CONTENT */}
                          <div className="p-[20mm] pb-[30mm] min-h-[297mm] bg-white relative">
                              <div className="space-y-6 text-gray-800 text-sm leading-relaxed">
                                  {orderedSections.map(section => {
                                      const visible = isSectionVisible(section);
                                      return (
                                        <div key={section.id} className={`mb-8 transition-opacity ${!visible ? 'opacity-25 pointer-events-none select-none' : ''}`}>
                                          {!visible && (
                                            <div className="text-[10px] font-bold text-rose-400 uppercase tracking-wide mb-1 flex items-center gap-1">
                                              <span>⊘ Chapter excluded by condition</span>
                                            </div>
                                          )}
                                          <h3 className="text-lg font-bold text-primary mb-3 border-b pb-2" style={{ borderColor: 'var(--im-primary-color)' }}>{localizedSectionTitle(section, activeLang)}</h3>
                                          <div className="im-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(buildSectionHtml(section)) }} />
                                        </div>
                                      );
                                  })}
                              </div>
                              
                              {/* FOOTER */}
                              {masterPages.body?.footerVariant !== 'none' && (
                                  <div className={`absolute bottom-0 left-0 right-0 p-8 border-t border-gray-100 text-center text-xs ${masterPages.body?.footerVariant === 'minimal' ? 'text-gray-300' : 'text-gray-400'}`}>
                                      {displayFooter}{displayFooter ? '  ·  ' : ''}v{previewVersion}
                                  </div>
                              )}
                          </div>

                          {/* BACK PAGE */}
                          {template?.metadata?.backPageContent && (
                              <div className="min-h-[297mm] bg-light p-[20mm] flex flex-col justify-end mt-4 break-before-page">
                                  <div className="border-t pt-8" style={{ borderColor: 'var(--im-primary-color)' }}>
                                      <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(template.metadata.backPageContent) }} />
                                      <div className="mt-10 text-xs text-gray-400 text-center">
                                          &copy; {new Date().getFullYear()} {template.metadata.companyName || 'Company Name'}. All rights reserved.
                                      </div>
                                  </div>
                              </div>
                          )}
                       </div>
                   </div>
               </div>
           </div>

           {/* Text Edit Modal */}
           {textEditId && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="font-bold text-lg">Edit Text</h3>
                            <button onClick={() => setTextEditId(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
                        </div>
                        <textarea 
                            className="w-full border p-3 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none" 
                            rows={4} 
                            value={tempTextValue} 
                            onChange={(e) => setTempTextValue(e.target.value)} 
                            autoFocus
                        />
                        <div className="flex justify-end gap-3 mt-4">
                            <button onClick={() => setTextEditId(null)} className="text-gray-600 hover:bg-light px-4 py-2 rounded">Cancel</button>
                            <button onClick={handleSaveTextModal} className="bg-indigo-600 text-white px-4 py-2 rounded font-medium hover:bg-indigo-700">Save Update</button>
                        </div>
                    </div>
                </div>
            )}
       </div>
    </Layout>
  );
};

export default ProjectIMGenerator;
