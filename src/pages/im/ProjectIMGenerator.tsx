
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
    getIMTemplates, getProjectIM, saveProjectIM, setProjectIMFinalized, deleteProjectIM,
    addDocument, uploadFile, getProjectDocs, getCategoryAttributes, getAttributeRequestsByProject,
    getIMBlocks, resolveManual, publishResolvedManuals, normalizeResolverData,
    getProjectSkus, collapseSkuAttributeValues, isPrintExportAvailable,
    getProjectIMStaleReasons, getPrintRenders, getPublishedManifestUrl,
    updateProjectIMPlaceholders, getProjectRequiredLanguages,
    getProjectIMBackups, ProjectIMConflictError, getAllProjectIMs,
    checkMarkupReviewStatus, isMarkupReviewAvailable,
    getTemplateRegulations, buildTemplateChecklist, getChecklistState, setChecklistItemState,
    getTemplateChecklistState, summarizeChecklist, groupChecklistByRegulation
} from '../../services';
import type { ChecklistItem, ChecklistItemState, ChecklistItemStatus } from '../../services';
import type { ProjectIMBackup } from '../../services';
import type { ProjectIMSummary } from '../../services/im/project-im.service';
import { skuSyntheticAttribute } from '../../config/compliance.constants';
import { wrapBlockCallout, passesFeatureGate } from '../../services/im/im-resolver';
import { getAppliesToLabel } from '../../services/im/callout-titles.i18n';
import { translateHtml } from '../../services/ai/translation.service';
import { markTranslatedFromEn } from '../../services/im/im-translation-marker';
import { IM_LANGUAGE_NAMES, IM_LANGUAGE_CODES, IM_TEMPLATE_LANGUAGE_OPTIONS, orderIMLanguages } from '../../config/im-languages';
import { DEFAULT_IM_LOGO_URL } from '../../config/im.constants';
import { uploadIMAsset, externalizeHtmlImages, externalizeFormDataImages } from '../../services/im/im-asset.service';
import { SaveProgressOverlay } from '../../components/common/SaveProgressOverlay';
import { Project, IMTemplate, IMTemplateType, IM_TEMPLATE_TYPE_LABELS, IMSection, IMBlock, ProjectIM, DocStatus, ResponsibleParty, CategoryAttribute, IMMasterLayoutName, IMMasterPageOverride, SKUContentValue, SKUSlotRef, RichTextContent, LegendTableContent, StepSequenceContent, AnnotatedImageSetContent, AnnotatedImage, ProjectBlockAddition, ProjectExtraSection, CalloutVariant, InlineBlockRef, SharedBlockRef, BlockRef, FeatureConditionFields, ProjectSku, ProjectAttributeRequest, localizedSectionTitle } from '../../types';
import type { PublishResult, PrintPdfResult, PrintRender, MarkupReviewResult } from '../../services';
import { isInReview } from './im-manual-status';
import { useAuth } from '../../context/AuthContext';
import { ArrowLeft, Save, FileDown, AlertCircle, Image as ImageIcon, Check, CheckCircle, Crosshair, Settings, GitBranch, CheckSquare, Square, X, Printer, Globe, ChevronDown, Download, FileJson, Loader2, Minus, Trash2, RotateCcw, Upload, Type, ChevronUp, FilePlus2, Lock, Unlock, Boxes, Eye, EyeOff, Plus, Layers, LayoutTemplate, Copy, GripVertical, Undo2, Redo2, ClipboardCopy, ClipboardPaste, Bookmark, Search, Send } from 'lucide-react';
import { InlineBlockEditor, CALLOUT_VARIANTS } from './editor/InlineBlockEditor';
import { useUndoRedo } from './editor/useUndoRedo';
import { ProjectImImportDialog } from './ProjectImImportDialog';
import { ProjectSupplierDiffImportDialog } from './ProjectSupplierDiffImportDialog';
import { getAttributesForCategory, sanitizeHtml } from '../../utils';
import { getIMThemeVariables } from './styles/im-theme';
import { DEFAULT_MASTER_PAGES, getBackgroundStyle, joinAttrValues } from './project-im-generator/im-layout.utils';
import { decodePlaceholderLabel, escapeXml, getTokensInFragment, matchesConditionValue, refHasCondition, refHasTable, refIsOverridable } from './project-im-generator/im-content.utils';
import { blockTypeToVariant, isExtraSection, isInlineBlockEmpty, newInlineBlock, sectionToInlineBlocks, seedPlaceholderBlocks } from './project-im-generator/im-blocks.utils';
import { PREVIEW_SECTION_ATTR, findPreviewSection, findByDataAttr, previewScrollTopFor } from './project-im-generator/preview-scroll.utils';
import { buildSectionOutline, findExcludedAncestor, METADATA_SECTION_TITLE } from './project-im-generator/section-outline.utils';
import { FILL_ANCHOR_ATTR, fillAnchors, type PublishIssue } from './project-im-generator/publish-issues';
import PublishReviewPanel from './project-im-generator/PublishReviewPanel';
import { ConfirmationModal } from '../../components/common/ConfirmationModal';
import { Badge } from '../../components/common/Badge';
import { OptionalContentPanel, IncludeModeControl, modeOf, type OptionalContentItem } from './project-im-generator/OptionalContentPanel';
import { BindableField } from './project-im-generator/BindableField';
import PrintExportDialog from './project-im-generator/PrintExportDialog';
import PipelineStepper, { type PipelineStep } from './project-im-generator/PipelineStepper';
import type { TemplateRegulation } from '../../types';
import { normalizeIMTemplateMetadata } from '../../utils/im-template-metadata.utils';

// The full set of editable, persisted state captured in a crash-safe local draft. Mirrors
// exactly what saveProjectIM writes, so a restored draft reproduces the unsaved session.
interface DraftState {
  formData: Record<string, string>;
  fieldBindings: Record<string, string[]>;
  conditions: Record<string, boolean>;
  sectionVisibility: Record<string, boolean>;
  refVisibility: Record<string, boolean>;
  skuContent: Record<string, SKUContentValue>;
  sectionAdditions: Record<string, ProjectBlockAddition[]>;
  extraSections: ProjectExtraSection[];
  sectionOverrides: Record<string, InlineBlockRef[]>;
  sectionSkus: Record<string, string[]>;
  blockOverrides: Record<string, Record<string, InlineBlockRef>>;
  boundSkuIds: string[];
  activeLang: string;
}

