/**
 * Shared IM inline-content editor.
 *
 * `SimpleRichTextEditor` and `InlineHtmlRow` were originally defined inside
 * IMTemplateEditor.tsx. They are extracted here so the project IM generator can
 * reuse the exact same authoring surface (headings, formatting, tables, images,
 * callout boxes, placeholder + condition chips) when adding project-specific
 * content blocks.
 *
 * `InlineBlockEditor` bundles an `InlineHtmlRow` with its own placeholder and
 * condition insertion modals, so a consumer only needs to pass content + the
 * category attributes; the heavy editor + modal plumbing lives here.
 */
import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Bold, Italic, Underline, Type, Image as ImageIcon, GitBranch, Table as TableIcon, AlertTriangle, AlertOctagon, Zap, Flame, Info, Upload, Loader2, Code, Languages, type LucideIcon } from 'lucide-react';
import { translateHtml } from '../../../services/ai/translation.service';
import { uploadIMAsset } from '../../../services/im/im-asset.service';
import { getCalloutTitle } from '../../../services/im/callout-titles.i18n';
import { CalloutVariant, CategoryAttribute } from '../../../types';

// --- ISO 7010 / 7000 callout signs (shared by the editor preview and serializer) ---
// W001 General Warning, W012 Electrical Hazard, W021 Flammable, M002 Information.
const ISO_W001 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><polygon points="50,6 94,87 6,87" fill="#FFDA00" stroke="#231F20" stroke-width="4.5" stroke-linejoin="round"/><rect x="46.5" y="30" width="7" height="31" rx="2.5" fill="#231F20"/><circle cx="50" cy="73" r="5.5" fill="#231F20"/></svg>`;
const ISO_W012 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><polygon points="50,6 94,87 6,87" fill="#FFDA00" stroke="#231F20" stroke-width="4.5" stroke-linejoin="round"/><path d="M57,24 L39,55 L51,55 L44,78 L62,47 L50,47 Z" fill="#231F20"/></svg>`;
const ISO_W021 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 525" style="display:block;width:100%;height:100%;"><path d="M 597.6,499.6 313.8,8 C 310.9,3 305.6,0 299.9,0 294.2,0 288.9,3.1 286,8 L 2.2,499.6 c -2.9,5 -2.9,11.1 0,16 2.9,5 8.2,8 13.9,8 h 567.6 c 5.7,0 11,-3.1 13.9,-8 2.9,-5 2.9,-11.1 0,-16 z" fill="#231F20"/><polygon points="43.875,491.5 299.875,48.2 555.875,491.5" transform="matrix(1,0,0,0.99591458,0.125,2.0332437)" fill="#FFDA00"/><path d="m 254.20599,412.70348 c -23.76019,-10.34209 -33.09455,-30.39188 -35.71706,-76.71863 -1.06141,-18.75 -1.13418,-34.09091 -0.16169,-34.09091 0.97249,0 4.29519,1.35243 7.38379,3.00539 4.98824,2.66964 5.99798,1.23079 9.03804,-12.87878 1.88233,-8.7363 4.23436,-21.75719 5.22673,-28.9353 l 1.80431,-13.05112 9.88246,9.57846 9.88247,9.57846 2.12479,-22.67469 c 1.16864,-12.47108 1.16355,-27.05119 -0.0112,-32.40024 -2.00776,-9.14129 -1.75819,-9.52331 4.15445,-6.35896 3.45979,1.85162 7.7334,6.06261 9.4969,9.35775 5.94987,11.11759 9.05366,6.09812 9.05366,-14.64178 0,-13.03057 1.58382,-22.79895 4.2985,-26.51149 4.12866,-5.64628 4.38304,-5.54174 6.43797,2.64577 1.17671,4.68838 8.03213,15.42775 15.23426,23.86526 7.20212,8.43751 13.64618,18.9181 14.32012,23.29019 l 1.22533,7.94926 0.45403,-8.33333 c 0.57982,-10.64199 4.12382,-10.5344 13.32837,0.4046 6.66394,7.91962 10.13451,17.48588 16.069,44.29237 1.93451,8.73845 2.1136,8.82656 4.61879,2.27273 3.3383,-8.7334 6.86421,-8.63774 11.65621,0.31623 4.67369,8.73288 5.39436,24.48257 2.30806,50.44134 -2.07621,17.46282 -1.84452,19.07567 2.04276,14.21936 4.04869,-5.05797 4.53933,-4.56179 6.4043,6.47691 2.55164,15.10294 -2.7687,35.42364 -12.71633,48.56921 -9.97903,13.18712 -34.5024,24.60594 -52.92676,24.6443 -17.95679,0.0373 -20.42284,-3.76866 -7.41467,-11.44366 11.92246,-7.03443 24.03985,-22.06988 30.77215,-38.18258 4.52855,-10.83827 4.49197,-11.358 -0.68324,-9.71542 -4.83224,1.53367 -5.35055,0.0658 -4.4593,-12.62848 l 1.00842,-14.36388 -7.91642,11.36363 c -10.00264,14.35834 -14.15034,14.55197 -10.26464,0.47915 3.75124,-13.58587 0.74797,-33.0383 -7.09173,-45.93369 -3.29306,-5.41667 -6.46488,-9.84849 -7.04853,-9.84849 -0.58364,0 -1.01554,11.25 -0.95978,25 0.0994,24.51621 -3.69021,41.66667 -9.20685,41.66667 -1.52966,0 -4.90224,-5.11364 -7.49462,-11.36364 l -4.71341,-11.36363 -0.46317,10.60606 c -0.25472,5.83333 -0.22051,15.03788 0.076,20.45454 0.29655,5.41667 -0.85159,9.84849 -2.55145,9.84849 -5.08631,0 -12.55008,-12.86679 -14.502,-25 -2.00506,-12.46355 -6.84316,-15.36643 -7.57568,-4.54546 -0.9802,14.47946 -1.44911,15.88549 -5.04602,15.13052 -8.24799,-1.73121 3.85695,30.08491 17.24971,45.33839 5.20849,5.93215 9.46999,11.62842 9.46999,12.65842 0,3.31249 -16.373,1.76328 -26.09704,-2.4693 z M 185,455 l 0,-25 230,0 0,25 z" fill="#231F20"/></svg>`;
const ISO_M002 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><circle cx="50" cy="50" r="46" fill="#0066B2"/><circle cx="50" cy="26" r="7" fill="white"/><rect x="43" y="40" width="14" height="36" rx="4" fill="white"/></svg>`;

const CALLOUT_ICONS: Record<CalloutVariant, string> = { warning: ISO_W001, caution: ISO_W001, electric: ISO_W012, flammable: ISO_W021, info: ISO_M002 };
const CALLOUT_TITLES: Record<CalloutVariant, string> = { warning: 'WARNING', caution: 'CAUTION', electric: 'ELECTRIC HAZARD', flammable: 'FLAMMABLE', info: 'INFO' };

// Editor-only chrome for the row variant selector + framing (the final PDF uses the CSS classes).
export const CALLOUT_VARIANTS: { value: CalloutVariant; label: string; Icon: LucideIcon; frame: string; chip: string }[] = [
  { value: 'warning',   label: 'Warning',         Icon: AlertTriangle, frame: 'border-orange-300 bg-orange-50',  chip: 'bg-orange-100 text-orange-700 border-orange-200' },
  { value: 'caution',   label: 'Caution',         Icon: AlertOctagon,  frame: 'border-yellow-300 bg-yellow-50',  chip: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  { value: 'electric',  label: 'Electric Hazard', Icon: Zap,           frame: 'border-red-300 bg-red-50',        chip: 'bg-red-100 text-red-700 border-red-200' },
  { value: 'flammable', label: 'Flammable',       Icon: Flame,         frame: 'border-orange-400 bg-rose-50',    chip: 'bg-rose-100 text-orange-700 border-orange-200' },
  { value: 'info',      label: 'Info',            Icon: Info,          frame: 'border-blue-300 bg-blue-50',      chip: 'bg-blue-100 text-blue-700 border-blue-200' },
];

// --- Structured Rich Text Editor ---
type BlockInsertType = 'warning' | 'info' | 'table' | 'caution' | 'electric';

type InlineNode =
  | { type: 'text'; text: string; marks?: Array<'bold' | 'italic' | 'underline'> }
  | { type: 'placeholder'; id: string; placeholderType: 'text' | 'image'; label: string; attrId?: string }
  | { type: 'condition'; id: string; featureId: string; featureName?: string; conditionLabel?: string; content: string }
  // Inline image (e.g. an uploaded asset dropped at the caret inside a paragraph).
  // `width` is the optional CSS width set via the resize control (e.g. "50%").
  | { type: 'image'; src: string; alt?: string; width?: string };

type EditorBlock =
  | { id: string; type: 'paragraph'; content: InlineNode[] }
  | { id: string; type: 'heading'; level: 1 | 2 | 3; content: InlineNode[] }
  | { id: string; type: 'callout'; variant: 'warning' | 'caution' | 'electric' | 'info'; content: InlineNode[] }
  | { id: string; type: 'image'; src: string; alt?: string; width?: string }
  | { id: string; type: 'table'; rows: InlineNode[][][] }
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

/** A table cell holding a single plain-text run (used for defaults/fallbacks). */
const textCell = (text: string): InlineNode[] => [{ type: 'text', text }];

/**
 * Collapse pretty-print / indentation whitespace inside a parsed table cell and
 * trim its edges. Source tables are often indented HTML, and the serializer pads
 * chips with `&nbsp;`; without this, that whitespace leaks into the cell and
 * compounds on every save/reload round-trip. `\s` includes ` `, so the chip
 * padding normalizes to a single space here and the serializer re-adds exactly
 * one `&nbsp;`, keeping the round-trip stable.
 */
const normalizeCellInlines = (nodes: InlineNode[]): InlineNode[] => {
  const collapsed = nodes.map((n) => (n.type === 'text' ? { ...n, text: n.text.replace(/\s+/g, ' ') } : n));
  const first = collapsed[0];
  if (first?.type === 'text') first.text = first.text.replace(/^\s+/, '');
  const last = collapsed[collapsed.length - 1];
  if (last?.type === 'text') last.text = last.text.replace(/\s+$/, '');
  return collapsed.filter((n) => !(n.type === 'text' && n.text === ''));
};

const SimpleRichTextEditor: React.FC<EditorProps> = ({ initialContent, onChange, placeholder, onInsertPlaceholder, onInsertCondition, minimal }) => {
  const [blocks, setBlocks] = useState<EditorBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  // Editing surface: 'rich' = structured WYSIWYG, 'html' = raw HTML source.
  const [mode, setMode] = useState<'rich' | 'html'>('rich');
  const [htmlDraft, setHtmlDraft] = useState('');
  // The image the user last clicked in the editor — target of the resize buttons.
  const [imgSelected, setImgSelected] = useState(false);
  const selectedImgRef = useRef<HTMLImageElement | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const htmlTextareaRef = useRef<HTMLTextAreaElement>(null);
  const initializingRef = useRef(false);
  const isUserEditingRef = useRef(false);
  const lastEmittedHtmlRef = useRef<string>('');
  // Last caret/selection inside this editor — restored before programmatic
  // inserts (placeholders, conditions, uploads) so they land at the cursor
  // rather than the start after the editor loses focus to a modal/file dialog.
  const savedRangeRef = useRef<Range | null>(null);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  // Auto-grow the raw-HTML textarea to fit its content so the source view expands
  // with the text like the WYSIWYG surface. The wrapper's manual resize still wins:
  // when dragged shorter than the content, the scroll container above clips + scrolls.
  useEffect(() => {
    if (mode !== 'html') return;
    const ta = htmlTextareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${ta.scrollHeight}px`;
  }, [mode, htmlDraft]);

  /** Insert HTML at the saved caret position (falling back to the end, never the start). */
  const insertHtmlAtCursor = useCallback((htmlString: string) => {
    const el = contentRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      const saved = savedRangeRef.current;
      if (saved && el.contains(saved.commonAncestorContainer)) {
        sel.removeAllRanges();
        sel.addRange(saved);
      } else {
        // No tracked caret → place it at the end of the content, not the beginning.
        const end = document.createRange();
        end.selectNodeContents(el);
        end.collapse(false);
        sel.removeAllRanges();
        sel.addRange(end);
      }
    }
    document.execCommand('insertHTML', false, htmlString);
    savedRangeRef.current = null;
  }, []);

  const handleImgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingImg(true);
    try {
      const url = await uploadIMAsset(file, 'blocks');
      // Insert at the cursor (matches placeholder/condition behaviour) instead of appending.
      insertHtmlAtCursor(`<img src="${url}" alt="${file.name}" style="max-width:100%;height:auto;border-radius:0.375rem;margin:1rem 0;" />`);
    } catch (err: any) {
      console.error('[SimpleRichTextEditor] image upload failed:', err);
      alert(err?.message ?? 'Image upload failed — see console for details.');
    } finally {
      setUploadingImg(false);
      if (imgInputRef.current) imgInputRef.current.value = '';
    }
  };

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
          label: decodeURIComponent(el.dataset.label || '').trim() || el.textContent?.replace(/[\[\]]/g, '').trim() || 'Text',
          // Preserve the attribute binding so it survives editor round-trips and the
          // resolver can fall back to it when data-id has diverged across languages.
          attrId: el.dataset.attrId || undefined,
        });
        return;
      }

      if (el.classList.contains('im-condition')) {
        inlines.push({
          type: 'condition',
          id: el.dataset.id || createId(),
          featureId: el.dataset.featureId || 'manual',
          featureName: el.dataset.featureName || '',
          conditionLabel: decodeURIComponent(el.dataset.conditionLabel || ''),
          content: decodeURIComponent(el.dataset.content || '').trim() || el.textContent || ''
        });
        return;
      }

      if (el.tagName === 'BR') {
        inlines.push({ type: 'text', text: '\n', marks: marks.length ? marks : undefined });
        return;
      }

      // Images dropped at the caret live inside a <p>/heading/cell. Without this
      // they fall through to the recursion below (an <img> has no children) and
      // are silently dropped on the deserialize→serialize round-trip — i.e. they
      // render but never save. `width` carries any resize the user applied.
      if (el.tagName === 'IMG') {
        inlines.push({ type: 'image', src: el.getAttribute('src') || '', alt: el.getAttribute('alt') || undefined, width: el.style.width || undefined });
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
      const attrAttr = inline.attrId ? ` data-attr-id="${inline.attrId}"` : '';
      return `&nbsp;<span class="im-placeholder ${colorClass} border px-2 py-0.5 rounded text-xs font-bold select-none mx-1" contenteditable="false" data-type="${inline.placeholderType}" data-id="${inline.id}"${attrAttr} data-label="${encodeURIComponent(inline.label)}">[${inline.label}]</span>&nbsp;`;
    }

    if (inline.type === 'condition') {
      const displayLabel = inline.featureId === 'manual'
          ? 'Optional'
          : inline.conditionLabel ? `${inline.featureName}: ${inline.conditionLabel}` : (inline.featureName || 'Auto-Spec');
      return `&nbsp;<span class="im-condition bg-purple-50 border-indigo-300 text-purple-800 border border-dashed px-2 py-1 rounded text-sm mx-1" contenteditable="false" data-id="${inline.id}" data-feature-id="${inline.featureId}" data-content="${encodeURIComponent(inline.content)}" data-feature-name="${inline.featureName || ''}" data-condition-value="${encodeURIComponent(inline.conditionLabel || '')}" title="Condition: ${displayLabel}"><span class="font-bold text-xs uppercase mr-1">[${displayLabel}]</span> ${inline.content.substring(0, 20)}${inline.content.length > 20 ? '...' : ''}</span>&nbsp;`;
    }

    if (inline.type === 'image') {
      const sizing = inline.width ? `width:${inline.width};max-width:100%;` : 'max-width:100%;';
      return `<img src="${inline.src}" alt="${inline.alt || ''}" style="${sizing}height:auto;border-radius:0.375rem;margin:1rem 0;" />`;
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
        parsed.push({ id: createId(), type: 'image', src: el.getAttribute('src') || '', alt: el.getAttribute('alt') || '', width: (el as HTMLElement).style.width || undefined });
        return;
      }
      if (el.tagName === 'TABLE') {
        // Parse each cell into inline nodes (not textContent) so placeholder /
        // condition chips inside cells survive the round-trip instead of being
        // flattened to their bare label text.
        const rows = Array.from(el.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((cell) => normalizeCellInlines(parseInlineNodes(cell as HTMLElement))));
        parsed.push({ id: createId(), type: 'table', rows: rows.length ? rows : [[textCell('Header 1'), textCell('Header 2')], [textCell('Value 1'), textCell('Value 2')]] });
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
        const title = CALLOUT_TITLES[block.variant] ?? block.variant.toUpperCase();
        const icon = `<div class="im-block-icon">${CALLOUT_ICONS[block.variant]}</div>`;
        return `<div class="im-block-wrapper im-block-${block.variant}">${icon}<div class="im-block-content"><strong class="im-block-title">${title}</strong><p>${serializeInline(block.content)}</p></div></div>`;
      }
      if (block.type === 'image') {
        const sizing = block.width ? `width:${block.width};max-width:100%;` : 'max-width:100%;';
        return `<img src="${block.src}" alt="${block.alt || ''}" style="${sizing}height:auto;border-radius:0.375rem;margin:1rem 0;" />`;
      }
      if (block.type === 'table') {
        const [headerRow, ...body] = block.rows;
        const th = (headerRow || []).map((cell) => `<th>${serializeInline(cell)}</th>`).join('');
        const tr = body.map((row) => `<tr>${row.map((cell) => `<td>${serializeInline(cell)}</td>`).join('')}</tr>`).join('');
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

  // Remember the caret while the user is editing, so an insert triggered from a
  // modal/toolbar (which steals focus) can restore it. Only tracks selections
  // that live inside this editor.
  const saveSelection = useCallback(() => {
    const el = contentRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (el.contains(range.commonAncestorContainer)) {
      savedRangeRef.current = range.cloneRange();
    }
  }, []);

  // --- Table row/column editing -------------------------------------------
  // Locate the caret's table cell within this editor: which table (by DOM order),
  // and the row/column index of the cell. Null when the caret isn't in a table.
  const getTableContext = (): { tableIdx: number; row: number; col: number } | null => {
    const el = contentRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return null;
    let node: Node | null = sel.getRangeAt(0).startContainer;
    let cell: HTMLElement | null = null;
    while (node && node !== el) {
      if (node instanceof HTMLElement && (node.tagName === 'TD' || node.tagName === 'TH')) { cell = node; break; }
      node = node.parentNode;
    }
    const table = cell?.closest('table');
    const tr = cell?.parentElement;
    if (!cell || !tr || !table || !el.contains(table)) return null;
    const tableIdx = Array.from(el.querySelectorAll('table')).indexOf(table as HTMLTableElement);
    const row = Array.from(table.querySelectorAll('tr')).indexOf(tr as HTMLTableRowElement);
    const col = Array.from(tr.children).indexOf(cell);
    return tableIdx >= 0 && row >= 0 && col >= 0 ? { tableIdx, row, col } : null;
  };

  const [caretInTable, setCaretInTable] = useState(false);
  const refreshCaretTable = useCallback(() => setCaretInTable(!!getTableContext()), []);

  const handleChange = useCallback((event: React.FormEvent<HTMLDivElement>) => {
    isUserEditingRef.current = true;
    saveSelection();
    refreshCaretTable();
    const next = deserializeHtmlToBlocks(event.currentTarget.innerHTML);
    setBlocks(next);
  }, [deserializeHtmlToBlocks, saveSelection, refreshCaretTable]);

  // Click an image to select it (shows the resize buttons); clicking anything
  // else deselects. The selection outline is DOM-only — `parseInlineNodes` reads
  // just `style.width`, so it never leaks into the saved HTML.
  const handleEditorClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const prev = selectedImgRef.current;
    if (prev && prev !== target) prev.style.outline = '';
    if (target.tagName === 'IMG') {
      selectedImgRef.current = target as HTMLImageElement;
      (target as HTMLImageElement).style.outline = '2px solid #6366f1';
      setImgSelected(true);
    } else {
      selectedImgRef.current = null;
      setImgSelected(false);
    }
    refreshCaretTable();
  }, [refreshCaretTable]);

  // Resize the selected image. Setting the DOM width then re-parsing persists the
  // width into blocks (and the emitted HTML) while keeping the live node in place.
  // `width === ''` clears the override → back to natural size (capped at 100%).
  const applyImgWidth = useCallback((width: string) => {
    const img = selectedImgRef.current;
    const el = contentRef.current;
    if (!img || !el) return;
    img.style.width = width;
    isUserEditingRef.current = true; // keep the DOM node; just sync blocks + emit
    setBlocks(deserializeHtmlToBlocks(el.innerHTML));
  }, [deserializeHtmlToBlocks]);

  useEffect(() => {
    if (isUserEditingRef.current) {
      isUserEditingRef.current = false;
      return;
    }
    if (!contentRef.current) return;
    contentRef.current.innerHTML = serializeBlocksToHtml(blocks);
    // The rewrite replaces any selected <img> node — drop the stale selection.
    selectedImgRef.current = null;
    setImgSelected(false);
  }, [blocks, serializeBlocksToHtml]);

  const insertBlock = (type: BlockInsertType) => {
    const newBlock: EditorBlock = type === 'table'
      ? { id: createId(), type: 'table', rows: [[textCell('Header 1'), textCell('Header 2')], [textCell('Row 1 Col 1'), textCell('Row 1 Col 2')]] }
      : { id: createId(), type: 'callout', variant: type, content: [{ type: 'text', text: type === 'warning' ? 'Indicates a hazardous situation which, if not avoided, could result in serious injury or death.' : type === 'caution' ? 'Indicates a potentially hazardous situation which may result in minor injury or damage to the appliance.' : type === 'electric' ? 'Risk of electric shock. Disconnect power before servicing.' : 'Offers helpful tips and information for using your product.' }] };
    setBlocks((prev) => [...prev, newBlock]);
    setSelectedBlockId(newBlock.id);
  };

  // Apply a structural change to the table the caret is in. Reads the live DOM first
  // (like switchToHtml) so in-progress typing isn't lost, mutates the matching table
  // block's `rows`, then lets the render effect rewrite the DOM + emit onChange.
  const mutateCaretTable = (
    fn: (rows: InlineNode[][][], ctx: { row: number; col: number }) => InlineNode[][][],
  ) => {
    const el = contentRef.current;
    if (!el) return;
    const ctx = getTableContext();
    const fresh = deserializeHtmlToBlocks(el.innerHTML);
    let seen = -1;
    let targetId: string | null = null;
    for (const b of fresh) {
      if (b.type === 'table') { seen++; if (seen === (ctx?.tableIdx ?? 0)) { targetId = b.id; break; } }
    }
    if (!targetId) return;
    const next = fresh.map((b) => {
      if (b.id !== targetId || b.type !== 'table') return b;
      const cols = b.rows.reduce((m, r) => Math.max(m, r.length), 0) || 1;
      return { ...b, rows: fn(b.rows, { row: ctx?.row ?? b.rows.length - 1, col: ctx?.col ?? cols - 1 }) };
    });
    isUserEditingRef.current = false; // force the render effect to rewrite the DOM
    setBlocks(next);
  };

  const tableColCount = (rows: InlineNode[][][]) => rows.reduce((m, r) => Math.max(m, r.length), 0) || 1;
  const addTableRow = () => mutateCaretTable((rows, { row }) => {
    const cols = tableColCount(rows);
    const newRow = Array.from({ length: cols }, () => textCell(''));
    const at = Math.min(row + 1, rows.length);
    return [...rows.slice(0, at), newRow, ...rows.slice(at)];
  });
  const addTableColumn = () => mutateCaretTable((rows, { col }) => rows.map((r) => {
    const at = Math.min(col + 1, r.length);
    return [...r.slice(0, at), textCell(''), ...r.slice(at)];
  }));
  // Never remove the header row (index 0) or the last remaining row.
  const removeTableRow = () => mutateCaretTable((rows, { row }) => (rows.length <= 1 || row === 0 ? rows : rows.filter((_, i) => i !== row)));
  const removeTableColumn = () => mutateCaretTable((rows, { col }) => (tableColCount(rows) <= 1 ? rows : rows.map((r) => r.filter((_, i) => i !== col))));

  // Mode switching. Going to HTML seeds the textarea from the current blocks;
  // returning to rich re-parses whatever HTML the user typed back into blocks.
  const switchToHtml = useCallback(() => {
    // Serialize from the live DOM, not `blocks`: programmatic chip inserts
    // (placeholders/conditions) land in the contentEditable immediately, while
    // `blocks` may lag behind, which would drop the chip from the HTML view.
    const live = contentRef.current?.innerHTML;
    const source = live != null ? deserializeHtmlToBlocks(live) : blocks;
    setBlocks(source);
    setHtmlDraft(serializeBlocksToHtml(source));
    setMode('html');
  }, [blocks, serializeBlocksToHtml, deserializeHtmlToBlocks]);

  const switchToRich = useCallback(() => {
    isUserEditingRef.current = false; // force the rich surface to re-render from blocks
    setBlocks(deserializeHtmlToBlocks(htmlDraft));
    setMode('rich');
  }, [htmlDraft, deserializeHtmlToBlocks]);

  const handleHtmlChange = useCallback((event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    setHtmlDraft(value);
    lastEmittedHtmlRef.current = value; // keep the echo-skip guard in sync
    onChangeRef.current(value);
  }, []);

  // Make THIS editor the insert target whenever it is focused, so a toolbar/modal
  // insert lands in the editor the user is actually working in. Multiple inline
  // rows (× languages) each mount their own editor, so registering on mount would
  // make the last-mounted one win regardless of focus.
  const registerAsInsertTarget = useCallback(() => {
    (window as any).currentEditorInsertHtml = insertHtmlAtCursor;
  }, [insertHtmlAtCursor]);

  useEffect(() => {
    return () => {
      if ((window as any).currentEditorInsertHtml === insertHtmlAtCursor) {
        (window as any).currentEditorInsertHtml = undefined;
      }
    };
  }, [insertHtmlAtCursor]);

  return (
    <div className={`flex flex-col flex-1 min-h-0 border rounded-xl transition-colors overflow-hidden ${isFocused ? 'border-indigo-400 ring-1 ring-indigo-100' : 'border-gray-300'}`}>

      <div className="flex-none flex items-center gap-1 p-2 bg-light border-b border-gray-200 select-none z-10 flex-wrap">
        {mode === 'rich' && (
          <>
            <button onMouseDown={(e) => { e.preventDefault(); setBlocks((prev) => [...prev, { id: createId(), type: 'heading', level: 1, content: [{ type: 'text', text: 'Heading 1' }] }]); }} className="px-2 py-1 text-xs font-semibold bg-gray-100 hover:bg-gray-200 rounded">H1</button>
            <button onMouseDown={(e) => { e.preventDefault(); setBlocks((prev) => [...prev, { id: createId(), type: 'heading', level: 2, content: [{ type: 'text', text: 'Heading 2' }] }]); }} className="px-2 py-1 text-xs font-semibold bg-gray-100 hover:bg-gray-200 rounded">H2</button>
            <button onMouseDown={(e) => { e.preventDefault(); setBlocks((prev) => [...prev, { id: createId(), type: 'heading', level: 3, content: [{ type: 'text', text: 'Heading 3' }] }]); }} className="px-2 py-1 text-xs font-semibold bg-gray-100 hover:bg-gray-200 rounded">H3</button>
            <button onMouseDown={(e) => { e.preventDefault(); setBlocks((prev) => [...prev, { id: createId(), type: 'paragraph', content: [] }]); }} className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded">Paragraph</button>
            <div className="w-px h-4 bg-gray-300 mx-1"></div>
            {/* Inline formatting — applies to the current selection via execCommand; onInput re-parses the marks */}
            <button onMouseDown={(e) => { e.preventDefault(); document.execCommand('bold'); }} className="p-1.5 hover:bg-gray-200 rounded text-gray-600" title="Bold (Ctrl+B)"><Bold size={16} /></button>
            <button onMouseDown={(e) => { e.preventDefault(); document.execCommand('italic'); }} className="p-1.5 hover:bg-gray-200 rounded text-gray-600" title="Italic (Ctrl+I)"><Italic size={16} /></button>
            <button onMouseDown={(e) => { e.preventDefault(); document.execCommand('underline'); }} className="p-1.5 hover:bg-gray-200 rounded text-gray-600" title="Underline (Ctrl+U)"><Underline size={16} /></button>
          </>
        )}
        {mode === 'rich' && !minimal && (
          <>
            <div className="w-px h-4 bg-gray-300 mx-1"></div>
            {/* Callout boxes are now applied to the whole row via the row's Box selector. */}
            <button onMouseDown={(e) => { e.preventDefault(); insertBlock('table'); }} className="p-1.5 hover:bg-gray-200 rounded text-gray-600" title="Insert Table"><TableIcon size={16} /></button>
            {caretInTable && (
              <>
                <button onMouseDown={(e) => { e.preventDefault(); addTableRow(); }} className="px-1.5 py-1 text-[11px] font-medium bg-gray-100 hover:bg-gray-200 rounded" title="Add a row below the current one">+ Row</button>
                <button onMouseDown={(e) => { e.preventDefault(); addTableColumn(); }} className="px-1.5 py-1 text-[11px] font-medium bg-gray-100 hover:bg-gray-200 rounded" title="Add a column after the current one">+ Col</button>
                <button onMouseDown={(e) => { e.preventDefault(); removeTableRow(); }} className="px-1.5 py-1 text-[11px] font-medium bg-gray-100 hover:bg-gray-200 rounded text-rose-600" title="Delete the current row (header can't be removed)">− Row</button>
                <button onMouseDown={(e) => { e.preventDefault(); removeTableColumn(); }} className="px-1.5 py-1 text-[11px] font-medium bg-gray-100 hover:bg-gray-200 rounded text-rose-600" title="Delete the current column">− Col</button>
              </>
            )}
            <div className="w-px h-4 bg-gray-300 mx-1"></div>
            <button onMouseDown={(e) => { e.preventDefault(); saveSelection(); registerAsInsertTarget(); onInsertPlaceholder?.('text'); }} className="flex items-center gap-1 px-2 py-1 bg-amber-50 text-yellow-700 hover:bg-amber-100 rounded text-xs font-medium border border-amber-200" title="Insert User Input Field"><Type size={14} /> Text</button>
            <button onMouseDown={(e) => { e.preventDefault(); saveSelection(); registerAsInsertTarget(); onInsertPlaceholder?.('image'); }} className="flex items-center gap-1 px-2 py-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded text-xs font-medium border border-indigo-200" title="Insert Image Upload Field"><ImageIcon size={14} /> Img</button>
            <button onMouseDown={(e) => { e.preventDefault(); saveSelection(); registerAsInsertTarget(); imgInputRef.current?.click(); }} disabled={uploadingImg} className="flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded text-xs font-medium border border-emerald-200 disabled:opacity-50" title="Upload image to Supabase">
              {uploadingImg ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} {uploadingImg ? 'Uploading…' : 'Upload'}
            </button>
            <button onMouseDown={(e) => { e.preventDefault(); saveSelection(); registerAsInsertTarget(); onInsertCondition?.(); }} className="flex items-center gap-1 px-2 py-1 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded text-xs font-medium border border-purple-200" title="Insert Optional/Conditional Text"><GitBranch size={14} /> Cond</button>
            <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={handleImgUpload} />
          </>
        )}
        {mode === 'rich' && imgSelected && (
          <>
            <div className="w-px h-4 bg-gray-300 mx-1"></div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide" title="Resize the selected image">Image</span>
            {['25%', '50%', '75%', '100%'].map((w) => (
              <button key={w} onMouseDown={(e) => { e.preventDefault(); applyImgWidth(w); }} className="px-1.5 py-1 text-[11px] bg-gray-100 hover:bg-gray-200 rounded">{w}</button>
            ))}
            <button onMouseDown={(e) => { e.preventDefault(); applyImgWidth(''); }} className="px-1.5 py-1 text-[11px] bg-gray-100 hover:bg-gray-200 rounded" title="Reset to original size">Auto</button>
          </>
        )}
        {mode === 'html' && (
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-1">Raw HTML source</span>
        )}
        {/* Mode toggle — always available, pinned right */}
        <button
          type="button"
          onMouseDown={(e) => { e.preventDefault(); mode === 'rich' ? switchToHtml() : switchToRich(); }}
          className={`ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors ${mode === 'html' ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-100'}`}
          title={mode === 'rich' ? 'Edit raw HTML source' : 'Back to visual editor'}
        >
          <Code size={14} /> {mode === 'rich' ? 'HTML' : 'Visual'}
        </button>
      </div>

      <div className="flex-1 min-h-0 relative bg-white cursor-text overflow-y-auto" onClick={() => { if (mode === 'rich') contentRef.current?.focus(); }}>
        {mode === 'html' ? (
          <textarea
            ref={htmlTextareaRef}
            value={htmlDraft}
            onChange={handleHtmlChange}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
            spellCheck={false}
            rows={1}
            className="block w-full min-h-[160px] p-4 outline-none resize-none overflow-hidden font-mono text-xs text-gray-800 bg-gray-50"
            placeholder={placeholder ? `${placeholder} (HTML)` : '<p>Enter HTML…</p>'}
          />
        ) : (
          <>
            {!initialContent && !isFocused && placeholder && (
               <div className="absolute top-4 left-4 text-gray-400 pointer-events-none select-none z-10">{placeholder}</div>
            )}
            <div
              ref={contentRef}
              className="min-h-[160px] p-4 outline-none im-content max-w-none font-sans"
              contentEditable
              onInput={handleChange}
              onClick={handleEditorClick}
              onFocus={() => { setIsFocused(true); registerAsInsertTarget(); }}
              onBlur={() => { setIsFocused(false); saveSelection(); }}
              onMouseUp={() => { saveSelection(); refreshCaretTable(); }}
              onKeyUp={() => { saveSelection(); refreshCaretTable(); }}
            />
          </>
        )}
      </div>
    </div>
  );
};

