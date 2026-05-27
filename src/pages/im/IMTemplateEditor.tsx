
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Layout from '../../components/Layout';
import { getIMTemplateByCategoryId, getIMSections, saveIMSection, deleteIMSection, getCategories, updateIMTemplate, getCategoryAttributes } from '../../services';
import { IMTemplate, IMSection, CategoryL3, CategoryAttribute, IMTemplateMetadata, IMMasterLayoutName } from '../../types';
import { Plus, Save, Trash2, ArrowLeft, LayoutTemplate, X, CheckCircle, Clock, User, ChevronUp, ChevronDown, Settings, Bold, Italic, Underline, List, Sparkles, Loader2, Type, Image as ImageIcon, GitBranch, Table as TableIcon, AlertTriangle, Info, Upload, Grid, Layers, Zap, AlertOctagon } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getAttributesForCategory } from '../../utils';
import { GoogleGenAI } from "@google/genai";
import './styles/im-content.css';
import { getIMThemeVariables } from './styles/im-theme';

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

// --- Structured Rich Text Editor ---
type BlockInsertType = 'warning' | 'info' | 'table' | 'caution' | 'electric';

type InlineNode =
  | { type: 'text'; text: string; marks?: Array<'bold' | 'italic' | 'underline'> }
  | { type: 'placeholder'; id: string; placeholderType: 'text' | 'image'; label: string }
  | { type: 'condition'; id: string; featureId: string; featureName?: string; conditionValue?: string; content: string };

type EditorBlock =
  | { id: string; type: 'paragraph'; content: InlineNode[] }
  | { id: string; type: 'heading'; level: 1 | 2 | 3; content: InlineNode[] }
  | { id: string; type: 'callout'; variant: 'warning' | 'caution' | 'electric' | 'info'; content: InlineNode[] }
  | { id: string; type: 'image'; src: string; alt?: string }
  | { id: string; type: 'table'; rows: string[][] }
  | { id: string; type: 'conditional'; condition: { id: string; featureId: string; featureName?: string }; content: InlineNode[] }
  | { id: string; type: 'legacy_html'; html: string };

interface EditorProps {
  initialContent: string;
  onChange: (html: string) => void;
  placeholder?: string;
  onInsertPlaceholder?: (type: 'text' | 'image') => void;
  onInsertCondition?: () => void;
  minimal?: boolean;
}

const createId = () => Math.random().toString(36).slice(2, 11);