const ProjectIMGenerator: React.FC = () => {
  const { projectId, templateType: templateTypeParam } = useParams<{ projectId: string; templateType?: string }>();
  const templateType: IMTemplateType = templateTypeParam === 'warning_leaflet' ? 'warning_leaflet' : 'im';
  const typeLabel = IM_TEMPLATE_TYPE_LABELS[templateType];
  const navigate = useNavigate();
  // Only used to stamp who confirmed a regulatory checklist item — that record is the
  // point of the checklist, so it must not be anonymous.
  const { user } = useAuth();
  
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
  // Per-chapter SKU scope: sectionId → project_skus.id[]. Empty = applies to all bound
  // SKUs (no "Applies to: …" header). Drives SKU-specific chapter variants.
  const [sectionSkus, setSectionSkus] = useState<Record<string, string[]>>({});
  // Add-content tab: the section whose editor is shown in the right pane (tree selection).
  const [selectedContentSectionId, setSelectedContentSectionId] = useState<string | null>(null);
  // Per-project override of a single inline template block (e.g. an edited table),
  // keyed by sectionId → refIndex → replacement inline block. Template stays untouched.
  const [blockOverrides, setBlockOverrides] = useState<Record<string, Record<string, InlineBlockRef>>>({});
  // Left panel mode: fill placeholder values, or author project-specific content.
  const [editorMode, setEditorMode] = useState<'fill' | 'content'>('fill');
  // Chapter briefly outlined in the preview after a "Show in preview" jump, so the eye can
  // find the landing spot in a page of body text. Cleared on a timer.
  const [flashSectionId, setFlashSectionId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);
  // The preview's scrolling viewport (the pane, not the A4 page inside it).
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const [availableBlocks, setAvailableBlocks] = useState<Record<string, { content: Record<string, string>; blockType: string }>>({});
  // Full block library (title/slug/type) for the standardized-block picker.
  const [blockLibrary, setBlockLibrary] = useState<IMBlock[]>([]);
  // Extra-section id the shared-block picker is currently adding into (null = closed).
  const [sharedPickerFor, setSharedPickerFor] = useState<string | null>(null);
  const [blockPickerSearch, setBlockPickerSearch] = useState('');
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
  // Load FAILED (network/auth) — rendered as an error-with-retry screen, never as the
  // template picker: mistaking "failed to load" for "no draft exists" invited starting
  // over and overwriting the real draft.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Someone else (or another tab) saved this manual after we loaded it. Saves are halted
  // until the operator reloads; their edits stay in the local crash-safe backup.
  const [saveConflict, setSaveConflict] = useState<{ at: string; by: string | null } | null>(null);
  // Daily rolling backups (last 3 days) — restore modal state.
  const [showBackups, setShowBackups] = useState(false);
  const [backups, setBackups] = useState<ProjectIMBackup[] | null>(null);
  // Brief "Saved!" confirmation shown on the Save Draft button after a successful save.
  const [savedTick, setSavedTick] = useState(false);
  // Background (debounced) server autosave — separate from the blocking manual Save.
  const [autosaving, setAutosaving] = useState(false);
  const [lastAutoSavedAt, setLastAutoSavedAt] = useState<Date | null>(null);
  const [generating, setGenerating] = useState(false);
  // Live phase text during publish ("Rendering PDF…", "Publishing 3/12 (de)…") so the long
  // publish shows visible progress instead of an opaque, seemingly-stuck spinner.
  const [publishStatus, setPublishStatus] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  // Settings menu holds destructive/rare actions (Delete Draft / Reset) so they
  // aren't a single misclick away in the toolbar.
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [showPrintDialog, setShowPrintDialog] = useState(false);
  // Which job the print dialog was opened for: rendering a PDF, or creating a
  // Markup.io review round (which renders one first if there isn't a current one).
  const [printIntent, setPrintIntent] = useState<'print' | 'review'>('print');
  // Pre-publish review panel (see PublishReviewPanel): docked beside the editor rather than
  // modal, because every row in it is a pointer into the editor and the list has to survive
  // being acted on. `armed` = opened by pressing Publish, so the panel carries the go/no-go
  // footer; opened from the preview toolbar it is a review list with no publish decision.
  const [reviewPanel, setReviewPanel] = useState<{ armed: boolean } | null>(null);
  const [reviewCollapsed, setReviewCollapsed] = useState(false);
  // The row last jumped from, kept marked so a long list doesn't lose the operator's place.
  const [activeIssueKey, setActiveIssueKey] = useState<string | null>(null);
  // A requested jump into the "Fill values" form. Held in state rather than done inline: the
  // click that produced it may also have switched the editor tab or language, so the target
  // is usually not in the DOM until a later frame (see the retry effect below).
  const [pendingJump, setPendingJump] = useState<{ anchor: string; tries: number } | null>(null);
  const [flashAnchor, setFlashAnchor] = useState<string | null>(null);
  // A translation gap the operator asked to fix: the chapter AND the language, so the inline
  // rows in that chapter open on that language instead of their own English default.
  const [translationFocus, setTranslationFocus] = useState<{ sectionId: string; lang: string; token: number } | null>(null);
  const flashAnchorTimerRef = useRef<number | null>(null);
  const fillScrollRef = useRef<HTMLDivElement>(null);
  // "Already up to date" guard: set when Publish is clicked but the published output would be
  // identical to what's already live. Carries the prior artifacts to show instead of republishing.
  const [noChangesPrompt, setNoChangesPrompt] = useState<{ manifestUrl: string | null; lastRender: PrintRender | null } | null>(null);
  const [checkingChanges, setCheckingChanges] = useState(false);
  // Auto-translation of project-authored content (added/edited sections). English is
  // always the source; template content is translated in the template editor, not here.
  // Language picker (same modal as the category template editor's "Manual Languages").
  const [isLangModalOpen, setIsLangModalOpen] = useState(false);
  const [langDraft, setLangDraft] = useState<string[]>(['en']);
  const [isTranslateModalOpen, setIsTranslateModalOpen] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateProgress, setTranslateProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  // When true (default) only blank target fragments are translated; the "retranslate"
  // checkbox flips it to overwrite existing translations too.
  const [translateSkipExisting, setTranslateSkipExisting] = useState(true);

  // Interactive Editing State
  const [textEditId, setTextEditId] = useState<string | null>(null);
  const [tempTextValue, setTempTextValue] = useState('');
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [activeLang, setActiveLang] = useState('en');

  // Modal State
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Finalization: a FINAL manual is locked read-only until explicitly unlocked. `finalizing`
  // guards the toggle network call; the two flags drive the confirm modals.
  const [finalizing, setFinalizing] = useState(false);
  const [showFinalizeConfirm, setShowFinalizeConfirm] = useState(false);
  const [showUnlockConfirm, setShowUnlockConfirm] = useState(false);
  // True when the manual is marked FINAL — mirrors IMTemplate.isFinalized. Every editing
  // surface, save, autosave, translate, import and delete is gated on this being false.
  const locked = instance?.isFinalized ?? false;
  // Neutralizes every editing surface in one class: no clicks, no text cursor (same idiom
  // as the template editor).
  const lockedCls = locked ? 'pointer-events-none select-none opacity-70' : '';

  // Any network write is in flight — blocks re-entry and mutating actions, and drives the
  // blocking save overlay so the user can't navigate away and wedge the session mid-save.
  const isBusy = saving || generating || translating || checkingChanges || finalizing;

  // Crash-safe local draft. `savedSnapshotRef` holds a serialization of the last-persisted
  // editable state (the DB baseline); the current state differing from it = "unsaved edits",
  // which drives both the localStorage backup and the beforeunload guard. `pendingDraft` is a
  // recovered draft awaiting the user's Restore/Discard decision.
  const savedSnapshotRef = useRef<string | null>(null);
  const [pendingDraft, setPendingDraft] = useState<{ savedAt: string; state: DraftState } | null>(null);
  const draftKey = projectId ? `project-im-draft:${projectId}:${templateType}` : null;

  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const [showImport, setShowImport] = useState(false);
  const [showDiffImport, setShowDiffImport] = useState(false);

  // Block drag-and-drop within one section's editable list (extra-section blocks or a
  // placeholder section's override blocks). Keyed by a listId so the single top-level
  // state can serve whichever section is currently rendered; arrow buttons remain.
  const [blockDrag, setBlockDrag] = useState<{ listId: string; index: number } | null>(null);
  const [blockOver, setBlockOver] = useState<{ listId: string; index: number } | null>(null);
  // Additions drag-and-drop is id-based (they render in position-anchored groups, so array
  // indices don't map to visual order). Kept separate from the index-based blockDnd.
  const [addDrag, setAddDrag] = useState<{ sectionId: string; addId: string } | null>(null);
  const [addOver, setAddOver] = useState<{ sectionId: string; addId: string } | null>(null);
  // Generic confirm dialog for destructive block deletes (#7).
  const [pendingConfirm, setPendingConfirm] = useState<{ title: string; message: string; onConfirm: () => void } | null>(null);
  // Cross-section block clipboard (#11) — holds a deep copy of a copied block ref.
  // sku_slot refs are never copyable (no copy affordance on locked template refs).
  const [clipboardBlock, setClipboardBlock] = useState<InlineBlockRef | SharedBlockRef | null>(null);
  // Local reusable snippets (#12), persisted per browser.
  const [snippets, setSnippets] = useState<{ name: string; block: InlineBlockRef }[]>(() => {
      try { return JSON.parse(localStorage.getItem('im-block-snippets') || '[]'); } catch { return []; }
  });
  const [showSnippetsFor, setShowSnippetsFor] = useState<string | null>(null);
  // Jump-to-section search (#5).
  const [sectionSearch, setSectionSearch] = useState('');

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
        if (settingsMenuRef.current && !settingsMenuRef.current.contains(event.target as Node)) {
            setShowSettingsMenu(false);
        }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    setSaveConflict(null);
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
        setBlockLibrary(blks);

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
            if (existingInstance.sectionSkus) setSectionSkus(existingInstance.sectionSkus);
            if (existingInstance.blockOverrides) setBlockOverrides(existingInstance.blockOverrides);
            
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
             // Sibling manuals for "start from a sibling project" — best-effort; the
             // template picker works fine without the list.
             getAllProjectIMs().then(ims => setSiblingIMs(ims)).catch(() => {});
        }
    } catch (e) {
        console.error(e);
        setLoadError(e instanceof Error ? e.message : 'Failed to load this manual.');
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
      
      // activeLang is reconciled against the PROJECT's required languages by the effect
      // below, not against temp.languages: the two differ (a project publishes a subset,
      // and a project on the blank template picks its own set), and checking the template
      // here used to pin a blank-template manual to English whatever it had chosen.
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

  // One-time override-key migration: move legacy positional keys (`<sectionId>:<index>`
  // for visibility, `<index>` for block overrides) onto the ref's stable id key
  // (`ref:<id>`) once the template's refs carry ids. Positional keys silently re-point
  // when a template's blocks are reordered — id keys don't. Skipped while FINAL (the
  // manual is read-only, and the id-first lookups fall back to positional keys anyway);
  // the migrated state registers as dirty and persists via the normal autosave.
  const overrideKeysMigratedRef = useRef(false);
  useEffect(() => {
      if (loading || locked || overrideKeysMigratedRef.current || !instance || sections.length === 0) return;
      overrideKeysMigratedRef.current = true;
      setRefVisibility(prev => {
          let changed = false;
          const next = { ...prev };
          for (const sec of sections) (sec.blockRefs ?? []).forEach((ref, i) => {
              if (!ref.id) return;
              const legacy = `${sec.id}:${i}`;
              const idKey = `ref:${ref.id}`;
              if (next[legacy] !== undefined) {
                  if (next[idKey] === undefined) next[idKey] = next[legacy];
                  delete next[legacy];
                  changed = true;
              }
          });
          return changed ? next : prev;
      });
      setBlockOverrides(prev => {
          let changed = false;
          const next: typeof prev = { ...prev };
          for (const sec of sections) {
              if (!next[sec.id]) continue;
              (sec.blockRefs ?? []).forEach((ref, i) => {
                  if (!ref.id) return;
                  const forSection = next[sec.id];
                  if (!forSection || forSection[String(i)] === undefined) return;
                  const updated = { ...forSection };
                  const idKey = `ref:${ref.id}`;
                  if (updated[idKey] === undefined) updated[idKey] = updated[String(i)];
                  delete updated[String(i)];
                  next[sec.id] = updated;
                  changed = true;
              });
          }
          return changed ? next : prev;
      });
  }, [loading, locked, instance, sections]);

  const handleTemplateSelect = async (e: React.ChangeEvent<HTMLSelectElement>) => {
      const val = e.target.value;
      if (val) await loadTemplate(val);
  };

  // --- "Start from a sibling project" (template-picker screen) --------------------
  // A new project in a category re-enters placeholder toggles, language settings and
  // field wiring a near-identical sibling already configured. This copies a CURATED
  // subset of the sibling's setup — condition/visibility choices, language settings,
  // attribute wiring, brand assets — and deliberately NEVER product attribute values,
  // SKU content, SKU scoping, or the cover title (per-product by definition). Field
  // wiring re-derives its values from THIS project's attributes via the binding-sync
  // effect. Optionally also copies the sibling's project text additions/edited blocks.
  const [siblingIMs, setSiblingIMs] = useState<ProjectIMSummary[]>([]);
  const [copySourceId, setCopySourceId] = useState('');
  const [copyContent, setCopyContent] = useState(false);
  const [copying, setCopying] = useState(false);

  const COPYABLE_META_KEYS = ['__required_languages', '__language_order', '__field_bindings', '__custom_logo', '__custom_footer'];

  const handleCopyFromSibling = async () => {
      if (!copySourceId || copying) return;
      setCopying(true);
      try {
          const sourceIM = await getProjectIM(copySourceId, templateType);
          if (!sourceIM) throw new Error('The source manual could not be loaded.');
          const safe = sourceIM.placeholderData || {};
          const curated: Record<string, string> = {};
          for (const [k, v] of Object.entries(safe)) {
              if (k.startsWith('cond_') || k.startsWith('secvis_') || k.startsWith('refvis_') || COPYABLE_META_KEYS.includes(k)) {
                  curated[k] = v;
              }
          }
          setFormData(curated);
          // Mirror loadData's prefix parsing so the toggle panels reflect the copy.
          const conds: Record<string, boolean> = {};
          const secVis: Record<string, boolean> = {};
          const refVis: Record<string, boolean> = {};
          for (const key of Object.keys(curated)) {
              if (key.startsWith('cond_')) conds[key.replace('cond_', '')] = curated[key] === 'true';
              else if (key.startsWith('refvis_')) refVis[key.replace('refvis_', '')] = curated[key] === 'true';
              else if (key.startsWith('secvis_')) secVis[key.replace('secvis_', '')] = curated[key] === 'true';
          }
          setConditions(conds);
          setSectionVisibility(secVis);
          setRefVisibility(refVis);
          if (curated['__field_bindings']) {
              try {
                  const parsed = JSON.parse(curated['__field_bindings']);
                  if (parsed && typeof parsed === 'object') setFieldBindings(parsed);
              } catch { /* wiring is optional — skip malformed */ }
          }
          if (copyContent) {
              setSectionAdditions(structuredClone(sourceIM.sectionAdditions ?? {}));
              setExtraSections(structuredClone(sourceIM.extraSections ?? []));
              setSectionOverrides(structuredClone(sourceIM.sectionOverrides ?? {}));
              setBlockOverrides(structuredClone(sourceIM.blockOverrides ?? {}));
          }
          // Same template as the sibling — that's what makes the copied section/ref
          // toggles meaningful. Nothing is persisted until the user saves.
          await loadTemplate(sourceIM.templateId);
      } catch (e) {
          alert(`Copying the setup failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
          setCopying(false);
      }
  };

  // --- Manual pipeline (stepper) ------------------------------------------------
  // Async signals the stepper needs beyond page state: publish freshness (staleness),
  // the newest print render's version, and the live Markup.io review outcome. All
  // best-effort and off the critical path — the stepper renders without them.
  const [pipelineStale, setPipelineStale] = useState<boolean | null>(null); // null = unknown/unchecked
  const [latestRenderVersion, setLatestRenderVersion] = useState<number | null | undefined>(undefined);

  useEffect(() => {
      if (loading || !projectId) return;
      if (instance?.status !== 'generated') { setPipelineStale(null); return; }
      // Deferred: the staleness check re-resolves every language — keep it away from first paint.
      const t = setTimeout(() => {
          getProjectIMStaleReasons(projectId, templateType)
              .then(rs => setPipelineStale(rs.length > 0))
              .catch(() => setPipelineStale(null));
      }, 1500);
      return () => clearTimeout(t);
  }, [loading, projectId, templateType, instance?.status, instance?.version]);

  useEffect(() => {
      if (loading || !projectId || !isPrintExportAvailable()) return;
      getPrintRenders(projectId, templateType)
          .then(rs => setLatestRenderVersion(rs[0]?.imVersion ?? null))
          .catch(() => { /* stepper shows the print step without freshness */ });
  }, [loading, projectId, templateType]);

  // --- Pre-publish regulatory checklist (migration 119) --------------------
  // The ITEMS come from the regulations that apply to this template; the TICKS are per
  // manual (project + template type), because "the declaration of conformity is in the
  // box" is a fact about this product's manual, not about the template it came from.
  // Loaded here rather than on the Publish click, so pressing Publish never waits on a
  // round trip -- and a failure to load leaves the checklist empty rather than standing
  // between a finished manual and its publish.
  const [regChecklist, setRegChecklist] = useState<ChecklistItem[]>([]);
  // The assignments the items were built from — the review panel groups by regulation, and
  // only the assignment carries the citation and title to head each group with.
  const [regAssignments, setRegAssignments] = useState<TemplateRegulation[]>([]);
  const [regChecklistState, setRegChecklistState] = useState<Record<string, ChecklistItemState>>({});
  const [regChecklistBusy, setRegChecklistBusy] = useState<string | null>(null);
  const [regChecklistError, setRegChecklistError] = useState('');
  // What the TEMPLATE author confirmed (migration 120). Read-only context here: covering an
  // obligation in the template and satisfying it in this manual are different claims, so
  // this never pre-fills a tick — it just stops the publisher wondering whether the
  // template author already dealt with it.
  const [regTemplateState, setRegTemplateState] = useState<Record<string, ChecklistItemState>>({});

  useEffect(() => {
      if (!template?.id || !projectId) { setRegChecklist([]); setRegAssignments([]); setRegChecklistState({}); setRegTemplateState({}); return; }
      let alive = true;
      Promise.all([
          getTemplateRegulations(template.id, template.categoryId),
          getChecklistState(projectId, templateType),
          getTemplateChecklistState(template.id),
      ])
          .then(([assignments, state, templateState]) => {
              if (!alive) return;
              setRegChecklist(buildTemplateChecklist(assignments));
              setRegAssignments(assignments);
              setRegChecklistState(state);
              setRegTemplateState(templateState);
          })
          .catch(e => console.error('[ProjectIMGenerator] regulatory checklist unavailable:', e));
      return () => { alive = false; };
  }, [template?.id, template?.categoryId, projectId, templateType]);

  const regChecklistSummary = summarizeChecklist(regChecklist, regChecklistState);
  // The same items, split by the regulation that imposes them — how a reviewer reads a
  // checklist. Derived rather than stored: the grouping is a view of `regAssignments`.
  const regChecklistGroups = groupChecklistByRegulation(regAssignments);

  /**
   * Record or clear one item's decision. Written immediately (there is no Save button in
   * a publish dialog) and applied optimistically, rolling back if the write fails --
   * a tick that looks saved but is not would be the one failure mode worth avoiding here.
   */
  const setChecklistDecision = async (key: string, status: ChecklistItemStatus | null) => {
      if (!projectId) return;
      const previous = regChecklistState;
      setRegChecklistBusy(key);
      setRegChecklistError('');
      setRegChecklistState(prev => {
          const next = { ...prev };
          if (!status) delete next[key];
          else next[key] = { status, updatedBy: user?.email, updatedAt: new Date().toISOString() };
          return next;
      });
      try {
          await setChecklistItemState(projectId, templateType, key, status, { actor: user?.email });
      } catch (e) {
          setRegChecklistState(previous);
          setRegChecklistError(`Could not save that: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
          setRegChecklistBusy(null);
      }
  };

  // Poll Markup.io once per open while a round is out and undecided; the function
  // caches the outcome on the manual, so this also heals the dashboard's view.
  const reviewCheckedRef = useRef(false);
  useEffect(() => {
      if (loading || !projectId || reviewCheckedRef.current || !isMarkupReviewAvailable()) return;
      if (!instance || !isInReview(instance) || instance.reviewDone === true || !instance.reviewMarkupId) return;
      reviewCheckedRef.current = true;
      checkMarkupReviewStatus(projectId, templateType)
          .then(res => setInstance(prev => prev ? {
              ...prev,
              reviewStatus: res.status,
              reviewDone: res.done,
              reviewActiveThreads: res.activeThreads,
              reviewCheckedAt: res.checkedAt,
          } : prev))
          .catch(() => { /* the cached/derived state stands */ });
  }, [loading, projectId, templateType, instance]);

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
      if (locked) return; // read-only while FINAL — no inline edits from the preview
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

  // Yield a frame so React can paint a status change before the next (possibly main-thread
  // blocking) step runs — otherwise "Saving…" never shows until it's over.
  const yieldToPaint = () => new Promise<void>(resolve => setTimeout(resolve, 0));

  // Encode the current form/condition/visibility state into the flat placeholder_data
  // map persisted on project_ims. Shared by draft save, publish, and auto-translate so
  // all three write an identical payload. `fd` defaults to current formData; save paths
  // pass the image-externalized copy so the persisted row never carries inline base64.
  const buildPlaceholderData = (fd: Record<string, string> = formData): Record<string, string> => {
      // Base layer = submitted attribute values (keyed by attribute id) so bound
      // placeholders/tokens resolve in the saved manual; PM edits in formData win.
      const data: Record<string, string> = { ...submittedAttrValues, ...fd };
      Object.entries(conditions).forEach(([k, v]) => { data[`cond_${k}`] = String(v); });
      Object.entries(sectionVisibility).forEach(([k, v]) => { data[`secvis_${k}`] = String(v); });
      Object.entries(refVisibility).forEach(([k, v]) => { data[`refvis_${k}`] = String(v); });
      // Current language + attribute bindings so manual/attribute mode is restored next time.
      data['__meta_language'] = activeLang;
      data['__field_bindings'] = JSON.stringify(fieldBindings);
      return data;
  };

  // ---------------- CRASH-SAFE LOCAL DRAFT ----------------
  // A snapshot of the editable state, in a fixed key order so JSON.stringify is a stable
  // dirty-check key. Built from current state; save paths pass `over` to substitute the
  // image-externalized copies so the baseline matches exactly what was persisted.
  const buildDraftState = (over: Partial<DraftState> = {}): DraftState => ({
    formData, fieldBindings, conditions, sectionVisibility, refVisibility, skuContent,
    sectionAdditions, extraSections, sectionOverrides, sectionSkus, blockOverrides,
    boundSkuIds, activeLang, ...over,
  });
  const serializeDraft = (over: Partial<DraftState> = {}) => JSON.stringify(buildDraftState(over));

  // Record what we just persisted as the new baseline and drop the local backup — nothing
  // is unsaved, so beforeunload stops warning and the draft won't be offered on reload.
  const markSaved = (over: Partial<DraftState> = {}) => {
    savedSnapshotRef.current = serializeDraft(over);
    if (draftKey) { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } }
  };

  // Apply a serialized editable-state snapshot to all the overlay setters. Shared by
  // draft recovery and by undo/redo.
  const applyDraftState = (s: DraftState) => {
    setFormData(s.formData ?? {});
    setFieldBindings(s.fieldBindings ?? {});
    setConditions(s.conditions ?? {});
    setSectionVisibility(s.sectionVisibility ?? {});
    setRefVisibility(s.refVisibility ?? {});
    setSkuContent(s.skuContent ?? {});
    setSectionAdditions(s.sectionAdditions ?? {});
    setExtraSections(s.extraSections ?? []);
    setSectionOverrides(s.sectionOverrides ?? {});
    setSectionSkus(s.sectionSkus ?? {});
    setBlockOverrides(s.blockOverrides ?? {});
    if (Array.isArray(s.boundSkuIds)) setBoundSkuIds(s.boundSkuIds);
    if (s.activeLang) setActiveLang(s.activeLang);
  };

  const restoreDraft = () => {
    if (!pendingDraft) return;
    // Apply the recovered edits but leave savedSnapshotRef at the DB baseline, so the
    // restored state registers as dirty and gets re-backed-up / offered for saving.
    applyDraftState(pendingDraft.state);
    setPendingDraft(null);
  };

  // Undo/redo over the whole editable overlay set (reuses the draft snapshot shape).
  // Disabled until load completes and while a recovered draft awaits a decision.
  const undoRedo = useUndoRedo(
    serializeDraft(),
    (json) => { try { applyDraftState(JSON.parse(json) as DraftState); } catch { /* ignore malformed */ } },
    { enabled: !loading && !pendingDraft },
  );

  const discardDraft = () => {
    if (draftKey) { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } }
    setPendingDraft(null);
  };

  // ---------------- DAILY BACKUPS (last 3 days) ----------------
  // Convert a backed-up ProjectIM row into the editable-state shape, exactly the way
  // loadData unpacks a loaded instance (prefixed keys → conditions/visibility maps).
  const draftStateFromIM = (im: ProjectIM): DraftState => {
    const data = im.placeholderData || {};
    const conds: Record<string, boolean> = {};
    const secVis: Record<string, boolean> = {};
    const refVis: Record<string, boolean> = {};
    Object.keys(data).forEach(key => {
      if (key.startsWith('cond_')) conds[key.replace('cond_', '')] = data[key] === 'true';
      else if (key.startsWith('refvis_')) refVis[key.replace('refvis_', '')] = data[key] === 'true';
      else if (key.startsWith('secvis_')) secVis[key.replace('secvis_', '')] = data[key] === 'true';
    });
    let bindings: Record<string, string[]> = {};
    try {
      const parsed = JSON.parse(data['__field_bindings'] ?? '');
      if (parsed && typeof parsed === 'object') bindings = parsed;
    } catch { /* absent/malformed — no bindings */ }
    return {
      formData: data,
      fieldBindings: bindings,
      conditions: conds,
      sectionVisibility: secVis,
      refVisibility: refVis,
      skuContent: im.skuContent ?? {},
      sectionAdditions: im.sectionAdditions ?? {},
      extraSections: im.extraSections ?? [],
      sectionOverrides: im.sectionOverrides ?? {},
      sectionSkus: im.sectionSkus ?? {},
      blockOverrides: im.blockOverrides ?? {},
      boundSkuIds: im.boundSkuIds ?? [],
      activeLang: data['__meta_language'] || activeLang,
    };
  };

  const openBackups = async () => {
    if (!projectId) return;
    setShowBackups(true);
    setBackups(null);
    try {
      setBackups(await getProjectIMBackups(projectId, templateType));
    } catch (e) {
      console.error('[ProjectIMGenerator] loading backups failed:', e);
      setBackups([]);
    }
  };

  // Load a daily snapshot INTO THE EDITOR (not straight into the DB): the operator can
  // review it in the preview, undo it (Ctrl/Cmd+Z), and keep it with a normal Save.
  const restoreBackup = (b: ProjectIMBackup) => {
    applyDraftState(draftStateFromIM(b.im));
    setShowBackups(false);
  };

  // Seed the DB baseline once loading finishes (so nothing is dirty on load), then offer to
  // restore a newer local draft if one survived a hang/crash/close on this device.
  useEffect(() => {
    if (loading || !draftKey || savedSnapshotRef.current !== null) return;
    savedSnapshotRef.current = serializeDraft();
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw);
        const newerThanDb = !instance || new Date(draft?.savedAt).getTime() > new Date(instance.updatedAt).getTime();
        if (draft?.savedAt && draft?.state && newerThanDb && JSON.stringify(draft.state) !== savedSnapshotRef.current) {
          setPendingDraft(draft);
        } else {
          localStorage.removeItem(draftKey);
        }
      }
    } catch { /* ignore malformed draft */ }
  }, [loading, draftKey, instance]);

  // Back the current edits up to localStorage IMMEDIATELY on every change (no network), so a
  // hang, crash, or accidental navigation never loses work — it's recovered on next load.
  // Paused while a recovered draft awaits the user's decision (keeps the stored draft intact).
  useEffect(() => {
    if (loading || pendingDraft || !draftKey || savedSnapshotRef.current === null) return;
    try {
      const cur = serializeDraft();
      if (cur !== savedSnapshotRef.current) {
        localStorage.setItem(draftKey, JSON.stringify({ savedAt: new Date().toISOString(), state: buildDraftState() }));
      } else {
        localStorage.removeItem(draftKey);
      }
    } catch { /* quota / private mode — best-effort */ }
  }, [formData, fieldBindings, conditions, sectionVisibility, refVisibility, skuContent,
      sectionAdditions, extraSections, sectionOverrides, sectionSkus, blockOverrides,
      boundSkuIds, activeLang, loading, pendingDraft, draftKey]);

  // Warn before leaving (tab close / reload) with unsaved edits or a save in flight.
  // No dependency array on purpose: re-binding each render keeps the handler closing over the
  // latest dirty check / isBusy. `serializeDraft()` only runs if the user actually tries to
  // leave, so this is cheap.
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      const dirty = savedSnapshotRef.current !== null && serializeDraft() !== savedSnapshotRef.current;
      if (dirty || isBusy) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  });

  // Persist the draft to the server. `silent` drives background autosave: no blocking
  // overlay, no success tick, and a failure is logged (and retried on the next change)
  // rather than alerted — the local backup remains the crash net either way.
  const persistDraft = async (opts?: { silent?: boolean }) => {
      if (!projectId || !selectedTemplateId) return;
      // A FINAL manual is read-only — never persist (this also short-circuits autosave).
      if (locked) return;
      // A detected concurrent-edit conflict halts all saves until the operator reloads —
      // saving would overwrite the other person's version.
      if (saveConflict) return;
      // Never let a save start on top of another operation (Publish/Translate/another Save):
      // overlapping writes to the same row queue behind each other's row lock (see data/resilience.ts).
      if (isBusy) return;
      const silent = opts?.silent ?? false;
      if (silent) setAutosaving(true);
      else { setSavedTick(false); setSaving(true); await yieldToPaint(); }

      try {
          // Move any base64 images out of the row (formData + overlay content) into storage
          // first, so the persisted JSONB stays small and can't trip the DB write timeout.
          const cache = new Map<string, string>();
          const extForm = await externalizeFormDataImages(formData, cache);
          setFormData(extForm);
          const ext = await externalizeOverlayImages({ sectionAdditions, sectionOverrides, blockOverrides, extraSections });
          setSectionAdditions(ext.sectionAdditions);
          setSectionOverrides(ext.sectionOverrides);
          setBlockOverrides(ext.blockOverrides);
          setExtraSections(ext.extraSections);
          const dataToSave = buildPlaceholderData(extForm);
          const saved = await saveProjectIM(projectId, selectedTemplateId, dataToSave, 'draft', skuContent, templateType, ext.sectionAdditions, ext.extraSections, ext.sectionOverrides, undefined, boundSkuIds, sectionSkus, ext.blockOverrides, { baselineUpdatedAt: instance?.updatedAt ?? null });
          setInstance(saved);
          // Baseline = exactly what we persisted, so the local draft clears and nothing shows dirty.
          markSaved({ formData: extForm, sectionAdditions: ext.sectionAdditions, sectionOverrides: ext.sectionOverrides, blockOverrides: ext.blockOverrides, extraSections: ext.extraSections });
          setLastAutoSavedAt(new Date());
          if (!silent) {
              // Transient inline confirmation instead of a blocking alert.
              setSavedTick(true);
              setTimeout(() => setSavedTick(false), 2500);
          }
      } catch (e) {
          console.error(e);
          if (e instanceof ProjectIMConflictError) {
              // Same handling for manual save and autosave: halt saving, show the banner.
              setSaveConflict({ at: e.lastUpdatedAt, by: e.lastUpdatedBy });
          } else if (!silent) {
              const detail = e instanceof Error && e.message ? `\n\nDetails: ${e.message}` : '';
              alert(`Failed to save draft. Your work is backed up locally on this device — try Save again.${detail}`);
          } else {
              console.warn('[ProjectIMGenerator] autosave failed — will retry on next change (work is backed up locally).');
          }
      } finally {
          if (silent) setAutosaving(false);
          else setSaving(false);
      }
  };

  const handleSaveDraft = () => persistDraft();

  // Conflict recovery: stash the current edits as the local draft (fresh timestamp, so the
  // restore prompt will offer them on top of the other person's version), then reload.
  const reloadAfterConflict = () => {
      if (draftKey) {
          try {
              localStorage.setItem(draftKey, JSON.stringify({ savedAt: new Date().toISOString(), state: buildDraftState() }));
          } catch { /* quota — the reload still proceeds; worst case the edits are lost with warning shown */ }
      }
      savedSnapshotRef.current = null;
      setSaveConflict(null);
      setPendingDraft(null);
      void loadData();
  };

  // Toggle the FINAL lock. Finalizing persists any unsaved edits first (so what's locked is
  // exactly what's on the server), then flips the flag; unlocking just clears it. Touches
  // only the finalize columns via setProjectIMFinalized, so it never races the content save.
  const applyFinalized = async (next: boolean) => {
      if (!projectId || isBusy) return;
      try {
          // Persist first (persistDraft manages its own `saving`/isBusy flag and bails if
          // isBusy) — only then raise `finalizing`, so its guard doesn't skip the save.
          if (next && isDirty) await persistDraft();
          setFinalizing(true);
          const res = await setProjectIMFinalized(projectId, templateType, next);
          setInstance(prev => prev ? { ...prev, isFinalized: res.isFinalized, finalizedAt: res.finalizedAt, finalizedBy: res.finalizedBy, updatedAt: res.updatedAt } : prev);
      } catch (e) {
          console.error('[ProjectIMGenerator] finalize toggle failed', e);
          alert(`Could not ${next ? 'mark this manual as final' : 'unlock this manual'} — see console for details.`);
      } finally {
          setFinalizing(false);
      }
  };

  const handleMarkFinal = () => { setShowFinalizeConfirm(false); applyFinalized(true); };
  const handleUnlock = () => { setShowUnlockConfirm(false); applyFinalized(false); };

  // Debounced background server autosave (on top of the instant local backup): 4s after
  // edits settle, silently persist to the DB so closing the tab never strands work on the
  // server. Skipped while loading, while a recovered draft awaits a decision, during any
  // other operation, and when nothing is unsaved.
  useEffect(() => {
      if (loading || pendingDraft || isBusy || saveConflict) return;
      if (!projectId || !selectedTemplateId || savedSnapshotRef.current === null) return;
      if (serializeDraft() === savedSnapshotRef.current) return; // nothing unsaved
      const t = setTimeout(() => { void persistDraft({ silent: true }); }, 4000);
      return () => clearTimeout(t);
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serializeDraft(), loading, pendingDraft, isBusy, projectId, selectedTemplateId]);

  /**
   * Scroll the preview pane to a chapter and flash it, so the eye can find where it landed
   * in what is otherwise a wall of A4 text. A no-op when the chapter isn't rendered; callers
   * disable their control in that case rather than letting the click do nothing silently.
   *
   * Lives up here with the hooks that use it, not down with the other section helpers: this
   * component returns early while loading and before a template is chosen, so anything a hook
   * closes over has to be initialised on EVERY render, not just the ones that get that far.
   */
  const jumpToPreviewSection = (sectionId: string) => {
    const scroller = previewScrollRef.current;
    if (!scroller) return;
    const target = findPreviewSection(scroller, sectionId);
    if (!target) return;

    const reduceMotion = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    scroller.scrollTo({
      top: previewScrollTopFor(scroller, target),
      behavior: reduceMotion ? 'auto' : 'smooth',
    });

    setFlashSectionId(sectionId);
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => setFlashSectionId(null), 1600);
  };

  /**
   * Content tab: picking a chapter in the tree also brings the preview to it, so the two panes
   * stay in sync without a second click. Deliberately keyed on the SELECTION (and on entering
   * the tab), not on content — auto-scrolling while someone types would yank the page around.
   *
   * No "is this chapter in the preview?" pre-check: `findPreviewSection` already misses for a
   * chapter the preview omitted (condition, visibility, SKU scope), and the DOM is the ground
   * truth for what is on screen. Checking `isSectionInPreview` here would mean closing over
   * bindings declared below the early returns, which is what broke this in the first place.
   */
  useEffect(() => {
    if (editorMode !== 'content' || !selectedContentSectionId) return;
    // A frame's grace so the preview has committed any layout change from the selection.
    const raf = requestAnimationFrame(() => jumpToPreviewSection(selectedContentSectionId));
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorMode, selectedContentSectionId]);

  /**
   * Bring the "Fill values" form to a `data-fill-anchor` and flash it — the landing half of a
   * click in the pre-publish review panel (see PublishReviewPanel, publish-issues.ts).
   *
   * Retried across frames rather than scrolled straight away: the same click usually switched
   * the editor tab, so the target is not mounted yet. And the form renders inputs for the
   * ACTIVE language only while the review is computed from English, so an anchor that stays
   * missing is most likely one this language does not produce — hence the single fall back to
   * English before giving up. Giving up is silent by design: the tab has already changed, which
   * is most of what the click was for.
   */
  useEffect(() => {
    if (!pendingJump) return;
    const raf = requestAnimationFrame(() => {
      const scroller = fillScrollRef.current;
      const target = scroller ? findByDataAttr(scroller, FILL_ANCHOR_ATTR, pendingJump.anchor) : null;
      if (scroller && target) {
        const reduceMotion = typeof window !== 'undefined'
          && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        scroller.scrollTo({
          top: previewScrollTopFor(scroller, target),
          behavior: reduceMotion ? 'auto' : 'smooth',
        });
        setFlashAnchor(pendingJump.anchor);
        if (flashAnchorTimerRef.current) window.clearTimeout(flashAnchorTimerRef.current);
        flashAnchorTimerRef.current = window.setTimeout(() => setFlashAnchor(null), 1600);
        setPendingJump(null);
        return;
      }
      if (pendingJump.tries >= 3) { setPendingJump(null); return; }
      if (pendingJump.tries === 1) setActiveLang('en');
      setPendingJump({ anchor: pendingJump.anchor, tries: pendingJump.tries + 1 });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingJump, editorMode, activeLang]);

  // Never leave a flash timer pending past unmount.
  useEffect(() => () => {
    if (flashTimerRef.current) window.clearTimeout(flashTimerRef.current);
    if (flashAnchorTimerRef.current) window.clearTimeout(flashAnchorTimerRef.current);
  }, []);

  // Keep the active language tab on a language this project actually produces. Runs once
  // the template and placeholder data are both in state, so a restored `__meta_language`
  // survives as long as it is still required; dropping the active language falls back to
  // the first required one (English unless the PM reordered).
  useEffect(() => {
    if (!template) return;
    const langs = getProjectRequiredLanguages(template, formData);
    if (!langs.includes(activeLang)) setActiveLang(langs[0] || 'en');
    // Only the two keys that can change the answer — not all of formData, which changes
    // on every keystroke.
  }, [template, formData['__required_languages'], formData['__language_order'], activeLang]);

  // Unsaved-work indicator: current editable state differs from the last-persisted baseline.
  const isDirty = savedSnapshotRef.current !== null && serializeDraft() !== savedSnapshotRef.current;

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
          setSectionSkus({});
          setBlockOverrides({});
          setEditorMode('fill');
          setTemplate(null);
          setSections([]);
          setSelectedTemplateId('');
          setActiveLang('en'); // Reset language

          // The empty state IS the new baseline — drop the local draft and reset the
          // snapshot so this deliberate reset isn't treated as unsaved edits.
          savedSnapshotRef.current = null;
          setPendingDraft(null);
          if (draftKey) { try { localStorage.removeItem(draftKey); } catch { /* ignore */ } }

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
      if (!project || !template) {
          console.error("Project or template missing");
          alert("Could not load project details to publish.");
          return;
      }
      // Don't publish on top of another in-flight operation (see handleSaveDraft).
      if (isBusy) return;

      setGenerating(true);
      setPublishStatus('Preparing…');
      // Each publish bumps the version; it's stamped into the print PDF footer and persisted.
      const nextVersion = (instance?.version ?? 0) + 1;

      try {
          setPublishStatus('Saving…');
          await yieldToPaint();
          // Move any base64 images out of the row (formData + overlay content) into storage
          // first, so the persisted JSONB stays small and can't trip the DB write timeout.
          const cache = new Map<string, string>();
          const extForm = await externalizeFormDataImages(formData, cache);
          setFormData(extForm);
          const extOv = await externalizeOverlayImages({ sectionAdditions, sectionOverrides, blockOverrides, extraSections });
          setSectionAdditions(extOv.sectionAdditions);
          setSectionOverrides(extOv.sectionOverrides);
          setBlockOverrides(extOv.blockOverrides);
          setExtraSections(extOv.extraSections);
          const dataToSave = buildPlaceholderData(extForm);
          const savedIM = await saveProjectIM(project.id, selectedTemplateId, dataToSave, 'generated', skuContent, templateType, extOv.sectionAdditions, extOv.extraSections, extOv.sectionOverrides, nextVersion, boundSkuIds, sectionSkus, extOv.blockOverrides, { baselineUpdatedAt: instance?.updatedAt ?? null });
          setInstance(savedIM);
          // Baseline = exactly what we persisted, so the local draft clears.
          markSaved({ formData: extForm, sectionAdditions: extOv.sectionAdditions, sectionOverrides: extOv.sectionOverrides, blockOverrides: extOv.blockOverrides, extraSections: extOv.extraSections });

          // Publish the structured ResolvedManual (one JSON per language + manifest) to the
          // public im-published bucket. This IS the publish output — the print-ready PDF is
          // rendered on demand from it (PrintExportDialog → render-print-pdf) and attached to
          // the project's documents when that render succeeds (attachPrintPdfToProject).
          setPublishStatus('Publishing languages…');
          const result = await publishResolvedManuals(
              project.id, template, sections, savedIM,
              (done, total, lang) => setPublishStatus(`Publishing ${done}/${total} (${lang.toUpperCase()})…`),
          );
          setPublishResult(result);

      } catch (e: any) {
          console.error("Publish failed", e);
          if (e instanceof ProjectIMConflictError) setSaveConflict({ at: e.lastUpdatedAt, by: e.lastUpdatedBy });
          else alert(`Failed to publish ${typeLabel}: ${e.message}`);
      } finally {
          setGenerating(false);
          setPublishStatus(null);
      }
  };

  // After a print render succeeds, persist that PDF as the project's single
  // "Generated {typeLabel}" document under the Production step (step 3) — never RFQ.
  // Each render is appended as a new version via uploadFile, so the Production section
  // always shows the latest file with older versions collapsed under it (Version History).
  const attachPrintPdfToProject = async (res: PrintPdfResult, langs: string[], pageSize: 'a4' | 'a5') => {
      if (!project) throw new Error('Project not loaded.');
      const resp = await fetch(res.url);
      if (!resp.ok) throw new Error(`Could not download the rendered PDF (${resp.status}).`);
      const blob = await resp.blob();
      const docTypeSlug = templateType === 'warning_leaflet' ? 'Warning_Leaflet' : 'Manual';
      const fileName = `${project.name.replace(/\s+/g, '_')}_${docTypeSlug}_${langs.map(l => l.toUpperCase()).join('-')}_${pageSize.toUpperCase()}.pdf`;
      const file = new File([blob], fileName, { type: 'application/pdf' });

      const PRODUCTION_STEP = 3;
      const generatedDocTitle = `Generated ${typeLabel}`;
      const existingDocs = await getProjectDocs(project.id);
      const targetDoc = existingDocs.find(d =>
         d.stepNumber === PRODUCTION_STEP &&
         d.title === generatedDocTitle &&
         d.responsibleParty === ResponsibleParty.INTERNAL
      ) ?? await addDocument({
         projectId: project.id,
         stepNumber: PRODUCTION_STEP,
         title: generatedDocTitle,
         description: `Generated from ${typeLabel} template`,
         responsibleParty: ResponsibleParty.INTERNAL,
         isVisibleToSupplier: true,
         isRequired: false,
         status: DocStatus.APPROVED
      });

      await uploadFile(targetDoc.id, file, false);
  };

  // After a PDF is sent to Markup.io, mirror the new review round onto the local
  // instance so the In Review badge + link appear without a reload. updatedAt is
  // synced too: the send-to-markup function bumps it server-side, and keeping a
  // stale baseline would trip the concurrent-edit guard on the next save.
  const handleReviewSent = (res: MarkupReviewResult) => {
      setInstance(prev => prev ? {
          ...prev,
          reviewUrl: res.markupUrl,
          reviewMarkupId: res.markupId,
          reviewRequestedAt: res.reviewRequestedAt,
          reviewRequestedBy: res.reviewRequestedBy,
          reviewVersion: res.reviewVersion,
          // A fresh round has no outcome yet — clear the previous round's cache.
          reviewStatus: null,
          reviewDone: null,
          reviewActiveThreads: null,
          reviewCheckedAt: null,
          updatedAt: res.reviewRequestedAt,
      } : prev);
  };

  // Remember the cover choices made in the print dialog (logo / cover image) as this
  // IM's defaults: mirror them into local form state (so the preview and the next
  // dialog open use them immediately) and persist them into placeholder_data so they
  // survive across sessions. Best-effort — never blocks the export flow.
  const persistCoverPrefs = (prefs: { logoUrl: string; coverImageUrl?: string }) => {
      if (!project) return;
      const patch: Record<string, string> = { __custom_logo: prefs.logoUrl };
      if (prefs.coverImageUrl !== undefined) patch.__custom_cover_image = prefs.coverImageUrl;
      // If everything was saved before this, keep it reading as saved — the pref
      // patch is persisted directly below, not via the draft/save pipeline.
      const wasClean = savedSnapshotRef.current !== null && savedSnapshotRef.current === serializeDraft();
      const nextForm = { ...formData, ...patch };
      setFormData(nextForm);
      if (wasClean) markSaved({ formData: nextForm });
      updateProjectIMPlaceholders(project.id, templateType, patch)
          .catch(e => console.error('Failed to persist cover preferences', e));
  };

  // ---------------- PROJECT CONTENT EDITOR ----------------
  // All edits below mutate project-only state (sectionAdditions / extraSections);
  // the template (sections / blocks) is never touched.


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

  // Drag-and-drop reorder of additions by id: drop the dragged addition into the target's
  // anchor position, immediately before the target in array order. Works within a section.
  const reorderAdditionById = (sectionId: string, draggedId: string, targetId: string) => {
      setSectionAdditions(prev => {
          const list = [...(prev[sectionId] ?? [])];
          const from = list.findIndex(a => a.id === draggedId);
          if (from < 0 || draggedId === targetId) return prev;
          const targetPos = list.find(a => a.id === targetId)?.position;
          if (targetPos === undefined) return prev;
          const [moved] = list.splice(from, 1);
          const insertAt = list.findIndex(a => a.id === targetId);
          list.splice(insertAt < 0 ? list.length : insertAt, 0, { ...moved, position: targetPos });
          return { ...prev, [sectionId]: list };
      });
  };

  // Deep-clone an addition (fresh id, same anchor position) and insert it right after
  // the source so the copy sits next to the original.
  const duplicateAddition = (sectionId: string, addId: string) => {
      setSectionAdditions(prev => {
          const list = [...(prev[sectionId] ?? [])];
          const i = list.findIndex(a => a.id === addId);
          if (i < 0) return prev;
          const clone = { ...structuredClone(list[i]), id: `add-${Math.random().toString(36).slice(2, 11)}` };
          list.splice(i + 1, 0, clone);
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

  // Map a shared block's type to its callout variant so a flattened copy keeps its look.

  // Duplicate a chapter (single section, not its subsections) into an editable
  // project-only chapter placed right after the source at the same level. The PM then
  // edits it per SKU and tags it via the SKU selector.
  const duplicateChapter = (section: IMSection) => {
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
          title: localizedSectionTitle(section, activeLang),
          order: newOrder,
          blocks: sectionToInlineBlocks(section, sectionOverrides, availableBlocks),
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
      setSectionSkus(prev => { const next = { ...prev }; delete next[id]; return next; });
  };

  const addBlockToExtra = (id: string) => {
      setExtraSections(prev => prev.map(s => s.id === id ? { ...s, blocks: [...s.blocks, newInlineBlock()] } : s));
  };

  const updateExtraBlock = (id: string, idx: number, lang: string, html: string) => {
      setExtraSections(prev => prev.map(s => s.id === id
          ? { ...s, blocks: s.blocks.map((b, i) => i === idx && b.kind === 'inline' ? { ...b, content: { ...b.content, [lang]: html } } : b) }
          : s));
  };

  const setExtraBlockVariant = (id: string, idx: number, variant: CalloutVariant | undefined) => {
      setExtraSections(prev => prev.map(s => s.id === id
          ? { ...s, blocks: s.blocks.map((b, i) => i === idx && b.kind === 'inline' ? { ...b, variant } : b) }
          : s));
  };

  // Insert a reference to an approved shared (standardized) block into a project section.
  const addSharedBlockToExtra = (id: string, blockId: string) => {
      setExtraSections(prev => prev.map(s => s.id === id
          ? { ...s, blocks: [...s.blocks, { kind: 'block', block_id: blockId } as SharedBlockRef] }
          : s));
  };


  const removeExtraBlock = (id: string, idx: number) => {
      setExtraSections(prev => prev.map(s => s.id === id
          ? { ...s, blocks: s.blocks.filter((_, i) => i !== idx) }
          : s));
  };

  // Deep-clone a project-section block and insert the copy directly after it.
  const duplicateExtraBlock = (id: string, idx: number) => {
      setExtraSections(prev => prev.map(s => {
          if (s.id !== id) return s;
          const source = s.blocks[idx];
          if (!source) return s;
          const blocks = [...s.blocks];
          blocks.splice(idx + 1, 0, structuredClone(source));
          return { ...s, blocks };
      }));
  };

  // Reorder a block within a project section (works for inline and shared blocks).
  const moveExtraBlock = (id: string, idx: number, dir: -1 | 1) => {
      setExtraSections(prev => prev.map(s => {
          if (s.id !== id) return s;
          const j = idx + dir;
          if (j < 0 || j >= s.blocks.length) return s;
          const blocks = [...s.blocks];
          [blocks[idx], blocks[j]] = [blocks[j], blocks[idx]];
          return { ...s, blocks };
      }));
  };

  // Arbitrary from→to reorder of a project-section's blocks (drag-and-drop).
  const reorderExtraBlock = (id: string, from: number, to: number) => {
      setExtraSections(prev => prev.map(s => {
          if (s.id !== id) return s;
          if (from < 0 || to < 0 || from >= s.blocks.length || to >= s.blocks.length) return s;
          const blocks = [...s.blocks];
          const [moved] = blocks.splice(from, 1);
          blocks.splice(to, 0, moved);
          return { ...s, blocks };
      }));
  };

  // --- Placeholder section overrides (full project content for is_placeholder sections) ---
  // Derive the initial editable blocks for a placeholder section from the template:
  // its inline refs, else its legacy content as one block, else one empty block.

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

  const duplicateOverrideBlock = (section: IMSection, idx: number) =>
      editOverride(section, blocks => {
          const source = blocks[idx];
          if (!source) return blocks;
          const next = [...blocks];
          next.splice(idx + 1, 0, structuredClone(source));
          return next;
      });

  const moveOverrideBlock = (section: IMSection, idx: number, dir: -1 | 1) =>
      editOverride(section, blocks => {
          const j = idx + dir;
          if (j < 0 || j >= blocks.length) return blocks;
          const next = [...blocks];
          [next[idx], next[j]] = [next[j], next[idx]];
          return next;
      });

  // Arbitrary from→to reorder of a placeholder section's override blocks (drag-and-drop).
  const reorderOverrideBlock = (section: IMSection, from: number, to: number) =>
      editOverride(section, blocks => {
          if (from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return blocks;
          const next = [...blocks];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return next;
      });

  // Native drag-and-drop wiring for a section's block list. `listId` is the extra
  // section id, or `ov:<sectionId>` for a placeholder section's override blocks; the
  // drop handler dispatches to the matching arbitrary-reorder above. Dragging is on a
  // dedicated handle (the editors host contentEditable — a draggable card would eat the
  // text selection).
  const blockDnd = {
    handleProps: (listId: string, index: number) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        setBlockDrag({ listId, index });
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', String(index)); } catch { /* noop */ }
      },
      onDragEnd: () => { setBlockDrag(null); setBlockOver(null); },
    }),
    dropProps: (listId: string, index: number) => ({
      onDragOver: (e: React.DragEvent) => {
        if (!blockDrag || blockDrag.listId !== listId || blockDrag.index === index) return;
        e.preventDefault();
        if (blockOver?.listId !== listId || blockOver?.index !== index) setBlockOver({ listId, index });
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const src = blockDrag;
        setBlockDrag(null); setBlockOver(null);
        if (!src || src.listId !== listId || src.index === index) return;
        if (listId.startsWith('ov:')) {
          const section = sections.find(s => s.id === listId.slice(3));
          if (section) reorderOverrideBlock(section, src.index, index);
        } else {
          reorderExtraBlock(listId, src.index, index);
        }
      },
    }),
    isDragging: (listId: string, index: number) => blockDrag?.listId === listId && blockDrag.index === index,
    isOver: (listId: string, index: number) =>
      blockOver?.listId === listId && blockOver.index === index && !(blockDrag?.listId === listId && blockDrag.index === index),
  };

  // Id-based drag-and-drop for section additions (see reorderAdditionById).
  const additionDnd = {
    handleProps: (sectionId: string, addId: string) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        setAddDrag({ sectionId, addId });
        e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', addId); } catch { /* noop */ }
      },
      onDragEnd: () => { setAddDrag(null); setAddOver(null); },
    }),
    dropProps: (sectionId: string, addId: string) => ({
      onDragOver: (e: React.DragEvent) => {
        if (!addDrag || addDrag.sectionId !== sectionId || addDrag.addId === addId) return;
        e.preventDefault();
        if (addOver?.sectionId !== sectionId || addOver?.addId !== addId) setAddOver({ sectionId, addId });
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        const src = addDrag;
        setAddDrag(null); setAddOver(null);
        if (!src || src.sectionId !== sectionId || src.addId === addId) return;
        reorderAdditionById(sectionId, src.addId, addId);
      },
    }),
    isDragging: (sectionId: string, addId: string) => addDrag?.sectionId === sectionId && addDrag.addId === addId,
    isOver: (sectionId: string, addId: string) =>
      addOver?.sectionId === sectionId && addOver.addId === addId && !(addDrag?.sectionId === sectionId && addDrag.addId === addId),
  };

  // --- Delete confirmation (#7): confirm only when there's content to lose ---
  const requestDeleteBlock = (isEmpty: boolean, onConfirm: () => void) => {
      if (isEmpty) { onConfirm(); return; }
      setPendingConfirm({
          title: 'Delete this block?',
          message: 'This block has content. Deleting it removes it from this project. You can undo with Ctrl/Cmd+Z.',
          onConfirm,
      });
  };

  // --- Block clipboard (#11): copy any block ref, paste a clone into a section ---
  const appendBlockToSection = (section: IMSection, ref: InlineBlockRef | SharedBlockRef) => {
      const clone = structuredClone(ref);
      if (isExtraSection(section)) {
          setExtraSections(prev => prev.map(s => s.id === section.id ? { ...s, blocks: [...s.blocks, clone] } : s));
      } else if (ref.kind !== 'inline') {
          // Shared/sku refs can only live in project-only sections; ignore elsewhere.
          alert('Standardized blocks can only be pasted into a project section.');
      } else if (section.isPlaceholder) {
          editOverride(section, blocks => [...blocks, clone as InlineBlockRef]);
      } else {
          setSectionAdditions(prev => {
              const list = [...(prev[section.id] ?? [])];
              list.push({ id: `add-${Math.random().toString(36).slice(2, 11)}`, position: (section.blockRefs?.length ?? 0), block: clone as InlineBlockRef });
              return { ...prev, [section.id]: list };
          });
      }
  };
  const pasteIntoSection = (section: IMSection) => { if (clipboardBlock) appendBlockToSection(section, clipboardBlock); };

  // --- Bulk callout variant (#12): set the box style on every inline block in a section ---
  const setAllVariantsInSection = (section: IMSection, variant: CalloutVariant | undefined) => {
      if (isExtraSection(section)) {
          setExtraSections(prev => prev.map(s => s.id === section.id
              ? { ...s, blocks: s.blocks.map(b => b.kind === 'inline' ? { ...b, variant } : b) } : s));
      } else if (section.isPlaceholder) {
          editOverride(section, blocks => blocks.map(b => ({ ...b, variant })));
      } else {
          setSectionAdditions(prev => ({
              ...prev,
              [section.id]: (prev[section.id] ?? []).map(a => ({ ...a, block: { ...a.block, variant } })),
          }));
      }
  };

  // --- Local snippets (#12): save/reuse a block's content across projects (per browser) ---
  const persistSnippets = (next: { name: string; block: InlineBlockRef }[]) => {
      setSnippets(next);
      try { localStorage.setItem('im-block-snippets', JSON.stringify(next)); } catch { /* quota — ignore */ }
  };
  const saveBlockAsSnippet = (block: InlineBlockRef) => {
      const name = window.prompt('Save this block as a reusable snippet. Name:')?.trim();
      if (!name) return;
      persistSnippets([...snippets.filter(s => s.name !== name), { name, block: structuredClone(block) }]);
  };
  const deleteSnippet = (name: string) => persistSnippets(snippets.filter(s => s.name !== name));

  // --- Per-project overrides of individual inline template blocks ---
  // `refIsOverridable` / `refHasTable` live in im-content.utils.ts (pure + unit-tested).

  // Start a per-project edit of a template inline block: seed the override from the
  // template ref (deep-copied so edits never mutate the template), stored by the ref's
  // stable key (`ref:<id>`, or the legacy index for id-less refs — see blockOvKey).
  const editBlockForProject = (sectionId: string, key: string, ref: InlineBlockRef) => {
      setBlockOverrides(prev => ({
          ...prev,
          [sectionId]: { ...(prev[sectionId] ?? {}), [key]: { ...ref, content: { ...ref.content } } },
      }));
  };

  const updateBlockOverride = (sectionId: string, key: string, lang: string, html: string) => {
      setBlockOverrides(prev => {
          const cur = prev[sectionId]?.[key];
          if (!cur) return prev;
          return { ...prev, [sectionId]: { ...prev[sectionId], [key]: { ...cur, content: { ...cur.content, [lang]: html } } } };
      });
  };

  const setBlockOverrideVariant = (sectionId: string, key: string, variant: CalloutVariant | undefined) => {
      setBlockOverrides(prev => {
          const cur = prev[sectionId]?.[key];
          if (!cur) return prev;
          return { ...prev, [sectionId]: { ...prev[sectionId], [key]: { ...cur, variant } } };
      });
  };

  // Drop a block override → the section falls back to the template block. Removes both
  // the id key and the legacy positional key so a stale legacy entry can't resurrect it.
  const resetBlockOverride = (sectionId: string, keys: string[]) => {
      setBlockOverrides(prev => {
          const forSection = { ...(prev[sectionId] ?? {}) };
          for (const k of keys) delete forSection[k];
          const next = { ...prev };
          if (Object.keys(forSection).length) next[sectionId] = forSection; else delete next[sectionId];
          return next;
      });
  };

  // ---------------- EXPORT HELPERS ----------------

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

  // Canonical structured export: the same ResolvedManual that gets published to the
  // im-published bucket, so this download is byte-identical to the hosted file.
  // (An XML/InDesign export used to live here; it exported only legacy section content —
  // no blocks/overrides/additions — and was confirmed unused, so it was removed.)
  const handleExport = async () => {
      if (!project) return;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${project.name.replace(/\s+/g, '_')}_${activeLang}_${timestamp}.json`;

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
          sectionAdditions,
          extraSections,
          sectionOverrides,
          boundSkuIds,
          sectionSkus,
          blockOverrides,
      };
      const blocks = await getIMBlocks();
      const blocksById: Record<string, any> = {};
      for (const b of blocks) blocksById[b.id] = b;
      // Attribute definitions so section conditions resolve identically to the published file.
      const attributesById = allAttributes.reduce<Record<string, CategoryAttribute>>((m, a) => { m[a.id] = a; return m; }, {});
      const resolved = resolveManual(template, sections, blocksById, resolverIM, activeLang, projectSkus.map(s => ({ id: s.id, skuNumber: s.skuNumber })), attributesById);
      downloadData(JSON.stringify(resolved, null, 2), filename, 'application/json');
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
                 const label = decodePlaceholderLabel(el.getAttribute('data-label'), el.textContent ?? '', 'Image');

                 wrapper.className += " bg-indigo-50 text-indigo-600 px-3 py-2 text-xs font-bold border border-dashed border-indigo-300 hover:bg-indigo-100";
                 wrapper.innerHTML = `<span style="display:flex;align-items:center;gap:4px">🖼️ ${label}</span>`;
             }
          } else {
             if (val) {
                 wrapper.className += " border-b-2 border-indigo-100 hover:border-indigo-400 px-1 hover:bg-indigo-50";
                 wrapper.textContent = val;
             } else {
                 const label = decodePlaceholderLabel(el.getAttribute('data-label'), el.textContent ?? '', 'Text');

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
          const label = decodePlaceholderLabel(el.getAttribute('data-label'), el.textContent ?? '', type === 'text' ? 'Text Input' : 'Image Upload');

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

  // Load failure gets its own screen — NOT the template picker. Showing the picker here
  // read as "no draft exists yet"; picking a template and saving would then overwrite the
  // real (unloadable) draft with a fresh empty state.
  if (loadError) {
      return (
          <Layout>
              <div className="max-w-2xl mx-auto mt-16 bg-white p-8 rounded-xl border border-rose-200 shadow text-center">
                  <AlertCircle size={32} className="mx-auto text-rose-500 mb-3" />
                  <h1 className="text-xl font-bold text-gray-800 mb-2">Couldn't load this {typeLabel.toLowerCase()}</h1>
                  <p className="text-sm text-muted mb-1">{loadError}</p>
                  <p className="text-xs text-muted mb-6">
                      If a draft exists, it is untouched — this is a loading problem, not a missing manual.
                  </p>
                  <div className="flex justify-center gap-3">
                      <button onClick={() => navigate(`/project/${projectId}`)} className="px-4 py-2 border border-gray-300 text-gray-600 rounded-xl text-sm font-medium hover:bg-light">Back to project</button>
                      <button onClick={() => loadData()} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700"><RotateCcw size={15} /> Try again</button>
                  </div>
              </div>
          </Layout>
      );
  }

  if (!selectedTemplateId) {
      // Offer the PROJECT'S CATEGORY templates when any exist — picking another category's
      // template produces a wrong manual with no warning. Fall back to all templates only
      // when the category has none (with a note), and mark non-finalized templates.
      const categoryTemplates = templates.filter(t => t.categoryId === project?.categoryId);
      const templateChoices = categoryTemplates.length ? categoryTemplates : templates;
      const templateOptionLabel = (t: IMTemplate) =>
          `${t.name}${t.isFinalized ? '' : ' — DRAFT template (not finalized)'}`;
      return (
          <Layout>
              <div className="max-w-2xl mx-auto mt-10">
                  <h1 className="text-3xl font-bold text-primary mb-6">Generate {typeLabel}</h1>
                  <div className="bg-white p-8 rounded-xl border border-gray-200 shadow">
                      <label className="block font-medium text-gray-700 mb-2">Select a Template</label>
                      <select className="w-full p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500" onChange={handleTemplateSelect} defaultValue="">
                          <option value="" disabled>-- Choose a Template --</option>
                          {templateChoices.map(t => <option key={t.id} value={t.id}>{templateOptionLabel(t)}</option>)}
                      </select>
                      {!categoryTemplates.length && templates.length > 0 && (
                          <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                              No template exists for this project's category yet — the list shows templates from
                              OTHER categories. Double-check the choice, or create a category template first.
                          </p>
                      )}

                      {/* Start from a sibling project — copies the curated setup of a manual
                          already configured in this category (see handleCopyFromSibling). */}
                      {(() => {
                          const siblings = siblingIMs.filter(s =>
                              s.templateType === templateType
                              && s.projectId !== projectId
                              && !!project?.categoryId
                              && s.categoryId === project.categoryId);
                          if (!siblings.length) return null;
                          return (
                              <>
                                  <div className="flex items-center gap-3 my-5">
                                      <div className="flex-1 h-px bg-gray-100" />
                                      <span className="text-xs text-gray-400 uppercase tracking-wide">or</span>
                                      <div className="flex-1 h-px bg-gray-100" />
                                  </div>
                                  <label className="block font-medium text-gray-700 mb-2">Start from a sibling project</label>
                                  <div className="flex gap-2">
                                      <select
                                          className="flex-1 min-w-0 p-3 border border-gray-300 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                                          value={copySourceId}
                                          onChange={(e) => setCopySourceId(e.target.value)}
                                      >
                                          <option value="">-- Choose a project in this category --</option>
                                          {siblings.map(s => (
                                              <option key={s.id} value={s.projectId}>
                                                  {(s.projectCode ? `${s.projectCode} — ` : '') + s.projectName}
                                                  {s.version ? ` (v${s.version})` : ''} · {new Date(s.updatedAt).toLocaleDateString()}
                                              </option>
                                          ))}
                                      </select>
                                      <button
                                          onClick={handleCopyFromSibling}
                                          disabled={!copySourceId || copying}
                                          className="shrink-0 flex items-center gap-2 bg-indigo-600 text-white px-4 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-40"
                                      >
                                          {copying ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
                                          {copying ? 'Copying…' : 'Copy setup'}
                                      </button>
                                  </div>
                                  <label className="flex items-center gap-2 mt-2 text-xs text-gray-600 cursor-pointer">
                                      <input type="checkbox" checked={copyContent} onChange={(e) => setCopyContent(e.target.checked)} />
                                      Also copy the sibling's project text additions &amp; edited blocks
                                  </label>
                                  <p className="text-[11px] text-gray-400 mt-1.5">
                                      Copies condition &amp; visibility choices, language settings, attribute wiring and brand
                                      assets — never product values, SKU content, or SKU scoping. Review with the checklist
                                      before publishing; nothing is saved until you save.
                                  </p>
                              </>
                          );
                      })()}

                      <div className="flex items-center gap-3 my-5">
                          <div className="flex-1 h-px bg-gray-100" />
                          <span className="text-xs text-gray-400 uppercase tracking-wide">or</span>
                          <div className="flex-1 h-px bg-gray-100" />
                      </div>

                      <button
                          onClick={() => setShowImport(true)}
                          className="w-full flex items-center justify-center gap-2 border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-xl p-3 text-sm font-semibold transition-colors"
                      >
                          <FileJson size={16} /> Import from JSON (quick, template-free)
                      </button>
                      <p className="text-[11px] text-gray-400 mt-2">
                          Drops a reviewed <code>.import.json</code> straight into this project as an editable
                          manual — no category template needed.
                      </p>
                  </div>
              </div>
              {showImport && (
                  <ProjectImImportDialog
                      projectId={projectId!}
                      templateType={templateType}
                      onClose={() => setShowImport(false)}
                      onImported={() => { setShowImport(false); loadData(); }}
                  />
              )}
          </Layout>
      );
  }

  const metadata = normalizeIMTemplateMetadata(template?.metadata);
  const pageBackground = metadata.assets?.backgroundAssetUrl
    ? `url(${metadata.assets.backgroundAssetUrl}) center/cover no-repeat`
    : undefined;
  const watermark = metadata.assets?.watermarkAssetUrl
    ? `url(${metadata.assets.watermarkAssetUrl}) center/55% no-repeat`
    : undefined;

  // MUST mirror the resolver's isSectionVisible (im-resolver.ts) exactly — the preview is
  // WYSIWYG only if the two agree. In particular: a condition whose attribute has NO value
  // EXCLUDES the chapter (the resolver's rule); it used to include it here, which meant the
  // preview showed chapters the published output silently dropped.
  const isSectionVisible = (section: IMSection): boolean => {
    const override = sectionVisibility[section.id];
    if (override !== undefined) return override;
    if (!section.conditionFeatureId) return true;
    if (section.conditionFeatureId === 'manual') return true; // included unless explicitly hidden
    // PM edits (formData) win over submitted supplier values — same merge the resolver sees.
    const value = formData[section.conditionFeatureId] ?? submittedAttrValues[section.conditionFeatureId];
    if (value === undefined) return false; // no data → excluded, matching publish
    if (!section.conditionLabel || section.conditionLabel === 'any') return true;
    const attr = allAttributes.find(a => a.id === section.conditionFeatureId);
    if (!attr) return String(value) === section.conditionLabel;
    return matchesConditionValue(value, section.conditionLabel, attr);
  };

  // Toggle a per-project section hide. Hidden = sectionVisibility[id] === false (persisted
  // as secvis_<id>); toggling a hidden section back removes the override (reverts to default/
  // auto-condition). Works for any section — template, placeholder, or project.
  const toggleSectionHidden = (id: string) => {
    setSectionVisibility(prev => {
      if (prev[id] === false) { const next = { ...prev }; delete next[id]; return next; }
      return { ...prev, [id]: false };
    });
  };

  // Effective visibility for the preview/PDF: a section is shown only if it AND all of its
  // ancestors are visible — mirrors the resolver, which skips a hidden section's whole subtree.
  const isSectionEffectivelyVisible = (section: IMSection): boolean => {
    let current: IMSection | undefined = section;
    const seen = new Set<string>();
    while (current && !seen.has(current.id)) {
      if (!isSectionVisible(current)) return false;
      seen.add(current.id);
      const parentId = current.parentId ?? null;
      if (!parentId) break;
      const extra = extraSections.find(s => s.id === parentId);
      current = sections.find(s => s.id === parentId)
        ?? (extra ? ({ ...extra, templateId: '', isPlaceholder: false, content: {} } as IMSection) : undefined);
    }
    return true;
  };

  // Which excluded ancestor is keeping a section out, if any. The resolver returns early on a
  // hidden section and never walks its children, so a sub-section left on its default can
  // still be absent because a chapter above it was switched off — the Sections list names
  // that chapter instead of showing an unexplained "Left out".
  const excludedAncestorOf = (section: IMSection): IMSection | undefined => {
    const byId = new Map<string, IMSection & { __projectExtra?: true }>(
      [...sections, ...extraAsSections].map(s => [s.id, s]),
    );
    const ancestorId = findExcludedAncestor(
      section.id,
      id => byId.get(id)?.parentId ?? null,
      id => { const s = byId.get(id); return !!s && !isSectionVisible(s); },
    );
    return ancestorId ? byId.get(ancestorId) : undefined;
  };

  /**
   * Whether a chapter is actually rendered in the Live Preview right now. The preview is
   * WYSIWYG, so a chapter excluded by its condition or outside the bound SKU scope is omitted
   * entirely. Shared by the preview itself and the "Show in preview" controls so the two can
   * never disagree about what is on screen.
   */
  const isSectionInPreview = (section: IMSection): boolean =>
    isSectionEffectivelyVisible(section) && isSectionInSkuScope(section.id);

  /**
   * "Show in preview" control. Explicitly DISABLED with a reason when the chapter isn't in the
   * preview, rather than clicking to no effect — an excluded chapter is exactly the case a PM
   * needs explained, not silently swallowed.
   */
  const renderJumpToPreview = (section: IMSection, opts: { compact?: boolean } = {}) => {
    const inPreview = isSectionInPreview(section);
    const label = inPreview
      ? 'Show this chapter in the live preview'
      : "Not in the preview: excluded by its condition, hidden, or outside this manual's SKU scope";
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); jumpToPreviewSection(section.id); }}
        disabled={!inPreview}
        title={label}
        aria-label={opts.compact ? label : undefined}
        className={`flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none ${
          inPreview
            ? 'text-gray-500 hover:bg-indigo-50 hover:text-indigo-700'
            : 'cursor-not-allowed text-gray-400'
        }`}
      >
        <Crosshair size={12} aria-hidden="true" />
        {/* The label carries the state, not just the tooltip: a greyed-out "Show in preview"
            looks broken, whereas "Not in preview" explains itself at a glance. */}
        {!opts.compact && <span>{inPreview ? 'Show in preview' : 'Not in preview'}</span>}
      </button>
    );
  };

  // --- Per-chapter SKU scope (SKU-specific chapter variants) ---
  // The SKUs a chapter may be scoped to: the bound SKUs, or all project SKUs when unbound.
  const scopeCandidateSkus = (): ProjectSku[] => {
    if (!boundSkuIds.length) return projectSkus;
    const bound = new Set(boundSkuIds);
    return projectSkus.filter(s => bound.has(s.id));
  };

  // SKU numbers a chapter is scoped to, intersected with the bound SKUs. Empty = applies
  // to all (no "Applies to: …" header). Mirrors the resolver's resolveSkuScope.
  const sectionSkuNumbers = (sectionId: string): string[] => {
    const ids = sectionSkus[sectionId];
    if (!ids || ids.length === 0) return [];
    const bound = new Set(boundSkuIds.length ? boundSkuIds : projectSkus.map(s => s.id));
    const numById = new Map(projectSkus.map(s => [s.id, s.skuNumber]));
    return ids.filter(id => bound.has(id)).map(id => numById.get(id)).filter(Boolean) as string[];
  };

  // False only when a chapter is scoped to SKUs, none of which are bound (resolver hides it).
  const isSectionInSkuScope = (sectionId: string): boolean => {
    const ids = sectionSkus[sectionId];
    if (!ids || ids.length === 0) return true;
    const bound = new Set(boundSkuIds.length ? boundSkuIds : projectSkus.map(s => s.id));
    return ids.some(id => bound.has(id));
  };

  // "Applies to: …" badge HTML prepended to a section body in the preview + PDF, mirroring
  // the viewer's DocumentView header. Empty when the chapter applies to all SKUs.
  const sectionSkuHeaderHtml = (sectionId: string): string => {
    const nums = sectionSkuNumbers(sectionId);
    if (!nums.length) return '';
    // Inline styles (not a CSS class) so the badge renders identically in the on-screen
    // preview and the published/print HTML, the same way wrapBlockCallout inlines its styles.
    const style = 'display:inline-block;margin:0 0 10px;padding:3px 10px;border-radius:9999px;background:#0f172a;color:#fff;font-size:12px;font-weight:600;';
    return `<div class="im-sku-scope" style="${style}">${escapeXml(getAppliesToLabel(activeLang))}: ${escapeXml(nums.join(', '))}</div>`;
  };

  // Toggle a SKU in a chapter's scope. Removing the last one clears the key (= applies to all).
  const toggleSectionSku = (sectionId: string, skuId: string) => {
    setSectionSkus(prev => {
      const current = prev[sectionId] ?? [];
      const next = current.includes(skuId) ? current.filter(id => id !== skuId) : [...current, skuId];
      const out = { ...prev };
      if (next.length) out[sectionId] = next; else delete out[sectionId];
      return out;
    });
  };

  // --- Conditional inline rows + shared blocks ("Show if" conditions) ---
  // A ref carries a condition when it requires (or requires the absence of) an attribute.

  // Auto visibility from the feature gate, evaluated against the same merged data the
  // resolver sees (submitted supplier values as the base, PM edits in formData on top).
  const refAutoVisible = (ref: BlockRef): boolean => {
    // A placeholder inline row is opt-in: hidden by default until the PM includes it.
    if (ref.kind === 'inline' && (ref as InlineBlockRef).isPlaceholder) return false;
    return passesFeatureGate(ref as FeatureConditionFields, { ...submittedAttrValues, ...formData }, {});
  };

  // --- Stable override keys -----------------------------------------------------
  // Overrides on template block refs are keyed by the ref's stable id (`ref:<id>`,
  // assigned on template save) so that inserting/reordering blocks in the template can't
  // re-point a project's overrides onto different blocks. Refs saved before ids existed
  // fall back to the legacy positional `<sectionId>:<index>` key; a one-time migration
  // below moves legacy entries onto id keys as soon as the manual is opened unlocked.
  const refVisKey = (sectionId: string, index: number, ref: BlockRef): string =>
    ref.id ? `ref:${ref.id}` : `${sectionId}:${index}`;
  const blockOvKey = (index: number, ref: BlockRef): string =>
    ref.id ? `ref:${ref.id}` : String(index);
  const getBlockOverride = (sectionId: string, index: number, ref: BlockRef): InlineBlockRef | undefined =>
    blockOverrides[sectionId]?.[blockOvKey(index, ref)] ?? blockOverrides[sectionId]?.[String(index)];
  // The key the current override is actually stored under — the id key when present,
  // else the legacy positional key (still possible while a FINAL manual awaits migration).
  const blockOverrideKeyInUse = (sectionId: string, index: number, ref: BlockRef): string =>
    blockOverrides[sectionId]?.[blockOvKey(index, ref)] !== undefined ? blockOvKey(index, ref) : String(index);

  // Effective visibility: a manual Include/Exclude override wins; otherwise the gate.
  const isRefVisible = (sectionId: string, index: number, ref: BlockRef): boolean => {
    const override = refVisibility[refVisKey(sectionId, index, ref)] ?? refVisibility[`${sectionId}:${index}`];
    if (override !== undefined) return override;
    return refAutoVisible(ref);
  };

  // Has this project explicitly excluded a block? Checks both keyings (stable id first, then
  // the legacy positional key) so a pre-id override still reads as excluded.
  const isRefExcluded = (sectionId: string, index: number, ref: BlockRef): boolean =>
    (refVisibility[refVisKey(sectionId, index, ref)] ?? refVisibility[`${sectionId}:${index}`]) === false;

  /**
   * Exclude / put back a single template block — a dedicated Inline HTML row or a shared
   * library block — for THIS project only.
   *
   * Writes the same `refvis_` override the Optional & Conditional panel writes, which the
   * resolver already honors for ANY ref (im-resolver: `if (override === false) return null`),
   * so leaving out an unconditional block needed no engine change — only a way to say it.
   * This exists because a template block CANNOT be deleted from a project: it belongs to the
   * shared template, and removing it there would change every other manual. Project-authored
   * blocks are deleted instead, which is why they don't get this control.
   *
   * Putting a block back CLEARS the override instead of storing `true`, so a condition added
   * to the template later still applies rather than being pinned open by this project.
   */
  const toggleRefExcluded = (sectionId: string, index: number, ref: BlockRef) => {
    const key = refVisKey(sectionId, index, ref);
    const legacyKey = `${sectionId}:${index}`;
    const excluded = isRefExcluded(sectionId, index, ref);
    setRefVisibility(prev => {
      const next = { ...prev };
      // Clear both keyings before writing, so a legacy entry can't survive and win later.
      delete next[key];
      delete next[legacyKey];
      if (!excluded) next[key] = false;
      return next;
    });
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
    return variant ? wrapBlockCallout(variant, html, activeLang) : html;
  };

  const buildSectionHtml = (section: IMSection): string => {
    // A project-authored placeholder section: its override blocks fully replace the
    // template content (mirrors the resolver). Empty override = intentionally blank.
    const override = sectionOverrides[section.id];
    const refs = override ?? (section.blockRefs ?? []);
    const hasInlineRef = refs.some(r => r.kind === 'inline');
    const parts: string[] = [];
    // Lead with the "Applies to: …" SKU header when this chapter is scoped to SKUs.
    const skuHeader = sectionSkuHeaderHtml(section.id);
    if (skuHeader) parts.push(skuHeader);
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
      // Per-project inline block override (e.g. an edited table) replaces this template
      // inline ref. Not applied to section overrides (already the project's own content).
      const inlineOverride = !override ? getBlockOverride(section.id, i, ref) : undefined;
      const effRef: any = (ref.kind === 'inline' && inlineOverride) ? inlineOverride : ref;
      if (effRef.kind === 'inline') {
        const html = processContent(effRef.content?.[activeLang] || effRef.content?.['en'] || '');
        // A row variant wraps its whole content in the ISO callout box (matches the resolver).
        if (html) parts.push(effRef.variant ? wrapBlockCallout(effRef.variant, html, activeLang) : html);
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
          if (rawHtml) parts.push(wrapBlockCallout(blk.blockType, rawHtml, activeLang));
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

  // Hierarchical numbering + depth for every section, so the Setup tab's Sections list and
  // the Content tab's section tree name a section the same way ("2.3.").
  const sectionOutline = buildSectionOutline([...sections, ...extraAsSections]);

  // --- Project-content translation ---------------------------------------------
  // Only project-AUTHORED content is translated here (added/edited sections):
  // sectionAdditions, sectionOverrides, blockOverrides, and extraSections — each an
  // inline block carrying content[lang]. Template blockRefs / shared blocks arrive
  // pre-translated from the template editor and are never touched. English is the
  // source. Returns display gaps + deferred translate tasks that mutate fresh working
  // copies (committed only after the run) plus those copies for persistence.
  const buildTranslationPlan = (langs: string[], skipExisting: boolean) => {
    // Deep-ish copies so a mid-run failure never leaves torn state.
    const wAdditions: Record<string, ProjectBlockAddition[]> = {};
    for (const [sid, adds] of Object.entries(sectionAdditions)) {
      wAdditions[sid] = adds.map(a => ({ ...a, block: { ...a.block, content: { ...a.block.content } } }));
    }
    const wOverrides: Record<string, InlineBlockRef[]> = {};
    for (const [sid, refs] of Object.entries(sectionOverrides)) {
      wOverrides[sid] = refs.map(r => ({ ...r, content: { ...r.content } }));
    }
    const wBlockOverrides: Record<string, Record<string, InlineBlockRef>> = {};
    for (const [sid, byIdx] of Object.entries(blockOverrides)) {
      wBlockOverrides[sid] = {};
      for (const [idx, ref] of Object.entries(byIdx)) wBlockOverrides[sid][idx] = { ...ref, content: { ...ref.content } };
    }
    const wExtras: ProjectExtraSection[] = extraSections.map(ex => ({
      ...ex, blocks: ex.blocks.map(b => b.kind === 'inline' ? { ...b, content: { ...b.content } } : b),
    }));

    // sectionId → English title, for labelling gaps in the UI.
    const titleById = new Map<string, string>();
    for (const s of orderedSections) titleById.set(s.id, localizedSectionTitle(s, 'en'));

    const tasksByLang: Record<string, Array<() => Promise<void>>> = {};
    const gapsByLang: Record<string, Set<string>> = {};
    for (const lang of langs) { tasksByLang[lang] = []; gapsByLang[lang] = new Set(); }

    // A fragment is translatable when it has English prose; it's a gap for `lang`
    // when the target is blank (or always, in overwrite mode). Mirrors the template
    // editor's `needs(...)`.
    const consider = (
      content: Record<string, string>,
      sectionId: string,
      write: (lang: string, html: string) => void,
    ) => {
      const src = content?.['en'];
      if (!src || !src.trim()) return;
      const label = titleById.get(sectionId) ?? sectionId;
      for (const lang of langs) {
        if (skipExisting && content[lang]?.trim()) continue;
        gapsByLang[lang].add(label);
        // Marked with the EN source hash so the editor's language tabs can flag the
        // translation as stale if English is edited later (im-translation-marker.ts).
        tasksByLang[lang].push(async () => { write(lang, markTranslatedFromEn(await translateHtml(src, 'en', lang), src)); });
      }
    };

    for (const [sid, adds] of Object.entries(wAdditions)) {
      adds.forEach(a => consider(a.block.content, sid, (lang, html) => { a.block.content[lang] = html; }));
    }
    for (const [sid, refs] of Object.entries(wOverrides)) {
      refs.forEach(r => consider(r.content, sid, (lang, html) => { r.content[lang] = html; }));
    }
    for (const [sid, byIdx] of Object.entries(wBlockOverrides)) {
      Object.values(byIdx).forEach(r => consider(r.content, sid, (lang, html) => { r.content[lang] = html; }));
    }
    wExtras.forEach(ex => ex.blocks.forEach(b => { if (b.kind === 'inline') consider(b.content, ex.id, (lang, html) => { b.content[lang] = html; }); }));

    return { tasksByLang, gapsByLang, working: { wAdditions, wOverrides, wBlockOverrides, wExtras } };
  };

  // Upload any base64 images embedded in project-authored content to storage and
  // replace them with URLs, BEFORE persisting. Content is stored per language, so an
  // inline base64 image would otherwise be duplicated across every translation and can
  // bloat the row past the DB write timeout. Returns externalized copies of the four
  // overlay maps (a shared cache uploads each unique image only once).
  const externalizeOverlayImages = async (ov: {
    sectionAdditions: Record<string, ProjectBlockAddition[]>;
    sectionOverrides: Record<string, InlineBlockRef[]>;
    blockOverrides: Record<string, Record<string, InlineBlockRef>>;
    extraSections: ProjectExtraSection[];
  }): Promise<typeof ov> => {
    const cache = new Map<string, string>();
    const fixContent = async (content: Record<string, string>) => {
      const next: Record<string, string> = { ...content };
      for (const lang of Object.keys(next)) next[lang] = await externalizeHtmlImages(next[lang], cache, 'project');
      return next;
    };

    const sectionAdditions: Record<string, ProjectBlockAddition[]> = {};
    for (const [sid, adds] of Object.entries(ov.sectionAdditions)) {
      sectionAdditions[sid] = [];
      for (const a of adds) sectionAdditions[sid].push({ ...a, block: { ...a.block, content: await fixContent(a.block.content) } });
    }
    const sectionOverrides: Record<string, InlineBlockRef[]> = {};
    for (const [sid, refs] of Object.entries(ov.sectionOverrides)) {
      sectionOverrides[sid] = [];
      for (const r of refs) sectionOverrides[sid].push({ ...r, content: await fixContent(r.content) });
    }
    const blockOverrides: Record<string, Record<string, InlineBlockRef>> = {};
    for (const [sid, byIdx] of Object.entries(ov.blockOverrides)) {
      blockOverrides[sid] = {};
      for (const [idx, r] of Object.entries(byIdx)) blockOverrides[sid][idx] = { ...r, content: await fixContent(r.content) };
    }
    const extraSections: ProjectExtraSection[] = [];
    for (const ex of ov.extraSections) {
      const blocks: Array<InlineBlockRef | SharedBlockRef> = [];
      for (const b of ex.blocks) blocks.push(b.kind === 'inline' ? { ...b, content: await fixContent(b.content) } : b);
      extraSections.push({ ...ex, blocks });
    }
    return { sectionAdditions, sectionOverrides, blockOverrides, extraSections };
  };

  // Translate the project-authored content into `langs` (English excluded). Mirrors
  // the template editor's concurrency pool + progress + failure collection, then
  // commits the working overlays and persists them (same payload as Save Draft).
  const handleTranslateProject = async (langs: string[]) => {
    if (translating || !projectId || !selectedTemplateId) return;
    const targets = langs.filter(l => l !== 'en');
    if (!targets.length) return;

    const { tasksByLang, working } = buildTranslationPlan(targets, translateSkipExisting);
    const tasks = targets.flatMap(l => tasksByLang[l]);
    if (tasks.length === 0) {
      alert(translateSkipExisting
        ? 'Nothing to translate — the selected language(s) are up to date. Enable “Retranslate existing” to overwrite.'
        : 'Nothing to translate — no project-authored sections have English content yet.');
      return;
    }

    setTranslating(true);
    setTranslateProgress({ done: 0, total: tasks.length });
    const failures: string[] = [];
    let done = 0;
    const CONCURRENCY = 4;
    let cursor = 0;
    const runner = async () => {
      while (cursor < tasks.length) {
        const t = tasks[cursor++];
        try { await t(); } catch (e: any) { failures.push(e?.message || 'a fragment failed'); }
        done += 1;
        setTranslateProgress({ done, total: tasks.length });
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, runner));

      // Externalize base64 images to storage first (formData + overlay content), so the
      // persisted row stays small — content is stored per language, so an inline image would
      // be duplicated across every translation and bloat the row past the DB write timeout.
      const cache = new Map<string, string>();
      const extForm = await externalizeFormDataImages(formData, cache);
      setFormData(extForm);
      const ext = await externalizeOverlayImages({
        sectionAdditions: working.wAdditions,
        sectionOverrides: working.wOverrides,
        blockOverrides: working.wBlockOverrides,
        extraSections: working.wExtras,
      });
      // Commit UI state, then persist directly with the externalized copies (state is async).
      setSectionAdditions(ext.sectionAdditions);
      setSectionOverrides(ext.sectionOverrides);
      setBlockOverrides(ext.blockOverrides);
      setExtraSections(ext.extraSections);
      try {
        const saved = await saveProjectIM(
          projectId, selectedTemplateId, buildPlaceholderData(extForm), 'draft', skuContent, templateType,
          ext.sectionAdditions, ext.extraSections, ext.sectionOverrides, undefined, boundSkuIds, sectionSkus, ext.blockOverrides,
          { baselineUpdatedAt: instance?.updatedAt ?? null },
        );
        setInstance(saved);
        markSaved({ formData: extForm, sectionAdditions: ext.sectionAdditions, sectionOverrides: ext.sectionOverrides, blockOverrides: ext.blockOverrides, extraSections: ext.extraSections });
      } catch (e) {
        console.error(e);
        if (e instanceof ProjectIMConflictError) setSaveConflict({ at: e.lastUpdatedAt, by: e.lastUpdatedBy });
        failures.push('Failed to save translations. Your work is backed up locally on this device.');
      }

      if (failures.length) {
        alert(`Translated ${tasks.length - failures.length}/${tasks.length} fragment(s). ${failures.length} left untranslated:\n\n${failures.slice(0, 8).join('\n')}${failures.length > 8 ? '\n…' : ''}`);
      }
    } finally {
      setTranslating(false);
    }
  };

  // Attributes selectable for this project (its category + global attributes).
  const projectAttributes = project?.categoryId
    ? getAttributesForCategory(allAttributes, project.categoryId)
    : allAttributes;

  // --- Per-project required languages ------------------------------------------
  // A project produces a subset of the template's languages (English always
  // included as source/fallback), in either the template's own order or a custom
  // order the PM sets below (e.g. "German, English, French, Italian, then others").
  // Persisted as `__required_languages` (membership) + `__language_order` (display/
  // publish order) in formData; both absent = all template languages, template order.
  // Drives the editor tabs, preview dropdown, pre-publish checklist, print export
  // language list, and what gets published — see getProjectRequiredLanguages, the
  // single source of truth this mirrors so publish/print never disagree with the editor.
  const templateLangs = template?.languages || ['en'];
  const requiredLanguages = template ? getProjectRequiredLanguages(template, formData) : ['en'];

  // What this project is ALLOWED to pick from — mirrors getProjectRequiredLanguages,
  // which is what publish/print/staleness actually enforce.
  //   • Category template → its own languages. Its section content exists in no others,
  //     so a project can only narrow the list; widening happens in the template editor.
  //   • Blank template (category-less, no sections — a project-based import or a manual
  //     built entirely in the project) → the full canonical list, because every fragment
  //     is project-authored and can be translated right here.
  const projectOwnsLanguages = !!template && !template.categoryId;
  const languagePool = projectOwnsLanguages ? IM_LANGUAGE_CODES : templateLangs;
  const languageOptions = IM_TEMPLATE_LANGUAGE_OPTIONS.filter(o => languagePool.includes(o.code));

  // Persist a membership + order pair. `next` is the wanted set (any order); membership is
  // stored canonically (English implicit) and the PM's existing custom order is preserved
  // for surviving languages, with newly added ones appended ("then others").
  const setRequiredLanguages = (next: string[]) => {
    const enabled = orderIMLanguages(next, languagePool);
    handleInputChange('__required_languages', JSON.stringify(enabled.filter(l => l !== 'en')));
    const kept = requiredLanguages.filter(l => enabled.includes(l));
    const order = [...kept, ...enabled.filter(l => !kept.includes(l))];
    handleInputChange('__language_order', JSON.stringify(order));
    if (!order.includes(activeLang)) setActiveLang('en');
  };

  const toggleRequiredLanguage = (code: string) => {
    if (code === 'en') return; // English is always required (source/fallback).
    setRequiredLanguages(requiredLanguages.includes(code)
      ? requiredLanguages.filter(l => l !== code)
      : [...requiredLanguages, code]);
  };

  const openLangModal = () => {
    if (locked) return; // manual is FINAL — unlock first
    setLangDraft(requiredLanguages);
    setIsLangModalOpen(true);
  };

  const handleSaveProjectLanguages = () => {
    setRequiredLanguages(langDraft);
    setIsLangModalOpen(false);
  };

  // Move a required language up/down in the custom display/publish order. Persists
  // the FULL resulting order (not just the moved pair) so it stays authoritative
  // even if some entries were previously implied by template order.
  const moveRequiredLanguage = (code: string, direction: 'up' | 'down') => {
    const idx = requiredLanguages.indexOf(code);
    const swapWith = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapWith < 0 || swapWith >= requiredLanguages.length) return;
    const next = [...requiredLanguages];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    handleInputChange('__language_order', JSON.stringify(next));
  };

  // Language list for the project content editor (one tab per REQUIRED language).
  const editorLanguages = requiredLanguages.map(c => ({ code: c, label: c.toUpperCase() }));

  // Languages this project produces (minus English, the source) and a display-only
  // gap map for the translation badge/modal.
  const otherRequiredLangs = requiredLanguages.filter(l => l !== 'en');
  const translationGaps = buildTranslationPlan(otherRequiredLangs, true).gapsByLang;
  const untranslatedSectionLabels = (() => {
    const s = new Set<string>();
    Object.values(translationGaps).forEach(set => set.forEach(l => s.add(l)));
    return s;
  })();

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

  // --- Pre-publish issues ------------------------------------------------------
  // What is missing, as structured issues that each know WHERE they are fixed (see
  // publish-issues.ts): unfilled input values and required SKU slots (both shared across
  // languages), conditional chapters the data leaves out, and per-language content gaps.
  // Rebuilt on every render while the review panel is open, so an item disappears as soon
  // as it is fixed instead of going stale behind the operator's back.
  const buildPublishIssues = (): PublishIssue[] => {
    const issues: PublishIssue[] = [];
    const seen = new Set<string>();

    // Hard requirement: an IM must be bound to at least one SKU (and the project must have one).
    const boundCount = boundSkuIds.length ? projectSkus.filter(s => boundSkuIds.includes(s.id)).length : projectSkus.length;
    if (projectSkus.length === 0) {
      issues.push({
        key: 'blocking:no-project-sku',
        kind: 'blocking',
        label: 'This project has no SKUs.',
        detail: 'Add at least one SKU to the project, then bind it to this manual.',
        // Fixed on the project page, not in this editor — the panel renders it as plain text.
        target: null,
      });
    } else if (boundCount === 0) {
      issues.push({
        key: 'blocking:no-bound-sku',
        kind: 'blocking',
        label: 'No SKU is bound to this manual.',
        detail: 'Select at least one under “Bound SKUs”.',
        target: { pane: 'fill', anchor: fillAnchors.skuBinding },
      });
    }

    for (const section of orderedSections) {
      if (!isSectionEffectivelyVisible(section)) continue;
      const secTitle = localizedSectionTitle(section, 'en');
      const { items, attrTokens } = collectSectionInputs(section, 'en');
      // Placeholder values + value-conditions are filled once and shared across languages.
      for (const it of items) {
        if (it.kind === 'condition' && !it.always) continue; // visibility toggles, not required values
        if (seen.has(it.id)) continue;
        seen.add(it.id);
        if (!(formData[it.id] || submittedAttrValues[it.id])) {
          issues.push({
            key: `value:${it.id}`,
            kind: 'value',
            label: it.label || it.id,
            sectionTitle: secTitle,
            target: { pane: 'fill', anchor: fillAnchors.value(it.id) },
          });
        }
      }
      for (const tok of attrTokens) {
        if (seen.has(tok)) continue;
        seen.add(tok);
        if (!(formData[tok] || submittedAttrValues[tok])) {
          const attr = allAttributes.find(a => a.id === tok);
          issues.push({
            key: `value:${tok}`,
            kind: 'value',
            label: attr?.name ?? tok,
            sectionTitle: secTitle,
            target: { pane: 'fill', anchor: fillAnchors.value(tok) },
          });
        }
      }
      // Required SKU slots.
      for (const ref of (section.blockRefs ?? [])) {
        if (ref.kind === 'sku_slot' && ref.required && !skuContent[ref.slot]) {
          issues.push({
            key: `slot:${section.id}:${ref.slot}`,
            kind: 'slot',
            label: ref.label?.en ?? ref.slot,
            sectionTitle: secTitle,
            target: { pane: 'fill', anchor: fillAnchors.slot(ref.slot) },
          });
        }
      }
    }

    // Conditional chapters whose attribute has no value and no explicit Include/Exclude
    // choice: they are LEFT OUT of the published output (resolver rule). Listed here so a
    // missing supplier value can never silently drop a chapter the operator expected.
    for (const section of orderedSections) {
      if (!section.conditionFeatureId || section.conditionFeatureId === 'manual' || !section.conditionLabel) continue;
      if (sectionVisibility[section.id] !== undefined) continue; // explicit choice made
      const v = formData[section.conditionFeatureId] ?? submittedAttrValues[section.conditionFeatureId];
      if (v === undefined) {
        const attr = allAttributes.find(a => a.id === section.conditionFeatureId);
        issues.push({
          key: `cond:${section.id}`,
          kind: 'condition',
          label: localizedSectionTitle(section, 'en'),
          detail: `“${attr?.name ?? section.conditionFeatureId}” has no value yet — the chapter is left out`,
          target: { pane: 'fill', anchor: fillAnchors.condition(section.id) },
        });
      }
    }

    // Per-language content gaps: anything authored in English but blank in another
    // REQUIRED language (non-required languages aren't part of this project's manual).
    // Keyed by chapter rather than by title, so each row can open THAT chapter in THAT
    // language — which is the only place the gap can be closed.
    for (const lang of requiredLanguages.filter(l => l !== 'en')) {
      const missing = new Set<string>();
      for (const section of orderedSections) {
        if (!isSectionEffectivelyVisible(section)) continue;
        const refs = sectionOverrides[section.id] ?? section.blockRefs ?? [];
        const hasInlineRef = refs.some(r => r.kind === 'inline');
        if (!hasInlineRef && section.content['en']?.trim() && !section.content[lang]?.trim()) {
          missing.add(section.id);
        }
        refs.forEach((ref, i) => {
          if ((ref.kind === 'inline' || ref.kind === 'block') && !isRefVisible(section.id, i, ref)) return;
          if (ref.kind === 'inline') {
            if ((ref as any).content?.['en']?.trim() && !(ref as any).content?.[lang]?.trim()) missing.add(section.id);
          } else if (ref.kind === 'block') {
            const blk = availableBlocks[(ref as any).block_id];
            if (blk?.content['en']?.trim() && !blk.content[lang]?.trim()) missing.add(section.id);
          }
        });
      }
      for (const sectionId of missing) {
        const section = orderedSections.find(s => s.id === sectionId);
        issues.push({
          key: `tr:${lang}:${sectionId}`,
          kind: 'translation',
          lang,
          label: section ? localizedSectionTitle(section, 'en') : sectionId,
          target: { pane: 'content', sectionId, lang },
        });
      }
    }

    return issues;
  };

  /**
   * Act on a click in the review panel: put the editor on the thing the issue is about.
   *
   * A translation gap goes to the "Add content" tab with that chapter selected AND that
   * language active — both, because editing the chapter in English would not close the gap.
   * Everything else lives in the "Fill values" form and is reached by its anchor (see the
   * retry effect up with the hooks).
   */
  const jumpToIssue = (issue: PublishIssue) => {
    setActiveIssueKey(issue.key);
    const target = issue.target;
    if (!target) return;
    if (target.pane === 'content') {
      setActiveLang(target.lang);
      setEditorMode('content');
      setSelectedContentSectionId(target.sectionId);
      setTranslationFocus(prev => ({
        sectionId: target.sectionId,
        lang: target.lang,
        token: (prev?.token ?? 0) + 1,
      }));
      return;
    }
    setEditorMode('fill');
    setPendingJump({ anchor: target.anchor, tries: 0 });
  };

  /**
   * Language the inline rows of the chapter on screen should open on, when the review panel
   * sent the operator here to fill it. Undefined for any other chapter, so a row's own
   * language tab keeps working the way it always has.
   */
  const focusRowLang = translationFocus && translationFocus.sectionId === selectedContentSectionId
    ? translationFocus.lang
    : undefined;

  /** Marks an element in the "Fill values" form as a jump target for the review panel. */
  const fillAnchorProps = (anchor: string) => ({ [FILL_ANCHOR_ATTR]: anchor });

  /** Classes that flash a jump target briefly after landing on it, so the eye finds it. */
  const fillFlashCls = (anchor: string) =>
    flashAnchor === anchor ? ' rounded-lg ring-2 ring-indigo-400 ring-offset-2 transition-shadow' : '';


  // Publish entry point. If the manual is already published and nothing changed since
  // (no unsaved edits + the published content hashes still match a re-resolve), don't
  // publish again — show the existing files and require explicit confirmation instead.
  // Otherwise continue to the checklist.
  const handlePublishClick = async () => {
    if (isBusy || !project) return;
    const hasUnsavedEdits = savedSnapshotRef.current !== null && serializeDraft() !== savedSnapshotRef.current;
    if (instance?.status === 'generated' && !hasUnsavedEdits) {
      setCheckingChanges(true);
      try {
        const reasons = await getProjectIMStaleReasons(project.id, templateType);
        if (!reasons.length) {
          const renders = await getPrintRenders(project.id, templateType);
          setNoChangesPrompt({
            manifestUrl: getPublishedManifestUrl(project.id, templateType),
            lastRender: renders[0] ?? null,
          });
          return;
        }
      } catch (e) {
        // Change detection is best-effort — on failure fall through to a normal publish.
        console.error('Publish change-check failed; proceeding to publish.', e);
      } finally {
        setCheckingChanges(false);
      }
    }
    proceedToChecklist();
  };

  // Review step (2nd stage of Publish): if anything's missing (or blocked), hand the publish
  // over to the docked review panel; otherwise publish straight away.
  //
  // An undecided regulatory checklist item opens the panel too -- that IS the pre-publish
  // review, and it would be pointless to add a checklist nobody is ever shown. Once every
  // item is decided the panel stops opening for that reason, so re-publishing a manual whose
  // checklist is settled is still one click.
  const proceedToChecklist = () => {
    const issues = buildPublishIssues();
    const regOpen = summarizeChecklist(regChecklist, regChecklistState).open;
    if (issues.length || regOpen > 0) {
      setReviewPanel({ armed: true });
      setReviewCollapsed(false);
    } else {
      handleGenerate();
    }
  };

  // Open the print-export dialog for the ALREADY-published version without republishing.
  // The publish-result payload is rebuilt from the deterministic storage layout
  // ({projectId}/{templateType}/{lang}.json), so no publish round-trip is needed.
  const openPrintDialog = (intent: 'print' | 'review') => {
    if (!project || !instance) return;
    const manifestUrl = getPublishedManifestUrl(project.id, templateType) ?? '';
    setPublishResult({
      manifestUrl,
      manifestPath: `${project.id}/${templateType}/manifest.json`,
      languages: requiredLanguages.map(language => ({
        language,
        url: manifestUrl.replace(/manifest\.json(\?.*)?$/, `${language}.json$1`),
        storagePath: `${project.id}/${templateType}/${language}.json`,
        contentHash: '',
        warnings: [],
      })),
    });
    setNoChangesPrompt(null);
    setPrintIntent(intent);
    setShowPrintDialog(true);
  };

  const openPrintForPublished = () => openPrintDialog('print');
  /** Open the dialog on the "Send for review" job — the Markup.io round leads. */
  const openPrintForReview = () => openPrintDialog('review');

  // Read-only HTML for a single template block ref (shown as a locked card in the
  // content editor). Mirrors buildSectionHtml's per-ref rendering.
  const templateRefPreviewHtml = (ref: any): string => {
    if (ref.kind === 'inline') return renderInlineHtml(ref.content, ref.variant);
    if (ref.kind === 'block') {
      const blk = availableBlocks[ref.block_id];
      if (!blk) return '';
      const baseHtml = processContent(blk.content[activeLang] || blk.content['en'] || '');
      const rawHtml = baseHtml.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => formData[k.trim()] ?? submittedAttrValues[k.trim()] ?? `{{${k.trim()}}}`);
      return rawHtml ? wrapBlockCallout(blk.blockType, rawHtml, activeLang) : '';
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

  // A "+ Duplicate chapter" button — copies this chapter into an editable project
  // chapter placed right after it, for authoring a SKU-specific variant.
  const renderDuplicateChapterButton = (section: IMSection) => (
    <button
      onClick={() => duplicateChapter(section)}
      className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-sky-600 border border-dashed border-sky-300 rounded hover:bg-sky-50 hover:text-sky-700 transition-colors"
    ><Boxes size={12} /> Duplicate this chapter for specific SKUs</button>
  );

  // Per-chapter SKU scope selector: pick which of the IM's SKUs this chapter applies
  // to. None selected = applies to all (no "Applies to: …" header). Hidden for
  // single-SKU manuals, where per-SKU variants are meaningless.
  const renderSkuScopeSelector = (sectionId: string) => {
    const candidates = scopeCandidateSkus();
    if (candidates.length <= 1) return null;
    const selected = new Set(sectionSkus[sectionId] ?? []);
    return (
      <div className="mt-3 border border-sky-100 rounded-lg bg-sky-50/40 px-2.5 py-2">
        <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-sky-600 mb-1.5">
          <Boxes size={11} /> Applies to SKUs
        </div>
        <div className="flex flex-wrap gap-1.5">
          {candidates.map(sku => {
            const on = selected.has(sku.id);
            return (
              <button
                key={sku.id}
                onClick={() => toggleSectionSku(sectionId, sku.id)}
                title={sku.skuTitle || sku.skuNumber}
                className={`px-2 py-0.5 rounded-full text-[11px] font-medium border transition-colors ${on ? 'bg-sky-600 text-white border-sky-600' : 'bg-white text-gray-600 border-gray-200 hover:border-sky-300'}`}
              >{sku.skuNumber}</button>
            );
          })}
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5">{selected.size === 0 ? 'Applies to all SKUs (no header shown).' : 'Shown as an “Applies to: …” header on the final IM.'}</p>
      </div>
    );
  };

  // Editable card for one project-authored inline block.
  const renderAdditionEditor = (
    block: InlineBlockRef,
    opts: { onChange: (lang: string, html: string) => void; onVariant: (v: CalloutVariant | undefined) => void; onRemove: () => void; onUp?: () => void; onDown?: () => void; onDuplicate?: () => void; onCopy?: () => void; onSaveSnippet?: () => void; rowKey: string; dnd?: { handleProps: object; dropProps: object; dragging: boolean; over: boolean } },
  ) => (
    <div {...(opts.dnd?.dropProps ?? {})} className={`border border-indigo-200 rounded-lg bg-indigo-50/40 transition-shadow ${opts.dnd?.dragging ? 'opacity-50' : ''} ${opts.dnd?.over ? 'ring-2 ring-indigo-300' : ''}`}>
      <div className="flex items-center justify-between px-2 py-1 border-b border-indigo-100">
        <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-500 flex items-center gap-1"><FilePlus2 size={11} /> Project content</span>
        <div className="flex items-center gap-1">
          {opts.dnd && <span {...opts.dnd.handleProps} title="Drag to reorder" className="cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-indigo-600"><GripVertical size={13} /></span>}
          {opts.onUp && <button onClick={opts.onUp} title="Move up" className="p-1 text-gray-400 hover:text-indigo-600"><ChevronUp size={13} /></button>}
          {opts.onDown && <button onClick={opts.onDown} title="Move down" className="p-1 text-gray-400 hover:text-indigo-600"><ChevronDown size={13} /></button>}
          {opts.onCopy && <button onClick={opts.onCopy} title="Copy block (paste into another section)" className="p-1 text-gray-400 hover:text-indigo-600"><ClipboardCopy size={13} /></button>}
          {opts.onSaveSnippet && <button onClick={opts.onSaveSnippet} title="Save as reusable snippet" className="p-1 text-gray-400 hover:text-indigo-600"><Bookmark size={13} /></button>}
          {opts.onDuplicate && <button onClick={opts.onDuplicate} title="Duplicate" className="p-1 text-gray-400 hover:text-indigo-600"><Copy size={13} /></button>}
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
        enableTranslate
        focusLang={focusRowLang}
        focusToken={translationFocus?.token}
      />
    </div>
  );

  // Read-only card for a standardized (shared) block referenced in a project section.
  // Shared blocks are approval-gated, so they render locked (edit them in the Block
  // Library); the resolver pulls their current content at publish time.
  const renderSharedBlockCard = (
    ref: SharedBlockRef,
    opts: { onRemove: () => void; onUp?: () => void; onDown?: () => void; onDuplicate?: () => void; onCopy?: () => void; dnd?: { handleProps: object; dropProps: object; dragging: boolean; over: boolean } },
  ) => {
    const meta = blockLibrary.find(b => b.id === ref.block_id);
    const html = templateRefPreviewHtml(ref);
    return (
      <div {...(opts.dnd?.dropProps ?? {})} className={`border border-amber-200 rounded-lg bg-amber-50/40 transition-shadow ${opts.dnd?.dragging ? 'opacity-50' : ''} ${opts.dnd?.over ? 'ring-2 ring-indigo-300' : ''}`}>
        <div className="flex items-center justify-between px-2 py-1 border-b border-amber-100">
          <span className="text-[10px] font-bold uppercase tracking-wide text-amber-600 flex items-center gap-1">
            <Lock size={11} /> Standardized block{meta?.title ? `: ${meta.title}` : ''}
          </span>
          <div className="flex items-center gap-1">
            {opts.dnd && <span {...opts.dnd.handleProps} title="Drag to reorder" className="cursor-grab active:cursor-grabbing p-1 text-gray-400 hover:text-indigo-600"><GripVertical size={13} /></span>}
            {opts.onUp && <button onClick={opts.onUp} title="Move up" className="p-1 text-gray-400 hover:text-indigo-600"><ChevronUp size={13} /></button>}
            {opts.onDown && <button onClick={opts.onDown} title="Move down" className="p-1 text-gray-400 hover:text-indigo-600"><ChevronDown size={13} /></button>}
            {opts.onCopy && <button onClick={opts.onCopy} title="Copy block (paste into another section)" className="p-1 text-gray-400 hover:text-indigo-600"><ClipboardCopy size={13} /></button>}
            {opts.onDuplicate && <button onClick={opts.onDuplicate} title="Duplicate" className="p-1 text-gray-400 hover:text-indigo-600"><Copy size={13} /></button>}
            <button onClick={opts.onRemove} title="Remove" className="p-1 text-gray-400 hover:text-rose-600"><Trash2 size={13} /></button>
          </div>
        </div>
        {html
          ? <div className="im-content p-3 text-sm pointer-events-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />
          : <div className="p-3 text-xs text-gray-400 italic">No content for {activeLang.toUpperCase()} (or the block was removed from the library).</div>}
      </div>
    );
  };

  // Editor pane for ONE selected section (extracted from the old flat list). Handles the
  // Section-level authoring actions shared across section types (#11 paste, #12 bulk box + snippets).
  const renderSectionActions = (section: IMSection) => (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      {clipboardBlock && (
        <button onClick={() => pasteIntoSection(section)} title="Paste the copied block here" className="flex items-center gap-1 py-1 px-2 text-[11px] font-medium text-indigo-600 border border-indigo-200 rounded hover:bg-indigo-50">
          <ClipboardPaste size={12} /> Paste block
        </button>
      )}
      <div className="flex items-center gap-1 text-[11px] text-gray-500">
        <span>Set all boxes:</span>
        <select
          value=""
          onChange={(e) => { if (e.target.value) setAllVariantsInSection(section, e.target.value === 'none' ? undefined : e.target.value as CalloutVariant); e.target.selectedIndex = 0; }}
          className="border border-gray-200 rounded px-1 py-0.5 bg-white text-gray-600 text-[11px]"
        >
          <option value="">Choose…</option>
          <option value="none">No box (plain)</option>
          {CALLOUT_VARIANTS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
      </div>
      <div className="relative">
        <button onClick={() => setShowSnippetsFor(showSnippetsFor === section.id ? null : section.id)} className="flex items-center gap-1 py-1 px-2 text-[11px] font-medium text-gray-600 border border-gray-200 rounded hover:bg-light">
          <Bookmark size={12} /> Snippets{snippets.length ? ` (${snippets.length})` : ''}
        </button>
        {showSnippetsFor === section.id && (
          <div className="absolute z-30 mt-1 w-60 bg-white border border-gray-200 rounded-lg shadow-xl py-1 max-h-64 overflow-y-auto">
            {snippets.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-gray-400 italic">No snippets yet. Use the bookmark icon on a block to save one.</p>
            ) : snippets.map(sn => (
              <div key={sn.name} className="flex items-center justify-between px-2 py-1 hover:bg-light">
                <button onClick={() => { appendBlockToSection(section, structuredClone(sn.block)); setShowSnippetsFor(null); }} className="flex-1 text-left text-xs text-gray-700 truncate" title={`Insert "${sn.name}"`}>{sn.name}</button>
                <button onClick={() => deleteSnippet(sn.name)} title="Delete snippet" className="p-1 text-gray-300 hover:text-rose-600"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  /**
   * Per-block inclusion control for ONE template block ref (a dedicated Inline HTML row, a
   * shared library block, or a table).
   *
   * Template blocks can't be deleted from a project, so "leave this one out" was previously
   * only expressible for blocks the template author had marked conditional or optional —
   * anything else was all-or-nothing at the chapter level. The override written here is the
   * same `refvis_` key the Optional & Conditional panel writes, and the resolver already
   * honors it for every ref kind, so the preview, the published JSON and the print export
   * all follow immediately.
   *
   * Two shapes, because they are two different decisions:
   *  • no template rule → a plain Exclude / Put back toggle, quiet until hovered so a chapter
   *    of thirty blocks isn't thirty competing buttons;
   *  • conditional or optional → the full Auto/Include/Exclude control, always visible, since
   *    a decision is genuinely owed and Auto is a real third state here.
   */
  const renderRefIncludeControl = (section: IMSection, ref: BlockRef, index: number): React.ReactNode => {
    // A SKU slot renders per-SKU content and has no visibility override in the resolver;
    // offering one here would be a control that does nothing.
    if (ref.kind === 'sku_slot') return null;
    const excluded = isRefExcluded(section.id, index, ref);
    const optional = ref.kind === 'inline' && !!(ref as InlineBlockRef).isPlaceholder;
    const conditional = refHasCondition(ref);
    const label = refHasTable(ref) ? 'table' : ref.kind === 'block' ? 'standardized block' : 'block';

    if (conditional || optional) {
      const key = refVisKey(section.id, index, ref);
      const override = refVisibility[key] ?? refVisibility[`${section.id}:${index}`];
      return (
        <div className="mb-0.5 flex items-center justify-end gap-2">
          <span className="mr-auto text-[10px] font-medium uppercase tracking-wide text-gray-400">
            {optional ? 'Optional block' : 'Conditional block'}
          </span>
          <IncludeModeControl
            value={modeOf(override)}
            ariaLabel={`Inclusion for this ${label} in ${localizedSectionTitle(section, activeLang)}`}
            onChange={mode => setRefVisibility(prev => {
              const next = { ...prev };
              delete next[key];
              delete next[`${section.id}:${index}`];
              if (mode !== 'auto') next[key] = mode === 'include';
              return next;
            })}
          />
        </div>
      );
    }

    return (
      <div className="mb-0.5 flex items-center justify-end gap-2">
        {excluded && (
          <span className="mr-auto inline-flex items-center gap-1 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
            <EyeOff size={10} /> Left out of this manual
          </span>
        )}
        <button
          type="button"
          onClick={() => toggleRefExcluded(section.id, index, ref)}
          title={excluded
            ? `Put this ${label} back into this manual`
            : `Leave this ${label} out of this manual — the shared template keeps it`}
          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-opacity motion-reduce:transition-none ${
            excluded
              ? 'text-indigo-600 hover:bg-indigo-50'
              : 'text-gray-400 opacity-0 hover:bg-gray-100 hover:text-gray-700 group-hover/ref:opacity-100 focus-visible:opacity-100'
          }`}
        >
          {excluded ? <><Eye size={11} /> Put back</> : <><EyeOff size={11} /> Exclude</>}
        </button>
      </div>
    );
  };

  // three kinds — project/extra, placeholder, and locked template — plus a hidden banner.
  const renderSectionContentEditor = (section: IMSection & { __projectExtra?: true }) => {
    const isExtra = (section as any).__projectExtra === true;
    const refs = section.blockRefs ?? [];
    const additions = [...(sectionAdditions[section.id] ?? [])].sort((a, b) => a.position - b.position);
    const hidden = sectionVisibility[section.id] === false;

    const hiddenBanner = hidden ? (
      <div className="mb-3 flex items-center justify-between gap-2 bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-600">
        <span className="flex items-center gap-1.5"><EyeOff size={13} /> Hidden for this project — it won't appear in the generated IM.</span>
        <button onClick={() => toggleSectionHidden(section.id)} className="flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-700"><Eye size={13} /> Show</button>
      </div>
    ) : null;

    if (isExtra) {
      const extra = extraSections.find(e => e.id === section.id);
      if (!extra) return null;
      return (
        <div className={hidden ? 'opacity-60' : ''}>
          {hiddenBanner}
          <div className="border border-emerald-200 rounded-xl p-3 bg-emerald-50/30">
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
              {extra.blocks.map((block, idx) => {
                const onUp = idx > 0 ? () => moveExtraBlock(extra.id, idx, -1) : undefined;
                const onDown = idx < extra.blocks.length - 1 ? () => moveExtraBlock(extra.id, idx, 1) : undefined;
                return (
                  <div key={`${extra.id}-${idx}`}>
                    {block.kind === 'inline'
                      ? renderAdditionEditor(block, {
                          rowKey: `${extra.id}-${idx}`,
                          onChange: (lang, html) => updateExtraBlock(extra.id, idx, lang, html),
                          onVariant: (v) => setExtraBlockVariant(extra.id, idx, v),
                          onRemove: () => requestDeleteBlock(isInlineBlockEmpty(block), () => removeExtraBlock(extra.id, idx)),
                          onDuplicate: () => duplicateExtraBlock(extra.id, idx),
                          onCopy: () => setClipboardBlock(block),
                          onSaveSnippet: () => saveBlockAsSnippet(block),
                          onUp, onDown,
                          dnd: { handleProps: blockDnd.handleProps(extra.id, idx), dropProps: blockDnd.dropProps(extra.id, idx), dragging: blockDnd.isDragging(extra.id, idx), over: blockDnd.isOver(extra.id, idx) },
                        })
                      : renderSharedBlockCard(block, { onRemove: () => setPendingConfirm({ title: 'Remove this block?', message: 'This removes the standardized block from this section. You can undo with Ctrl/Cmd+Z.', onConfirm: () => removeExtraBlock(extra.id, idx) }), onDuplicate: () => duplicateExtraBlock(extra.id, idx), onCopy: () => setClipboardBlock(block), onUp, onDown, dnd: { handleProps: blockDnd.handleProps(extra.id, idx), dropProps: blockDnd.dropProps(extra.id, idx), dragging: blockDnd.isDragging(extra.id, idx), over: blockDnd.isOver(extra.id, idx) } })}
                  </div>
                );
              })}
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => addBlockToExtra(extra.id)} className="flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-indigo-400 border border-dashed border-indigo-200 rounded hover:bg-indigo-50 hover:text-indigo-600 transition-colors"><Type size={12} /> Add text block</button>
                <button onClick={() => { setBlockPickerSearch(''); setSharedPickerFor(extra.id); }} className="flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-amber-500 border border-dashed border-amber-300 rounded hover:bg-amber-50 hover:text-amber-700 transition-colors"><Lock size={12} /> Add standardized block</button>
              </div>
              {renderSectionActions(section)}
              {renderAddChapterButton(extra)}
              {renderDuplicateChapterButton(section)}
            </div>
            {renderSkuScopeSelector(section.id)}
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
        <div className={hidden ? 'opacity-60' : ''}>
          {hiddenBanner}
          <div className="border border-amber-200 rounded-xl p-3 bg-amber-50/30">
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
                    onRemove: () => requestDeleteBlock(isInlineBlockEmpty(block), () => removeOverrideBlock(section, idx)),
                    onDuplicate: () => duplicateOverrideBlock(section, idx),
                    onCopy: () => setClipboardBlock(block),
                    onSaveSnippet: () => saveBlockAsSnippet(block),
                    onUp: idx > 0 ? () => moveOverrideBlock(section, idx, -1) : undefined,
                    onDown: idx < blocks.length - 1 ? () => moveOverrideBlock(section, idx, 1) : undefined,
                    dnd: { handleProps: blockDnd.handleProps(`ov:${section.id}`, idx), dropProps: blockDnd.dropProps(`ov:${section.id}`, idx), dragging: blockDnd.isDragging(`ov:${section.id}`, idx), over: blockDnd.isOver(`ov:${section.id}`, idx) },
                  })}
                </div>
              ))}
              <button onClick={() => addOverrideBlock(section)} className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-indigo-400 border border-dashed border-indigo-200 rounded hover:bg-indigo-50 hover:text-indigo-600 transition-colors"><Type size={12} /> Add text block</button>
              {renderSectionActions(section)}
              {renderAddChapterButton(section)}
              {renderDuplicateChapterButton(section)}
            </div>
            {renderSkuScopeSelector(section.id)}
          </div>
        </div>
      );
    }

    // Template section: locked blocks + insertable project additions.
    return (
      <div className={hidden ? 'opacity-60' : ''}>
        {hiddenBanner}
        <div>
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
                onRemove: () => requestDeleteBlock(isInlineBlockEmpty(a.block), () => removeAddition(section.id, a.id)),
                onDuplicate: () => duplicateAddition(section.id, a.id),
                onCopy: () => setClipboardBlock(a.block),
                onSaveSnippet: () => saveBlockAsSnippet(a.block),
                onUp: i > 0 ? () => moveAddition(section.id, a.id, -1) : undefined,
                onDown: i < arr.length - 1 ? () => moveAddition(section.id, a.id, 1) : undefined,
                dnd: { handleProps: additionDnd.handleProps(section.id, a.id), dropProps: additionDnd.dropProps(section.id, a.id), dragging: additionDnd.isDragging(section.id, a.id), over: additionDnd.isOver(section.id, a.id) },
              })}</div>
            ))}

            {refs.map((ref, i) => (
              <React.Fragment key={i}>
                {/* A template block. Inline ones can be edited for this project only (stored as
                    a project override, never written back to the template); shared blocks and
                    SKU slots stay locked — see refIsOverridable. Any of them can be left out of
                    THIS manual without touching the template — see renderRefIncludeControl. */}
                <div className="group/ref">
                {renderRefIncludeControl(section, ref, i)}
                <div className={isRefExcluded(section.id, i, ref) ? 'opacity-50' : ''}>
                {ref.kind === 'sku_slot' ? (
                  <div className="flex items-center gap-2 text-xs text-gray-400 italic border border-gray-100 rounded px-2 py-1.5 bg-gray-50">
                    <Lock size={11} /> SKU slot: {(ref as SKUSlotRef).label?.[activeLang] || (ref as SKUSlotRef).slot}
                  </div>
                ) : refIsOverridable(ref) ? (
                  getBlockOverride(section.id, i, ref) ? (
                    // Template block unlocked for this project — fully editable (and for a
                    // table, that includes adding rows/columns).
                    <div className="border border-sky-200 rounded-lg bg-sky-50/30">
                      <div className="flex items-center justify-between px-2 py-1 border-b border-sky-100">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-sky-600 flex items-center gap-1">
                          <Unlock size={11} /> {refHasTable(ref) ? 'Table · edited for this project' : 'Edited for this project'}
                        </span>
                        <button onClick={() => resetBlockOverride(section.id, [blockOvKey(i, ref), String(i)])} title="Discard the project edits and go back to the template block" className="text-[10px] font-medium text-gray-500 hover:text-rose-600 flex items-center gap-1"><RotateCcw size={11} /> Reset to template</button>
                      </div>
                      <InlineBlockEditor
                        rowKey={`${section.id}-bo-${i}`}
                        content={getBlockOverride(section.id, i, ref)!.content}
                        variant={getBlockOverride(section.id, i, ref)!.variant}
                        languages={editorLanguages}
                        attributes={projectAttributes}
                        onChange={(lang, html) => updateBlockOverride(section.id, blockOverrideKeyInUse(section.id, i, ref), lang, html)}
                        onVariantChange={(v) => setBlockOverrideVariant(section.id, blockOverrideKeyInUse(section.id, i, ref), v)}
                        enableTranslate
                        focusLang={focusRowLang}
                        focusToken={translationFocus?.token}
                      />
                    </div>
                  ) : (
                    // Locked template block + an opt-in to edit it for this project only. The
                    // template itself is untouched; the edit is stored on this manual.
                    <div className="relative border border-gray-100 rounded bg-gray-50/60 px-3 py-2 opacity-90">
                      <span className="absolute top-1 right-1 text-gray-300" title="Template content — edit it for this project below"><Lock size={11} /></span>
                      <div className="im-content text-xs text-gray-600 pointer-events-none mb-2" dangerouslySetInnerHTML={{ __html: sanitizeHtml(templateRefPreviewHtml(ref) || '<span class="text-gray-300 italic">Empty template block</span>') }} />
                      <button
                        onClick={() => editBlockForProject(section.id, blockOvKey(i, ref), ref as InlineBlockRef)}
                        title={refHasTable(ref)
                          ? 'Edit this table for this project only — the shared template keeps its version'
                          : 'Edit this text for this project only — the shared template keeps its version'}
                        className="w-full flex items-center justify-center gap-1 py-1.5 text-[11px] font-medium text-sky-600 border border-dashed border-sky-300 rounded hover:bg-sky-50 hover:text-sky-700 transition-colors"
                      >
                        <Unlock size={12} /> {refHasTable(ref) ? 'Edit table for this project' : 'Edit for this project'}
                      </button>
                    </div>
                  )
                ) : (
                  // Shared library block: approval-gated, so it stays locked here. Change it in
                  // the Block Library (which updates every manual that uses it).
                  <div className="relative border border-gray-100 rounded bg-gray-50/60 px-3 py-2 opacity-90">
                    <span className="absolute top-1 right-1 text-gray-300" title="Shared block (locked) — edit it in the Block Library"><Lock size={11} /></span>
                    <div className="im-content text-xs text-gray-600 pointer-events-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(templateRefPreviewHtml(ref) || '<span class="text-gray-300 italic">Empty template block</span>') }} />
                  </div>
                )}
                </div>{/* dimmed body of an excluded block */}
                </div>{/* group/ref — reveals the Exclude control on hover */}
                {renderInsertButton(section.id, i + 1)}
                {additions.filter(a => a.position === i + 1).map((a, idx, arr) => (
                  <div key={a.id}>{renderAdditionEditor(a.block, {
                    rowKey: a.id,
                    onChange: (lang, html) => updateAdditionContent(section.id, a.id, lang, html),
                    onVariant: (v) => setAdditionVariant(section.id, a.id, v),
                    onRemove: () => requestDeleteBlock(isInlineBlockEmpty(a.block), () => removeAddition(section.id, a.id)),
                    onDuplicate: () => duplicateAddition(section.id, a.id),
                    onCopy: () => setClipboardBlock(a.block),
                    onSaveSnippet: () => saveBlockAsSnippet(a.block),
                    onUp: idx > 0 ? () => moveAddition(section.id, a.id, -1) : undefined,
                    onDown: idx < arr.length - 1 ? () => moveAddition(section.id, a.id, 1) : undefined,
                    dnd: { handleProps: additionDnd.handleProps(section.id, a.id), dropProps: additionDnd.dropProps(section.id, a.id), dragging: additionDnd.isDragging(section.id, a.id), over: additionDnd.isOver(section.id, a.id) },
                  })}</div>
                ))}
              </React.Fragment>
            ))}
            {renderSectionActions(section)}
            <div className="pt-1">{renderAddChapterButton(section)}</div>
            <div className="pt-1">{renderDuplicateChapterButton(section)}</div>
          </div>
          {renderSkuScopeSelector(section.id)}
        </div>
      </div>
    );
  };

  // One row of the project section tree (recursive), mirroring the template editor's
  // Structure sidebar: indentation by depth, hierarchical numbering, hide + add controls.
  const renderProjectTreeRow = (
    section: IMSection & { __projectExtra?: true },
    prefix: string,
    level: number,
  ): React.ReactNode => {
    const all: (IMSection & { __projectExtra?: true })[] = [...sections, ...extraAsSections];
    const children = all
      .filter(s => (s.parentId ?? null) === section.id && s.title !== '__METADATA__')
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const isExtra = (section as any).__projectExtra === true;
    const hidden = sectionVisibility[section.id] === false;
    const selected = selectedContentSectionId === section.id;
    return (
      <div key={section.id} className="flex flex-col">
        <div
          onClick={() => setSelectedContentSectionId(section.id)}
          className={`flex items-center gap-2 p-2 rounded cursor-pointer text-sm group transition-colors ${selected ? 'bg-indigo-50 text-indigo-700 font-medium border border-indigo-200' : 'text-gray-600 hover:bg-light border border-transparent'}`}
          style={{ paddingLeft: `${(level * 12) + 8}px` }}
        >
          <span className="text-gray-400 text-xs font-mono min-w-[24px]">{prefix}</span>
          <span className={`truncate flex-1 ${hidden ? 'line-through text-gray-400' : ''}`}>{localizedSectionTitle(section, activeLang)}</span>
          {isExtra
            ? <FilePlus2 size={12} className="text-emerald-400 shrink-0" aria-label="Project section" />
            : section.isPlaceholder
              ? <LayoutTemplate size={12} className="text-amber-400 shrink-0" aria-label="Placeholder section" />
              : <Lock size={12} className="text-gray-300 shrink-0" aria-label="Template section" />}
          {hidden && <EyeOff size={12} className="text-gray-400 shrink-0" aria-label="Hidden" />}
          <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity gap-0.5">
            {renderJumpToPreview(section, { compact: true })}
            <button onClick={(e) => { e.stopPropagation(); toggleSectionHidden(section.id); }} title={hidden ? 'Show section' : 'Hide section for this project'} className="text-gray-400 hover:text-indigo-600 p-1 hover:bg-indigo-100 rounded">{hidden ? <Eye size={12} /> : <EyeOff size={12} />}</button>
            <button onClick={(e) => { e.stopPropagation(); addExtraSection(section.id); }} title="Add sub-section" className="text-gray-400 hover:text-indigo-600 p-1 hover:bg-indigo-100 rounded"><Plus size={12} /></button>
            {isExtra && <button onClick={(e) => { e.stopPropagation(); removeExtraSection(section.id); if (selected) setSelectedContentSectionId(null); }} title="Delete project section" className="text-gray-400 hover:text-rose-600 p-1 hover:bg-rose-100 rounded"><Trash2 size={12} /></button>}
          </div>
        </div>
        {children.map((child, idx) => renderProjectTreeRow(child, `${prefix}${idx + 1}.`, level + 1))}
      </div>
    );
  };

  const renderProjectSectionTree = () => {
    const all: (IMSection & { __projectExtra?: true })[] = [...sections, ...extraAsSections];
    const roots = all
      .filter(s => !s.parentId && s.title !== '__METADATA__')
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    return (
      <div className="w-64 shrink-0 bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden">
        <div className="p-3 border-b border-gray-100 bg-light flex justify-between items-center">
          <span className="text-xs font-bold text-muted uppercase flex items-center gap-1.5"><Layers size={13} /> Section tree</span>
          <div className="flex items-center gap-1">
            <button onClick={() => addExtraSection(null)} title="Add chapter at document root" className="text-indigo-600 hover:bg-indigo-100 p-1 rounded"><Plus size={14} /></button>
          </div>
        </div>
        {/* Jump-to-section search (#5) */}
        <div className="px-2 pt-2">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input value={sectionSearch} onChange={(e) => setSectionSearch(e.target.value)} placeholder="Find a section…" className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {sectionSearch.trim() ? (() => {
            const q = sectionSearch.trim().toLowerCase();
            const matches = all.filter(s => s.title !== '__METADATA__' && localizedSectionTitle(s, activeLang).toLowerCase().includes(q));
            return matches.length ? matches.map(s => (
              <button key={s.id} onClick={() => setSelectedContentSectionId(s.id)} className={`w-full text-left px-2 py-1.5 rounded text-sm truncate ${selectedContentSectionId === s.id ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-600 hover:bg-light'}`} title={localizedSectionTitle(s, activeLang)}>{localizedSectionTitle(s, activeLang)}</button>
            )) : <p className="text-xs text-gray-400 italic px-2 py-4 text-center">No sections match “{sectionSearch}”.</p>;
          })() : roots.length ? roots.map((s, idx) => renderProjectTreeRow(s, `${idx + 1}.`, 0))
            : <div className="text-xs text-gray-400 text-center py-6">No sections yet.</div>}
        </div>
      </div>
    );
  };

  const renderContentEditor = () => {
    const selectable = orderedSections.filter(s => s.title !== '__METADATA__');
    const selectedSection = selectable.find(s => s.id === selectedContentSectionId) ?? selectable[0];
    return (
      <div className="flex-1 flex gap-3 p-4 overflow-hidden min-h-0">
        {renderProjectSectionTree()}
        <div className="flex-1 min-w-0 overflow-y-auto">
          <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-xs text-indigo-800 flex items-start gap-2 mb-4">
            <FilePlus2 size={14} className="mt-0.5 shrink-0" />
            <span>Select a chapter on the left to edit it for this project. Use the <strong>eye</strong> icon to <strong>hide</strong> a standardized section — or any sub-section inside it — that doesn't apply; it (and everything nested under it) won't appear in the generated IM. A single standardized block can be left out on its own with <strong>Exclude</strong> above it. Standardized text and tables can be tweaked with <strong>Edit for this project</strong>, and reset back to the template at any time — nothing here changes the shared template or any other manual. Shared library blocks stay locked, but can still be excluded.</span>
          </div>
          {selectedSection && (
            <div className="mb-3 flex items-center justify-between gap-2 border-b border-gray-100 pb-2">
              <span className="min-w-0 truncate text-xs font-bold text-gray-700">
                {localizedSectionTitle(selectedSection, activeLang)}
              </span>
              {renderJumpToPreview(selectedSection)}
            </div>
          )}
          {selectedSection ? renderSectionContentEditor(selectedSection) : <div className="text-sm text-gray-400 text-center py-10">No sections yet.</div>}
        </div>
      </div>
    );
  };

  const imThemeVars = getIMThemeVariables(template?.metadata);
  const masterPages = {
    ...DEFAULT_MASTER_PAGES,
    ...(template?.metadata?.masterPages || {})
  };

  // Computed values for current language
  const displayTitle = formData['__cover_title'] !== undefined ? formData['__cover_title'] : (project?.name || 'Product Name');
  const displaySubtitle = formData['__cover_subtitle'] !== undefined ? formData['__cover_subtitle'] : 'INSTRUCTION MANUAL';
  const displayLogo = formData['__custom_logo'] || metadata.companyLogoUrl || DEFAULT_IM_LOGO_URL;
  const displayCoverImage = formData['__custom_cover_image'] || metadata.coverImageUrl;
  const displayFooter = formData['__custom_footer'] !== undefined ? formData['__custom_footer'] : (metadata.footerText || '');
  // Version the next publish will stamp (current persisted version + 1).
  const previewVersion = (instance?.version ?? 0) + 1;

  const completion = calculateCompletion(activeLang);
  // Live pre-publish issues. Computed once per render and shared, so the count on the
  // pipeline's "Content" step and the rows in the review panel can never disagree.
  const publishIssues = buildPublishIssues();

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

       {/* Generic block-delete confirmation (#7) */}
       <ConfirmationModal
         variant="danger"
         isOpen={!!pendingConfirm}
         title={pendingConfirm?.title ?? ''}
         message={pendingConfirm?.message ?? ''}
         confirmLabel="Delete"
         onConfirm={() => { pendingConfirm?.onConfirm(); setPendingConfirm(null); }}
         onCancel={() => setPendingConfirm(null)}
       />

       {/* Mark this manual FINAL (locks it read-only until unlocked). */}
       <ConfirmationModal
         isOpen={showFinalizeConfirm}
         title={`Mark this ${typeLabel.toLowerCase()} as final?`}
         message={`Marking it final locks it against changes${isDirty ? ' (your unsaved edits are saved first)' : ''}. Nobody can edit, translate, import into or delete it until it is explicitly unlocked. You can still publish and export it.`}
         confirmLabel="Mark as final"
         onConfirm={handleMarkFinal}
         onCancel={() => setShowFinalizeConfirm(false)}
       />

       {/* Unlock a FINAL manual so it can be edited again. */}
       <ConfirmationModal
         isOpen={showUnlockConfirm}
         title="Unlock this manual for editing?"
         message="This manual is marked FINAL. Unlocking removes the lock and makes it editable again. You can mark it final again once you're done."
         confirmLabel="Unlock for editing"
         onConfirm={handleUnlock}
         onCancel={() => setShowUnlockConfirm(false)}
       />

       {/* Blocking overlay while a save/publish is in flight — stops the user navigating away
           and wedging the session. Guaranteed to clear because every network call in the save
           path is time-bounded (see data/resilience.ts / saveProjectIM). Translation is excluded:
           it shows its own progress in the translate modal, which this would otherwise hide. */}
       <SaveProgressOverlay
         isOpen={saving || generating}
         message={generating ? 'Publishing your manual…' : 'Saving your work…'}
         detail={generating ? publishStatus : null}
       />

       {/* Concurrent-edit conflict: someone else saved after we loaded. All saves are halted
           until reload; the operator's edits are stashed in the local draft and re-offered. */}
       {saveConflict && (
         <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[70] bg-white border border-rose-300 shadow-xl rounded-xl px-4 py-3 flex items-center gap-4 max-w-xl">
           <AlertCircle size={18} className="text-rose-500 shrink-0" />
           <span className="text-sm text-gray-700">
             <strong>{saveConflict.by ?? 'Someone else'}</strong> saved this {typeLabel.toLowerCase()} at{' '}
             {new Date(saveConflict.at).toLocaleString()} — after you loaded it. Saving is paused so
             their work isn't overwritten. Reload to get their version; you'll then be offered your
             own edits to restore and merge.
           </span>
           <button onClick={reloadAfterConflict} className="px-3 py-1.5 bg-rose-600 text-white rounded-lg text-xs font-semibold hover:bg-rose-700 shrink-0">Reload</button>
         </div>
       )}

       {/* Recovered unsaved edits from a hang/crash/close on this device. */}
       {pendingDraft && (
         <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[65] bg-white border border-amber-300 shadow-xl rounded-xl px-4 py-3 flex items-center gap-4 max-w-lg">
           <AlertCircle size={18} className="text-amber-500 shrink-0" />
           <span className="text-sm text-gray-700">
             We found unsaved edits from {new Date(pendingDraft.savedAt).toLocaleString()} that didn't finish saving. Restore them?
           </span>
           <div className="flex gap-2 shrink-0">
             <button onClick={restoreDraft} className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700">Restore</button>
             <button onClick={discardDraft} className="px-3 py-1.5 border border-gray-300 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50">Discard</button>
           </div>
         </div>
       )}

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
               {isPrintExportAvailable() && (
                 <button onClick={() => { setPrintIntent('print'); setShowPrintDialog(true); }} className="text-sm px-3 py-2 border border-primary text-primary rounded hover:bg-primary/5 flex items-center gap-1.5">
                   <FileDown size={14} /> Export print PDF
                 </button>
               )}
               {/* Publishing produces no PDF, so the review round has to render one — this
                   button is the shortcut that does both, rather than making the operator
                   find the Markup.io panel inside the print dialog. */}
               {isPrintExportAvailable() && isMarkupReviewAvailable() && (
                 <button
                   onClick={() => { setPrintIntent('review'); setShowPrintDialog(true); }}
                   title="Send this manual's print PDF to Markup.io for supplier review"
                   className="text-sm px-3 py-2 border border-sky-300 text-sky-700 rounded hover:bg-sky-50 flex items-center gap-1.5"
                 >
                   <Send size={14} /> Send for review
                 </button>
               )}
               <button onClick={() => navigate(`/project/${project?.id}`)} className="text-sm px-3 py-2 bg-primary text-white rounded hover:opacity-90">Go to project</button>
             </div>
           </div>
         </div>
       )}

       {showPrintDialog && publishResult && project && (
         <PrintExportDialog
           projectId={project.id}
           templateType={templateType}
           projectName={project.name}
           template={template}
           formData={formData}
           languages={publishResult.languages.map((l) => l.language)}
           skus={(boundSkuIds.length ? projectSkus.filter((s) => boundSkuIds.includes(s.id)) : projectSkus)
             .map((s) => s.skuNumber)
             .filter(Boolean)}
           version={instance?.version}
           onRendered={async (res, langs, size) => {
             // A fresh render for the current version — keep the pipeline's Print step live.
             setLatestRenderVersion(instance?.version ?? null);
             await attachPrintPdfToProject(res, langs, size);
           }}
           onCoverPrefs={persistCoverPrefs}
           onReviewSent={handleReviewSent}
           intent={printIntent}
           onClose={() => { setShowPrintDialog(false); setPrintIntent('print'); }}
         />
       )}

       {/* ALREADY UP TO DATE — nothing changed since the last publish. Show the existing
           files and only regenerate on explicit confirmation. */}
       {noChangesPrompt && (
         <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
           <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
             <h3 className="font-bold text-lg mb-1 flex items-center gap-2">
               <CheckCircle size={18} className="text-emerald-600" /> Already up to date
             </h3>
             <p className="text-sm text-muted mb-4">
               Nothing has changed since <strong>v{instance?.version}</strong> of this {typeLabel.toLowerCase()} was
               published — regenerating would produce identical output. Use the existing files below,
               or regenerate anyway.
             </p>

             <div className="border rounded-lg divide-y mb-5">
               <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                 <div className="min-w-0">
                   <div className="text-sm font-medium text-gray-800">Published manifest (v{instance?.version})</div>
                   <div className="text-xs text-muted">Structured JSON — all languages</div>
                 </div>
                 {noChangesPrompt.manifestUrl && (
                   <a href={noChangesPrompt.manifestUrl} target="_blank" rel="noreferrer" className="text-xs px-2 py-1.5 border rounded hover:bg-gray-50 shrink-0">Open</a>
                 )}
               </div>
               {noChangesPrompt.lastRender ? (
                 <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                   <div className="min-w-0">
                     <div className="text-sm font-medium text-gray-800">
                       Print PDF{noChangesPrompt.lastRender.imVersion != null ? ` (v${noChangesPrompt.lastRender.imVersion})` : ''}
                     </div>
                     <div className="text-xs text-muted">
                       <span className="uppercase">{noChangesPrompt.lastRender.languages.join(', ')} · {noChangesPrompt.lastRender.pageSize?.toUpperCase()}</span>
                       {' · '}{new Date(noChangesPrompt.lastRender.createdAt).toLocaleDateString()}
                     </div>
                   </div>
                   <a href={noChangesPrompt.lastRender.url} target="_blank" rel="noreferrer" className="text-xs px-2 py-1.5 border rounded hover:bg-gray-50 flex items-center gap-1 shrink-0">
                     <Download size={12} /> Download
                   </a>
                 </div>
               ) : (
                 <div className="px-3 py-2.5 text-xs text-muted">No print PDF has been rendered for this version yet.</div>
               )}
             </div>

             <div className="flex items-center gap-2 pt-4 border-t border-gray-100">
               {/* Render a (new) print PDF from the already-published version — no republish needed. */}
               {isPrintExportAvailable() && (
                 <button onClick={openPrintForPublished} className="text-sm px-3 py-2 border border-primary text-primary rounded-lg hover:bg-primary/5 flex items-center gap-1.5">
                   <FileDown size={14} /> Export print PDF
                 </button>
               )}
               <div className="flex-1" />
               <button onClick={() => setNoChangesPrompt(null)} className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50">Close</button>
               <button
                 onClick={() => { setNoChangesPrompt(null); proceedToChecklist(); }}
                 className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700"
               >Regenerate anyway</button>
             </div>
           </div>
         </div>
       )}

       {/* PRE-PUBLISH CHECKLIST */}
       {/* DAILY BACKUPS — one snapshot per day, last 3 days, restored into the editor. */}
       {showBackups && (
         <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
           <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
             <div className="flex items-start justify-between mb-1">
               <h3 className="font-bold text-lg flex items-center gap-2"><RotateCcw size={18} className="text-indigo-500" /> Restore a daily backup</h3>
               <button onClick={() => setShowBackups(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
             </div>
             <p className="text-sm text-muted mb-4">
               One snapshot is kept per day (each day's last saved state), for the last 3 days.
               Restoring loads it <strong>into the editor</strong> — review it in the preview, undo with
               Ctrl/Cmd+Z, and press Save Draft to keep it. Nothing changes on the server until you save.
             </p>
             {backups === null ? (
               <div className="flex items-center gap-2 text-sm text-muted py-6 justify-center"><Loader2 size={15} className="animate-spin" /> Loading backups…</div>
             ) : backups.length === 0 ? (
               <div className="text-sm text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-lg">
                 No backups yet — a snapshot is stored automatically with each day's saves.
               </div>
             ) : (
               <div className="border rounded-lg divide-y">
                 {backups.map(b => (
                   <div key={b.backupDate} className="flex items-center justify-between gap-3 px-3 py-2.5">
                     <div className="min-w-0">
                       <div className="text-sm font-medium text-gray-800">
                         {new Date(b.backupDate).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                       </div>
                       <div className="text-xs text-muted">
                         Last saved {new Date(b.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                         {b.savedBy ? ` by ${b.savedBy}` : ''}
                       </div>
                     </div>
                     <button
                       onClick={() => restoreBackup(b)}
                       className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50"
                     >Load into editor</button>
                   </div>
                 ))}
               </div>
             )}
             <div className="flex justify-end mt-5 pt-4 border-t border-gray-100">
               <button onClick={() => setShowBackups(false)} className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50">Close</button>
             </div>
           </div>
         </div>
       )}

       {/* MANUAL LANGUAGES — same picker as the category template editor's "Manual Languages",
           scoped to what this project may publish (see languagePool). Membership only; the
           order lives in the Required Languages list behind it. */}
       {isLangModalOpen && (
         <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
           <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
             <div className="flex justify-between items-center mb-4">
               <h3 className="font-bold text-lg flex items-center gap-2"><Globe size={18} className="text-indigo-500" /> Manual Languages</h3>
               <button onClick={() => setIsLangModalOpen(false)}><X size={18} className="text-gray-400 hover:text-gray-600" /></button>
             </div>
             <p className="text-xs text-muted mb-4">
               Choose which languages this manual must be published in. Each one gets its own tab on every
               content row, and Publish/Print produce one manual per language. English is always included.
               {!projectOwnsLanguages && ' The list comes from this category’s template.'}
             </p>
             <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto">
               {languageOptions.map(l => {
                 const checked = l.code === 'en' || langDraft.includes(l.code);
                 const isEn = l.code === 'en';
                 return (
                   <label key={l.code} className={`flex items-center gap-2 text-sm p-2 rounded border transition-colors ${checked ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:bg-gray-50'} ${isEn ? 'cursor-default' : 'cursor-pointer'}`}>
                     <input
                       type="checkbox"
                       className="rounded accent-indigo-600"
                       checked={checked}
                       disabled={isEn}
                       onChange={e => setLangDraft(prev => e.target.checked ? [...prev, l.code] : prev.filter(c => c !== l.code))}
                     />
                     <span className={isEn ? 'text-gray-500' : ''}>{l.label}</span>
                     {isEn && <span className="ml-auto text-[10px] text-gray-400 uppercase tracking-wide">required</span>}
                   </label>
                 );
               })}
             </div>
             {/* A newly added language starts empty: say so here rather than letting the
                 pre-publish checklist be the first mention. */}
             <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
               A language you add starts empty — use <strong className="font-semibold text-gray-500">Translate project content</strong> to fill
               it from English, or type into its tab. Publish flags anything still missing.
             </p>
             <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 mt-4">
               <button onClick={() => setIsLangModalOpen(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded text-sm">Cancel</button>
               <button onClick={handleSaveProjectLanguages} className="px-4 py-2 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700">Save Languages</button>
             </div>
           </div>
         </div>
       )}

       {/* TRANSLATIONS */}
       {isTranslateModalOpen && (
         <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
           <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[85vh] flex flex-col">
             <div className="flex items-start justify-between mb-1">
               <h3 className="font-bold text-lg flex items-center gap-2"><Globe size={18} className="text-indigo-500" /> Translate project content</h3>
               <button onClick={() => { if (!translating) setIsTranslateModalOpen(false); }} className="text-gray-400 hover:text-gray-600 disabled:opacity-40" disabled={translating}><X size={18} /></button>
             </div>
             <p className="text-sm text-muted mb-4">
               Auto-translate the sections you added or edited on this project. Template content is already translated and isn’t included here.
             </p>
             <div className="overflow-y-auto space-y-3 pr-1 flex-1">
               {otherRequiredLangs.map(lang => {
                 const missing = [...(translationGaps[lang] ?? [])];
                 const name = IM_LANGUAGE_NAMES[lang] ?? lang.toUpperCase();
                 return (
                   <div key={lang} className="border border-gray-200 rounded-lg p-3">
                     <div className="flex items-center justify-between gap-2">
                       <div className="text-sm font-medium">
                         {missing.length === 0
                           ? <span className="flex items-center gap-1.5 text-emerald-700"><CheckCircle size={14} /> {name} — up to date</span>
                           : <span className="flex items-center gap-1.5 text-orange-700"><Globe size={14} className="text-amber-500" /> {name} — {missing.length} missing</span>}
                       </div>
                       <button
                         onClick={() => handleTranslateProject([lang])}
                         disabled={translating || (missing.length === 0 && translateSkipExisting)}
                         className="text-xs px-3 py-1.5 rounded-lg border border-indigo-200 text-indigo-700 font-medium hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed"
                       >Translate</button>
                     </div>
                     {missing.length > 0 && (
                       <ul className="mt-2 space-y-1">
                         {missing.map((m, i) => (
                           <li key={i} className="text-xs text-gray-600 flex items-start gap-2"><Globe size={12} className="text-amber-400 mt-0.5 shrink-0" /> {m}</li>
                         ))}
                       </ul>
                     )}
                   </div>
                 );
               })}
             </div>
             {translating && (
               <div className="mt-3">
                 <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                   <div className="h-full bg-indigo-500 transition-all" style={{ width: `${translateProgress.total ? (translateProgress.done / translateProgress.total) * 100 : 0}%` }} />
                 </div>
                 <div className="text-xs text-muted mt-1">Translating {translateProgress.done}/{translateProgress.total}…</div>
               </div>
             )}
             <label className="flex items-center gap-2 text-xs text-gray-600 mt-3 pt-3 border-t border-gray-100">
               <input type="checkbox" checked={!translateSkipExisting} onChange={e => setTranslateSkipExisting(!e.target.checked)} disabled={translating} />
               Retranslate content that already has a translation (overwrite)
             </label>
             <p className="text-[11px] text-muted mt-2">
               New project-only section titles aren’t translated (they’re shared across languages). Auto-translation requires the deployed translation service.
             </p>
             <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-gray-100">
               <button onClick={() => { if (!translating) setIsTranslateModalOpen(false); }} disabled={translating} className="text-sm px-4 py-2 border rounded-lg hover:bg-gray-50 disabled:opacity-50">Close</button>
               <button
                 onClick={() => handleTranslateProject(otherRequiredLangs)}
                 disabled={translating || (untranslatedSectionLabels.size === 0 && translateSkipExisting)}
                 className="text-sm px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
               >{translating ? <Loader2 size={14} className="animate-spin" /> : <Globe size={14} />} Translate all languages</button>
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
                          {/* Out for supplier review on Markup.io. Derived, never stored: editing
                              (status back to draft) or republishing (version bump) ends it. */}
                          {instance && isInReview(instance) && (
                            instance.reviewUrl ? (
                              <a
                                href={instance.reviewUrl}
                                target="_blank"
                                rel="noreferrer"
                                title={`Sent for review${instance.reviewRequestedBy ? ` by ${instance.reviewRequestedBy}` : ''}${instance.reviewRequestedAt ? ` on ${new Date(instance.reviewRequestedAt).toLocaleDateString()}` : ''} — open the Markup.io review`}
                                className="flex items-center gap-1 bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide hover:bg-sky-200"
                              ><Eye size={10} /> In Review</a>
                            ) : (
                              <span className="flex items-center gap-1 bg-sky-100 text-sky-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide"><Eye size={10} /> In Review</span>
                            )
                          )}
                          {locked && <span className="flex items-center gap-1 bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded font-bold uppercase tracking-wide"><Lock size={10} /> Final</span>}
                       </div>
                   </div>
               </div>
               <div className="flex gap-3 items-center">
                   {/* Autosave / unsaved status — mirrors the template editor's honesty about save state. */}
                   <span className="text-xs text-muted min-w-[90px] text-right hidden sm:block">
                       {autosaving ? <span className="flex items-center justify-end gap-1"><Loader2 size={12} className="animate-spin" /> Autosaving…</span>
                        : isDirty ? <span className="text-amber-600">Unsaved changes</span>
                        : lastAutoSavedAt ? `Saved ${lastAutoSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : instance ? 'All changes saved' : ''}
                   </span>
                   <div className="flex items-center rounded-xl border border-gray-300 bg-white overflow-hidden">
                       <button onClick={undoRedo.undo} disabled={!undoRedo.canUndo || isBusy || locked} title="Undo (Ctrl/Cmd+Z)" className="flex items-center justify-center w-9 h-9 text-gray-600 hover:bg-light disabled:opacity-30 disabled:cursor-not-allowed"><Undo2 size={16} /></button>
                       <div className="w-px h-5 bg-gray-200" />
                       <button onClick={undoRedo.redo} disabled={!undoRedo.canRedo || isBusy || locked} title="Redo (Ctrl/Cmd+Shift+Z)" className="flex items-center justify-center w-9 h-9 text-gray-600 hover:bg-light disabled:opacity-30 disabled:cursor-not-allowed"><Redo2 size={16} /></button>
                   </div>
                   {locked ? (
                     <button onClick={() => setShowUnlockConfirm(true)} disabled={isBusy} className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 disabled:opacity-70">
                        {finalizing ? <Loader2 size={16} className="animate-spin" /> : <Unlock size={16} />} Unlock to edit
                     </button>
                   ) : (
                   <button onClick={handleSaveDraft} disabled={isBusy} className={`flex items-center gap-2 px-4 py-2 bg-white border rounded-xl text-sm font-medium hover:bg-light disabled:opacity-80 ${savedTick ? 'border-emerald-300 text-emerald-700' : 'border-gray-300 text-gray-700'}`}>
                      {saving ? <Loader2 size={16} className="animate-spin" /> : savedTick ? <CheckCircle size={16} className="text-emerald-600" /> : <Save size={16} />}
                      {saving ? 'Saving…' : savedTick ? 'Saved!' : 'Save Draft'}
                   </button>
                   )}

                   {!locked && otherRequiredLangs.length > 0 && (
                     <button onClick={() => setIsTranslateModalOpen(true)} disabled={isBusy} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-light disabled:opacity-60" title="Review & auto-translate project-authored sections">
                        <Globe size={16} /> Translations
                        {untranslatedSectionLabels.size > 0 && (
                          <span className="ml-0.5 text-[10px] font-bold bg-amber-100 text-orange-700 px-1.5 py-0.5 rounded-full">{untranslatedSectionLabels.size}</span>
                        )}
                     </button>
                   )}

                   <button onClick={() => setShowImport(true)} disabled={isBusy || locked} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-light disabled:opacity-60" title="Replace this manual by importing a reviewed JSON">
                      <FileJson size={16} /> Import
                   </button>

                   {!!template?.categoryId && (
                     <button onClick={() => setShowDiffImport(true)} disabled={isBusy || locked} className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-xl text-sm font-medium hover:bg-light disabled:opacity-60" title="Add a reviewed supplier draft on top of this project's template, keeping the template as-is">
                        <GitBranch size={16} /> Import supplier draft (diff)
                     </button>
                   )}

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
                                  onClick={() => handleExport()}
                                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-light flex items-center gap-2"
                               >
                                  <FileJson size={16} /> Export as JSON
                               </button>
                           </div>
                       )}
                   </div>

                   <button onClick={handlePublishClick} disabled={isBusy} title={generating ? (publishStatus ?? 'Publishing…') : undefined} className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-70 max-w-[280px]">
                      {(generating || checkingChanges) ? <Loader2 size={16} className="animate-spin shrink-0" /> : <FileDown size={16} className="shrink-0" />}
                      {/* Says what it does: publishes EVERY required language, not the active tab. */}
                      <span className="truncate">{generating ? (publishStatus ?? 'Publishing…') : checkingChanges ? 'Checking for changes…' : `Publish (${requiredLanguages.length} ${requiredLanguages.length === 1 ? 'language' : 'languages'})`}</span>
                   </button>

                   {/* Settings menu — houses destructive/rare actions (Delete Draft / Reset)
                       so they can't be triggered by a single stray click in the toolbar. */}
                   <div className="relative" ref={settingsMenuRef}>
                       <button
                          onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                          disabled={loading || isBusy}
                          className="flex items-center justify-center w-10 h-10 bg-white border border-gray-300 text-gray-600 rounded-xl hover:bg-light disabled:opacity-60"
                          title="Settings"
                       >
                          <Settings size={16} />
                       </button>
                       {showSettingsMenu && (
                           <div className="absolute top-full right-0 mt-2 w-52 bg-white rounded-xl shadow-xl border border-gray-200 z-50 py-1">
                               {instance && (
                                 locked ? (
                                   <button
                                      onClick={() => { setShowSettingsMenu(false); setShowUnlockConfirm(true); }}
                                      disabled={loading || isBusy}
                                      className="w-full text-left px-4 py-2 text-sm text-amber-700 hover:bg-amber-50 flex items-center gap-2 disabled:opacity-60"
                                   >
                                      <Unlock size={16} /> Unlock to edit
                                   </button>
                                 ) : (
                                   <button
                                      onClick={() => { setShowSettingsMenu(false); setShowFinalizeConfirm(true); }}
                                      disabled={loading || isBusy}
                                      className="w-full text-left px-4 py-2 text-sm text-emerald-700 hover:bg-emerald-50 flex items-center gap-2 disabled:opacity-60"
                                   >
                                      <Lock size={16} /> Mark as final
                                   </button>
                                 )
                               )}
                               {instance && (
                                 <button
                                    onClick={() => { setShowSettingsMenu(false); void openBackups(); }}
                                    disabled={loading || isBusy || locked}
                                    title="Load one of the last 3 daily snapshots into the editor"
                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-light flex items-center gap-2 disabled:opacity-60"
                                 >
                                    <RotateCcw size={16} /> Restore daily backup
                                 </button>
                               )}
                               <button
                                  onClick={() => { setShowSettingsMenu(false); handleDeleteDraft(); }}
                                  disabled={loading || isBusy || locked}
                                  className="w-full text-left px-4 py-2 text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-2 disabled:opacity-60"
                               >
                                  {instance ? <Trash2 size={16} /> : <RotateCcw size={16} />}
                                  {instance ? 'Delete Draft' : 'Reset'}
                               </button>
                           </div>
                       )}
                   </div>
               </div>
           </div>

           {/* Manual pipeline — where this manual stands and what's next, each step
               clickable to its action. Derivations use only data this page already has
               (plus the three async pipeline signals fetched above). */}
           {(() => {
             // Translations have their own step below, so "Content" counts everything else.
             const contentIssues = publishIssues.filter(i => i.kind !== 'translation').length;
             const published = instance?.status === 'generated';
             const inReview = !!instance && isInReview(instance);
             const reviewDone = inReview && instance?.reviewDone === true;
             const threads = instance?.reviewActiveThreads;

             const steps: PipelineStep[] = [
               {
                 key: 'content', label: 'Content',
                 state: contentIssues === 0 ? 'done' : 'todo',
                 detail: contentIssues > 0 ? `${contentIssues} open item${contentIssues === 1 ? '' : 's'}` : undefined,
                 title: contentIssues > 0 ? 'Open the review panel — missing values, SKU content and dropped chapters' : 'All values, slots and conditions are filled',
                 onClick: contentIssues > 0
                   ? () => { setReviewPanel(prev => prev ?? { armed: false }); setReviewCollapsed(false); }
                   : undefined,
               },
               otherRequiredLangs.length === 0
                 ? { key: 'translation', label: 'Translation', state: 'skipped', detail: 'EN only', title: 'This manual only produces English' }
                 : {
                     key: 'translation', label: 'Translation',
                     state: untranslatedSectionLabels.size === 0 ? 'done' : 'todo',
                     detail: untranslatedSectionLabels.size > 0 ? `${untranslatedSectionLabels.size} untranslated` : `${otherRequiredLangs.length} lang${otherRequiredLangs.length === 1 ? '' : 's'}`,
                     title: 'Review & translate project-authored content',
                     onClick: locked ? undefined : () => setIsTranslateModalOpen(true),
                   },
               {
                 key: 'publish', label: 'Published',
                 state: !published ? 'todo' : pipelineStale ? 'warn' : 'done',
                 detail: !published ? undefined : pipelineStale ? `v${instance?.version} · out of date` : `v${instance?.version}`,
                 title: !published ? 'Publish every required language' : pipelineStale ? 'Sources changed since this publish — publish again' : 'Published and up to date',
                 onClick: () => handlePublishClick(),
               },
               !inReview
                 ? {
                     key: 'review', label: 'Review', state: locked ? 'skipped' : 'optional',
                     // Read as an ACTION, not a state — "send for review" is the click.
                     detail: locked ? 'not reviewed'
                       : !isMarkupReviewAvailable() ? 'optional'
                       : published ? 'send for review →' : 'after publish',
                     title: !isMarkupReviewAvailable()
                       ? 'Optional review step (Markup.io is not configured in this environment)'
                       : published
                         ? 'Send the print PDF to Markup.io for supplier review (renders one first if needed)'
                         : 'Publish first — the review round uploads a rendered print PDF to Markup.io',
                     onClick: published && isMarkupReviewAvailable() ? () => openPrintForReview() : undefined,
                   }
                 : reviewDone
                   ? {
                       key: 'review', label: 'Review', state: 'done', detail: 'Review done',
                       title: `Markup.io review finished${instance?.reviewStatus ? ` (${instance.reviewStatus})` : ''} — open it`,
                       onClick: instance?.reviewUrl ? () => window.open(instance.reviewUrl!, '_blank', 'noreferrer') : undefined,
                     }
                   : {
                       key: 'review', label: 'Review', state: 'warn',
                       detail: typeof threads === 'number' ? `in review · ${threads} open` : 'in review',
                       title: 'Out on Markup.io collecting feedback — open the review',
                       onClick: instance?.reviewUrl ? () => window.open(instance.reviewUrl!, '_blank', 'noreferrer') : undefined,
                     },
               {
                 key: 'final', label: 'Final',
                 state: locked ? 'done' : 'todo',
                 detail: locked && instance?.finalizedAt ? new Date(instance.finalizedAt).toLocaleDateString() : undefined,
                 title: locked ? 'Signed off and locked' : 'Mark this manual FINAL (locks its content)',
                 onClick: !locked && instance ? () => setShowFinalizeConfirm(true) : undefined,
               },
               ...(isPrintExportAvailable() ? [{
                 key: 'print', label: 'Print',
                 state: (latestRenderVersion == null ? 'todo'
                   : instance?.version != null && latestRenderVersion < instance.version ? 'warn' : 'done') as PipelineStep['state'],
                 detail: latestRenderVersion === null ? 'no PDF yet'
                   : latestRenderVersion === undefined ? undefined
                   : instance?.version != null && latestRenderVersion < instance.version ? `v${latestRenderVersion} outdated` : `v${latestRenderVersion}`,
                 title: published ? 'Open the print-PDF dialog' : 'Publish first — the print PDF is built from the published files',
                 onClick: published ? () => openPrintForPublished() : undefined,
               } satisfies PipelineStep] : []),
             ];
             return <PipelineStepper steps={steps} />;
           })()}

           {locked && (
             <div className="flex items-center gap-3 mb-4 px-4 py-3 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-900">
               <Lock size={18} className="shrink-0 text-emerald-600" />
               <div className="text-sm flex-1">
                 <span className="font-semibold">This {typeLabel.toLowerCase()} is marked FINAL and is locked against changes.</span>{' '}
                 {instance?.finalizedAt && <>Finalized {new Date(instance.finalizedAt).toLocaleString()}{instance?.finalizedBy ? ` by ${instance.finalizedBy}` : ''}. </>}
                 To make changes, unlock it first — this prevents accidental edits to a finalized manual. You can still publish and export it.
               </div>
               <button onClick={() => setShowUnlockConfirm(true)} disabled={isBusy} className="flex items-center gap-1.5 bg-white border border-emerald-300 text-emerald-700 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-emerald-100 disabled:opacity-60"><Unlock size={14} /> Unlock to edit</button>
             </div>
           )}

           <div className="flex flex-1 gap-6 overflow-hidden">
               {/* LEFT: INPUTS — wider in "Add content" mode to fit the section tree + editor.
                   `lockedCls` neutralizes every editing surface when the manual is FINAL. */}
               <div className={`${editorMode === 'content' ? 'w-1/2' : 'w-1/3'} bg-white border border-gray-200 rounded-xl shadow flex flex-col overflow-hidden transition-all ${lockedCls}`}>
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
                   <div ref={fillScrollRef} className="flex-1 overflow-y-auto p-6 space-y-8">

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
                       <div {...fillAnchorProps(fillAnchors.skuBinding)} className={`border-b border-gray-100 pb-6${fillFlashCls(fillAnchors.skuBinding)}`}>
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

                       {/* REQUIRED LANGUAGES — which template languages this project produces, and in
                           what order (drives the editor tabs, publish, and print-export language list). */}
                       {languagePool.length > 1 && (
                         <div className="border-b border-gray-100 pb-6">
                           <h4 className="font-bold text-gray-800 mb-1 flex items-center gap-2 text-sm">
                             <Globe size={14} className="text-indigo-500" /> Required Languages
                           </h4>
                           <p className="text-xs text-muted mb-3">
                             Pick the languages this manual must be published in, and reorder them — e.g. German
                             first, then English, French, Italian. English is always included.
                           </p>
                           <div className="space-y-1 mb-2">
                             {requiredLanguages.map((code, i) => {
                               const locked = code === 'en';
                               return (
                                 <div key={code} className="flex items-center gap-1 bg-light border border-gray-200 rounded px-2 py-1">
                                   <span className="text-xs font-bold text-gray-700 flex-1">
                                     {code.toUpperCase()}{locked && <span className="text-muted font-normal"> · always included</span>}
                                   </span>
                                   <button
                                     type="button"
                                     onClick={() => moveRequiredLanguage(code, 'up')}
                                     disabled={i === 0}
                                     title="Move up"
                                     className="p-0.5 text-gray-400 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                   ><ChevronUp size={13} /></button>
                                   <button
                                     type="button"
                                     onClick={() => moveRequiredLanguage(code, 'down')}
                                     disabled={i === requiredLanguages.length - 1}
                                     title="Move down"
                                     className="p-0.5 text-gray-400 hover:text-indigo-600 disabled:opacity-30 disabled:cursor-not-allowed"
                                   ><ChevronDown size={13} /></button>
                                   {!locked && (
                                     <button
                                       type="button"
                                       onClick={() => toggleRequiredLanguage(code)}
                                       title="Remove from this manual"
                                       className="p-0.5 text-gray-400 hover:text-rose-600"
                                     ><X size={13} /></button>
                                   )}
                                 </div>
                               );
                             })}
                           </div>
                           <div className="flex flex-wrap items-center gap-2">
                             {/* One-click chips only when the pool is a short, curated list (a category
                                 template's own languages). The canonical 22 would just be alphabetical
                                 noise — that case goes through the modal. */}
                             {!projectOwnsLanguages && languagePool.filter(c => !requiredLanguages.includes(c)).map(code => (
                               <button
                                 key={code}
                                 type="button"
                                 onClick={() => toggleRequiredLanguage(code)}
                                 title="Click to include"
                                 className="px-2.5 py-1 rounded text-xs font-medium border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50 hover:border-gray-400"
                               >+ {code.toUpperCase()}</button>
                             ))}
                             <button
                               type="button"
                               onClick={openLangModal}
                               className="flex items-center gap-1 rounded border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 hover:bg-indigo-100"
                             ><Plus size={12} /> Add languages…</button>
                           </div>
                           {/* Says WHERE a language that isn't on offer comes from, so the dead end
                               of "the one I need isn't listed" has an answer on screen. */}
                           {!projectOwnsLanguages && (
                             <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
                               This manual follows its category template, so it can only use the {templateLangs.length} language(s)
                               that template declares. To offer another, add and translate it in the category template first.
                             </p>
                           )}
                         </div>
                       )}

                       {/* CHAPTERS & SECTIONS — the manual's outline, with inclusion per section.
                           Supersedes the old "Chapter Conditions" panel, which listed ONLY
                           attribute-conditioned chapters: an ordinary sub-section that doesn't
                           apply to this product was then excludable only from the Content tab's
                           tree, which is not where the other inclusion decisions live. Every
                           section is listed here at its real depth, and excluding one leaves out
                           everything nested inside it (the resolver skips a hidden subtree).
                           Same Auto/Include/Exclude control as the Optional & Conditional panel
                           below — the decision is identical, so the affordance must be too; a
                           section with no condition gets the two-state variant, because there
                           Auto and Include are the same outcome. */}
                       {(() => {
                         const rows = orderedSections.filter(s => s.title !== METADATA_SECTION_TITLE);
                         if (!rows.length) return null;
                         const inManual = rows.filter(s => isSectionEffectivelyVisible(s)).length;
                         const excludedByHand = rows.filter(s => sectionVisibility[s.id] === false).length;
                         const overridden = rows.filter(s => sectionVisibility[s.id] !== undefined);
                         return (
                         <div className="border-b border-gray-100 pb-6">
                           <div className="mb-1 flex flex-wrap items-center gap-2">
                             <h4 className="flex items-center gap-2 text-sm font-bold text-gray-800">
                               <span className="rounded bg-violet-100 px-1.5 py-0.5 text-xs font-bold text-violet-700">SEC</span> Chapters &amp; Sections
                             </h4>
                             <span className="text-[11px] font-medium text-gray-500">
                               {inManual} of {rows.length} in the manual
                               {excludedByHand > 0 && <span> · {excludedByHand} you left out</span>}
                             </span>
                             {overridden.length > 0 && (
                               <button
                                 type="button"
                                 onClick={() => setSectionVisibility(prev => {
                                   const next = { ...prev };
                                   overridden.forEach(s => delete next[s.id]);
                                   return next;
                                 })}
                                 title="Return every section to its default (its template condition, or in the manual)"
                                 className="flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-indigo-700"
                               ><RotateCcw size={11} /> Reset all</button>
                             )}
                           </div>
                           <p className="mb-3 max-w-[70ch] text-[11px] leading-relaxed text-gray-500">
                             Anything that doesn't apply to this product can be left out — a whole chapter or a
                             single sub-section inside one. Leaving out a section also leaves out everything nested
                             under it. Nothing here changes the shared template. To leave out one block instead of a
                             whole section, use <strong className="font-semibold text-gray-600">Exclude</strong> on that
                             block in the <strong className="font-semibold text-gray-600">Add content</strong> tab.
                           </p>
                           <div className="overflow-hidden rounded-lg border border-gray-200 divide-y divide-gray-100">
                             {rows.map(s => {
                               const outline = sectionOutline[s.id] ?? { prefix: '', level: 0 };
                               const isExtra = (s as any).__projectExtra === true;
                               const override = sectionVisibility[s.id];
                               // 'manual' is the template's own "in unless hidden" marker, not an
                               // attribute condition — it has no rule text to show.
                               const conditional = !!s.conditionFeatureId && s.conditionFeatureId !== 'manual';
                               const attr = conditional ? allAttributes.find(a => a.id === s.conditionFeatureId) : undefined;
                               const autoResult = (() => {
                                 if (!conditional || !s.conditionLabel) return true;
                                 const val = formData[s.conditionFeatureId!] ?? submittedAttrValues[s.conditionFeatureId!];
                                 if (val === undefined) return null; // no data
                                 return attr ? matchesConditionValue(val, s.conditionLabel, attr) : true;
                               })();
                               // Mirror isSectionVisible (and the resolver): a chapter whose
                               // condition has no data is LEFT OUT until the value arrives, so
                               // the preview always matches the published output.
                               const autoVisible = autoResult === null ? false : autoResult;
                               const own = isSectionVisible(s);
                               // Only worth naming an ancestor when this section is otherwise in:
                               // a section excluded on its own account is its own explanation.
                               const blocker = own ? excludedAncestorOf(s) : undefined;
                               const visible = own && !blocker;
                               const contrary = conditional && override !== undefined && override !== autoVisible;
                               return (
                                 <div
                                   key={s.id}
                                   {...fillAnchorProps(fillAnchors.condition(s.id))}
                                   className={`py-2 pr-3 ${visible ? '' : 'bg-gray-50/60'}${fillFlashCls(fillAnchors.condition(s.id))}`}
                                   style={{ paddingLeft: `${(outline.level * 14) + 12}px` }}
                                 >
                                   <div className="flex items-start gap-2">
                                     <div className="min-w-0 flex-1">
                                       <div className="flex items-center gap-1.5">
                                         <span className="shrink-0 font-mono text-[10px] text-gray-400">{outline.prefix}</span>
                                         <span className={`truncate text-xs font-semibold ${visible ? 'text-gray-800' : 'text-gray-500'}`}>
                                           {localizedSectionTitle(s, activeLang)}
                                         </span>
                                         {isExtra
                                           ? <FilePlus2 size={11} className="shrink-0 text-emerald-400" aria-label="Project section" />
                                           : s.isPlaceholder
                                             ? <LayoutTemplate size={11} className="shrink-0 text-amber-400" aria-label="Placeholder section" />
                                             : <Lock size={11} className="shrink-0 text-gray-300" aria-label="Template section" />}
                                       </div>
                                       {/* Second line only when there is something to explain: a plain
                                           included section needs no badge to say so. */}
                                       {(!visible || conditional) && (
                                         <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                           <Badge
                                             tone={visible ? 'emerald' : 'gray'}
                                             icon={visible ? <Check size={11} /> : <Minus size={11} />}
                                             className="rounded px-1.5 py-0 text-[10px]"
                                           >{visible ? 'In the manual' : 'Left out'}</Badge>
                                           {blocker && (
                                             <span className="text-[11px] text-gray-500">
                                               “{localizedSectionTitle(blocker, activeLang)}” is left out, so this goes with it
                                             </span>
                                           )}
                                           {conditional && (
                                             <span className="text-[11px] text-gray-500">
                                               {attr?.name ?? '?'} = {s.conditionLabel}
                                               {autoResult === null
                                                 ? ': no value entered yet — left out until the value arrives'
                                                 : autoResult ? ': matches' : ': no match'}
                                             </span>
                                           )}
                                           {contrary && (
                                             <span className="rounded bg-amber-50 px-1.5 py-0 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                                               Your choice overrides this rule
                                             </span>
                                           )}
                                         </div>
                                       )}
                                     </div>
                                     <IncludeModeControl
                                       // No condition means no Auto to distinguish from Include, so
                                       // that section gets two states and Include clears the override.
                                       value={conditional ? modeOf(override) : (override === false ? 'exclude' : 'include')}
                                       modes={conditional ? undefined : ['include', 'exclude']}
                                       ariaLabel={`Inclusion for section ${localizedSectionTitle(s, activeLang)}`}
                                       onChange={mode => setSectionVisibility(prev => {
                                         const next = { ...prev };
                                         if (mode === 'auto' || (mode === 'include' && !conditional)) delete next[s.id];
                                         else next[s.id] = mode === 'include';
                                         return next;
                                       })}
                                     />
                                   </div>
                                 </div>
                               );
                             })}
                           </div>
                         </div>
                         );
                       })()}

                       {/* OPTIONAL & CONDITIONAL CONTENT — inline rows / shared blocks with a
                           "Show if" condition, plus inline rows marked as opt-in placeholders.
                           Grouped by chapter and rendered by OptionalContentPanel; this block only
                           flattens the refs into the shape that panel consumes. */}
                       {(() => {
                         const merged = { ...submittedAttrValues, ...formData };
                         const items: OptionalContentItem[] = orderedSections.flatMap(section =>
                           (section.blockRefs ?? [])
                             .map((ref, index) => ({ ref, index }))
                             // Conditional and optional blocks, PLUS any ordinary block this
                             // project explicitly left out from the Content tab: an exclusion
                             // nobody can see in Setup is an exclusion nobody remembers making.
                             // SKU slots never appear — the resolver has no override for them.
                             .filter(x => x.ref.kind !== 'sku_slot' && (
                               refHasCondition(x.ref)
                               || (x.ref.kind === 'inline' && (x.ref as InlineBlockRef).isPlaceholder)
                               || (refVisibility[refVisKey(section.id, x.index, x.ref)] ?? refVisibility[`${section.id}:${x.index}`]) !== undefined
                             ))
                             .map(({ ref, index }) => {
                               const isPlaceholder = ref.kind === 'inline' && !!(ref as InlineBlockRef).isPlaceholder;
                               // A block with no template rule at all is here only because of an
                               // explicit choice — see OptionalContentItem.kind 'manual'.
                               const isManual = !isPlaceholder && !refHasCondition(ref);
                               const condAttrId = (ref as FeatureConditionFields).requires_feature ?? undefined;
                               // Show the project's version when this block has been edited for
                               // this project, matching what the manual will actually contain.
                               // Condition/placeholder metadata still comes from the template ref
                               // (an override copies those fields and can't change them).
                               const shownRef = ref.kind === 'inline'
                                 ? (getBlockOverride(section.id, index, ref) ?? ref)
                                 : ref;
                               const rawContent = shownRef.kind === 'block'
                                 ? (() => { const blk = availableBlocks[(shownRef as any).block_id]; return blk?.content?.[activeLang] || blk?.content?.['en'] || ''; })()
                                 : ((shownRef as any).content?.[activeLang] || (shownRef as any).content?.['en'] || '');
                               const snippet = rawContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
                               return {
                                 // Stable id key when the ref has one — survives template block
                                 // reordering (legacy positional key otherwise).
                                 key: refVisKey(section.id, index, ref),
                                 sectionId: section.id,
                                 sectionTitle: localizedSectionTitle(section, activeLang),
                                 label: snippet || (ref.kind === 'block' ? 'Shared block' : 'Inline content'),
                                 previewHtml: templateRefPreviewHtml(shownRef),
                                 kind: isManual ? 'manual' : isPlaceholder ? 'placeholder' : 'conditional',
                                 conditionText: isManual
                                   ? null
                                   : isPlaceholder
                                     ? ((ref as InlineBlockRef).note || null)
                                     : describeRefCondition(ref as FeatureConditionFields),
                                 autoVisible: refAutoVisible(ref),
                                 visible: isRefVisible(section.id, index, ref),
                                 override: refVisibility[refVisKey(section.id, index, ref)] ?? refVisibility[`${section.id}:${index}`],
                                 noData: !isPlaceholder && !!condAttrId && !merged[condAttrId],
                               };
                             })
                         );
                         return (
                           <OptionalContentPanel
                             items={items}
                             sectionOrder={orderedSections.map(s => s.id)}
                             onSetOverride={(key, override) => setRefVisibility(prev => {
                               const next = { ...prev };
                               if (override === undefined) delete next[key]; else next[key] = override;
                               return next;
                             })}
                           />
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
                               <div key={section.id} {...fillAnchorProps(fillAnchors.section(section.id))} className={`border-b border-gray-100 pb-6 last:border-0${fillFlashCls(fillAnchors.section(section.id))}`}>
                                   <div className="mb-4 flex items-center justify-between gap-2">
                                       <h4 className="flex min-w-0 items-center gap-2 text-sm font-bold text-gray-800">
                                           <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-muted">Sec {section.order}</span>
                                           <span className="truncate">{localizedSectionTitle(section, activeLang)}</span>
                                       </h4>
                                       {renderJumpToPreview(section)}
                                   </div>
                                   {section.isPlaceholder && <div className="mb-4 bg-indigo-50 p-3 rounded border border-indigo-100 text-xs text-blue-800"><AlertCircle size={14} className="inline mr-1"/> Placeholder Section</div>}
                                   {!contentHtml && items.length === 0 && attrTokens.length === 0 && slotRefs.length === 0 && !section.isPlaceholder && <div className="text-xs text-gray-400 italic mb-2">No content defined for {activeLang.toUpperCase()}.</div>}

                                   <div className="space-y-5">
                                       {/* SKU slot forms */}
                                       {slotRefs.map(ref => (
                                         <div key={`slot-${ref.slot}`} {...fillAnchorProps(fillAnchors.slot(ref.slot))} className={fillFlashCls(fillAnchors.slot(ref.slot)).trim()}>
                                           {renderSkuSlotForm(ref)}
                                         </div>
                                       ))}

                                       {/* Bound spec values ({{attribute}} tokens) — e.g. SKU, power.
                                           Auto-filled from supplier data; editable so PMs can verify/correct. */}
                                       {attrTokens.map(tok => {
                                           const attr = allAttributes.find(a => a.id === tok);
                                           const unit = attr?.validationRules?.unit ? ` ${attr.validationRules.unit}` : '';
                                           return (
                                             <div key={`tok-${tok}`} {...fillAnchorProps(fillAnchors.value(tok))} className={fillFlashCls(fillAnchors.value(tok)).trim()}>
                                               <BindableField
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
                                             </div>
                                           );
                                       })}

                                       {items.map((item, idx) => {
                                           const isFilled = !!formData[item.id];
                                           const featName = item.featureId !== 'manual' ? (allAttributes.find(f => f.id === item.featureId)?.name || 'Unknown Attribute') : null;
                                           return (
                                               <div key={`${item.id}-${idx}`} {...fillAnchorProps(fillAnchors.value(item.id))} className={`group${fillFlashCls(fillAnchors.value(item.id))}`}>
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

                           {/* Translation Status Badge */}
                           {otherRequiredLangs.length > 0 && (
                             <button
                               onClick={() => setIsTranslateModalOpen(true)}
                               className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1.5 font-medium transition-colors ${untranslatedSectionLabels.size === 0 ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' : 'bg-amber-50 text-orange-700 border-amber-200 hover:bg-amber-100'}`}
                               title="Review & auto-translate project-authored sections"
                             >
                               <Globe size={12} />
                               {untranslatedSectionLabels.size === 0 ? 'Translations complete' : `${untranslatedSectionLabels.size} untranslated`}
                             </button>
                           )}

                           {/* PRE-PUBLISH REVIEW — the panel Publish opens, on demand: the gaps it
                               lists are worth fixing while editing, not only at the gate. */}
                           <button
                             onClick={() => { setReviewPanel(prev => prev ?? { armed: false }); setReviewCollapsed(false); }}
                             className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1.5 font-medium transition-colors ${
                               reviewPanel && !reviewCollapsed
                                 ? 'bg-slate-100 text-gray-700 border-gray-300'
                                 : 'bg-white text-gray-500 border-gray-200 hover:bg-light'
                             }`}
                             title="Open the pre-publish review — missing values, untranslated chapters and the regulatory checklist"
                           >
                             <CheckSquare size={12} /> Publish review
                           </button>

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
                           <span className="text-xs text-muted border-l pl-2 border-gray-300 flex items-center gap-1"><Printer size={12}/> {metadata.pageSize.toUpperCase()}</span>
                           <span className="text-xs text-muted">{metadata.layout?.pageNumberingStyle}</span>
                       </div>
                   </div>
                   <div ref={previewScrollRef} className="flex-1 overflow-y-auto bg-gray-100 p-8 flex justify-center scroll-smooth motion-reduce:scroll-auto" onClick={handlePreviewClick}>
                       <div ref={previewRef} className="bg-white shadow-lg w-[210mm] min-h-[297mm] origin-top" data-icon-set={metadata.assets?.iconSet}>
                          {/* COVER PAGE */}
                          <div className="min-h-[297mm] flex flex-col relative bg-white mb-4 break-after-page" style={{ ...(getBackgroundStyle(masterPages.cover) || {}), ...(pageBackground ? { background: pageBackground } : {}) }} data-page-template={metadata.pages?.coverTemplate}>
                             {displayCoverImage && <div className="h-[400px] bg-cover bg-center" style={{ backgroundImage: `url(${displayCoverImage})` }} />}
                             <div className="flex-1 p-[20mm] flex flex-col justify-between">
                                <div>
                                   {displayLogo && <img src={displayLogo} alt="Logo" className="h-12 object-contain mb-10" />}
                                   <h1 className="text-4xl font-bold text-primary mb-4" style={{ color: metadata.brand?.textColors.heading, fontFamily: metadata.brand?.fontFamilies.heading }}>{displayTitle}</h1>
                                   <p className="text-xl text-muted uppercase tracking-widest font-light" style={{ color: metadata.brand?.textColors.muted, fontFamily: metadata.brand?.fontFamilies.body }}>{displaySubtitle}</p>
                                </div>
                                <div className="border-t-4 pt-6" style={{ borderColor: 'var(--im-primary-color)' }}>
                                   <p className="text-sm font-bold text-primary uppercase mb-1">{metadata.companyName || 'Company Name'}</p>
                                   <p className="text-xs text-muted">Original Instructions</p>
                                </div>
                             </div>
                          </div>
                          {/* CONTENT */}
                          <div className="p-[20mm] pb-[30mm] min-h-[297mm] bg-white relative" style={{ background: pageBackground }} data-page-template={metadata.pages?.bodyTemplate}>
                              {watermark && <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ background: watermark }} />}
                              <div className="space-y-6 text-gray-800 text-sm leading-relaxed">
                                  {orderedSections.map(section => {
                                      // WYSIWYG: the preview mirrors the generated output, so a chapter
                                      // excluded by its condition (or because none of its SKUs are bound)
                                      // is omitted entirely rather than shown dimmed. The "Optional &
                                      // Conditional Content" panel above remains the place to see/override
                                      // what's excluded.
                                      if (!isSectionInPreview(section)) return null;
                                      return (
                                        <div
                                          key={section.id}
                                          // Jump target for the editor's "Show in preview" controls.
                                          {...{ [PREVIEW_SECTION_ATTR]: section.id }}
                                          className={`mb-8 scroll-mt-6 rounded transition-shadow duration-500 motion-reduce:transition-none ${
                                            flashSectionId === section.id
                                              ? 'ring-2 ring-indigo-500 ring-offset-4 ring-offset-white'
                                              : 'ring-0'
                                          }`}
                                        >
                                          <h3 className="text-lg font-bold text-primary mb-3 border-b pb-2" style={{ borderColor: 'var(--im-primary-color)', color: metadata.brand?.textColors.heading, fontFamily: metadata.brand?.fontFamilies.heading }}>{localizedSectionTitle(section, activeLang)}</h3>
                                          <div className="im-content" style={{ color: metadata.brand?.textColors.body, fontFamily: metadata.brand?.fontFamilies.body, fontSize: `${metadata.brand?.fontSizes.body}px` }} dangerouslySetInnerHTML={{ __html: sanitizeHtml(buildSectionHtml(section)) }} />
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
                          {metadata.backPageContent && (
                              <div className="min-h-[297mm] bg-light p-[20mm] flex flex-col justify-end mt-4 break-before-page" style={pageBackground ? { background: pageBackground } : undefined} data-page-template={metadata.pages?.endPageVariants?.[0] || 'standard-end'}>
                                  <div className="border-t pt-8" style={{ borderColor: 'var(--im-primary-color)' }}>
                                      <div dangerouslySetInnerHTML={{ __html: sanitizeHtml(metadata.backPageContent) }} />
                                      <div className="mt-10 text-xs text-gray-400 text-center">
                                          &copy; {new Date().getFullYear()} {metadata.companyName || 'Company Name'}. All rights reserved.
                                      </div>
                                  </div>
                              </div>
                          )}
                       </div>
                   </div>
               </div>

               {/* PRE-PUBLISH REVIEW — docked beside the editor, not over it: every row is a
                   jump into the editor, so the list has to stay put while it is acted on.
                   Issues are rebuilt on each render, so a fixed item leaves the list at once. */}
               {reviewPanel && (
                   <PublishReviewPanel
                     typeLabel={typeLabel}
                     issues={publishIssues}
                     languageName={(code) => IM_LANGUAGE_NAMES[code] ?? code.toUpperCase()}
                     collapsed={reviewCollapsed}
                     onToggleCollapsed={() => setReviewCollapsed(c => !c)}
                     onClose={() => setReviewPanel(null)}
                     onJump={jumpToIssue}
                     activeIssueKey={activeIssueKey}
                     regulationGroups={regChecklistGroups}
                     checklistState={regChecklistState}
                     templateChecklistState={regTemplateState}
                     checklistSummary={regChecklistSummary}
                     checklistBusyKey={regChecklistBusy}
                     checklistError={regChecklistError}
                     onDecide={setChecklistDecision}
                     armed={reviewPanel.armed}
                     onPublish={() => { setReviewPanel(null); handleGenerate(); }}
                     // Disarmed rather than closed: "not yet" means "let me fix these first",
                     // and the list is what they need in order to do that.
                     onCancelPublish={() => setReviewPanel({ armed: false })}
                   />
               )}
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

            {showImport && (
                <ProjectImImportDialog
                    projectId={projectId!}
                    templateType={templateType}
                    onClose={() => setShowImport(false)}
                    onImported={() => { setShowImport(false); loadData(); }}
                />
            )}

            {showDiffImport && (
                <ProjectSupplierDiffImportDialog
                    projectId={projectId!}
                    templateId={selectedTemplateId}
                    templateType={templateType}
                    onClose={() => setShowDiffImport(false)}
                    onImported={() => { setShowDiffImport(false); loadData(); }}
                />
            )}

            {sharedPickerFor && (() => {
                const q = blockPickerSearch.trim().toLowerCase();
                const candidates = blockLibrary
                    .filter(b => b.approvalStatus === 'approved')
                    .filter(b => !q || b.title.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q) || (b.internalTitle ?? '').toLowerCase().includes(q));
                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setSharedPickerFor(null)}>
                        <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden" onMouseDown={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                                <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Lock size={16} className="text-amber-600" /> Add standardized block</h2>
                                <button onClick={() => setSharedPickerFor(null)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
                            </div>
                            <div className="px-5 pt-3">
                                <input
                                    autoFocus
                                    value={blockPickerSearch}
                                    onChange={e => setBlockPickerSearch(e.target.value)}
                                    placeholder="Search approved blocks by title, internal title or slug…"
                                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-amber-400"
                                />
                            </div>
                            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
                                {candidates.length === 0 && <div className="text-center py-10 text-gray-400 text-sm">No approved blocks{q ? ' match your search' : ' in the library yet'}.</div>}
                                {candidates.map(b => (
                                    <button
                                        key={b.id}
                                        onClick={() => { addSharedBlockToExtra(sharedPickerFor, b.id); setSharedPickerFor(null); }}
                                        className="w-full text-left border border-gray-200 rounded-lg px-3 py-2 hover:border-amber-300 hover:bg-amber-50 transition-colors"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm font-semibold text-gray-800">{b.title}</span>
                                            <span className="text-[9px] font-bold uppercase tracking-wide bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">{b.blockType}</span>
                                        </div>
                                        {b.internalTitle && <div className="text-[11px] text-violet-500 italic truncate">{b.internalTitle}</div>}
                                        <div className="text-[11px] font-mono text-gray-400 truncate">{b.slug}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            })()}
       </div>
    </Layout>
  );
};

export default ProjectIMGenerator;
