/** IMBlockLibrary — manage reusable IM content blocks (multilingual, with usage tracking). */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import Layout from '../../components/Layout';
import { getIMBlocks, saveIMBlock, deleteIMBlock, getIMBlockUsageCounts, BlockInUseError, getCategories, getCategoryAttributes } from '../../services';
import { uploadIMAsset } from '../../services/im/im-asset.service';
import { buildSlug, makeUid } from '../../services/im/block-slug';
import { IMBlock, CategoryL3, CategoryAttribute } from '../../types';
import { sanitizeHtml } from '../../utils';
import {
  Layers, Plus, Search, CheckCircle2, Clock, Edit2, Trash2, X,
  ChevronDown, ChevronUp, AlertTriangle, Info, Zap, AlertCircle, FileText, Upload, Images, Loader2, RefreshCw, Flame, Thermometer,
  Code, Bold, Italic, Underline, Languages as LanguagesIcon, QrCode
} from 'lucide-react';
import { translateHtml } from '../../services/ai/translation.service';
import { QR_SKU_PLACEHOLDER_ID } from '../../config/im.constants';
import { AssetLibraryPanel } from './editor/AssetLibraryPanel';
// Shared blocks are edited outside any one template, so model the HOUSE DEFAULT
// profile (full IM, A5) — the size most blocks will actually print at.
import { usePrintColumn } from './editor/usePrintColumn';
import { imContentVars } from './editor/im-content-style';
import './styles/im-content.css';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLOCK_TYPES = [
  { value: 'content',     label: 'Content',   color: 'bg-blue-100 text-blue-700' },
  { value: 'warning',     label: 'Warning',   color: 'bg-amber-100 text-amber-700' },
  { value: 'danger',      label: 'Danger',    color: 'bg-red-100 text-red-700' },
  { value: 'caution',     label: 'Caution',   color: 'bg-orange-100 text-orange-700' },
  { value: 'electric',    label: 'Electric',  color: 'bg-yellow-100 text-yellow-700' },
  { value: 'flammable',   label: 'Risk of Fire',  color: 'bg-rose-100 text-orange-700' },
  { value: 'hot_surface', label: 'Hot Surface',   color: 'bg-amber-100 text-amber-800' },
  { value: 'info',        label: 'Info',      color: 'bg-sky-100 text-sky-700' },
  { value: 'legacy_html', label: 'Legacy',    color: 'bg-gray-100 text-gray-600' },
] as const;

import { IM_LANGUAGE_TABS as LANGUAGES } from '../../config/im-languages';

type BlockTypeValue = typeof BLOCK_TYPES[number]['value'];

const blockTypeColor = (bt: string) =>
  BLOCK_TYPES.find(t => t.value === bt)?.color ?? 'bg-gray-100 text-gray-600';

const blockTypeLabel = (bt: string) =>
  BLOCK_TYPES.find(t => t.value === bt)?.label ?? bt;

const blockTypeIcon = (bt: string) => {
  if (bt === 'warning')  return <AlertTriangle size={12} />;
  if (bt === 'danger')   return <AlertTriangle size={12} />;
  if (bt === 'caution')  return <AlertCircle   size={12} />;
  if (bt === 'electric') return <Zap           size={12} />;
  if (bt === 'flammable') return <Flame        size={12} />;
  if (bt === 'hot_surface') return <Thermometer size={12} />;
  if (bt === 'info')     return <Info          size={12} />;
  return <FileText size={12} />;
};

// ---------------------------------------------------------------------------
// Empty block factory
// ---------------------------------------------------------------------------

const emptyBlock = (): Partial<IMBlock> => ({
  slug: '',
  title: '',
  blockType: 'content',
  sourceLanguage: 'en',
  content: { en: '' },
  placeholders: [],
  applicableCategories: [],
  regulationRefs: [],
  approvalStatus: 'draft',
});

// ---------------------------------------------------------------------------
// Block Editor Modal
// ---------------------------------------------------------------------------