// --- Inline HTML row with its own per-language tabs ---
// Mirrors the Block Library editor: each inline row lets you author content for
// every enabled language directly, instead of following the section-level
// language tab. Switching the row tab edits/saves that language independently.
interface InlineHtmlRowProps {
  content: Record<string, string>;
  variant?: CalloutVariant;
  languages: { code: string; label: string }[];
  sectionId: string;
  index: number;
  onChange: (lang: string, html: string) => void;
  onVariantChange: (variant: CalloutVariant | undefined) => void;
  onInsertPlaceholder: (type: 'text' | 'image') => void;
  onInsertCondition: () => void;
  /** Show a per-box "Translate from EN" button on non-English language tabs. */
  enableTranslate?: boolean;
}

export const InlineHtmlRow: React.FC<InlineHtmlRowProps> = ({ content, variant, languages, sectionId, index, onChange, onVariantChange, onInsertPlaceholder, onInsertCondition, enableTranslate }) => {
  const [rowLang, setRowLang] = useState('en');
  const [translating, setTranslating] = useState(false);
  const [translateErr, setTranslateErr] = useState<string | null>(null);
  // Guard against the active row language being disabled on the template later.
  const activeCode = languages.some(l => l.code === rowLang) ? rowLang : (languages[0]?.code ?? 'en');
  const variantCfg = variant ? CALLOUT_VARIANTS.find(v => v.value === variant) : undefined;

  // Latest-value refs so the placeholder fan-out (registered at modal-open time,
  // run later at confirm time) always reads current row state — never a stale
  // snapshot captured when the modal opened.
  const contentRef = useRef(content); contentRef.current = content;
  const languagesRef = useRef(languages); languagesRef.current = languages;
  const activeCodeRef = useRef(activeCode); activeCodeRef.current = activeCode;
  const onChangeRef = useRef(onChange); onChangeRef.current = onChange;

  /** True when `html` already contains a placeholder chip with this `data-id`. */
  const hasPlaceholderId = (html: string | undefined, id: string) =>
    !!id && !!html && html.includes(`data-id="${id}"`);

  // Insert the placeholder chip at the caret in the active language AND append the
  // SAME chip (identical data-id/attr/label/type) to every other enabled language,
  // so the author defines it once and it resolves everywhere. Idempotent per
  // data-id so re-inserting an attribute-bound placeholder never duplicates it.
  const commitPlaceholder = useCallback((chipHtml: string) => {
    const id = chipHtml.match(/data-id="([^"]*)"/)?.[1] ?? '';
    const langs = languagesRef.current;
    const active = activeCodeRef.current;
    const cnt = contentRef.current;
    if (!hasPlaceholderId(cnt[active], id)) {
      (window as any).currentEditorInsertHtml?.(chipHtml);
    }
    langs.forEach(l => {
      if (l.code === active) return;
      const existing = cnt[l.code] ?? '';
      if (hasPlaceholderId(existing, id)) return;
      const next = existing.trim() ? `${existing}<p>${chipHtml}</p>` : `<p>${chipHtml}</p>`;
      onChangeRef.current(l.code, next);
    });
  }, []);

  // Register this row's fan-out as the active commit target when its editor's
  // placeholder button is pressed (the toolbar mousedown already pointed
  // currentEditorInsertHtml at this row's editor), then open the parent modal.
  const handleInsertPlaceholder = useCallback((type: 'text' | 'image') => {
    (window as any).currentEditorCommitPlaceholder = commitPlaceholder;
    onInsertPlaceholder(type);
  }, [commitPlaceholder, onInsertPlaceholder]);

  useEffect(() => () => {
    if ((window as any).currentEditorCommitPlaceholder === commitPlaceholder) {
      (window as any).currentEditorCommitPlaceholder = undefined;
    }
  }, [commitPlaceholder]);

  // Switching to a language that has no content yet backfills the placeholder
  // chips from the reference language (English) so placeholders created before
  // this language was enabled still appear. Gated strictly on an EMPTY target so
  // we never re-add chips a translator deliberately removed from real content.
  const handleSelectLang = useCallback((code: string) => {
    setRowLang(code);
    const cnt = contentRef.current;
    if ((cnt[code] ?? '').trim()) return;
    const langs = languagesRef.current;
    const refLang = langs.find(l => l.code === 'en')?.code ?? langs[0]?.code;
    if (!refLang || refLang === code) return;
    const chips = (cnt[refLang] ?? '').match(/<span[^>]*class="[^"]*im-placeholder[^"]*"[^>]*>.*?<\/span>/gs);
    if (!chips?.length) return;
    onChangeRef.current(code, chips.map(c => `<p>${c}</p>`).join(''));
  }, []);

  // Per-box AI translation: fill the ACTIVE language tab from the English source via
  // the same proxy the bulk translator uses (chips/images preserved). The result is
  // pushed through onChange so it renders in the editor for the author to review and
  // tweak before saving — nothing is persisted here.
  const enSource = content['en'] ?? '';
  const canTranslate = !!enableTranslate && activeCode !== 'en' && !!enSource.trim();
  const handleTranslateRow = useCallback(async () => {
    const source = contentRef.current['en'] ?? '';
    const target = activeCodeRef.current;
    if (target === 'en' || !source.trim() || translating) return;
    setTranslateErr(null);
    setTranslating(true);
    try {
      const out = await translateHtml(source, 'en', target);
      onChangeRef.current(target, out);
    } catch (e: any) {
      setTranslateErr(e?.message || 'Translation failed');
    } finally {
      setTranslating(false);
    }
  }, [translating]);

  return (
    <div className="flex flex-col gap-2 p-3 resize-y overflow-hidden min-h-[280px]">
      {/* Callout box selector — wraps the ENTIRE row content in this ISO sign box on render */}
      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide mr-0.5">Box:</span>
        <button
          type="button"
          onClick={() => onVariantChange(undefined)}
          className={`px-2 py-1 rounded text-xs font-medium border transition-colors ${!variant ? 'bg-gray-700 text-white border-gray-700' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
        >
          None
        </button>
        {CALLOUT_VARIANTS.map(({ value, label, Icon, chip }) => {
          const isActive = variant === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onVariantChange(value)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium border transition-colors ${isActive ? chip : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'}`}
              title={`Wrap this row in a ${label} box`}
            >
              <Icon size={12} /> {label}
            </button>
          );
        })}
      </div>

      {/* Per-row language tabs — a filled dot marks languages that already have content */}
      <div className="flex items-center gap-1 flex-wrap shrink-0">
        {languages.map(l => {
          const filled = !!(content[l.code] && content[l.code].trim());
          const isActive = activeCode === l.code;
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => handleSelectLang(l.code)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                isActive ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {l.code.toUpperCase()}
              {filled && <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-white' : 'bg-emerald-500'}`} />}
            </button>
          );
        })}
        {enableTranslate && activeCode !== 'en' && (
          <button
            type="button"
            onClick={handleTranslateRow}
            disabled={!canTranslate || translating}
            title={enSource.trim() ? `Translate this box from English into ${activeCode.toUpperCase()} — review before saving` : 'Add English content first'}
            className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {translating ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
            {translating ? 'Translating…' : `Translate from EN`}
          </button>
        )}
      </div>
      {translateErr && <div className="text-[11px] text-rose-600 shrink-0 -mt-1">{translateErr}</div>}

      {/* Editor — when a variant is set, the surface is framed to show everything inside is wrapped */}
      <div className={`flex-1 min-h-0 flex flex-col ${variantCfg ? `border-l-4 rounded-r ${variantCfg.frame} pl-2` : ''}`}>
        {variantCfg && (
          <div className="flex items-center gap-2 px-1 py-1.5 shrink-0">
            <span className="w-6 h-6 shrink-0" dangerouslySetInnerHTML={{ __html: CALLOUT_ICONS[variantCfg.value] }} />
            <span className="text-[11px] font-extrabold tracking-wide text-gray-700">{getCalloutTitle(variantCfg.value, activeCode)}</span>
            <span className="text-[10px] text-gray-400 italic">— everything below renders inside this box</span>
          </div>
        )}
        <div className="flex-1 min-h-0 flex flex-col">
          <SimpleRichTextEditor
            key={`${sectionId}-inline-${index}-${activeCode}`}
            initialContent={content[activeCode] || ''}
            onChange={(html) => onChange(activeCode, html)}
            placeholder="Enter content…"
            onInsertPlaceholder={handleInsertPlaceholder}
            onInsertCondition={onInsertCondition}
          />
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Self-contained placeholder + condition insertion modals
// ---------------------------------------------------------------------------

/** Routes an insert to whichever SimpleRichTextEditor most recently had focus. */
const insertHtmlToCurrentEditor = (html: string) => {
  if ((window as any).currentEditorInsertHtml) {
    (window as any).currentEditorInsertHtml(html);
  }
};

const PlaceholderModal: React.FC<{
  type: 'text' | 'image';
  attributes: CategoryAttribute[];
  onClose: () => void;
}> = ({ type, attributes, onClose }) => {
  const [label, setLabel] = useState('');
  const [attrId, setAttrId] = useState('');

  const attrOptions = attributes.filter(f =>
    type === 'image' ? (f as any).dataType === 'image' : (f as any).dataType !== 'image'
  );

  const confirm = () => {
    const finalLabel = label.trim() || (type === 'text' ? 'Text' : 'Image');
    // When bound to an attribute, use the attribute id as data-id so the generator
    // resolves the value (e.g. a supplier-uploaded product image) automatically.
    const id = attrId || createId();
    const colorClass = type === 'text' ? 'bg-amber-100 border-yellow-300 text-amber-800' : 'bg-indigo-100 border-indigo-300 text-blue-800';
    const attrAttr = attrId ? ` data-attr-id="${attrId}"` : '';
    const html = `&nbsp;<span class="im-placeholder ${colorClass} border px-2 py-0.5 rounded text-xs font-bold select-none mx-1" contenteditable="false" data-type="${type}" data-id="${id}"${attrAttr} data-label="${encodeURIComponent(finalLabel)}">[${finalLabel}]</span>&nbsp;`;
    // Prefer the row-aware fan-out (shares the placeholder across all languages);
    // fall back to a plain caret insert if no row registered one.
    if ((window as any).currentEditorCommitPlaceholder) {
      (window as any).currentEditorCommitPlaceholder(html);
    } else {
      insertHtmlToCurrentEditor(html);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in fade-in zoom-in duration-200">
        <h3 className="font-bold text-lg mb-4">Add {type === 'text' ? 'Text' : 'Image'} Placeholder</h3>
        {attrOptions.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">From Attribute (optional)</label>
            <select
              className="w-full border p-2 rounded text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              value={attrId}
              onChange={e => {
                const id = e.target.value;
                setAttrId(id);
                const attr = attributes.find(f => f.id === id);
                setLabel(id && attr ? attr.name : '');
              }}
            >
              <option value="">— Custom label —</option>
              <optgroup label={type === 'image' ? 'Product Image Attributes' : 'Category Attributes'}>
                {attrOptions.map(f => (
                  <option key={f.id} value={f.id}>{f.name} ({(f as any).dataType})</option>
                ))}
              </optgroup>
            </select>
            <p className="text-xs text-muted mt-1">
              {type === 'image'
                ? 'Bind to a product image so the uploaded photo renders here automatically.'
                : 'Select an attribute to pre-fill the label, or enter a custom one below.'}
            </p>
          </div>
        )}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Label</label>
          <input className="w-full border p-2 rounded outline-none focus:ring-2 focus:ring-indigo-500" placeholder={type === 'text' ? 'e.g. Product Name' : 'e.g. Front View'} value={label} onChange={(e) => setLabel(e.target.value)} autoFocus onKeyDown={(e) => e.key === 'Enter' && confirm()} />
          <p className="text-xs text-muted mt-1">This label will be shown when filling out the manual.</p>
        </div>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="text-gray-600 hover:bg-gray-100 px-4 py-2 rounded">Cancel</button>
          <button onClick={confirm} className="bg-indigo-600 text-white px-4 py-2 rounded">Insert</button>
        </div>
      </div>
    </div>
  );
};

const ConditionModal: React.FC<{
  attributes: CategoryAttribute[];
  onClose: () => void;
}> = ({ attributes, onClose }) => {
  const [featureId, setFeatureId] = useState('manual');
  const [text, setText] = useState('');
  const [enumSelected, setEnumSelected] = useState<string[]>([]);
  const [numMin, setNumMin] = useState('');
  const [numMax, setNumMax] = useState('');
  const [boolValue, setBoolValue] = useState('true');
  const [textValue, setTextValue] = useState('');
  const [useAttrValue, setUseAttrValue] = useState(false);
  const [anyValue, setAnyValue] = useState(false);

  const resetValue = () => {
    setEnumSelected([]); setNumMin(''); setNumMax(''); setBoolValue('true');
    setTextValue(''); setUseAttrValue(false); setAnyValue(false);
  };

  const buildConditionValue = (): string => {
    const attr = attributes.find(f => f.id === featureId) as any;
    if (!attr) return '';
    switch (attr.dataType) {
      case 'enum':    return enumSelected.join(', ');
      case 'integer':
      case 'decimal': {
        const unit = attr.validationRules?.unit ? ` ${attr.validationRules.unit}` : '';
        if (numMin && numMax) return `${numMin}–${numMax}${unit}`;
        return `${numMin || numMax}${unit}`;
      }
      case 'boolean': return boolValue === 'true' ? 'Yes' : 'No';
      case 'text':    return textValue;
      default:        return '';
    }
  };

  const confirm = () => {
    const id = createId();
    let featureName = '';
    let conditionLabel = '';
    if (featureId !== 'manual') {
      const feat = attributes.find(f => f.id === featureId);
      if (feat) featureName = feat.name;
      if (!anyValue) conditionLabel = buildConditionValue();
    }

    // "Any value" mode: inserts an always-visible value placeholder
    if (anyValue && featureId !== 'manual') {
      const html = `&nbsp;<span class="im-condition bg-amber-50 border-amber-300 text-amber-800 border border-dashed px-2 py-1 rounded text-sm mx-1" contenteditable="false" data-id="${id}" data-feature-id="${featureId}" data-feature-name="${featureName}" data-content="${encodeURIComponent(featureName)}" data-condition-value="*" data-always="true" title="Value: ${featureName}"><span class="font-bold text-xs uppercase mr-1">[${featureName}]</span></span>&nbsp;`;
      insertHtmlToCurrentEditor(html);
      onClose();
      return;
    }

    const effectiveContent = useAttrValue && conditionLabel ? conditionLabel : text;
    if (!effectiveContent.trim()) return;
    const displayLabel = featureId === 'manual' ? 'Optional' : conditionLabel ? `${featureName}: ${conditionLabel}` : featureName;
    const html = `&nbsp;<span class="im-condition bg-purple-50 border-indigo-300 text-purple-800 border border-dashed px-2 py-1 rounded text-sm mx-1" contenteditable="false" data-id="${id}" data-feature-id="${featureId}" data-content="${encodeURIComponent(effectiveContent)}" data-feature-name="${featureName}" data-condition-value="${encodeURIComponent(conditionLabel)}" title="Condition: ${displayLabel}"><span class="font-bold text-xs uppercase mr-1">[${displayLabel}]</span> ${effectiveContent.substring(0, 20)}${effectiveContent.length > 20 ? '...' : ''}</span>&nbsp;`;
    insertHtmlToCurrentEditor(html);
    onClose();
  };

  const attr = attributes.find(f => f.id === featureId) as any;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h3 className="font-bold text-lg mb-4">Add Condition</h3>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Condition Trigger</label>
          <select className="w-full border p-2 rounded text-sm outline-none focus:ring-2 focus:ring-indigo-500" value={featureId} onChange={(e) => { setFeatureId(e.target.value); resetValue(); }}>
            <option value="manual">Manual Selection (Optional Block)</option>
            <optgroup label="Auto-include based on Attribute">
              {attributes.map(f => <option key={f.id} value={f.id}>{f.name} ({(f as any).dataType})</option>)}
            </optgroup>
          </select>
          <p className="text-xs text-muted mt-1">{featureId === 'manual' ? 'User decides whether to include this text when generating the manual.' : anyValue ? "The attribute's value will be injected inline — always visible, no condition needed." : 'Text is automatically included if this attribute matches the selected value.'}</p>
        </div>

        {featureId !== 'manual' && (
          <div className="mb-4 flex items-center gap-2 p-3 rounded border border-amber-200 bg-amber-50">
            <input id="condAnyValue" type="checkbox" className="rounded accent-amber-600" checked={anyValue} onChange={e => { setAnyValue(e.target.checked); if (e.target.checked) setUseAttrValue(false); }} />
            <label htmlFor="condAnyValue" className="text-sm text-amber-800 cursor-pointer select-none">
              <span className="font-medium">Any value — always show</span>
              <span className="text-amber-700 ml-1">Injects the live attribute value directly into the document, no condition match required.</span>
            </label>
          </div>
        )}

        {!anyValue && featureId !== 'manual' && attr && (() => {
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
                    {enumOptions.map((opt: string) => (
                      <label key={opt} className="flex items-center gap-2 text-sm cursor-pointer p-1.5 rounded hover:bg-indigo-100">
                        <input type="checkbox" className="rounded accent-indigo-600" checked={enumSelected.includes(opt)} onChange={e => setEnumSelected(prev => e.target.checked ? [...prev, opt] : prev.filter(v => v !== opt))} />
                        <span>{opt}</span>
                      </label>
                    ))}
                  </div>
                )}
                {enumSelected.length > 0 && <p className="text-xs text-indigo-600 mt-2">Selected: {enumSelected.join(', ')}</p>}
              </div>
            );
          }
          if (attr.dataType === 'integer' || attr.dataType === 'decimal') {
            return (
              <div className="mb-4 p-3 bg-indigo-50 rounded border border-indigo-200">
                <label className="block text-sm font-medium text-gray-700 mb-2">Match Range{unit}</label>
                <div className="flex items-center gap-2">
                  <input type="number" className="flex-1 border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Min" value={numMin} onChange={e => setNumMin(e.target.value)} />
                  <span className="text-gray-400 text-sm">–</span>
                  <input type="number" className="flex-1 border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Max" value={numMax} onChange={e => setNumMax(e.target.value)} />
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
                    <input type="radio" name="condBool" value="true" checked={boolValue === 'true'} onChange={() => setBoolValue('true')} className="accent-indigo-600" />
                    <span className="text-sm font-medium text-green-700">Yes</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="condBool" value="false" checked={boolValue === 'false'} onChange={() => setBoolValue('false')} className="accent-indigo-600" />
                    <span className="text-sm font-medium text-rose-700">No</span>
                  </label>
                </div>
              </div>
            );
          }
          return (
            <div className="mb-4 p-3 bg-indigo-50 rounded border border-indigo-200">
              <label className="block text-sm font-medium text-gray-700 mb-2">Match Text</label>
              <input type="text" className="w-full border rounded p-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Value to match..." value={textValue} onChange={e => setTextValue(e.target.value)} />
            </div>
          );
        })()}

        {!anyValue && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-700">Content to Show</label>
              {featureId !== 'manual' && (
                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input type="checkbox" className="rounded accent-indigo-600" checked={useAttrValue} onChange={e => setUseAttrValue(e.target.checked)} />
                  <span className="text-xs text-indigo-600 font-medium">Use attribute value</span>
                </label>
              )}
            </div>
            {useAttrValue && featureId !== 'manual' ? (
              <div className="w-full border border-indigo-300 bg-indigo-50 p-2 rounded text-sm text-indigo-800 min-h-[72px] flex items-center">
                {buildConditionValue() || <span className="text-gray-400 italic">Set a condition value above to preview...</span>}
              </div>
            ) : (
              <textarea className="w-full border p-2 rounded outline-none focus:ring-2 focus:ring-indigo-500" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to show if condition matches..." />
            )}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="text-gray-600">Cancel</button>
          <button onClick={confirm} className="bg-indigo-600 text-white px-4 py-2 rounded">Insert</button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// InlineBlockEditor — an InlineHtmlRow plus self-contained insertion modals
// ---------------------------------------------------------------------------

interface InlineBlockEditorProps {
  content: Record<string, string>;
  variant?: CalloutVariant;
  languages: { code: string; label: string }[];
  /** Category attributes used to bind placeholders / build conditions. */
  attributes: CategoryAttribute[];
  /** Stable id used for editor React keys (e.g. the addition / section id). */
  rowKey: string;
  onChange: (lang: string, html: string) => void;
  onVariantChange: (variant: CalloutVariant | undefined) => void;
  /** Show a per-box "Translate from EN" button on non-English language tabs. */
  enableTranslate?: boolean;
}

export const InlineBlockEditor: React.FC<InlineBlockEditorProps> = ({ content, variant, languages, attributes, rowKey, onChange, onVariantChange, enableTranslate }) => {
  const [placeholderType, setPlaceholderType] = useState<'text' | 'image' | null>(null);
  const [conditionOpen, setConditionOpen] = useState(false);

  return (
    <>
      <InlineHtmlRow
        content={content}
        variant={variant}
        languages={languages}
        sectionId={rowKey}
        index={0}
        onChange={onChange}
        onVariantChange={onVariantChange}
        enableTranslate={enableTranslate}
        onInsertPlaceholder={(type) => setPlaceholderType(type)}
        onInsertCondition={() => setConditionOpen(true)}
      />
      {placeholderType && (
        <PlaceholderModal type={placeholderType} attributes={attributes} onClose={() => setPlaceholderType(null)} />
      )}
      {conditionOpen && (
        <ConditionModal attributes={attributes} onClose={() => setConditionOpen(false)} />
      )}
    </>
  );
};