const SimpleRichTextEditor: React.FC<EditorProps> = ({ initialContent, onChange, placeholder, onInsertPlaceholder, onInsertCondition, minimal }) => {
  const [blocks, setBlocks] = useState<EditorBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const initializingRef = useRef(false);
  const isUserEditingRef = useRef(false);
  const lastEmittedHtmlRef = useRef<string>('');
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const parseInlineNodes = useCallback((container: HTMLElement): InlineNode[] => {
    const inlines: InlineNode[] = [];

    const walk = (node: Node, marks: Array<'bold' | 'italic' | 'underline'> = []) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (text) inlines.push({ type: 'text', text, marks: marks.length ? marks : undefined });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as HTMLElement;

      if (el.classList.contains('im-placeholder')) {
        inlines.push({
          type: 'placeholder',
          id: el.dataset.id || createId(),
          placeholderType: (el.dataset.type as 'text' | 'image') || 'text',
          label: decodeURIComponent(el.dataset.label || '').trim() || el.textContent?.replace(/[\[\]]/g, '').trim() || 'Text'
        });
        return;
      }

      if (el.classList.contains('im-condition')) {
        inlines.push({
          type: 'condition',
          id: el.dataset.id || createId(),
          featureId: el.dataset.featureId || 'manual',
          featureName: el.dataset.featureName || '',
          conditionValue: decodeURIComponent(el.dataset.conditionValue || ''),
          content: decodeURIComponent(el.dataset.content || '').trim() || el.textContent || ''
        });
        return;
      }

      if (el.tagName === 'BR') {
        inlines.push({ type: 'text', text: '\n', marks: marks.length ? marks : undefined });
        return;
      }

      const nextMarks = [...marks];
      if (['B', 'STRONG'].includes(el.tagName) && !nextMarks.includes('bold')) nextMarks.push('bold');
      if (['I', 'EM'].includes(el.tagName) && !nextMarks.includes('italic')) nextMarks.push('italic');
      if (el.tagName === 'U' && !nextMarks.includes('underline')) nextMarks.push('underline');

      Array.from(el.childNodes).forEach((child) => walk(child, nextMarks));
    };

    Array.from(container.childNodes).forEach((child) => walk(child));
    return inlines;
  }, []);

  const serializeInline = useCallback((inlines: InlineNode[]): string => inlines.map((inline) => {
    if (inline.type === 'placeholder') {
      const colorClass = inline.placeholderType === 'text' ? 'bg-amber-100 border-yellow-300 text-amber-800' : 'bg-indigo-100 border-indigo-300 text-blue-800';
      return `&nbsp;<span class="im-placeholder ${colorClass} border px-2 py-0.5 rounded text-xs font-bold select-none mx-1" contenteditable="false" data-type="${inline.placeholderType}" data-id="${inline.id}" data-label="${encodeURIComponent(inline.label)}">[${inline.label}]</span>&nbsp;`;
    }

    if (inline.type === 'condition') {
      const displayLabel = inline.featureId === 'manual'
          ? 'Optional'
          : inline.conditionValue ? `${inline.featureName}: ${inline.conditionValue}` : (inline.featureName || 'Auto-Spec');
      return `&nbsp;<span class="im-condition bg-purple-50 border-indigo-300 text-purple-800 border border-dashed px-2 py-1 rounded text-sm mx-1" contenteditable="false" data-id="${inline.id}" data-feature-id="${inline.featureId}" data-content="${encodeURIComponent(inline.content)}" data-feature-name="${inline.featureName || ''}" data-condition-value="${encodeURIComponent(inline.conditionValue || '')}" title="Condition: ${displayLabel}"><span class="font-bold text-xs uppercase mr-1">[${displayLabel}]</span> ${inline.content.substring(0, 20)}${inline.content.length > 20 ? '...' : ''}</span>&nbsp;`;
    }

    let textHtml = inline.text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br />');
    (inline.marks || []).forEach((mark) => {
      if (mark === 'bold') textHtml = `<strong>${textHtml}</strong>`;
      if (mark === 'italic') textHtml = `<em>${textHtml}</em>`;
      if (mark === 'underline') textHtml = `<u>${textHtml}</u>`;
    });
    return textHtml;
  }).join(''), []);

  const deserializeHtmlToBlocks = useCallback((html: string): EditorBlock[] => {
    if (!html.trim()) return [{ id: createId(), type: 'paragraph', content: [] }];
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
    const root = doc.body.firstElementChild as HTMLElement;
    const parsed: EditorBlock[] = [];

    Array.from(root.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
        parsed.push({ id: createId(), type: 'paragraph', content: [{ type: 'text', text: node.textContent }] });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;

      const el = node as HTMLElement;
      if (el.matches('h1, h2, h3')) {
        parsed.push({ id: createId(), type: 'heading', level: Number(el.tagName[1]) as 1 | 2 | 3, content: parseInlineNodes(el) });
        return;
      }
      if (el.tagName === 'P') {
        parsed.push({ id: createId(), type: 'paragraph', content: parseInlineNodes(el) });
        return;
      }
      if (el.classList.contains('im-block-wrapper')) {
        const contentEl = el.querySelector('.im-block-content') as HTMLElement | null;
        const variant = (['warning', 'caution', 'electric', 'info'].find(v => el.classList.contains(`im-block-${v}`)) || 'info') as 'warning' | 'caution' | 'electric' | 'info';
        // Use only the <p> body — the .im-block-title strong is re-generated on serialize, exclude it
        const bodyEl = contentEl?.querySelector('p') as HTMLElement | null;
        parsed.push({ id: createId(), type: 'callout', variant, content: parseInlineNodes(bodyEl || contentEl || el) });
        return;
      }
      if (el.tagName === 'IMG') {
        parsed.push({ id: createId(), type: 'image', src: el.getAttribute('src') || '', alt: el.getAttribute('alt') || '' });
        return;
      }
      if (el.tagName === 'TABLE') {
        const rows = Array.from(el.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((cell) => (cell.textContent || '').trim()));
        parsed.push({ id: createId(), type: 'table', rows: rows.length ? rows : [['Header 1', 'Header 2'], ['Value 1', 'Value 2']] });
        return;
      }
      if (el.classList.contains('im-condition') && !el.closest('p, h1, h2, h3, .im-block-wrapper')) {
        parsed.push({ id: createId(), type: 'conditional', condition: { id: el.dataset.id || createId(), featureId: el.dataset.featureId || 'manual', featureName: el.dataset.featureName || '' }, content: [{ type: 'condition', id: el.dataset.id || createId(), featureId: el.dataset.featureId || 'manual', featureName: el.dataset.featureName || '', content: decodeURIComponent(el.dataset.content || '').trim() || el.textContent || '' }] });
        return;
      }
      parsed.push({ id: createId(), type: 'legacy_html', html: el.outerHTML });
    });

    return parsed.length ? parsed : [{ id: createId(), type: 'paragraph', content: [] }];
  }, [parseInlineNodes]);

  const serializeBlocksToHtml = useCallback((list: EditorBlock[]): string => {
    return list.map((block) => {
      if (block.type === 'paragraph') return `<p>${serializeInline(block.content)}</p>`;
      if (block.type === 'heading') return `<h${block.level}>${serializeInline(block.content)}</h${block.level}>`;
      if (block.type === 'callout') {
        // ISO 7010 W001 — General Warning (equilateral triangle, exclamation mark)
        const w001 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><polygon points="50,6 94,87 6,87" fill="#FFDA00" stroke="#231F20" stroke-width="4.5" stroke-linejoin="round"/><rect x="46.5" y="30" width="7" height="31" rx="2.5" fill="#231F20"/><circle cx="50" cy="73" r="5.5" fill="#231F20"/></svg>`;
        // ISO 7010 W012 — Electrical Hazard (triangle, lightning bolt)
        const w012 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><polygon points="50,6 94,87 6,87" fill="#FFDA00" stroke="#231F20" stroke-width="4.5" stroke-linejoin="round"/><path d="M57,24 L39,55 L51,55 L44,78 L62,47 L50,47 Z" fill="#231F20"/></svg>`;
        // ISO 7000-0190 / M002 — Information (blue circle, white i)
        const m002 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><circle cx="50" cy="50" r="46" fill="#0066B2"/><circle cx="50" cy="26" r="7" fill="white"/><rect x="43" y="40" width="14" height="36" rx="4" fill="white"/></svg>`;
        const isoIcons: Record<string, string> = { warning: w001, caution: w001, electric: w012, info: m002 };
        const title = block.variant === 'electric' ? 'ELECTRIC HAZARD' : block.variant.toUpperCase();
        const icon = `<div class="im-block-icon">${isoIcons[block.variant]}</div>`;
        return `<div class="im-block-wrapper im-block-${block.variant}">${icon}<div class="im-block-content"><strong class="im-block-title">${title}</strong><p>${serializeInline(block.content)}</p></div></div>`;
      }
      if (block.type === 'image') return `<img src="${block.src}" alt="${block.alt || ''}" style="max-width: 100%; height: auto; border-radius: 0.375rem; margin: 1rem 0;" />`;
      if (block.type === 'table') {
        const [headerRow, ...body] = block.rows;
        const th = (headerRow || []).map((cell) => `<th>${cell}</th>`).join('');
        const tr = body.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`).join('');
        return `<table class="im-table"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
      }
      if (block.type === 'conditional') {
        return `<p>${serializeInline([{ type: 'condition', id: block.condition.id, featureId: block.condition.featureId, featureName: block.condition.featureName, content: block.content.map((x) => x.type === 'text' ? x.text : '').join(' ').trim() || 'Conditional content' }])}</p>`;
      }
      return block.html;
    }).join('');
  }, [serializeInline]);

  useEffect(() => {
    // Skip re-init when initialContent is just our own update echoed back from the parent
    if (initialContent === lastEmittedHtmlRef.current) return;
    initializingRef.current = true;
    const next = deserializeHtmlToBlocks(initialContent || '');
    setBlocks(next);
    if (!selectedBlockId && next.length) setSelectedBlockId(next[0].id);
  }, [deserializeHtmlToBlocks, initialContent]);

  useEffect(() => {
    if (initializingRef.current) {
      initializingRef.current = false;
      return;
    }
    const html = serializeBlocksToHtml(blocks);
    lastEmittedHtmlRef.current = html;
    onChangeRef.current(html);
  }, [blocks, serializeBlocksToHtml]);

  const saveSelection = useCallback(() => {
    // Selection persistence is handled by the browser for this editor implementation.
  }, []);

  const handleChange = useCallback((event: React.FormEvent<HTMLDivElement>) => {
    isUserEditingRef.current = true;
    const next = deserializeHtmlToBlocks(event.currentTarget.innerHTML);
    setBlocks(next);
  }, [deserializeHtmlToBlocks]);

  useEffect(() => {
    if (isUserEditingRef.current) {
      isUserEditingRef.current = false;
      return;
    }
    if (!contentRef.current) return;
    contentRef.current.innerHTML = serializeBlocksToHtml(blocks);
  }, [blocks, serializeBlocksToHtml]);

  const insertBlock = (type: BlockInsertType) => {
    const newBlock: EditorBlock = type === 'table'
      ? { id: createId(), type: 'table', rows: [['Header 1', 'Header 2'], ['Row 1 Col 1', 'Row 1 Col 2']] }
      : { id: createId(), type: 'callout', variant: type, content: [{ type: 'text', text: type === 'warning' ? 'Indicates a hazardous situation which, if not avoided, could result in serious injury or death.' : type === 'caution' ? 'Indicates a potentially hazardous situation which may result in minor injury or damage to the appliance.' : type === 'electric' ? 'Risk of electric shock. Disconnect power before servicing.' : 'Offers helpful tips and information for using your product.' }] };
    setBlocks((prev) => [...prev, newBlock]);
    setSelectedBlockId(newBlock.id);
  };

  useEffect(() => {
    (window as any).currentEditorInsertHtml = (htmlString: string) => {
      if (!contentRef.current) return;
      contentRef.current.focus();
      // Insert at the current cursor position within the full-document editor
      document.execCommand('insertHTML', false, htmlString);
    };

    return () => { (window as any).currentEditorInsertHtml = undefined; };
  }, []);

  return (
    <div className={`flex flex-col h-full border rounded-xl transition-colors overflow-hidden ${isFocused ? 'border-indigo-400 ring-1 ring-indigo-100' : 'border-gray-300'}`}>

      <div className="flex-none flex items-center gap-1 p-2 bg-light border-b border-gray-200 select-none z-10 flex-wrap">
        <button onMouseDown={(e) => { e.preventDefault(); setBlocks((prev) => [...prev, { id: createId(), type: 'heading', level: 1, content: [{ type: 'text', text: 'Heading 1' }] }]); }} className="px-2 py-1 text-xs font-semibold bg-gray-100 hover:bg-gray-200 rounded">H1</button>
        <button onMouseDown={(e) => { e.preventDefault(); setBlocks((prev) => [...prev, { id: createId(), type: 'heading', level: 2, content: [{ type: 'text', text: 'Heading 2' }] }]); }} className="px-2 py-1 text-xs font-semibold bg-gray-100 hover:bg-gray-200 rounded">H2</button>
        <button onMouseDown={(e) => { e.preventDefault(); setBlocks((prev) => [...prev, { id: createId(), type: 'heading', level: 3, content: [{ type: 'text', text: 'Heading 3' }] }]); }} className="px-2 py-1 text-xs font-semibold bg-gray-100 hover:bg-gray-200 rounded">H3</button>
        <button onMouseDown={(e) => { e.preventDefault(); setBlocks((prev) => [...prev, { id: createId(), type: 'paragraph', content: [] }]); }} className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded">Paragraph</button>
        {!minimal && (
          <>
            <div className="w-px h-4 bg-gray-300 mx-1"></div>
            <button onMouseDown={(e) => { e.preventDefault(); insertBlock('warning'); }} className="p-1.5 hover:bg-orange-100 hover:text-amber-600 rounded text-gray-600" title="Warning Block"><AlertTriangle size={16} /></button>
            <button onMouseDown={(e) => { e.preventDefault(); insertBlock('caution'); }} className="p-1.5 hover:bg-amber-100 hover:text-amber-600 rounded text-gray-600" title="Caution Block"><AlertOctagon size={16} /></button>
            <button onMouseDown={(e) => { e.preventDefault(); insertBlock('electric'); }} className="p-1.5 hover:bg-rose-100 hover:text-rose-600 rounded text-gray-600" title="Electric Hazard"><Zap size={16} /></button>
            <button onMouseDown={(e) => { e.preventDefault(); insertBlock('info'); }} className="p-1.5 hover:bg-indigo-100 hover:text-indigo-600 rounded text-gray-600" title="Info Block"><Info size={16} /></button>
            <button onMouseDown={(e) => { e.preventDefault(); insertBlock('table'); }} className="p-1.5 hover:bg-gray-200 rounded text-gray-600" title="Insert Table"><TableIcon size={16} /></button>
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
            className="min-h-full p-4 outline-none im-content max-w-none font-sans"
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
  
  const [categoryAttributes, setCategoryAttributes] = useState<CategoryAttribute[]>([]);
  const [isTranslating, setIsTranslating] = useState(false);

  const [activeSidebarTab, setActiveSidebarTab] = useState<'structure' | 'assets'>('structure');
  const [assets, setAssets] = useState<string[]>([]);

  const [isLangModalOpen, setIsLangModalOpen] = useState(false);
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

  const [metaSettings, setMetaSettings] = useState<IMTemplateMetadata>({
     pageSize: 'a4',
     primaryColor: '#0f172a',
     coverImageUrl: '',
     companyLogoUrl: '',
     companyName: '',
     backPageContent: '',
     footerText: '',
     masterPages: { cover: {}, chapter: {}, body: {}, appendix: {}, end: {} },
     sectionLayoutMap: {}
  });

  useEffect(() => {
    if (!categoryId) return;
    loadData();
  }, [categoryId]);

  const loadData = async () => {
    if (!categoryId) return;
    const [cats, temp, attrs] = await Promise.all([
        getCategories(),
        getIMTemplateByCategoryId(categoryId),
        getCategoryAttributes()
    ]);
    setCategory(cats.find(c => c.id === categoryId) || null);
    setCategoryAttributes(attrs);
    
    if (temp) {
      setTemplate(temp);
      setTemplateLanguages(temp.languages || ['en', 'de', 'fr', 'es', 'it']);
      if (temp.metadata) {
        setMetaSettings({
          ...temp.metadata,
          masterPages: { cover: {}, chapter: {}, body: {}, appendix: {}, end: {}, ...(temp.metadata.masterPages || {}) },
          sectionLayoutMap: temp.metadata.sectionLayoutMap || {}
        });
      }
      
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
    setPlaceholderAttrId('');
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
      setSecCondAttrId(section.conditionAttributeId || '');
      setSecCondEnumSelected([]);
      setSecCondNumMin('');
      setSecCondNumMax('');
      setSecCondBoolValue('true');
      setSecCondTextValue('');
      // Prepopulate if already has a condition
      if (section.conditionAttributeId && section.conditionValue) {
          const attr = categoryFeatures.find(f => f.id === section.conditionAttributeId);
          if (attr) {
              const cv = section.conditionValue;
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
      updateCurrentSection({ conditionAttributeId: secCondAttrId, conditionValue: cv });
      setIsSectionCondModalOpen(false);
  };

  const handleClearSectionCondition = () => {
      updateCurrentSection({ conditionAttributeId: null, conditionValue: null });
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
      let conditionValue = "";
      if (condFeatureId !== 'manual') {
          const feat = categoryAttributes.find(f => f.id === condFeatureId);
          if (feat) { featureName = feat.name; }
          if (!condAnyValue) conditionValue = buildConditionValue();
      }

      // "Any value" mode: inserts an always-visible value placeholder
      if (condAnyValue && condFeatureId !== 'manual') {
          const safeFeatureName = encodeURIComponent(featureName);
          const html = `&nbsp;<span class="im-condition bg-amber-50 border-amber-300 text-amber-800 border border-dashed px-2 py-1 rounded text-sm mx-1" contenteditable="false" data-id="${id}" data-feature-id="${condFeatureId}" data-feature-name="${featureName}" data-content="${safeFeatureName}" data-condition-value="*" data-always="true" title="Value: ${featureName}"><span class="font-bold text-xs uppercase mr-1">[${featureName}]</span></span>&nbsp;`;
          insertHtmlToCurrentEditor(html);
          setIsConditionModalOpen(false);
          return;
      }

      const effectiveContent = condUseAttrValue && conditionValue ? conditionValue : condText;
      if (!effectiveContent.trim()) return;
      const displayLabel = condFeatureId === 'manual'
          ? 'Optional'
          : conditionValue ? `${featureName}: ${conditionValue}` : featureName;
      const safeText = encodeURIComponent(effectiveContent);
      const safeCondVal = encodeURIComponent(conditionValue);
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
              <span className="truncate flex-1">{s.title}</span>
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
              {s.conditionAttributeId && <span title="Conditional chapter"><GitBranch size={12} className="text-violet-400 shrink-0" /></span>}
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
  const categoryFeatures = categoryId ? getAttributesForCategory(categoryAttributes, categoryId) : [];
  const imThemeVars = getIMThemeVariables(metaSettings);

  return (
    <Layout>
       <div className="flex flex-col h-[calc(100vh-100px)]" style={imThemeVars}>
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
                     {/* Chapter condition row */}
                     <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-100 bg-light/40 text-xs">
                        <GitBranch size={13} className="text-gray-400 shrink-0" />
                        <span className="text-muted font-medium">Chapter condition:</span>
                        {currentSection.conditionAttributeId ? (() => {
                          const attr = categoryFeatures.find(a => a.id === currentSection.conditionAttributeId);
                          return (
                            <>
                              <span className="bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5 rounded font-medium">
                                {attr?.name ?? 'Unknown'}: {currentSection.conditionValue}
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
                    {categoryFeatures.length > 0 && (
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
                          <optgroup label="Category Attributes">
                            {categoryFeatures.map(f => (
                              <option key={f.id} value={f.id}>{f.name} ({f.dataType})</option>
                            ))}
                          </optgroup>
                        </select>
                        <p className="text-xs text-muted mt-1">Select an attribute to pre-fill the label, or enter a custom one below.</p>
                      </div>
                    )}
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