interface BlockModalProps {
  block: Partial<IMBlock>;
  categories: CategoryL3[];
  allAttributes: CategoryAttribute[];
  onSave: (b: Partial<IMBlock>) => Promise<void>;
  onClose: () => void;
  saving: boolean;
  saveError?: string;
}

const BlockModal: React.FC<BlockModalProps> = ({ block: initial, categories, allAttributes, onSave, onClose, saving, saveError }) => {
  const isNew = !initial.id;

  const printGeometry = usePrintColumn('im', 'a5');
  const [draft, setDraft] = useState<Partial<IMBlock>>(initial);
  const [activeLang, setActiveLang] = useState('en');
  const [uploadingImg, setUploadingImg] = useState(false);
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  const [slugDirty, setSlugDirty] = useState(false);
  const [slugUid, setSlugUid] = useState(makeUid);
  // Content editing surface: 'visual' = WYSIWYG (contentEditable), 'html' = raw source.
  const [contentMode, setContentMode] = useState<'visual' | 'html'>('visual');
  const imgInputRef = useRef<HTMLInputElement>(null);
  const visualRef = useRef<HTMLDivElement>(null);
  const htmlTextareaRef = useRef<HTMLTextAreaElement>(null);
  // Last caret/selection inside the visual surface, restored before a programmatic
  // insert (upload, asset picker) that would otherwise land at the end because the
  // triggering button/modal steals focus first.
  const savedRangeRef = useRef<Range | null>(null);

  const set = (updates: Partial<IMBlock>) => setDraft(prev => ({ ...prev, ...updates }));

  const setContent = (lang: string, html: string) =>
    setDraft(prev => ({ ...prev, content: { ...prev.content, [lang]: html } }));

  // Seed the visual surface from state only when the language or mode changes —
  // never on every keystroke, so the caret doesn't jump while typing.
  useEffect(() => {
    if (contentMode === 'visual' && visualRef.current) {
      visualRef.current.innerHTML = sanitizeHtml(draft.content?.[activeLang] ?? '');
    }
  }, [activeLang, contentMode]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveSelection = useCallback(() => {
    const el = visualRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  }, []);

  // Insert a snippet (image / attribute token) at the caret, mode-aware. Visual mode
  // restores the last saved selection (falling back to the end) before running
  // execCommand, so an insert triggered from a button/modal — which steals focus —
  // still lands where the user was, not appended after whatever they'd typed. HTML
  // mode reads the textarea's own selection, which survives a blur.
  const insertIntoContent = (html: string) => {
    if (contentMode === 'visual' && visualRef.current) {
      const el = visualRef.current;
      el.focus();
      const sel = window.getSelection();
      if (sel) {
        const saved = savedRangeRef.current;
        if (saved && el.contains(saved.commonAncestorContainer)) {
          sel.removeAllRanges();
          sel.addRange(saved);
        } else {
          const end = document.createRange();
          end.selectNodeContents(el);
          end.collapse(false);
          sel.removeAllRanges();
          sel.addRange(end);
        }
      }
      document.execCommand('insertHTML', false, html);
      savedRangeRef.current = null;
      setContent(activeLang, el.innerHTML);
    } else {
      const ta = htmlTextareaRef.current;
      const current = draft.content?.[activeLang] ?? '';
      const start = ta?.selectionStart ?? current.length;
      const end = ta?.selectionEnd ?? current.length;
      setContent(activeLang, current.slice(0, start) + html + current.slice(end));
    }
  };

  // --- AI translation (EN → all / specific language) ---
  const [translateTarget, setTranslateTarget] = useState('all');
  // "Only missing languages" is OPT-IN. It used to be forced on for "all", so on a
  // block that already carried every language — the normal state of a library block —
  // the run skipped all 21 targets, changed nothing and said nothing: the button
  // looked broken. Retranslating after an edit to EN is the common case, so the
  // default now translates every target and replaces what is there (after a confirm).
  const [translateOnlyMissing, setTranslateOnlyMissing] = useState(false);
  const [translating, setTranslating] = useState(false);
  const [translateProgress, setTranslateProgress] = useState({ done: 0, total: 0 });
  // Outcome of the last run, shown under the button. Every exit path sets this, so
  // the button always reports what it did — including "nothing, and here's why".
  const [translateStatus, setTranslateStatus] = useState<{ tone: 'ok' | 'warn'; text: string } | null>(null);

  // Translate the block's English content into the chosen target(s). Placeholders/
  // formatting are preserved by translation.service. Results populate the language
  // tabs; nothing is persisted until the user reviews and clicks Save.
  const handleTranslateBlock = async () => {
    const source = (draft.content?.['en'] ?? '').trim();
    if (!source) {
      setTranslateStatus({ tone: 'warn', text: 'Add English content first — translation uses EN as the source.' });
      return;
    }
    const isAll = translateTarget === 'all';
    const candidates = isAll
      ? LANGUAGES.filter(l => l.code !== 'en').map(l => l.code)
      : [translateTarget];
    const isFilled = (code: string) => !!(draft.content?.[code] ?? '').trim();
    const targets = isAll && translateOnlyMissing ? candidates.filter(c => !isFilled(c)) : candidates;
    if (!targets.length) {
      setTranslateStatus({
        tone: 'warn',
        text: `Nothing to translate — all ${candidates.length} languages already have content. Untick "Only missing" to retranslate them.`,
      });
      return;
    }
    // One click on "All languages" replaces every translation of the block, so ask
    // first — a specific pick is a deliberate single-language overwrite and doesn't.
    const overwrites = targets.filter(isFilled);
    if (isAll && overwrites.length) {
      const listed = overwrites.slice(0, 8).map(c => c.toUpperCase()).join(', ');
      const ok = window.confirm(
        `Retranslate from English and REPLACE the existing content in ${overwrites.length} language(s)` +
        ` (${listed}${overwrites.length > 8 ? '…' : ''})?\n\nNothing is saved until you click Save.`
      );
      if (!ok) { setTranslateStatus({ tone: 'warn', text: 'Translation cancelled — nothing changed.' }); return; }
    }

    setTranslateStatus(null);
    setTranslating(true);
    setTranslateProgress({ done: 0, total: targets.length });
    const nextContent: Record<string, string> = { ...(draft.content ?? {}) };
    const failures: string[] = [];
    let firstError = '';
    let idx = 0, done = 0;
    const worker = async () => {
      while (idx < targets.length) {
        const code = targets[idx++];
        try { nextContent[code] = await translateHtml(source, 'en', code); }
        catch (e: any) {
          failures.push(code.toUpperCase());
          // Keep the first message: a whole run failing is nearly always ONE cause
          // (not signed in, or the Netlify function isn't served) worth showing.
          if (!firstError) firstError = e?.message ?? '';
        }
        done += 1;
        setTranslateProgress({ done, total: targets.length });
      }
    };
    try {
      await Promise.all(Array.from({ length: Math.min(4, targets.length) }, worker));
      set({ content: nextContent });
      // Reseed the visual surface if the currently-shown language was translated.
      if (contentMode === 'visual' && visualRef.current) visualRef.current.innerHTML = sanitizeHtml(nextContent[activeLang] ?? '');
      const translated = targets.length - failures.length;
      setTranslateStatus(failures.length
        ? {
            tone: 'warn',
            text: `Translated ${translated} of ${targets.length}. Failed: ${failures.join(', ')} (left unchanged)` +
              `${firstError ? ` — ${firstError}` : ''}`,
          }
        : { tone: 'ok', text: `Translated ${translated} language(s) — review the tabs, then Save.` });
    } finally {
      setTranslating(false);
    }
  };

  // Auto-generate slug from title + type while the user hasn't hand-edited it
  useEffect(() => {
    if (!isNew || slugDirty) return;
    set({ slug: buildSlug(draft.title ?? '', draft.blockType ?? 'content', slugUid) });
  }, [draft.title, draft.blockType, slugUid]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRefreshSlug = () => {
    const uid = makeUid();
    setSlugUid(uid);
    setSlugDirty(false);
    set({ slug: buildSlug(draft.title ?? '', draft.blockType ?? 'content', uid) });
  };

  const handleImgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImg(true);
    try {
      const url = await uploadIMAsset(file, 'blocks');
      const tag = `<img src="${url}" alt="${file.name}" style="max-width:100%;height:auto;border-radius:4px;margin:8px 0;">`;
      insertIntoContent(tag);
    } catch (err: any) {
      console.error('[BlockModal] image upload failed:', err);
      alert(err?.message ?? 'Image upload failed — see console for details.');
    } finally {
      setUploadingImg(false);
      if (imgInputRef.current) imgInputRef.current.value = '';
    }
  };

  const toggleCategory = (id: string) => {
    const cats = draft.applicableCategories ?? [];
    set({ applicableCategories: cats.includes(id) ? cats.filter(c => c !== id) : [...cats, id] });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title?.trim()) { alert('Title is required'); return; }
    if (!draft.slug?.trim()) { alert('Slug could not be generated — please enter one manually.'); return; }
    await onSave(draft);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-5 border-b border-gray-100">
          <h3 className="font-bold text-lg text-primary">
            {initial.id ? 'Edit Block' : 'New Shared Block'}
          </h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-700"><X size={20} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Title — drives auto-slug generation */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Title <span className="text-rose-400">*</span></label>
            <input
              autoFocus
              className="w-full border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={draft.title ?? ''}
              onChange={e => set({ title: e.target.value })}
              placeholder="General Electrical Safety"
              required
            />
          </div>

          {/* Internal title — for differentiating blocks internally; never printed on IMs */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Internal Title</label>
            <input
              className="w-full border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={draft.internalTitle ?? ''}
              onChange={e => set({ internalTitle: e.target.value })}
              placeholder="e.g. EU variant · rev 2024"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              A private label to tell similar blocks apart in the library. Never shown on generated manuals.
            </p>
          </div>

          {/* Slug — auto-generated, editable */}
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">
              Slug
              {isNew && !slugDirty && (
                <span className="ml-2 text-[10px] font-normal text-indigo-500 normal-case">auto-generated</span>
              )}
            </label>
            <div className="flex items-center gap-2">
              <input
                className="flex-1 border rounded-lg p-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={draft.slug ?? ''}
                onChange={e => {
                  setSlugDirty(true);
                  set({ slug: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') });
                }}
                placeholder="warning_electrical_safety_a3b4c5"
                required
              />
              <button
                type="button"
                onClick={handleRefreshSlug}
                title="Regenerate slug from title + type"
                className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg border border-gray-200 transition-colors shrink-0"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <p className="text-[10px] text-gray-400 mt-1">
              Auto-generated from title and block type. Editable — click <RefreshCw size={9} className="inline" /> to regenerate.
            </p>
          </div>

          {/* Type + Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Block Type</label>
              <select
                className="w-full border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={draft.blockType ?? 'content'}
                onChange={e => set({ blockType: e.target.value as BlockTypeValue })}
              >
                {BLOCK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase mb-1">Approval Status</label>
              <select
                className="w-full border rounded-lg p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                value={draft.approvalStatus ?? 'draft'}
                onChange={e => set({ approvalStatus: e.target.value as 'draft' | 'approved' })}
              >
                <option value="draft">Draft</option>
                <option value="approved">Approved</option>
              </select>
            </div>
          </div>

          {/* Categories */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold text-gray-500 uppercase">Applicable Categories</label>
              <button
                type="button"
                onClick={() => {
                  const isAll = (draft.applicableCategories ?? []).length === 0;
                  // Turning OFF "all": pre-select every existing category so the user can deselect specific ones.
                  // Turning ON "all": clear the array — resolver treats [] as "all, including future".
                  set({ applicableCategories: isAll ? categories.map(c => c.id) : [] });
                }}
                className={`flex items-center gap-2 text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                  (draft.applicableCategories ?? []).length === 0
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-500 border-gray-300 hover:border-indigo-400'
                }`}
              >
                <CheckCircle2 size={11} />
                All categories
              </button>
            </div>

            {(draft.applicableCategories ?? []).length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-700">
                <CheckCircle2 size={13} className="shrink-0 text-indigo-500" />
                Applies to all categories, including any created in the future. Toggle off to restrict to specific ones.
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                {categories.map(cat => {
                  const selected = (draft.applicableCategories ?? []).includes(cat.id);
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => toggleCategory(cat.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                        selected
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'
                      }`}
                    >
                      {cat.name}
                    </button>
                  );
                })}
                {categories.length === 0 && <span className="text-xs text-gray-400">No categories found</span>}
              </div>
            )}
          </div>

          {/* Content per language */}
          <div>
            <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
              <label className="text-xs font-semibold text-gray-500 uppercase">Content</label>
              {/* AI translate the EN source into all / a specific language */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-gray-400 uppercase tracking-wide">AI translate EN →</span>
                <select
                  value={translateTarget}
                  onChange={e => { setTranslateTarget(e.target.value); setTranslateStatus(null); }}
                  disabled={translating}
                  className="border border-indigo-200 rounded px-2 py-1 text-xs bg-indigo-50 text-indigo-700 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:opacity-60"
                >
                  <option value="all">All languages</option>
                  {LANGUAGES.filter(l => l.code !== 'en').map(l => (
                    <option key={l.code} value={l.code}>{l.name}</option>
                  ))}
                </select>
                {translateTarget === 'all' && (
                  <label className="flex items-center gap-1 text-[10px] text-gray-500" title="Skip languages that already have content — otherwise every language is retranslated from EN">
                    <input
                      type="checkbox"
                      checked={translateOnlyMissing}
                      onChange={e => { setTranslateOnlyMissing(e.target.checked); setTranslateStatus(null); }}
                      disabled={translating}
                      className="w-3 h-3 accent-indigo-600"
                    />
                    Only missing
                  </label>
                )}
                <button
                  type="button"
                  onClick={handleTranslateBlock}
                  disabled={translating}
                  title="Translate the English content; placeholders and formatting are preserved"
                  className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
                >
                  {translating
                    ? <><Loader2 size={12} className="animate-spin" /> {translateProgress.done}/{translateProgress.total}</>
                    : <><LanguagesIcon size={12} /> Translate</>}
                </button>
              </div>
            </div>
            {translateStatus && (
              <div className={`mb-2 text-xs rounded border px-2 py-1 ${
                translateStatus.tone === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}>
                {translateStatus.text}
              </div>
            )}
            {/* Language tabs — wrap across rows so all 28 languages fit; hover shows the full name */}
            <div className="flex flex-wrap gap-1 mb-2">
              {LANGUAGES.map(l => (
                <button
                  key={l.code}
                  type="button"
                  onClick={() => setActiveLang(l.code)}
                  title={l.name}
                  aria-label={l.name}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    activeLang === l.code
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {l.label}
                  {/* Dot = this language has content, so a translation run's effect is visible here */}
                  {!!(draft.content?.[l.code] ?? '').trim() && (
                    <span className={`w-1.5 h-1.5 rounded-full ${activeLang === l.code ? 'bg-white' : 'bg-emerald-500'}`} />
                  )}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              {/* Visual / HTML view toggle */}
              <div className="flex rounded border border-gray-200 overflow-hidden mr-auto">
                <button
                  type="button"
                  onClick={() => setContentMode('visual')}
                  className={`px-2 py-1 text-xs font-medium transition-colors ${contentMode === 'visual' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >Visual</button>
                <button
                  type="button"
                  onClick={() => setContentMode('html')}
                  className={`px-2 py-1 text-xs font-medium flex items-center gap-1 transition-colors ${contentMode === 'html' ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                ><Code size={12} /> HTML</button>
              </div>
              {/* Inline formatting (visual mode) */}
              {contentMode === 'visual' && (
                <>
                  <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('bold'); }} className="p-1 hover:bg-gray-100 rounded text-gray-600" title="Bold"><Bold size={14} /></button>
                  <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('italic'); }} className="p-1 hover:bg-gray-100 rounded text-gray-600" title="Italic"><Italic size={14} /></button>
                  <button type="button" onMouseDown={e => { e.preventDefault(); document.execCommand('underline'); }} className="p-1 hover:bg-gray-100 rounded text-gray-600" title="Underline"><Underline size={14} /></button>
                </>
              )}
              {/* Attribute value token picker */}
              {allAttributes.length > 0 && (
                <select
                  className="border border-violet-200 rounded px-2 py-1 text-xs bg-violet-50 text-violet-700 focus:outline-none focus:ring-1 focus:ring-violet-400 max-w-48"
                  value=""
                  onChange={e => {
                    const attr = allAttributes.find(a => a.id === e.target.value);
                    if (!attr) return;
                    insertIntoContent(`{{${attr.id}}}`);
                    e.target.value = '';
                  }}
                >
                  <option value="">+ Insert attribute value…</option>
                  {allAttributes.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); saveSelection(); insertIntoContent(`{{${QR_SKU_PLACEHOLDER_ID}}}`); }}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                title="SKU QR code — filled in automatically with a QR code linking to use.berlin/<SKU>, wherever this block is used"
              >
                <QrCode size={12} /> QR Code
              </button>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); saveSelection(); imgInputRef.current?.click(); }}
                disabled={uploadingImg}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
              >
                {uploadingImg ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                {uploadingImg ? 'Uploading…' : 'Upload Image'}
              </button>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); saveSelection(); setShowAssetPicker(true); }}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                title="Search &amp; insert from the asset library"
              >
                <Images size={12} /> Assets
              </button>
              <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={handleImgUpload} />
            </div>
            {contentMode === 'html' ? (
              <textarea
                ref={htmlTextareaRef}
                className="w-full border rounded-lg p-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-y"
                rows={8}
                value={draft.content?.[activeLang] ?? ''}
                onChange={e => setContent(activeLang, e.target.value)}
                placeholder={`<p>Block content in ${activeLang.toUpperCase()}…</p>`}
              />
            ) : (
              <div
                ref={visualRef}
                contentEditable
                suppressContentEditableWarning
                onInput={e => { saveSelection(); setContent(activeLang, e.currentTarget.innerHTML); }}
                onMouseUp={saveSelection}
                onKeyUp={saveSelection}
                onBlur={saveSelection}
                className="im-content w-full border rounded-lg p-3 text-sm min-h-[12rem] max-h-[24rem] overflow-y-auto focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                style={printGeometry ? imContentVars(printGeometry) : undefined}
              />
            )}
            <p className="text-[10px] text-gray-400 mt-1">
              Use <code className="bg-gray-100 px-1 rounded">{`{{token}}`}</code> or pick an attribute above to insert its auto-resolved value.
              English is required; other languages are optional (resolver falls back to EN with a warning).
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-100 bg-light/40 rounded-b-xl space-y-2">
          {saveError && (
            <div className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">
              {saveError}
            </div>
          )}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : (initial.id ? 'Save Changes' : 'Create Block')}
            </button>
          </div>
        </div>
      </form>

      {showAssetPicker && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setShowAssetPicker(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl h-[80vh] flex flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Images size={18} className="text-indigo-600" /> Asset Library</h2>
              <button type="button" onClick={() => setShowAssetPicker(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <AssetLibraryPanel onInsert={(html) => { insertIntoContent(html); setShowAssetPicker(false); }} />
          </div>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Block card
// ---------------------------------------------------------------------------

interface BlockCardProps {
  block: IMBlock;
  onEdit: () => void;
  onDelete: () => void;
  categories: CategoryL3[];
  usageCount: number;
}

const BlockCard: React.FC<BlockCardProps> = ({ block, onEdit, onDelete, categories, usageCount }) => {
  const [expanded, setExpanded] = useState(false);
  const cardGeometry = usePrintColumn('im', 'a5');
  const catNames = (block.applicableCategories ?? [])
    .map(id => categories.find(c => c.id === id)?.name ?? id);

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md transition-shadow">
      <div className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${blockTypeColor(block.blockType)}`}>
                {blockTypeIcon(block.blockType)}
                {blockTypeLabel(block.blockType).toUpperCase()}
              </span>
              {block.approvalStatus === 'approved' ? (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  <CheckCircle2 size={10} /> APPROVED
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                  <Clock size={10} /> DRAFT
                </span>
              )}
              {usageCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700"
                  title={`Referenced by ${usageCount} template section${usageCount !== 1 ? 's' : ''}`}
                >
                  <Layers size={10} /> IN USE · {usageCount}
                </span>
              )}
            </div>
            <h3 className="font-bold text-gray-800 truncate">{block.title}</h3>
            {block.internalTitle && (
              <p className="text-xs text-violet-500 truncate italic" title={block.internalTitle}>{block.internalTitle}</p>
            )}
            <p className="text-xs font-mono text-gray-400 truncate">{block.slug}</p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onEdit} className="p-1.5 text-gray-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50"><Edit2 size={14} /></button>
            <button
              onClick={onDelete}
              disabled={usageCount > 0}
              title={usageCount > 0
                ? `In use by ${usageCount} template section${usageCount !== 1 ? 's' : ''}. Remove it from all IM templates before deleting.`
                : 'Delete block'}
              className="p-1.5 text-gray-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-400 disabled:hover:bg-transparent"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mt-2">
          {catNames.length === 0 ? (
            <span className="text-[10px] bg-indigo-100 text-indigo-600 px-2 py-0.5 rounded-full font-medium">All categories</span>
          ) : (
            catNames.map(n => (
              <span key={n} className="text-[10px] bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{n}</span>
            ))
          )}
        </div>
      </div>

      {/* Expandable content preview */}
      <div className="border-t border-gray-100">
        <button
          onClick={() => setExpanded(e => !e)}
          className="w-full flex items-center justify-between px-4 py-2 text-xs text-gray-400 hover:text-gray-600 hover:bg-light/50 transition-colors"
        >
          <span>Content preview (EN)</span>
          {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {expanded && (
          <div className="px-4 pb-4">
            <div
              className="text-sm text-gray-600 border rounded-lg p-3 bg-light/30 max-h-40 overflow-y-auto im-content"
              style={cardGeometry ? imContentVars(cardGeometry) : undefined}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(block.content['en'] ?? '<em class="text-gray-400">No English content</em>') }}
            />
          </div>
        )}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// BlockLibraryContent — reusable, no Layout wrapper
// Used both by the standalone /im/library route and the IMDashboard tab.
// ---------------------------------------------------------------------------

export const BlockLibraryContent: React.FC = () => {
  const [blocks, setBlocks] = useState<IMBlock[]>([]);
  const [categories, setCategories] = useState<CategoryL3[]>([]);
  const [allAttributes, setAllAttributes] = useState<CategoryAttribute[]>([]);
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [searchText, setSearchText] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');

  const [editingBlock, setEditingBlock] = useState<Partial<IMBlock> | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>('');

  const loadData = useCallback(async () => {
    const [blks, cats, attrs, usage] = await Promise.all([
      getIMBlocks(), getCategories(), getCategoryAttributes(), getIMBlockUsageCounts(),
    ]);
    setBlocks(blks);
    setCategories(cats);
    setAllAttributes(attrs);
    setUsageCounts(usage);
    setLoading(false);
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const handleSave = async (draft: Partial<IMBlock>) => {
    setSaving(true);
    setSaveError('');
    try {
      await saveIMBlock(draft);
      await loadData();
      setEditingBlock(null);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      console.error('[BlockLibrary] saveIMBlock failed:', e);
      setSaveError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (block: IMBlock) => {
    // Hard stop for in-use blocks — the service enforces this too, but catch it
    // here so the user never even reaches the confirm for a block that can't go.
    if ((usageCounts[block.id] ?? 0) > 0) {
      alert(`"${block.title}" is still used by ${usageCounts[block.id]} template section(s). Remove it from all IM templates before deleting.`);
      return;
    }
    if (!confirm(`Delete block "${block.title}"?`)) return;
    try {
      await deleteIMBlock(block.id);
      setBlocks(prev => prev.filter(b => b.id !== block.id));
    } catch (e: any) {
      // BlockInUseError (or any concurrent-edit race) lands here with a clear message.
      console.error('[BlockLibrary] deleteIMBlock failed:', e);
      alert(e instanceof BlockInUseError ? e.message : (e?.message ?? 'Failed to delete block.'));
      await loadData(); // refresh counts in case usage changed under us
    }
  };

  const filtered = blocks.filter(b => {
    if (filterType !== 'all' && b.blockType !== filterType) return false;
    if (filterStatus !== 'all' && b.approvalStatus !== filterStatus) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      return b.title.toLowerCase().includes(q) || b.slug.toLowerCase().includes(q) || (b.internalTitle ?? '').toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            placeholder="Search by title, internal title or slug…"
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
        </div>
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
        >
          <option value="all">All types</option>
          {BLOCK_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
        >
          <option value="all">All statuses</option>
          <option value="draft">Draft</option>
          <option value="approved">Approved</option>
        </select>
        <button
          onClick={() => setEditingBlock(emptyBlock())}
          className="flex items-center gap-1.5 bg-indigo-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-indigo-700 text-sm shadow-sm shrink-0"
        >
          <Plus size={15} /> New Block
        </button>
      </div>

      <p className="text-xs text-gray-400 mb-4">
        {loading ? 'Loading…' : `${filtered.length} block${filtered.length !== 1 ? 's' : ''}${filtered.length !== blocks.length ? ` (${blocks.length} total)` : ''}`}
      </p>

      {loading ? (
        <div className="text-center py-16 text-gray-400">Loading blocks…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 border border-dashed border-gray-200 rounded-xl text-gray-400 bg-light">
          {blocks.length === 0 ? 'No blocks yet. Click "New Block" to create your first shared block.' : 'No blocks match the current filters.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map(block => (
            <BlockCard
              key={block.id}
              block={block}
              categories={categories}
              usageCount={usageCounts[block.id] ?? 0}
              onEdit={() => setEditingBlock(block)}
              onDelete={() => handleDelete(block)}
            />
          ))}
        </div>
      )}

      {editingBlock && (
        <BlockModal
          block={editingBlock}
          categories={categories}
          allAttributes={allAttributes}
          onSave={handleSave}
          onClose={() => { setEditingBlock(null); setSaveError(''); }}
          saving={saving}
          saveError={saveError}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Standalone page (wraps content in Layout for the /im/library route)
// ---------------------------------------------------------------------------

const IMBlockLibrary: React.FC = () => (
  <Layout>
    <div className="mb-6">
      <h1 className="text-3xl font-bold text-primary flex items-center gap-2">
        <Layers className="text-indigo-600" /> Block Library
      </h1>
      <p className="text-muted mt-1">Shared, reusable approved content units for IM templates.</p>
    </div>
    <BlockLibraryContent />
  </Layout>
);

export default IMBlockLibrary;
