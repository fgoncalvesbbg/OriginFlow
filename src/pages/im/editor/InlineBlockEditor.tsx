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
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { IMAGE_ALIGNS, type ImageAlign } from '../../../services/im/im-image-align';
import { sanitizeAuthorHtml } from '../../../services/im/im-author-html';
import { usePrintColumn } from './usePrintColumn';
import { previewZoomFor, widthAsColumnPercent, CRAMPED_PREVIEW_ZOOM } from '../../../services/im/im-print-geometry';
import { imgStyleFor, imgTag, readImgAlign, readImgBorder, readImgValign, IMG_VALIGNS, type ImgVAlign } from './im-image-markup';
import { imContentVars } from './im-content-style';
import { Bold, Italic, Underline, Highlighter, List, ListOrdered, Type, Image as ImageIcon, Images, GitBranch, Table as TableIcon, AlertTriangle, AlertOctagon, Zap, Flame, Thermometer, Info, Upload, Loader2, Code, Languages, AlignLeft, AlignCenter, AlignRight, WrapText, X, ShieldCheck, ShieldPlus, Square, Plus, ChevronDown, ChevronRight, type LucideIcon, Columns, QrCode } from 'lucide-react';
import { translateHtml } from '../../../services/ai/translation.service';
import { markTranslatedFromEn, translationStaleAgainstEn } from '../../../services/im/im-translation-marker';
import { getTranslationVerbatims, createTranslationVerbatim, updateTranslationVerbatim } from '../../../services/ai/translation-verbatim.service';
import { uploadIMAsset } from '../../../services/im/im-asset.service';
import { getCalloutTitle } from '../../../services/im/callout-titles.i18n';
import { TEMP_HIGHLIGHT_CLASS } from '../../../services/im/im-resolver';
import { QR_SKU_PLACEHOLDER_ID } from '../../../config/im.constants';
import { CalloutVariant, CategoryAttribute, TranslationVerbatim } from '../../../types';
import type { IMTemplateType } from '../../../types';
import type { PrintPageSizeKey } from '../../../services/im/im-print-typography';
import { sanitizeHtml } from '../../../utils';
import { useAuth } from '../../../context/AuthContext';
import { AttributePicker } from './AttributePicker';
import { AssetLibraryPanel } from './AssetLibraryPanel';
import EditorToolbarMenu from './EditorToolbarMenu';
import { setInsertTarget, clearInsertTarget, insertToActiveEditor, setCommitPlaceholderTarget, clearCommitPlaceholderTarget, commitPlaceholder as commitPlaceholderToTarget } from './insertTarget';

// --- SKU QR code chip --------------------------------------------------------
// A system-computed placeholder chip (same im-placeholder markup the resolver and
// translation memory already know how to handle) rather than a plain {{token}}: its
// resolved value is raw SVG, which the im-placeholder text-chip path splices in verbatim,
// and freezing it as a chip keeps it out of machine translation entirely. There is
// nothing to bind — the resolver fills the QR in automatically (im-resolver.ts) from the
// manual's first bound SKU — so it carries a fixed reserved id instead of an attrId.
const QR_CHIP_HTML = `&nbsp;<span class="im-placeholder bg-amber-100 border-yellow-300 text-amber-800 border px-2 py-0.5 rounded text-xs font-bold select-none mx-1 cursor-default" contenteditable="false" data-type="text" data-id="${QR_SKU_PLACEHOLDER_ID}" data-label="${encodeURIComponent('QR Code')}" title="SKU QR code — filled in automatically with a QR code linking to use.berlin/<SKU> for this manual's SKU">[QR Code]</span>&nbsp;`;

// --- Verbatim phrase badges (EN tab only) ------------------------------------
// Known verbatim phrases (translation_verbatims table) are fetched once per
// session and shared by every open row/editor instance, mirroring the cache in
// translation.service.ts. `notifyVerbatimListeners` pushes a fresh list to every
// mounted editor immediately after a save, so a phrase added in one box is
// badged in every other open EN box without a page reload.
let verbatimsCache: TranslationVerbatim[] | null = null;
let verbatimsPromise: Promise<TranslationVerbatim[]> | null = null;
const verbatimListeners = new Set<(v: TranslationVerbatim[]) => void>();
const notifyVerbatimListeners = (v: TranslationVerbatim[]) => {
  verbatimsCache = v;
  verbatimListeners.forEach((fn) => fn(v));
};
const loadVerbatimsCached = (): Promise<TranslationVerbatim[]> => {
  if (verbatimsCache) return Promise.resolve(verbatimsCache);
  if (!verbatimsPromise) {
    verbatimsPromise = getTranslationVerbatims()
      .then((v) => { verbatimsCache = v; return v; })
      .catch((e) => { console.warn('[InlineBlockEditor] Failed to load translation verbatims; continuing without.', e); return []; });
  }
  return verbatimsPromise;
};

// Small inline badge appended right after a matched verbatim phrase — purely a
// visual, contenteditable="false" marker. It is never part of the saved HTML:
// parseInlineNodes skips the `im-verbatim-badge` class entirely, so it drops out
// on the very next deserialize→serialize round-trip and is re-added by the
// decoration pass below. lucide's ShieldCheck path, inlined for raw DOM insertion.
const VERBATIM_BADGE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px;display:block;"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/></svg>`;

// --- ISO 7010 / 7000 callout signs (shared by the editor preview and serializer) ---
// W001 General Warning, W012 Electrical Hazard, W021 Flammable (Risk of Fire), W017 Hot Surface, M002 Information.
const ISO_W001 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><polygon points="50,6 94,87 6,87" fill="#FFDA00" stroke="#231F20" stroke-width="4.5" stroke-linejoin="round"/><rect x="46.5" y="30" width="7" height="31" rx="2.5" fill="#231F20"/><circle cx="50" cy="73" r="5.5" fill="#231F20"/></svg>`;
const ISO_W012 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><polygon points="50,6 94,87 6,87" fill="#FFDA00" stroke="#231F20" stroke-width="4.5" stroke-linejoin="round"/><path d="M57,24 L39,55 L51,55 L44,78 L62,47 L50,47 Z" fill="#231F20"/></svg>`;
const ISO_W021 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 525" style="display:block;width:100%;height:100%;"><path d="M 597.6,499.6 313.8,8 C 310.9,3 305.6,0 299.9,0 294.2,0 288.9,3.1 286,8 L 2.2,499.6 c -2.9,5 -2.9,11.1 0,16 2.9,5 8.2,8 13.9,8 h 567.6 c 5.7,0 11,-3.1 13.9,-8 2.9,-5 2.9,-11.1 0,-16 z" fill="#231F20"/><polygon points="43.875,491.5 299.875,48.2 555.875,491.5" transform="matrix(1,0,0,0.99591458,0.125,2.0332437)" fill="#FFDA00"/><path d="m 254.20599,412.70348 c -23.76019,-10.34209 -33.09455,-30.39188 -35.71706,-76.71863 -1.06141,-18.75 -1.13418,-34.09091 -0.16169,-34.09091 0.97249,0 4.29519,1.35243 7.38379,3.00539 4.98824,2.66964 5.99798,1.23079 9.03804,-12.87878 1.88233,-8.7363 4.23436,-21.75719 5.22673,-28.9353 l 1.80431,-13.05112 9.88246,9.57846 9.88247,9.57846 2.12479,-22.67469 c 1.16864,-12.47108 1.16355,-27.05119 -0.0112,-32.40024 -2.00776,-9.14129 -1.75819,-9.52331 4.15445,-6.35896 3.45979,1.85162 7.7334,6.06261 9.4969,9.35775 5.94987,11.11759 9.05366,6.09812 9.05366,-14.64178 0,-13.03057 1.58382,-22.79895 4.2985,-26.51149 4.12866,-5.64628 4.38304,-5.54174 6.43797,2.64577 1.17671,4.68838 8.03213,15.42775 15.23426,23.86526 7.20212,8.43751 13.64618,18.9181 14.32012,23.29019 l 1.22533,7.94926 0.45403,-8.33333 c 0.57982,-10.64199 4.12382,-10.5344 13.32837,0.4046 6.66394,7.91962 10.13451,17.48588 16.069,44.29237 1.93451,8.73845 2.1136,8.82656 4.61879,2.27273 3.3383,-8.7334 6.86421,-8.63774 11.65621,0.31623 4.67369,8.73288 5.39436,24.48257 2.30806,50.44134 -2.07621,17.46282 -1.84452,19.07567 2.04276,14.21936 4.04869,-5.05797 4.53933,-4.56179 6.4043,6.47691 2.55164,15.10294 -2.7687,35.42364 -12.71633,48.56921 -9.97903,13.18712 -34.5024,24.60594 -52.92676,24.6443 -17.95679,0.0373 -20.42284,-3.76866 -7.41467,-11.44366 11.92246,-7.03443 24.03985,-22.06988 30.77215,-38.18258 4.52855,-10.83827 4.49197,-11.358 -0.68324,-9.71542 -4.83224,1.53367 -5.35055,0.0658 -4.4593,-12.62848 l 1.00842,-14.36388 -7.91642,11.36363 c -10.00264,14.35834 -14.15034,14.55197 -10.26464,0.47915 3.75124,-13.58587 0.74797,-33.0383 -7.09173,-45.93369 -3.29306,-5.41667 -6.46488,-9.84849 -7.04853,-9.84849 -0.58364,0 -1.01554,11.25 -0.95978,25 0.0994,24.51621 -3.69021,41.66667 -9.20685,41.66667 -1.52966,0 -4.90224,-5.11364 -7.49462,-11.36364 l -4.71341,-11.36363 -0.46317,10.60606 c -0.25472,5.83333 -0.22051,15.03788 0.076,20.45454 0.29655,5.41667 -0.85159,9.84849 -2.55145,9.84849 -5.08631,0 -12.55008,-12.86679 -14.502,-25 -2.00506,-12.46355 -6.84316,-15.36643 -7.57568,-4.54546 -0.9802,14.47946 -1.44911,15.88549 -5.04602,15.13052 -8.24799,-1.73121 3.85695,30.08491 17.24971,45.33839 5.20849,5.93215 9.46999,11.62842 9.46999,12.65842 0,3.31249 -16.373,1.76328 -26.09704,-2.4693 z M 185,455 l 0,-25 230,0 0,25 z" fill="#231F20"/></svg>`;
const ISO_M002 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" style="display:block;width:100%;height:100%;"><circle cx="50" cy="50" r="46" fill="#0066B2"/><circle cx="50" cy="26" r="7" fill="white"/><rect x="43" y="40" width="14" height="36" rx="4" fill="white"/></svg>`;

// ISO 7010 W017 — Hot surface
const ISO_W017 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 525" style="display:block;width:100%;height:100%;"><path d="M597.6,499.6,313.8,8c-2.9-5-8.2-8-13.9-8s-11,3.1-13.9,8l-283.8,491.6c-2.9,5-2.9,11.1,0,16,2.9,5,8.2,8,13.9,8h567.6c5.7,0,11-3.1,13.9-8,2.9-5,2.9-11.1,0-16z" fill="#231F20"/><polygon points="43.875,491.5,299.88,48.2,555.88,491.5" transform="matrix(1,0,0,0.99591458,0.125,2.0332437)" fill="#FFDA00"/><rect x="175" y="437" width="250" height="25" fill="#231F20"/><path d="M242.68,415c56.86-81.3-60.68-104.16-2.68-185" stroke="#231F20" stroke-width="16" fill="none"/><path d="m303.78,414.51c56.86-81.3-60.561-103.43-2.561-184.27" stroke="#231F20" stroke-width="16" fill="none"/><path d="M365,415c56.86-81.3-59.23-104.65-1.22-185.49" stroke="#231F20" stroke-width="16" fill="none"/></svg>`;

const CALLOUT_ICONS: Record<CalloutVariant, string> = { warning: ISO_W001, danger: ISO_W001, caution: ISO_W001, electric: ISO_W012, flammable: ISO_W021, hot_surface: ISO_W017, info: ISO_M002 };
const CALLOUT_TITLES: Record<CalloutVariant, string> = { warning: 'WARNING', danger: 'DANGER', caution: 'CAUTION', electric: 'ELECTRIC HAZARD', flammable: 'RISK OF FIRE', hot_surface: 'HOT SURFACE', info: 'INFO' };

// Default body text seeded when a callout box is inserted inline (per variant).
const CALLOUT_DEFAULT_TEXT: Record<CalloutVariant, string> = {
  warning: 'Indicates a hazardous situation which, if not avoided, could result in serious injury or death.',
  danger: 'Indicates an imminent hazardous situation which, if not avoided, will result in death or serious injury.',
  caution: 'Indicates a potentially hazardous situation which may result in minor injury or damage to the appliance.',
  electric: 'Risk of electric shock. Disconnect power before servicing.',
  flammable: 'Risk of fire. Keep away from open flames and flammable materials.',
  hot_surface: 'Hot surface. Do not touch during or immediately after use — allow to cool first.',
  info: 'Offers helpful tips and information for using your product.',
};

// Editor-only chrome for the row variant selector + framing (the final PDF uses the CSS classes).
export const CALLOUT_VARIANTS: { value: CalloutVariant; label: string; Icon: LucideIcon; frame: string; chip: string }[] = [
  { value: 'warning',   label: 'Warning',         Icon: AlertTriangle, frame: 'border-orange-300 bg-orange-50',  chip: 'bg-orange-100 text-orange-700 border-orange-200' },
  { value: 'danger',    label: 'Danger',          Icon: AlertTriangle, frame: 'border-red-700 bg-red-100',       chip: 'bg-red-700 text-white border-red-700' },
  { value: 'caution',   label: 'Caution',         Icon: AlertOctagon,  frame: 'border-yellow-300 bg-yellow-50',  chip: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  { value: 'electric',  label: 'Electric Hazard', Icon: Zap,           frame: 'border-red-300 bg-red-50',        chip: 'bg-red-100 text-red-700 border-red-200' },
  { value: 'flammable', label: 'Risk of Fire',    Icon: Flame,         frame: 'border-orange-400 bg-rose-50',    chip: 'bg-rose-100 text-orange-700 border-orange-200' },
  { value: 'hot_surface', label: 'Hot Surface',   Icon: Thermometer,   frame: 'border-amber-400 bg-amber-50',    chip: 'bg-amber-100 text-amber-800 border-amber-200' },
  { value: 'info',      label: 'Info',            Icon: Info,          frame: 'border-blue-300 bg-blue-50',      chip: 'bg-blue-100 text-blue-700 border-blue-200' },
];

// --- Structured Rich Text Editor ---
type BlockInsertType = 'warning' | 'danger' | 'info' | 'table' | 'caution' | 'electric' | 'flammable' | 'hot_surface';

// A 'temp' mark flags text as not-yet-final (author-visible highlight only —
// never a real formatting choice). Publishing must be blocked while any survives;
// see `containsTempHighlight` / `TEMP_HIGHLIGHT_MARKER` below.
type TextMark = 'bold' | 'italic' | 'underline' | 'temp';

type InlineNode =
  | { type: 'text'; text: string; marks?: Array<TextMark> }
  | { type: 'placeholder'; id: string; placeholderType: 'text' | 'image'; label: string; attrId?: string }
  // `always` marks an "any value — always show" chip (data-always): the attribute's
  // live value is injected unconditionally. Must round-trip or the chip degrades
  // into a normal condition on the next edit.
  | { type: 'condition'; id: string; featureId: string; featureName?: string; conditionLabel?: string; content: string; always?: boolean }
  // Inline image (e.g. an uploaded asset dropped at the caret inside a paragraph).
  // `width` is the optional CSS width set via the resize control (e.g. "50%");
  // `align` is the chosen inline/left/right/center placement; `border` draws a
  // thin frame around the image; `valign` seats an INLINE image against its text line.
  | { type: 'image'; src: string; alt?: string; width?: string; align?: ImgAlign; border?: boolean; valign?: ImgVAlign };

// A table cell's content plus its own horizontal alignment (independent of any
// per-image align/float set inside it — this centers/aligns whatever the cell
// holds, image or text, the way a spreadsheet or Word table cell would).
export type CellAlign = 'left' | 'center' | 'right';
interface TableCellData { align?: CellAlign; content: InlineNode[]; }

// One list item at a nesting depth (0 = top level). Depth-flat storage lets the
// parser/serializer round-trip nested <ul>/<ol> instead of flattening them.
interface ListItemData { depth: number; content: InlineNode[]; }

type EditorBlock =
  | { id: string; type: 'paragraph'; content: InlineNode[] }
  | { id: string; type: 'heading'; level: 1 | 2 | 3; content: InlineNode[] }
  | { id: string; type: 'callout'; variant: CalloutVariant; content: InlineNode[] }
  | { id: string; type: 'image'; src: string; alt?: string; width?: string; align?: ImgAlign; border?: boolean; valign?: ImgVAlign }
  | { id: string; type: 'list'; ordered: boolean; items: ListItemData[] }
  // `fit` — 'content' shrinks the table to its content instead of the full column (the
  // default house style). `colWidths` — author-set column widths in ABSOLUTE mm (not
  // %, which is relative to the table's own width and unresolvable once that width is
  // itself auto — see setCaretColumnWidth), null for auto columns; serialized as a
  // <colgroup> so print honours them too.
  | { id: string; type: 'table'; rows: TableCellData[][]; fit?: 'content'; colWidths?: (number | null)[] }
  | { id: string; type: 'conditional'; condition: { id: string; featureId: string; featureName?: string }; content: InlineNode[] }
  | { id: string; type: 'legacy_html'; html: string };

/** Everything a placeholder chip carries, read off its data-* attributes for editing. */
export interface PlaceholderChipData { id: string; type: 'text' | 'image'; label: string; attrId?: string }
/** Everything a condition chip carries, read off its data-* attributes for editing. */
export interface ConditionChipData { id: string; featureId: string; featureName: string; content: string; conditionLabel: string; always: boolean }

interface EditorProps {
  initialContent: string;
  onChange: (html: string) => void;
  placeholder?: string;
  onInsertPlaceholder?: (type: 'text' | 'image') => void;
  onInsertCondition?: () => void;
  /**
   * Click-to-edit for existing chips: called with the chip's current data and a
   * `replace` callback that swaps the clicked chip's HTML in place. When absent,
   * chips stay inert (the pre-edit behaviour).
   */
  onEditPlaceholder?: (data: PlaceholderChipData, replace: (html: string) => void) => void;
  onEditCondition?: (data: ConditionChipData, replace: (html: string) => void) => void;
  minimal?: boolean;
  /**
   * Enables verbatim phrase badges + the "Save as Verbatim" toolbar action.
   * Passed only for the EN tab (verbatim phrases are English text matched
   * exactly); the languages list drives which per-language wording fields the
   * save/edit modal offers.
   */
  verbatimLanguages?: { code: string; label: string }[];
  /**
   * BCP-47 code of the language being edited (e.g. "de"). Set on the
   * contentEditable so the browser spellchecks with the RIGHT dictionary —
   * without it, German/French prose is checked against the UI language and
   * either everything squiggles or real typos pass silently.
   */
  lang?: string;
  /**
   * Which print profile this content will be set in. Given both, the editor models the real
   * printed column so image sizes match the PDF; omitted, it keeps its fluid canvas.
   */
  printTemplateType?: IMTemplateType;
  printPageSize?: PrintPageSizeKey;
}

const createId = () => Math.random().toString(36).slice(2, 11);

// --- Image sizing + alignment -------------------------------------------------
// Editor images carry an optional CSS width (from the size control) and an
// alignment. Alignment is persisted as a `data-align` attribute (the source of
// truth read back on every parse) AND baked into the inline `style` so it renders
// identically in the editor, the print PDF, and the viewer. Because the
// serializers rebuild the <img> style from scratch, anything not captured on the
// node is lost on round-trip — hence align lives on the node, like width. The
// builders/readers live in im-image-markup.ts so the asset library inserts the
// exact same markup this editor round-trips.
export type ImgAlign = ImageAlign;
const IMG_ALIGNS: readonly ImgAlign[] = IMAGE_ALIGNS;

/** A table cell holding a single plain-text run (used for defaults/fallbacks). */
const textCell = (text: string): TableCellData => ({ content: [{ type: 'text', text }] });

const CELL_ALIGNS: CellAlign[] = ['left', 'center', 'right'];

/** Read a valid cell alignment off a <td>/<th> element, or undefined (browser default: left). */
const readCellAlign = (el: Element): CellAlign | undefined => {
  const a = el.getAttribute('data-align') as CellAlign | null;
  return a && CELL_ALIGNS.includes(a) ? a : undefined;
};

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

/* ---------------------------------------------------------------------------
 * Toolbar primitives
 *
 * The editor bar carries ~30 controls (block styles, marks, lists, six kinds of
 * insert, plus contextual table and image controls). Flat, they were one wrapping
 * row of mixed shapes and six pastel colours where nothing said what belonged to
 * what. These four primitives give the bar ONE vocabulary:
 *
 *   TbGroup   — a segmented shell: "these act on the same thing" (replaces the
 *               old bare `w-px` dividers, which grouped by proximity only)
 *   TbIcon    — every icon control, one shape, one active state
 *   TbPill    — every labelled control (H1, +Row, 50%)
 *   TbCaption — names a contextual group (TABLE / CELL / IMAGE / SIZE …)
 *
 * All of them fire on mousedown with preventDefault: the whole bar operates on
 * the contentEditable's live selection, and letting a button take focus would
 * collapse it before the command runs. That was repeated on ~30 buttons; it now
 * lives in one place. Enter/Space are wired too, so the bar stays keyboard-usable
 * (the caret's selection is saved on keyup/blur, so commands still land).
 * ------------------------------------------------------------------------- */

const TB_TONES = {
  default: 'text-gray-600 hover:bg-gray-100',
  amber: 'text-amber-600 hover:bg-amber-50',
  purple: 'text-purple-600 hover:bg-purple-50',
  rose: 'text-rose-600 hover:bg-rose-50',
} as const;

type TbTone = keyof typeof TB_TONES;

/**
 * A boolean the author sets once and keeps, across sessions and across every editor box.
 *
 * The print-width preview is a working preference, not document data: switching it per box, or
 * having it reset on reload, would be worse than not remembering it at all. Storage failures
 * (private windows, blocked site data) fall back to the default rather than throwing.
 */
const usePersistedFlag = (key: string, fallback: boolean): [boolean, (next: boolean) => void] => {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : raw === '1';
    } catch {
      return fallback;
    }
  });
  const set = useCallback((next: boolean) => {
    setValue(next);
    try {
      window.localStorage.setItem(key, next ? '1' : '0');
    } catch {
      /* preference simply will not persist */
    }
  }, [key]);
  return [value, set];
};

const MATCH_PRINT_WIDTH_KEY = 'im.editor.matchPrintWidth';

const TbGroup: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <div className={`flex items-center gap-0.5 rounded-lg border border-gray-200 bg-white p-0.5 ${className}`}>{children}</div>
);

const TbCaption: React.FC<{ children: React.ReactNode; title?: string }> = ({ children, title }) => (
  <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wide px-0.5" title={title}>{children}</span>
);

interface TbButtonProps {
  /** Runs on mousedown (selection-preserving) and on Enter/Space. */
  onPress: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
  tone?: TbTone;
  children: React.ReactNode;
}

const tbPressProps = (onPress: () => void, disabled?: boolean) => ({
  type: 'button' as const,
  disabled,
  onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); if (!disabled) onPress(); },
  onKeyDown: (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (!disabled) onPress();
  },
});

const TbIcon: React.FC<TbButtonProps> = ({ onPress, title, active, disabled, tone = 'default', children }) => (
  <button
    {...tbPressProps(onPress, disabled)}
    title={title}
    aria-label={title}
    aria-pressed={active}
    className={`flex items-center justify-center w-7 h-7 rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      active ? 'bg-indigo-600 text-white hover:bg-indigo-700' : TB_TONES[tone]
    }`}
  >{children}</button>
);

const TbPill: React.FC<TbButtonProps & { bold?: boolean }> = ({ onPress, title, active, disabled, tone = 'default', bold, children }) => (
  <button
    {...tbPressProps(onPress, disabled)}
    title={title}
    aria-pressed={active}
    className={`px-1.5 h-7 rounded-md text-[11px] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${bold ? 'font-semibold' : 'font-medium'} ${
      active ? 'bg-indigo-600 text-white hover:bg-indigo-700' : TB_TONES[tone]
    }`}
  >{children}</button>
);
const SimpleRichTextEditor: React.FC<EditorProps> = ({ initialContent, onChange, placeholder, onInsertPlaceholder, onInsertCondition, onEditPlaceholder, onEditCondition, minimal, verbatimLanguages, lang, printTemplateType, printPageSize }) => {
  const { user } = useAuth();
  const verbatimEnabled = !!verbatimLanguages?.length;
  const [verbatims, setVerbatims] = useState<TranslationVerbatim[]>(() => verbatimsCache ?? []);
  const [verbatimModal, setVerbatimModal] = useState<{ id?: string; phrase: string; note: string; translations: Record<string, string> } | null>(null);
  const [savingVerbatim, setSavingVerbatim] = useState(false);
  const [blocks, setBlocks] = useState<EditorBlock[]>([]);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  // Foldered/searchable asset library popup — lets the author reuse a previously
  // uploaded image (or an ISO pictogram) without leaving this row.
  const [showAssetPicker, setShowAssetPicker] = useState(false);
  // Editing surface: 'rich' = structured WYSIWYG, 'html' = raw HTML source.
  const [mode, setMode] = useState<'rich' | 'html'>('rich');
  const [htmlDraft, setHtmlDraft] = useState('');
  // The image the user last clicked in the editor — target of the size/align controls.
  const [imgSelected, setImgSelected] = useState(false);
  // Mirror of the selected image's current width + alignment, so the toolbar can
  // highlight the active choice. Kept in sync on selection and on every apply.
  // The printed column this content will be set in, when the screen knows it. Drives both the
  // image height cap and the optional true-to-print canvas.
  const printColumn = usePrintColumn(printTemplateType, printPageSize);
  const [matchPrintWidth, setMatchPrintWidth] = usePersistedFlag(MATCH_PRINT_WIDTH_KEY, true);
  // The compact/minimal surface is a single-line control, so modelling a page column there
  // would be meaningless.
  const printPreview = !!printColumn && matchPrintWidth && !minimal;
  // Measured so the modelled column can be scaled to fill the pane exactly, which keeps the
  // proportions true without ever producing a horizontal scrollbar.
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const [canvasWidth, setCanvasWidth] = useState(0);

  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      setCanvasWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const previewZoom = printColumn ? previewZoomFor(printColumn.columnPx, canvasWidth) : 1;

  const [imgWidth, setImgWidth] = useState<string>('');
  const [imgAlign, setImgAlign] = useState<ImgAlign | undefined>(undefined);
  const [imgBorder, setImgBorder] = useState(false);
  const [imgValign, setImgValign] = useState<ImgVAlign | undefined>(undefined);
  // Editable alt text of the selected image — previously settable only once, at upload.
  const [imgAlt, setImgAlt] = useState<string>('');
  const selectedImgRef = useRef<HTMLImageElement | null>(null);
  // Drag-resize handle over the selected image: its position (relative to the editor's
  // positioned scroll container) and the drag-in-progress bookkeeping.
  const [imgHandle, setImgHandle] = useState<{ left: number; top: number } | null>(null);
  const dragStateRef = useRef<{ startX: number; startWidth: number; contentWidth: number } | null>(null);
  const editorShellRef = useRef<HTMLDivElement>(null);
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

  // Load the shared verbatim list once (subsequent instances hit the cache) and
  // stay subscribed so a phrase saved in another open box shows up here too.
  useEffect(() => {
    if (!verbatimEnabled) return;
    let alive = true;
    loadVerbatimsCached().then((v) => { if (alive) setVerbatims(v); });
    const listener = (v: TranslationVerbatim[]) => { if (alive) setVerbatims(v); };
    verbatimListeners.add(listener);
    return () => { alive = false; verbatimListeners.delete(listener); };
  }, [verbatimEnabled]);

  // Memoized: this array's identity flows (via decorateVerbatims) into the deps of
  // the render effect that rewrites the contentEditable from `blocks`. Rebuilding it
  // on every render made that effect run on EVERY render — so any re-render that
  // wasn't caused by typing (parent echo after onChange, focus/toolbar state like
  // caretInTable flipping) rewrote the DOM with the one-shot isUserEditingRef guard
  // already consumed, destroying the caret (felt worst inside tables).
  const verbatimPhrases = useMemo(
    () => (verbatimEnabled ? verbatims.map((v) => v.phrase).filter(Boolean) : []),
    [verbatimEnabled, verbatims],
  );

  // Badge every occurrence of a known verbatim phrase in the live DOM. Purely
  // presentational: removes and reinserts its own badges each call (idempotent),
  // never touches `blocks`/emitted HTML. Matches are case-sensitive, exactly like
  // freezeVerbatims (im-chip-freeze.ts) uses at translation time, so a badge here
  // means the phrase really will be protected when this box is translated.
  const decorateVerbatims = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    el.querySelectorAll('.im-verbatim-badge').forEach((b) => b.remove());
    el.normalize();
    if (!verbatimPhrases.length) return;
    const phrases = [...verbatimPhrases].sort((a, b) => b.length - a.length);

    const findFirstMatch = (text: string): { idx: number; phrase: string } | null => {
      let best: { idx: number; phrase: string } | null = null;
      for (const phrase of phrases) {
        if (!phrase) continue;
        const idx = text.indexOf(phrase);
        if (idx === -1) continue;
        if (!best || idx < best.idx || (idx === best.idx && phrase.length > best.phrase.length)) best = { idx, phrase };
      }
      return best;
    };

    const decorateTextNode = (textNode: Text) => {
      let current: Text | null = textNode;
      while (current) {
        const text = current.textContent || '';
        const match = findFirstMatch(text);
        if (!match) break;
        const rest = current.splitText(match.idx + match.phrase.length);
        const badge = document.createElement('span');
        badge.className = 'im-verbatim-badge';
        badge.setAttribute('contenteditable', 'false');
        badge.setAttribute('data-verbatim-phrase', encodeURIComponent(match.phrase));
        badge.title = 'Verbatim phrase — official per-language wording exists. Click to view/edit.';
        badge.innerHTML = VERBATIM_BADGE_SVG;
        current.parentNode?.insertBefore(badge, rest);
        current = rest;
      }
    };

    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) { decorateTextNode(node as Text); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const elNode = node as HTMLElement;
      if (elNode.classList.contains('im-placeholder') || elNode.classList.contains('im-condition') || elNode.classList.contains('im-verbatim-badge')) return;
      Array.from(elNode.childNodes).forEach(walk);
    };
    Array.from(el.childNodes).forEach(walk);
  }, [verbatimPhrases]);

  // Re-run decoration once the (async) verbatim list arrives or changes, in case
  // it lands after the DOM has already been rendered from `blocks`.
  useEffect(() => { decorateVerbatims(); }, [decorateVerbatims]);

  /** Selection → new/edit verbatim modal. Reuses the existing entry (by exact
   * phrase match) instead of creating a duplicate — `phrase` is unique in the table. */
  const handleSaveSelectionAsVerbatim = useCallback(() => {
    const el = contentRef.current;
    const sel = window.getSelection();
    const phrase = sel && sel.rangeCount > 0 && !sel.isCollapsed && el?.contains(sel.getRangeAt(0).commonAncestorContainer)
      ? sel.toString().trim()
      : '';
    if (!phrase) {
      alert('Select the English text you want to save as a verbatim phrase first.');
      return;
    }
    const existing = verbatims.find((v) => v.phrase === phrase);
    setVerbatimModal(existing
      ? { id: existing.id, phrase: existing.phrase, note: existing.note ?? '', translations: { ...existing.translations } }
      : { phrase, note: '', translations: {} });
  }, [verbatims]);

  const handleSaveVerbatimEntry = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verbatimModal) return;
    setSavingVerbatim(true);
    try {
      const translations = Object.fromEntries(Object.entries(verbatimModal.translations).filter(([, v]) => v && v.trim()));
      if (verbatimModal.id) {
        await updateTranslationVerbatim(verbatimModal.id, { phrase: verbatimModal.phrase, note: verbatimModal.note, translations });
      } else {
        await createTranslationVerbatim({ phrase: verbatimModal.phrase, note: verbatimModal.note, translations }, user?.id);
      }
      const fresh = await getTranslationVerbatims();
      notifyVerbatimListeners(fresh);
      setVerbatimModal(null);
    } catch (err: any) {
      alert(`Error saving verbatim: ${err?.message ?? err}`);
    } finally {
      setSavingVerbatim(false);
    }
  }, [verbatimModal, user]);

  const handleImgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Prompt for alt text on explicit upload (accessibility of the generated manual).
    // Defaults to the file name; paste/drop keep the filename silently to stay frictionless.
    const altInput = window.prompt('Describe this image for accessibility (alt text):', file.name.replace(/\.[^.]+$/, ''))?.trim();
    const alt = (altInput || file.name).replace(/"/g, '&quot;');
    setUploadingImg(true);
    try {
      const url = await uploadIMAsset(file, 'blocks');
      // Insert at the cursor (matches placeholder/condition behaviour) instead of appending.
      insertHtmlAtCursor(imgTag(url, alt));
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

    const walk = (node: Node, marks: Array<TextMark> = []) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (text) inlines.push({ type: 'text', text, marks: marks.length ? marks : undefined });
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const el = node as HTMLElement;

      // Ephemeral verbatim-match decoration — never part of the saved content;
      // dropped here so it can't survive a deserialize→serialize round-trip.
      if (el.classList.contains('im-verbatim-badge')) return;

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
          // Chips store the expected value as data-condition-value (dataset.conditionValue).
          // This used to read dataset.conditionLabel — an attribute that never existed —
          // so the condition's value silently emptied on every editor round-trip.
          conditionLabel: decodeURIComponent((el.dataset.conditionValue === '*' ? '' : el.dataset.conditionValue) || ''),
          content: decodeURIComponent(el.dataset.content || '').trim() || el.textContent || '',
          always: el.dataset.always === 'true' || undefined,
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
        inlines.push({ type: 'image', src: el.getAttribute('src') || '', alt: el.getAttribute('alt') || undefined, width: el.style.width || undefined, align: readImgAlign(el), border: readImgBorder(el) || undefined, valign: readImgValign(el) });
        return;
      }

      const nextMarks = [...marks];
      if (['B', 'STRONG'].includes(el.tagName) && !nextMarks.includes('bold')) nextMarks.push('bold');
      if (['I', 'EM'].includes(el.tagName) && !nextMarks.includes('italic')) nextMarks.push('italic');
      if (el.tagName === 'U' && !nextMarks.includes('underline')) nextMarks.push('underline');
      if (el.classList.contains(TEMP_HIGHLIGHT_CLASS) && !nextMarks.includes('temp')) nextMarks.push('temp');

      Array.from(el.childNodes).forEach((child) => walk(child, nextMarks));
    };

    Array.from(container.childNodes).forEach((child) => walk(child));
    return inlines;
  }, []);

  const serializeInline = useCallback((inlines: InlineNode[]): string => inlines.map((inline) => {
    if (inline.type === 'placeholder') {
      const colorClass = inline.placeholderType === 'text' ? 'bg-amber-100 border-yellow-300 text-amber-800' : 'bg-indigo-100 border-indigo-300 text-blue-800';
      const attrAttr = inline.attrId ? ` data-attr-id="${inline.attrId}"` : '';
      return `&nbsp;<span class="im-placeholder ${colorClass} border px-2 py-0.5 rounded text-xs font-bold select-none mx-1 cursor-pointer" contenteditable="false" data-type="${inline.placeholderType}" data-id="${inline.id}"${attrAttr} data-label="${encodeURIComponent(inline.label)}" title="Placeholder: ${inline.label} — click to edit">[${inline.label}]</span>&nbsp;`;
    }

    if (inline.type === 'condition') {
      if (inline.always) {
        // "Any value — always show" chip: the attribute's live value is injected
        // unconditionally. data-always/data-condition-value="*" must survive the
        // round-trip — dropping them silently degraded the chip into a condition.
        const name = inline.featureName || inline.content || 'Value';
        return `&nbsp;<span class="im-condition bg-amber-50 border-amber-300 text-amber-800 border border-dashed px-2 py-1 rounded text-sm mx-1 cursor-pointer" contenteditable="false" data-id="${inline.id}" data-feature-id="${inline.featureId}" data-feature-name="${inline.featureName || ''}" data-content="${encodeURIComponent(inline.content)}" data-condition-value="*" data-always="true" title="Value: ${name} — click to edit"><span class="font-bold text-xs uppercase mr-1">[${name}]</span></span>&nbsp;`;
      }
      const displayLabel = inline.featureId === 'manual'
          ? 'Optional'
          : inline.conditionLabel ? `${inline.featureName}: ${inline.conditionLabel}` : (inline.featureName || 'Auto-Spec');
      return `&nbsp;<span class="im-condition bg-purple-50 border-indigo-300 text-purple-800 border border-dashed px-2 py-1 rounded text-sm mx-1 cursor-pointer" contenteditable="false" data-id="${inline.id}" data-feature-id="${inline.featureId}" data-content="${encodeURIComponent(inline.content)}" data-feature-name="${inline.featureName || ''}" data-condition-value="${encodeURIComponent(inline.conditionLabel || '')}" title="Condition: ${displayLabel} — click to edit"><span class="font-bold text-xs uppercase mr-1">[${displayLabel}]</span> ${inline.content.substring(0, 20)}${inline.content.length > 20 ? '...' : ''}</span>&nbsp;`;
    }

    if (inline.type === 'image') {
      return imgTag(inline.src, inline.alt || '', inline.width, inline.align, inline.border, inline.valign);
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
      if (mark === 'temp') textHtml = `<mark class="${TEMP_HIGHLIGHT_CLASS}" data-temp="true" title="Temporary — remove before publishing">${textHtml}</mark>`;
    });
    return textHtml;
  }).join(''), []);

  const deserializeHtmlToBlocks = useCallback((rawHtml: string): EditorBlock[] => {
    // Every route HTML takes into the editor passes through here: the initial load, an
    // Excel/Word/Sheets table paste, and the HTML-mode source box. Repairing it at this single
    // point means inline styles that override the print settings are corrected at the source and
    // never stored, instead of being re-fixed on every export. It matters most for markup that
    // becomes a legacy_html block, which otherwise round-trips its outerHTML verbatim.
    const html = sanitizeAuthorHtml(rawHtml);
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
        const variant = (['warning', 'danger', 'caution', 'electric', 'flammable', 'hot_surface', 'info'].find(v => el.classList.contains(`im-block-${v}`)) || 'info') as CalloutVariant;
        // Parse the WHOLE body minus the generated title (re-added on serialize).
        // Multi-paragraph callout bodies (from imports/legacy content) used to be cut
        // to their FIRST <p> here — silent data loss in safety text. Paragraph
        // boundaries are preserved as line breaks (serialized back as <br/>).
        let content: InlineNode[];
        if (contentEl) {
          const body = contentEl.cloneNode(true) as HTMLElement;
          body.querySelector('.im-block-title')?.remove();
          const paras = Array.from(body.children).filter((c) => c.tagName === 'P') as HTMLElement[];
          if (paras.length > 1) {
            content = paras.flatMap((p, i) => {
              const nodes = parseInlineNodes(p);
              return i === 0 ? nodes : [{ type: 'text', text: '\n' } as InlineNode, ...nodes];
            });
          } else {
            content = parseInlineNodes(paras[0] ?? body);
          }
        } else {
          content = parseInlineNodes(el);
        }
        parsed.push({ id: createId(), type: 'callout', variant, content });
        return;
      }
      if (el.tagName === 'IMG') {
        parsed.push({ id: createId(), type: 'image', src: el.getAttribute('src') || '', alt: el.getAttribute('alt') || '', width: (el as HTMLElement).style.width || undefined, align: readImgAlign(el), border: readImgBorder(el) || undefined, valign: readImgValign(el) });
        return;
      }
      if (el.tagName === 'UL' || el.tagName === 'OL') {
        // Depth-aware walk so nested <ul>/<ol> round-trip instead of flattening.
        // Each <li>'s OWN content is parsed with its nested lists removed (they are
        // collected as deeper items right after it, preserving document order).
        // Known simplification: nested levels take the top list's ordered/unordered
        // kind on serialize (a <ul> inside an <ol> comes back as a nested <ol>).
        const items: ListItemData[] = [];
        const collect = (listEl: Element, depth: number) => {
          Array.from(listEl.children).forEach((child) => {
            if (child.tagName === 'UL' || child.tagName === 'OL') { collect(child, depth + 1); return; }
            if (child.tagName !== 'LI') return;
            const own = child.cloneNode(true) as HTMLElement;
            own.querySelectorAll('ul, ol').forEach((n) => n.remove());
            items.push({ depth, content: parseInlineNodes(own) });
            Array.from(child.children)
              .filter((c) => c.tagName === 'UL' || c.tagName === 'OL')
              .forEach((n) => collect(n, depth + 1));
          });
        };
        collect(el, 0);
        parsed.push({ id: createId(), type: 'list', ordered: el.tagName === 'OL', items: items.length ? items : [{ depth: 0, content: [] }] });
        return;
      }
      if (el.tagName === 'TABLE') {
        // Parse each cell into inline nodes (not textContent) so placeholder /
        // condition chips inside cells survive the round-trip instead of being
        // flattened to their bare label text. Cell alignment is read off its own
        // `data-align` attribute, independent of any per-image align inside it.
        const rows = Array.from(el.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((cell) => ({
          align: readCellAlign(cell),
          content: normalizeCellInlines(parseInlineNodes(cell as HTMLElement)),
        })));
        // Width mode + author column widths (a <colgroup> of mm widths) must round-trip:
        // the serializer rebuilds the whole tag, so anything not on the node is destroyed
        // on the next keystroke — exactly how pasted Word/Excel column widths were lost.
        // mm, not %: see setCaretColumnWidth's comment for why a percentage column width
        // defeats the OTHER column's ability to shrink to its own content.
        const fit = el.getAttribute('data-table-fit') === 'content' ? ('content' as const) : undefined;
        const cols = Array.from(el.querySelectorAll('col'));
        const colWidths = cols.length
          ? cols.map((c) => {
              const m = ((c as HTMLElement).style.width || '').match(/^(\d+(?:\.\d+)?)mm$/);
              return m ? Number(m[1]) : null;
            })
          : undefined;
        parsed.push({
          id: createId(),
          type: 'table',
          rows: rows.length ? rows : [[textCell('Header 1'), textCell('Header 2')], [textCell('Value 1'), textCell('Value 2')]],
          fit,
          colWidths: colWidths?.some((w) => w != null) ? colWidths : undefined,
        });
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
        return imgTag(block.src, block.alt || '', block.width, block.align, block.border);
      }
      if (block.type === 'list') {
        const tag = block.ordered ? 'ol' : 'ul';
        const items = block.items.length ? block.items : [{ depth: 0, content: [] as InlineNode[] }];
        // Rebuild nesting from the flat depth sequence: a deeper run nests inside
        // the previous <li> (standard HTML list structure).
        let i = 0;
        const renderLevel = (depth: number): string => {
          let out = '';
          while (i < items.length && items[i].depth >= depth) {
            if (items[i].depth === depth) {
              out += `<li>${serializeInline(items[i].content)}`;
              i++;
              if (i < items.length && items[i].depth > depth) out += `<${tag}>${renderLevel(depth + 1)}</${tag}>`;
              out += '</li>';
            } else {
              // Sequence starts deeper than expected (e.g. first item indented) —
              // wrap the deeper run in an empty item so the HTML stays valid.
              out += `<li><${tag}>${renderLevel(depth + 1)}</${tag}></li>`;
            }
          }
          return out;
        };
        return `<${tag}>${renderLevel(0)}</${tag}>`;
      }
      if (block.type === 'table') {
        // `data-align` is the round-trip source of truth (re-read on parse); the
        // `text-align` style is what actually centers/aligns the cell's content —
        // text runs directly, and any inline (non-floated/non-blocked) image too.
        const cellHtml = (cell: TableCellData, tag: 'th' | 'td') => {
          const alignAttr = cell.align ? ` data-align="${cell.align}" style="text-align:${cell.align};"` : '';
          return `<${tag}${alignAttr}>${serializeInline(cell.content)}</${tag}>`;
        };
        const [headerRow, ...body] = block.rows;
        const th = (headerRow || []).map((cell) => cellHtml(cell, 'th')).join('');
        const tr = body.map((row) => `<tr>${row.map((cell) => cellHtml(cell, 'td')).join('')}</tr>`).join('');
        // Width mode + column widths. data-table-fit switches the table to shrink-to-content
        // (both stylesheets); the <colgroup> carries author column widths in mm — NOT %,
        // which would be relative to the table's own width and unresolvable the moment
        // that width is itself auto (fit-content) — flagged with data-col-widths so a
        // full-width table gets table-layout:fixed and honours the pinned column exactly.
        const fitAttr = block.fit === 'content' ? ' data-table-fit="content"' : '';
        const hasWidths = !!block.colWidths?.some((w) => w != null);
        const widthsAttr = hasWidths ? ' data-col-widths="1"' : '';
        const colgroup = hasWidths
          ? `<colgroup>${(block.colWidths ?? []).map((w) => (w != null ? `<col style="width:${w}mm;" />` : '<col />')).join('')}</colgroup>`
          : '';
        return `<table class="im-table"${fitAttr}${widthsAttr}>${colgroup}<thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
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

  // Top-level child of the contentEditable that contains the caret — used to insert
  // new blocks AFTER the block the user is working in, instead of at the very end.
  const caretTopLevelIndex = useCallback((): number | null => {
    const el = contentRef.current;
    const sel = window.getSelection();
    const live = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const range = live && el && el.contains(live.startContainer) ? live : savedRangeRef.current;
    if (!el || !range || !el.contains(range.startContainer)) return null;
    let node: Node | null = range.startContainer;
    while (node && node.parentNode !== el) node = node.parentNode;
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
    const idx = Array.from(el.children).indexOf(node as Element);
    return idx >= 0 ? idx : null;
  }, []);

  /** Insert whole blocks right after the caret's block (or at the end without a caret). */
  const insertBlocksAtCaret = useCallback((newBlocks: EditorBlock[]) => {
    const el = contentRef.current;
    if (!el || !newBlocks.length) return;
    const fresh = deserializeHtmlToBlocks(el.innerHTML); // don't lose in-progress typing
    const idx = caretTopLevelIndex();
    const at = idx != null ? idx + 1 : fresh.length;
    isUserEditingRef.current = false; // force the render effect to rewrite the DOM
    setBlocks([...fresh.slice(0, at), ...newBlocks, ...fresh.slice(at)]);
    setSelectedBlockId(newBlocks[0].id);
  }, [deserializeHtmlToBlocks, caretTopLevelIndex]);

  // Upload pasted/dropped image files to Storage and insert the URL, instead of
  // letting the browser inline them as base64 data URIs. A pasted screenshot
  // stored inline gets duplicated into every language on save and can push a
  // section row to tens of MB — which is what times out the save. (Content that
  // still slips through with data URIs is externalized again at save time in
  // im-section.service / im-block.service as a safety net.)
  const uploadAndInsertImages = useCallback(async (files: File[]) => {
    setUploadingImg(true);
    try {
      for (const file of files) {
        const url = await uploadIMAsset(file, 'blocks');
        insertHtmlAtCursor(imgTag(url, file.name));
      }
    } catch (err: any) {
      console.error('[SimpleRichTextEditor] pasted/dropped image upload failed:', err);
      alert(err?.message ?? 'Image upload failed — see console for details.');
    } finally {
      setUploadingImg(false);
    }
  }, [insertHtmlAtCursor]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) {
      event.preventDefault();
      saveSelection(); // pin the caret so the async insert lands where the user pasted
      void uploadAndInsertImages(files);
      return;
    }

    // A paste carrying an HTML <table> (Excel/Sheets/Word ranges): letting the browser
    // insert it mid-paragraph would flatten it to bare text on the next round-trip
    // (parseInlineNodes keeps only text runs). Parse the pasted HTML into proper
    // blocks instead and insert them after the caret's block — tables stay tables.
    const html = event.clipboardData?.getData('text/html') ?? '';
    if (/<table[\s>]/i.test(html)) {
      event.preventDefault();
      saveSelection();
      const pasted = deserializeHtmlToBlocks(html)
        // Drop the empty paragraphs clipboard wrappers tend to produce.
        .filter((b) => !(b.type === 'paragraph' && b.content.every((n) => n.type === 'text' && !n.text.trim())));
      if (pasted.length) insertBlocksAtCaret(pasted);
      return;
    }
    // Plain text/HTML paste — let the browser handle it.
  }, [saveSelection, uploadAndInsertImages, deserializeHtmlToBlocks, insertBlocksAtCaret]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    void uploadAndInsertImages(files);
  }, [uploadAndInsertImages]);

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
  // Mirrors the caret cell's current alignment so the toolbar can highlight it,
  // the same way imgAlign mirrors the selected image's alignment.
  const [caretCellAlign, setCaretCellAlign] = useState<CellAlign | undefined>(undefined);
  // Mirrors of the caret table's width mode and the caret COLUMN's set width (mm),
  // so the table context row can show the current values.
  const [caretTableFit, setCaretTableFit] = useState<'content' | undefined>(undefined);
  const [caretColWidth, setCaretColWidth] = useState<string>('');
  // The last NON-NULL table context, kept even after live selection leaves the table.
  // The "Col" width control is a real text <input> — unlike the table toolbar's other
  // buttons (mousedown+preventDefault, selection never moves), focusing it to type a
  // value inevitably moves the browser's selection into the input, so getTableContext()
  // sees no selection left inside the table by the time Enter/blur commits. Without
  // this ref, the commit silently fell back to the table's LAST column instead of the
  // one the operator actually opened the control from.
  const lastTableCtxRef = useRef<{ tableIdx: number; row: number; col: number } | null>(null);
  // Which block the caret sits in, so the style group can SHOW the current block
  // instead of only offering conversions. Same refresh path as caretInTable.
  const [caretBlockTag, setCaretBlockTag] = useState<'h1' | 'h2' | 'h3' | 'p' | null>(null);
  const refreshCaretTable = useCallback(() => {
    const el = contentRef.current;
    const sel = window.getSelection();
    const startNode = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).startContainer : null;
    const startEl = startNode
      ? (startNode.nodeType === Node.ELEMENT_NODE ? (startNode as HTMLElement) : startNode.parentElement)
      : null;
    const blockEl = el && startEl && el.contains(startEl) ? startEl.closest('h1, h2, h3, p') : null;
    setCaretBlockTag(blockEl ? (blockEl.tagName.toLowerCase() as 'h1' | 'h2' | 'h3' | 'p') : null);
    const ctx = getTableContext();
    if (ctx) lastTableCtxRef.current = ctx;
    setCaretInTable(!!ctx);
    if (!ctx) { setCaretCellAlign(undefined); setCaretTableFit(undefined); setCaretColWidth(''); return; }
    let seen = -1;
    for (const b of blocks) {
      if (b.type !== 'table') continue;
      seen++;
      if (seen === ctx.tableIdx) {
        setCaretCellAlign(b.rows[ctx.row]?.[ctx.col]?.align);
        setCaretTableFit(b.fit);
        const w = b.colWidths?.[ctx.col];
        setCaretColWidth(w != null ? String(w) : '');
        return;
      }
    }
    // Not a structured block — the same opaque-wrapper case findCaretTableEl exists for
    // (see its comment). Read the live DOM directly instead of blanking the display: a
    // table that already carries e.g. data-table-fit="content" from a migration was
    // showing "Fit page" as the pressed pill, so clicking "Fit content" (believing it
    // was off) landed on an attribute that was already there — no visible change, and
    // no way to tell from the toolbar that it had ever been on.
    const table = el?.querySelectorAll('table')[ctx.tableIdx];
    const tr = table?.querySelectorAll('tr')[ctx.row];
    const cell = tr?.children[ctx.col] as HTMLElement | undefined;
    if (table) {
      setCaretCellAlign(cell ? readCellAlign(cell) : undefined);
      setCaretTableFit(table.getAttribute('data-table-fit') === 'content' ? 'content' : undefined);
      const colEl = table.querySelector('colgroup')?.children[ctx.col] as HTMLElement | undefined;
      const m = (colEl?.style.width || '').match(/^(\d+(?:\.\d+)?)mm$/);
      setCaretColWidth(m ? m[1] : '');
      return;
    }
    setCaretCellAlign(undefined);
    setCaretTableFit(undefined);
    setCaretColWidth('');
  }, [blocks]);

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
    const badge = target.closest?.('.im-verbatim-badge') as HTMLElement | null;
    if (badge) {
      const phrase = decodeURIComponent(badge.dataset.verbatimPhrase || '');
      const existing = verbatims.find((v) => v.phrase === phrase);
      if (existing) setVerbatimModal({ id: existing.id, phrase: existing.phrase, note: existing.note ?? '', translations: { ...existing.translations } });
      return;
    }

    // Click-to-edit an existing chip: hand its data + an in-place replace callback to
    // the row (which opens the matching modal pre-filled). Previously chips were inert
    // — fixing a typo in a condition meant deleting and rebuilding it from scratch.
    const chip = target.closest?.('.im-placeholder, .im-condition') as HTMLElement | null;
    const editorEl = contentRef.current;
    if (chip && editorEl?.contains(chip)) {
      const replace = (html: string) => {
        chip.outerHTML = html;
        isUserEditingRef.current = true; // keep the live DOM; just sync blocks + emit
        if (contentRef.current) setBlocks(deserializeHtmlToBlocks(contentRef.current.innerHTML));
      };
      // The SKU QR code chip is system-computed (no attribute to rebind), so it's excluded
      // from the generic placeholder-edit modal — clicking it does nothing.
      if (chip.classList.contains('im-placeholder') && chip.dataset.id !== QR_SKU_PLACEHOLDER_ID && onEditPlaceholder) {
        onEditPlaceholder({
          id: chip.dataset.id || '',
          type: (chip.dataset.type as 'text' | 'image') || 'text',
          label: decodeURIComponent(chip.dataset.label || '').trim() || 'Text',
          attrId: chip.dataset.attrId || undefined,
        }, replace);
        return;
      }
      if (chip.classList.contains('im-condition') && onEditCondition) {
        onEditCondition({
          id: chip.dataset.id || '',
          featureId: chip.dataset.featureId || 'manual',
          featureName: chip.dataset.featureName || '',
          content: decodeURIComponent(chip.dataset.content || ''),
          conditionLabel: decodeURIComponent(chip.dataset.conditionValue === '*' ? '' : (chip.dataset.conditionValue || '')),
          always: chip.dataset.always === 'true',
        }, replace);
        return;
      }
    }

    const prev = selectedImgRef.current;
    if (prev && prev !== target) prev.style.outline = '';
    if (target.tagName === 'IMG') {
      const img = target as HTMLImageElement;
      selectedImgRef.current = img;
      img.style.outline = '2px solid #6366f1';
      setImgSelected(true);
      setImgWidth(img.style.width || '');
      setImgAlign(readImgAlign(img));
      setImgBorder(readImgBorder(img));
      setImgValign(readImgValign(img));
      setImgAlt(img.getAttribute('alt') || '');
    } else {
      selectedImgRef.current = null;
      setImgSelected(false);
    }
    refreshCaretTable();
  }, [refreshCaretTable, verbatims, onEditPlaceholder, onEditCondition, deserializeHtmlToBlocks]);

  /**
   * Keep the drag-resize handle glued to the selected image's bottom-right corner.
   * Coordinates are relative to the editor's positioned scroll shell; both rects are
   * measured in visual (post-`zoom`) space, so the handle lands correctly at any
   * preview zoom. Recomputed on selection, size changes, zoom changes and scroll.
   */
  const syncImgHandle = useCallback(() => {
    const img = selectedImgRef.current;
    const shell = editorShellRef.current;
    if (!img || !shell || !img.isConnected) { setImgHandle(null); return; }
    const imgRect = img.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    setImgHandle({
      left: imgRect.right - shellRect.left + shell.scrollLeft - 7,
      top: imgRect.bottom - shellRect.top + shell.scrollTop - 7,
    });
  }, []);

  useEffect(() => {
    if (!imgSelected) { setImgHandle(null); return; }
    syncImgHandle();
    const shell = editorShellRef.current;
    shell?.addEventListener('scroll', syncImgHandle);
    window.addEventListener('resize', syncImgHandle);
    return () => {
      shell?.removeEventListener('scroll', syncImgHandle);
      window.removeEventListener('resize', syncImgHandle);
    };
  }, [imgSelected, imgWidth, imgAlign, imgBorder, previewZoom, canvasWidth, syncImgHandle]);

  // Resize / re-align / re-border the selected image. All rebuild the whole inline
  // style (via imgStyleFor) so a previous float/margin/border is fully cleared,
  // preserve the OTHER dimensions (each control keeps the current values of the
  // rest), re-add the selection outline the rebuild wiped, then re-parse so the
  // change persists into blocks + emitted HTML while the live node stays in place.
  const restyleSelectedImg = useCallback((width?: string, align?: ImgAlign, border?: boolean, valign?: ImgVAlign) => {
    const img = selectedImgRef.current;
    const el = contentRef.current;
    if (!img || !el) return;
    if (align) img.setAttribute('data-align', align);
    if (border) img.setAttribute('data-border', '1'); else img.removeAttribute('data-border');
    if (align === 'inline' && valign) img.setAttribute('data-valign', valign); else img.removeAttribute('data-valign');
    img.style.cssText = imgStyleFor(width, align, border, valign);
    img.style.outline = '2px solid #6366f1'; // rebuild wiped it — keep the selection visible
    isUserEditingRef.current = true; // keep the DOM node; just sync blocks + emit
    setBlocks(deserializeHtmlToBlocks(el.innerHTML));
  }, [deserializeHtmlToBlocks]);

  // `width === ''` clears the override → back to natural size (capped at 100%).
  const applyImgWidth = useCallback((width: string) => {
    const img = selectedImgRef.current;
    if (!img) return;
    setImgWidth(width);
    restyleSelectedImg(width || undefined, readImgAlign(img), readImgBorder(img), readImgValign(img));
  }, [restyleSelectedImg]);

  const applyImgAlign = useCallback((align: ImgAlign) => {
    const img = selectedImgRef.current;
    if (!img) return;
    setImgAlign(align);
    restyleSelectedImg(img.style.width || undefined, align, readImgBorder(img), readImgValign(img));
  }, [restyleSelectedImg]);

  const applyImgBorder = useCallback((border: boolean) => {
    const img = selectedImgRef.current;
    if (!img) return;
    setImgBorder(border);
    restyleSelectedImg(img.style.width || undefined, readImgAlign(img), border, readImgValign(img));
  }, [restyleSelectedImg]);

  const applyImgValign = useCallback((valign: ImgVAlign) => {
    const img = selectedImgRef.current;
    if (!img) return;
    setImgValign(valign);
    restyleSelectedImg(img.style.width || undefined, readImgAlign(img), readImgBorder(img), valign);
  }, [restyleSelectedImg]);

  /**
   * Drag-resize: the corner handle writes the width as a PERCENT of the text column, so
   * the size means the same thing on every page size and in the PDF. Both rects come from
   * getBoundingClientRect — visual, post-`zoom` space — so the ratio is zoom-proof. During
   * the drag only the live style moves (cheap); the model is committed once on release.
   */
  const handleResizeStart = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const img = selectedImgRef.current;
    const content = contentRef.current;
    if (!img || !content) return;
    e.preventDefault();
    e.stopPropagation();
    dragStateRef.current = {
      startX: e.clientX,
      startWidth: img.getBoundingClientRect().width,
      contentWidth: content.getBoundingClientRect().width,
    };
    const onMove = (ev: PointerEvent) => {
      const st = dragStateRef.current;
      const im = selectedImgRef.current;
      if (!st || !im || !(st.contentWidth > 0)) return;
      const pct = Math.round(Math.min(100, Math.max(5, ((st.startWidth + ev.clientX - st.startX) / st.contentWidth) * 100)));
      im.style.width = `${pct}%`;
      setImgWidth(`${pct}%`);
      syncImgHandle();
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const st = dragStateRef.current;
      dragStateRef.current = null;
      const im = selectedImgRef.current;
      if (!st || !im) return;
      // Commit through the normal restyle path so the width persists into blocks + HTML.
      const w = im.style.width || undefined;
      restyleSelectedImg(w, readImgAlign(im), readImgBorder(im), readImgValign(im));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [restyleSelectedImg, syncImgHandle]);

  // Apply the typed alt text to the selected image (accessibility of the generated
  // manual). Alt used to be settable only once, in the upload prompt — pasted/dropped
  // images silently kept their filename forever.
  const commitImgAlt = useCallback(() => {
    const img = selectedImgRef.current;
    const el = contentRef.current;
    if (!img || !el) return;
    // Double quotes would break the serialized alt="…" attribute (imgTag inserts raw).
    const v = imgAlt.trim().replace(/"/g, "'");
    if ((img.getAttribute('alt') || '') === v) return;
    img.setAttribute('alt', v);
    isUserEditingRef.current = true; // keep the live DOM; just sync blocks + emit
    setBlocks(deserializeHtmlToBlocks(el.innerHTML));
  }, [imgAlt, deserializeHtmlToBlocks]);

  // Apply the free-typed width. Empty → natural size; a bare number → px; otherwise a
  // valid CSS length (px/%/rem/em) is accepted, anything else is ignored (no-op).
  const commitCustomWidth = useCallback(() => {
    const v = imgWidth.trim();
    if (v === '') { applyImgWidth(''); return; }
    const norm = /^\d+(\.\d+)?$/.test(v) ? `${v}px` : v;
    if (/^\d+(\.\d+)?(px|%|rem|em)$/.test(norm)) applyImgWidth(norm);
  }, [imgWidth, applyImgWidth]);

  // Run a formatting/list execCommand, then re-sync `blocks` from the live DOM.
  // We can't rely on the command's own `input` event to do this: browsers don't
  // reliably fire `input` for list toggles (insertOrdered/UnorderedList). When it
  // doesn't fire, `blocks` keeps the pre-command paragraphs, and the next render's
  // DOM-sync effect rewrites the editor from those stale blocks — so a numbered
  // list reverts to plain paragraphs and is never emitted/saved. Reading innerHTML
  // right after execCommand (synchronous) captures the change deterministically.
  const execCmd = useCallback((command: string, value?: string) => {
    const el = contentRef.current;
    if (!el) return;
    el.focus();
    document.execCommand(command, false, value);
    isUserEditingRef.current = true; // keep the native DOM; just sync blocks + emit
    setBlocks(deserializeHtmlToBlocks(el.innerHTML));
  }, [deserializeHtmlToBlocks]);

  /**
   * Convert the block the caret is in to a heading/paragraph — what H1/H2/H3 mean in
   * every editor operators know. Falls back to APPENDING a new block (the old
   * behaviour) when the caret isn't in the editor, or sits somewhere a heading can't
   * live (inside a table cell or a callout body, where the parser would silently
   * flatten it back to text on the next round-trip).
   */
  const applyBlockType = useCallback((tag: 'h1' | 'h2' | 'h3' | 'p') => {
    const el = contentRef.current;
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const container = range?.commonAncestorContainer ?? null;
    const containerEl = container
      ? (container.nodeType === Node.ELEMENT_NODE ? (container as HTMLElement) : container.parentElement)
      : null;
    const caretInside = !!(el && container && el.contains(container));
    const inUnconvertible = !!containerEl?.closest('td, th, .im-block-wrapper');
    if (caretInside && !inUnconvertible) {
      execCmd('formatBlock', `<${tag}>`);
      refreshCaretTable();
      return;
    }
    setBlocks((prev) => [
      ...prev,
      tag === 'p'
        ? { id: createId(), type: 'paragraph', content: [] }
        : { id: createId(), type: 'heading', level: Number(tag[1]) as 1 | 2 | 3, content: [{ type: 'text', text: `Heading ${tag[1]}` }] },
    ]);
  }, [execCmd, refreshCaretTable]);

  // Tab / Shift+Tab inside a list item: indent/outdent (creates or unwinds a nested
  // list, which the parser now round-trips). Outside lists, Tab keeps its browser
  // default (focus move) — authors expect that for accessibility.
  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const el = contentRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return;
    const container = sel.getRangeAt(0).startContainer;
    const containerEl = container.nodeType === Node.ELEMENT_NODE ? (container as HTMLElement) : container.parentElement;
    const li = containerEl?.closest('li');
    if (!li || !el.contains(li)) return;
    event.preventDefault();
    execCmd(event.shiftKey ? 'outdent' : 'indent');
  }, [execCmd]);


  // Toggle a "temporary — not final yet" highlight over the current selection. Unlike
  // bold/italic/underline there's no native execCommand for a custom-classed wrapper, so
  // this manipulates the Range directly: unwrap if the selection sits inside an existing
  // highlight (toggle off), otherwise wrap it in a <mark>. No-ops on a collapsed selection
  // — there's nothing to mark. See TEMP_HIGHLIGHT_CLASS (im-resolver.ts): publish is
  // blocked while any survive in the resolved manual.
  const toggleHighlight = useCallback(() => {
    const el = contentRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return;

    const closestHighlight = (node: Node): HTMLElement | null => {
      const start = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
      return start?.closest(`mark.${TEMP_HIGHLIGHT_CLASS}`) ?? null;
    };
    const startMark = closestHighlight(range.startContainer);
    const endMark = closestHighlight(range.endContainer);

    if (startMark && startMark === endMark) {
      // Selection sits entirely inside one existing highlight — unwrap it (toggle off).
      const parent = startMark.parentNode;
      if (parent) {
        while (startMark.firstChild) parent.insertBefore(startMark.firstChild, startMark);
        parent.removeChild(startMark);
      }
    } else {
      const mark = document.createElement('mark');
      mark.className = TEMP_HIGHLIGHT_CLASS;
      mark.setAttribute('data-temp', 'true');
      mark.title = 'Temporary — remove before publishing';
      mark.appendChild(range.extractContents());
      range.insertNode(mark);
    }
    isUserEditingRef.current = true; // keep the live DOM; just sync blocks + emit
    setBlocks(deserializeHtmlToBlocks(el.innerHTML));
  }, [deserializeHtmlToBlocks]);

  // Caret cell to restore after a forced DOM rewrite (table row/col/align ops).
  // The rewrite replaces every node, so the browser drops the selection — without
  // this the caret lands outside the table after each toolbar action.
  const pendingCaretCellRef = useRef<{ tableIdx: number; row: number; col: number } | null>(null);

  useEffect(() => {
    if (isUserEditingRef.current) {
      isUserEditingRef.current = false;
      return;
    }
    if (!contentRef.current) return;
    // Sanitize before writing to the live DOM: blocks can carry stored `legacy_html`
    // (round-tripped verbatim from the DB), so an <img onerror=…>/<svg onload=…> would
    // otherwise execute here in the editor. serializeBlocksToHtml's own markup is
    // standard HTML and passes through unchanged.
    contentRef.current.innerHTML = sanitizeHtml(serializeBlocksToHtml(blocks));
    // The rewrite replaces any selected <img> node — drop the stale selection.
    selectedImgRef.current = null;
    setImgSelected(false);
    decorateVerbatims();
    // Put the caret back into the cell a table toolbar action was operating on
    // (clamped, in case that row/column was just removed).
    const pending = pendingCaretCellRef.current;
    if (pending) {
      pendingCaretCellRef.current = null;
      const table = contentRef.current.querySelectorAll('table')[pending.tableIdx];
      const trs = table ? Array.from(table.querySelectorAll('tr')) : [];
      const tr = trs[Math.min(pending.row, trs.length - 1)];
      const cell = tr?.children[Math.min(pending.col, Math.max(tr.children.length - 1, 0))];
      if (cell) {
        const range = document.createRange();
        range.selectNodeContents(cell);
        range.collapse(false);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        setCaretInTable(true);
      }
    }
  }, [blocks, serializeBlocksToHtml, decorateVerbatims]);

  const insertBlock = (type: BlockInsertType) => {
    const newBlock: EditorBlock = type === 'table'
      ? { id: createId(), type: 'table', rows: [[textCell('Header 1'), textCell('Header 2')], [textCell('Row 1 Col 1'), textCell('Row 1 Col 2')]] }
      : { id: createId(), type: 'callout', variant: type, content: [{ type: 'text', text: CALLOUT_DEFAULT_TEXT[type] }] };
    // Land right after the block the caret is in (not at the very end of the row).
    insertBlocksAtCaret([newBlock]);
  };

  /**
   * The live caret cell + its row/table, by DOM position — the row/column sibling of
   * findCaretTableEl (see that comment for why DOM position, not the `blocks` model,
   * is the only lookup that works for a table trapped inside an opaque legacy_html
   * wrapper). Used by every row/column/cell operation below.
   */
  const findCaretCellEl = (): { table: HTMLTableElement; tr: HTMLTableRowElement; cell: HTMLElement; row: number; col: number } | null => {
    const el = contentRef.current;
    const ctx = getTableContext() ?? lastTableCtxRef.current;
    if (!el || !ctx) return null;
    const table = el.querySelectorAll('table')[ctx.tableIdx] as HTMLTableElement | undefined;
    if (!table) return null;
    const trs = table.querySelectorAll('tr');
    const tr = trs[Math.min(ctx.row, trs.length - 1)] as HTMLTableRowElement | undefined;
    const cell = tr?.children[Math.min(ctx.col, tr.children.length - 1)] as HTMLElement | undefined;
    if (!tr || !cell) return null;
    return { table, tr, cell, row: Array.from(trs).indexOf(tr), col: Array.from(tr.children).indexOf(cell) };
  };

  /** A blank cell shaped like `source` — same tag (td/th) and attributes (so a layout
   *  table's width/padding/border carries over), no content and no inherited align. A
   *  shallow clone (no children) IS an empty cell; nothing to strip but alignment. */
  const clearedCellClone = (source: Element): HTMLElement => {
    const clone = source.cloneNode(false) as HTMLElement;
    clone.removeAttribute('data-align');
    clone.style.textAlign = '';
    return clone;
  };

  // --- DOM-direct table edits ----------------------------------------------
  // Fallback path for a table the `blocks` model can't see (see findCaretTableEl):
  // mutate the live DOM node itself, per-row/per-cell, so an existing table's own
  // tag types (<th> vs <td>) and <thead> membership carry over exactly instead of
  // being reconstructed from the "row 0 is the header" assumption the structured
  // model bakes in — an assumption that doesn't hold for a table with no header
  // concept at all (a plain two-cell icon+text layout, for instance).
  const addTableRowDom = () => {
    const found = findCaretCellEl();
    if (!found) return;
    const newTr = document.createElement('tr');
    Array.from(found.tr.children).forEach((cell) => newTr.appendChild(clearedCellClone(cell)));
    found.tr.after(newTr);
    syncBlocksFromLiveDom();
  };
  const addTableColumnDom = () => {
    const found = findCaretCellEl();
    if (!found) return;
    const { table, col } = found;
    Array.from(table.querySelectorAll('tr')).forEach((row) => {
      const cells = Array.from(row.children);
      const source = cells[Math.min(col, cells.length - 1)];
      source?.after(clearedCellClone(source));
    });
    const colgroup = table.querySelector('colgroup');
    if (colgroup) {
      const cols = Array.from(colgroup.children);
      const at = cols[Math.min(col, cols.length - 1)];
      if (at) at.after(document.createElement('col')); else colgroup.appendChild(document.createElement('col'));
    }
    syncBlocksFromLiveDom();
  };
  const removeTableRowDom = () => {
    const found = findCaretCellEl();
    if (!found) return;
    // Never remove the last remaining row, or a row that's genuinely a <thead> header
    // (a headerless table has nothing here to protect, so this is a strict superset
    // of the structured model's "never remove row 0").
    if (found.table.querySelectorAll('tr').length <= 1 || found.tr.closest('thead')) return;
    found.tr.remove();
    syncBlocksFromLiveDom();
  };
  const removeTableColumnDom = () => {
    const found = findCaretCellEl();
    if (!found) return;
    const { table, col } = found;
    const rows = Array.from(table.querySelectorAll('tr'));
    if (Math.max(...rows.map((r) => r.children.length)) <= 1) return;
    rows.forEach((row) => row.children[Math.min(col, row.children.length - 1)]?.remove());
    table.querySelector('colgroup')?.children[col]?.remove();
    syncBlocksFromLiveDom();
  };
  const setCellAlignDom = (align: CellAlign) => {
    const found = findCaretCellEl();
    if (!found) return;
    found.cell.setAttribute('data-align', align);
    found.cell.style.textAlign = align;
    syncBlocksFromLiveDom();
  };
  const removeCaretTableDom = () => {
    const found = findCaretTableEl();
    if (!found) return;
    found.table.remove();
    syncBlocksFromLiveDom();
    setCaretInTable(false);
  };

  // Delete the whole table the caret is in. The row/column removers deliberately keep
  // the header and the last column, so without this an unwanted table was permanently
  // stuck in the content.
  const removeCaretTable = () => {
    const el = contentRef.current;
    const ctx = getTableContext() ?? lastTableCtxRef.current;
    if (!el || !ctx) return;
    if (!window.confirm('Delete this entire table?')) return;
    const fresh = deserializeHtmlToBlocks(el.innerHTML);
    let seen = -1;
    let found = false;
    const next = fresh.filter((b) => {
      if (b.type !== 'table') return true;
      seen++;
      if (seen === ctx.tableIdx) { found = true; return false; }
      return true;
    });
    if (!found) { removeCaretTableDom(); return; }
    isUserEditingRef.current = false; // force the render effect to rewrite the DOM
    setBlocks(next.length ? next : [{ id: createId(), type: 'paragraph', content: [] }]);
    setCaretInTable(false);
  };

  type TableBlock = Extract<EditorBlock, { type: 'table' }>;

  // Apply a change to the table BLOCK the caret is in. Reads the live DOM first
  // (like switchToHtml) so in-progress typing isn't lost, maps the matching block,
  // then lets the render effect rewrite the DOM + emit onChange.
  //
  // Falls back to the last REMEMBERED table position (lastTableCtxRef) when the live
  // selection has left the table — committing the "Col" width input is exactly that
  // case: typing into it moved the browser's selection there, so a live-only lookup
  // would silently target the table's last column instead of the one the operator
  // actually opened the control from.
  //
  // `domFallback` runs instead of silently doing nothing when the caret's table isn't
  // one the `blocks` model can see at all (findCaretTableEl's opaque-wrapper case) —
  // every call site below passes its DOM-direct equivalent from the block above.
  const mutateCaretTableBlock = (
    fn: (block: TableBlock, ctx: { row: number; col: number }) => TableBlock,
    domFallback?: () => void,
  ) => {
    const el = contentRef.current;
    if (!el) return;
    const ctx = getTableContext() ?? lastTableCtxRef.current;
    const fresh = deserializeHtmlToBlocks(el.innerHTML);
    let seen = -1;
    let targetId: string | null = null;
    for (const b of fresh) {
      if (b.type === 'table') { seen++; if (seen === (ctx?.tableIdx ?? 0)) { targetId = b.id; break; } }
    }
    if (!targetId) { domFallback?.(); return; }
    const next = fresh.map((b) => {
      if (b.id !== targetId || b.type !== 'table') return b;
      const cols = b.rows.reduce((m, r) => Math.max(m, r.length), 0) || 1;
      return fn(b, { row: ctx?.row ?? b.rows.length - 1, col: ctx?.col ?? cols - 1 });
    });
    isUserEditingRef.current = false; // force the render effect to rewrite the DOM
    if (ctx) pendingCaretCellRef.current = ctx; // restore the caret to this cell after the rewrite
    setBlocks(next);
  };

  const mutateCaretTable = (
    fn: (rows: TableCellData[][], ctx: { row: number; col: number }) => TableCellData[][],
    domFallback?: () => void,
  ) => mutateCaretTableBlock((b, ctx) => ({ ...b, rows: fn(b.rows, ctx) }), domFallback);

  const tableColCount = (rows: TableCellData[][]) => rows.reduce((m, r) => Math.max(m, r.length), 0) || 1;
  const addTableRow = () => mutateCaretTable((rows, { row }) => {
    const cols = tableColCount(rows);
    const newRow = Array.from({ length: cols }, () => textCell(''));
    const at = Math.min(row + 1, rows.length);
    return [...rows.slice(0, at), newRow, ...rows.slice(at)];
  }, addTableRowDom);
  // Column edits keep colWidths index-aligned — a stale width on the wrong column is
  // worse than no width at all.
  const addTableColumn = () => mutateCaretTableBlock((b, { col }) => {
    const rows = b.rows.map((r) => {
      const at = Math.min(col + 1, r.length);
      return [...r.slice(0, at), textCell(''), ...r.slice(at)];
    });
    const colWidths = b.colWidths
      ? [...b.colWidths.slice(0, col + 1), null, ...b.colWidths.slice(col + 1)]
      : undefined;
    return { ...b, rows, colWidths };
  }, addTableColumnDom);
  // Never remove the header row (index 0) or the last remaining row.
  const removeTableRow = () => mutateCaretTable((rows, { row }) => (rows.length <= 1 || row === 0 ? rows : rows.filter((_, i) => i !== row)), removeTableRowDom);
  const removeTableColumn = () => mutateCaretTableBlock((b, { col }) => {
    if (tableColCount(b.rows) <= 1) return b;
    const colWidths = b.colWidths?.filter((_, i) => i !== col);
    return {
      ...b,
      rows: b.rows.map((r) => r.filter((_, i) => i !== col)),
      colWidths: colWidths?.some((w) => w != null) ? colWidths : undefined,
    };
  }, removeTableColumnDom);
  // Align the caret's cell only — this editor has no multi-cell selection, so a
  // toolbar click always targets the one cell the caret is in.
  const setCellAlign = (align: CellAlign) => mutateCaretTable((rows, { row, col }) =>
    rows.map((r, ri) => (ri !== row ? r : r.map((cell, ci) => (ci === col ? { ...cell, align } : cell)))), () => setCellAlignDom(align));

  /**
   * The live <table> DOM element (+ caret column) for width-mode edits — found by DOM
   * position, NOT by looking the caret's table up in the structured `blocks` model.
   *
   * Why: real author content routinely nests a table inside a wrapping element the
   * top-level parser doesn't recognise (a <div> around a legend, a stray <br>, an
   * inline <style> block from a Word/Excel paste — all found in production content).
   * That wrapper — table included — round-trips as an opaque `legacy_html` block, so
   * it still RENDERS correctly and the table toolbar still APPEARS (caretInTable is
   * itself DOM-only), but `mutateCaretTableBlock`'s `block.type === 'table'` search
   * never finds it — every Fit/Col-width click silently did nothing. Row/column DOM
   * position has no such gap: `getTableContext`'s indices identify the exact live
   * <table> regardless of what wraps it, so width-mode edits go straight to the DOM
   * and let the next parse pick the result up — into a structured block where one
   * exists, or back into the same opaque blob otherwise. Falls back to the last
   * REMEMBERED position (lastTableCtxRef) once live selection has left the editor —
   * typing into the "Col" input does exactly that.
   */
  const findCaretTableEl = (): { table: HTMLTableElement; col: number } | null => {
    const el = contentRef.current;
    const ctx = getTableContext() ?? lastTableCtxRef.current;
    if (!el || !ctx) return null;
    const table = el.querySelectorAll('table')[ctx.tableIdx] as HTMLTableElement | undefined;
    return table ? { table, col: ctx.col } : null;
  };

  /** Re-derive `blocks` from the live DOM after a direct mutation, without rewriting it
   *  (the mutation already IS the DOM's current state) — the same "keep the live node,
   *  just sync + emit" pattern restyleSelectedImg uses for images. */
  const syncBlocksFromLiveDom = () => {
    const el = contentRef.current;
    if (!el) return;
    isUserEditingRef.current = true;
    setBlocks(deserializeHtmlToBlocks(el.innerHTML));
  };

  // Width mode of the whole table: full column (default) or shrink-to-content.
  const setTableFit = (fit: 'content' | undefined) => {
    const found = findCaretTableEl();
    if (!found) return;
    setCaretTableFit(fit);
    if (fit === 'content') found.table.setAttribute('data-table-fit', 'content');
    else found.table.removeAttribute('data-table-fit');
    syncBlocksFromLiveDom();
  };

  /**
   * Set/clear the caret COLUMN's width in mm (absolute, not %), via a <colgroup> on
   * the live table.
   *
   * Why mm and not a percentage: a % <col> width is relative to the TABLE's own
   * width, but a "fit content" table's width is ITSELF auto (computed FROM its
   * columns) — a circular dependency the CSS spec leaves largely to the engine.
   * Measured in Chromium: a 20%/auto pair on a two-column table left the unset
   * column at 80% of the table's width regardless of how little text it held (a
   * single character still claimed 149px of a 187px table) — so a pinned %
   * column defeats "let the other column shrink to its content" outright, no
   * matter the table's own width mode. An absolute unit has no such ambiguity:
   * the pinned column holds its exact size and the other genuinely sizes to its
   * own content in "fit content" mode, while `table-layout: fixed` (still
   * applied by both stylesheets whenever a width is set and the table itself is
   * full-width) makes it hold exactly in "fit page" mode too, with the other
   * column absorbing the remainder — verified the same way, same two configs.
   */
  const setCaretColumnWidth = (mm: number | null) => {
    const found = findCaretTableEl();
    if (!found) return;
    const { table, col } = found;
    const firstRow = table.querySelector('tr');
    const colCount = firstRow ? firstRow.children.length : col + 1;
    let colgroup = table.querySelector('colgroup');
    if (!colgroup) {
      colgroup = document.createElement('colgroup');
      for (let i = 0; i < colCount; i++) colgroup.appendChild(document.createElement('col'));
      table.insertBefore(colgroup, table.firstChild);
    }
    // The table may have grown columns since this colgroup was created.
    while (colgroup.children.length < colCount) colgroup.appendChild(document.createElement('col'));
    const cols = Array.from(colgroup.children) as HTMLElement[];
    const target = cols[Math.min(col, cols.length - 1)];
    if (target) target.style.width = mm != null ? `${mm}mm` : '';
    if (cols.some((c) => c.style.width)) table.setAttribute('data-col-widths', '1');
    else { table.removeAttribute('data-col-widths'); colgroup.remove(); }
    syncBlocksFromLiveDom();
  };

  const commitCaretColWidth = () => {
    const v = caretColWidth.trim().replace(/mm$/i, '');
    if (v === '') { setCaretColumnWidth(null); return; }
    const n = Number(v);
    // Bounded by the printed column itself when known (a column can't exceed the
    // page), else a generous fallback so the control still works with no profile.
    const max = printColumn ? printColumn.columnMm : 300;
    if (Number.isFinite(n) && n >= 3 && n <= max) setCaretColumnWidth(Math.round(n * 10) / 10);
  };

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
    setInsertTarget(insertHtmlAtCursor);
  }, [insertHtmlAtCursor]);

  useEffect(() => {
    return () => clearInsertTarget(insertHtmlAtCursor);
  }, [insertHtmlAtCursor]);

  return (
    <div className={`flex flex-col flex-1 min-h-0 border rounded-xl transition-colors ${isFocused ? 'border-indigo-400 ring-1 ring-indigo-100' : 'border-gray-300'}`}>

      {/* Sticky within the surrounding scroll pane so formatting stays reachable in long rows.
          `overflow-hidden` is intentionally NOT on the container above — it would clip sticky. */}
      {/* Toolbar. Sticky within the surrounding scroll pane so formatting stays reachable
          in long rows (`overflow-hidden` is intentionally NOT on the container above — it
          would clip sticky).

          Organised by WHAT A CONTROL ACTS ON, in a fixed order:
            row 1  block style · lists · character marks · review marks · Insert ▾   [HTML]
            row 2  the table the caret is in        (only while it is)
            row 3  the selected image               (only while one is)
          Row 1 never reorders, so no button ever moves under the pointer when a table
          or image comes into play — that reflow was the bar's real usability problem.
          Groups are segmented shells rather than bare dividers, and every control uses
          the same two shapes (TbIcon / TbPill), so shape and colour finally mean
          something: colour is reserved for the chip families and for destructive edits. */}
      <div className="flex-none sticky top-0 bg-light border-b border-gray-200 rounded-t-xl select-none z-20">
        <div className="flex items-center gap-1.5 p-2 flex-wrap">
          {mode === 'rich' ? (
            <>
              {/* BLOCK STYLE — converts the caret's block; the active pill also SHOWS
                  which block you are in, which the old flat row never did. */}
              <TbGroup>
                {([
                  { tag: 'h1' as const, label: 'H1', name: 'Heading 1' },
                  { tag: 'h2' as const, label: 'H2', name: 'Heading 2' },
                  { tag: 'h3' as const, label: 'H3', name: 'Heading 3' },
                ]).map(({ tag, label, name }) => (
                  <TbPill key={tag} bold active={caretBlockTag === tag} onPress={() => applyBlockType(tag)} title={`Make the current block a ${name}`}>{label}</TbPill>
                ))}
                <TbPill active={caretBlockTag === 'p'} onPress={() => applyBlockType('p')} title="Make the current block a plain paragraph">Paragraph</TbPill>
              </TbGroup>

              {/* LISTS — block-level too, but a separate decision. execCmd toggles the
                  current line(s) and re-parses into a list block. */}
              <TbGroup>
                <TbIcon onPress={() => execCmd('insertUnorderedList')} title="Bulleted list"><List size={15} /></TbIcon>
                <TbIcon onPress={() => execCmd('insertOrderedList')} title="Numbered list"><ListOrdered size={15} /></TbIcon>
              </TbGroup>

              {/* CHARACTER FORMATTING — applies to the current selection; execCmd
                  re-parses the marks from the DOM. */}
              <TbGroup>
                <TbIcon onPress={() => execCmd('bold')} title="Bold (Ctrl+B)"><Bold size={15} /></TbIcon>
                <TbIcon onPress={() => execCmd('italic')} title="Italic (Ctrl+I)"><Italic size={15} /></TbIcon>
                <TbIcon onPress={() => execCmd('underline')} title="Underline (Ctrl+U)"><Underline size={15} /></TbIcon>
              </TbGroup>

              {/* REVIEW MARKS — not formatting: these change what happens at publish
                  (temporary text blocks it) and at translation time (verbatim wording
                  wins over the AI), so they get their own group and keep their colour. */}
              <TbGroup>
                <TbIcon tone="amber" onPress={toggleHighlight} title="Mark as temporary — select text not yet final; publish is blocked while any remains"><Highlighter size={15} /></TbIcon>
                {verbatimEnabled && (
                  <TbIcon tone="purple" onPress={handleSaveSelectionAsVerbatim} title="Save the selected text as an official Verbatim phrase — future translations use the stored per-language wording instead of the AI's own translation"><ShieldPlus size={15} /></TbIcon>
                )}
              </TbGroup>

              {/* INSERT — one place for "add something at the cursor". Six buttons in six
                  pastel colours became one trigger; the icons keep the chip colours so the
                  amber/blue/purple mapping an author already knows still holds. */}
              {!minimal && (
                <>
                  <EditorToolbarMenu
                    variant="toolbar"
                    preserveSelection
                    align="left"
                    panelWidth="w-72"
                    icon={uploadingImg ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    label={uploadingImg ? 'Uploading…' : 'Insert'}
                    title="Insert a field, an image, a table or a QR code at the cursor"
                    groups={[
                      { label: 'Fields the project fills in', items: [
                        { key: 'ph-text', icon: <Type size={15} className="text-amber-600" />, label: 'Text field', hint: 'Amber chip — the project types the value', onClick: () => { saveSelection(); registerAsInsertTarget(); onInsertPlaceholder?.('text'); } },
                        { key: 'ph-image', icon: <ImageIcon size={15} className="text-indigo-600" />, label: 'Image field', hint: 'Blue chip — the project uploads the picture', onClick: () => { saveSelection(); registerAsInsertTarget(); onInsertPlaceholder?.('image'); } },
                        { key: 'condition', icon: <GitBranch size={15} className="text-purple-600" />, label: 'Conditional text', hint: 'Purple chip — text that only appears for certain feature values', onClick: () => { saveSelection(); registerAsInsertTarget(); onInsertCondition?.(); } },
                      ] },
                      { label: 'Image', items: [
                        { key: 'upload', icon: uploadingImg ? <Loader2 size={15} className="animate-spin text-emerald-600" /> : <Upload size={15} className="text-emerald-600" />, label: uploadingImg ? 'Uploading…' : 'Upload an image', hint: 'From this computer — stored with the manual', disabled: uploadingImg, onClick: () => { saveSelection(); registerAsInsertTarget(); imgInputRef.current?.click(); } },
                        { key: 'assets', icon: <Images size={15} className="text-sky-600" />, label: 'Asset library', hint: 'Search and insert an image already uploaded', onClick: () => { saveSelection(); setShowAssetPicker(true); } },
                      ] },
                      { label: 'Automatic', items: [
                        { key: 'qr-sku', icon: <QrCode size={15} className="text-amber-600" />, label: 'SKU QR code', hint: 'Links to use.berlin/<SKU> — filled in automatically, nothing to type', onClick: () => { saveSelection(); insertHtmlAtCursor(QR_CHIP_HTML); } },
                      ] },
                      { label: 'Block', items: [
                        { key: 'table', icon: <TableIcon size={15} className="text-gray-500" />, label: 'Table', hint: 'A 2-column table after the current block', onClick: () => insertBlock('table') },
                      ] },
                    ]}
                  />
                  <input ref={imgInputRef} type="file" accept="image/*" className="hidden" onChange={handleImgUpload} />
                </>
              )}
            </>
          ) : (
            <TbCaption>Raw HTML source</TbCaption>
          )}

          {/* Print-width preview — like the mode toggle, about the editor rather than the
              content. Pinned right so it never shifts the editing groups. */}
          {printColumn && !minimal && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); setMatchPrintWidth(!matchPrintWidth); }}
              className={`ml-auto flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-medium border transition-colors ${matchPrintWidth ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'}`}
              title={
                matchPrintWidth
                  ? `Showing the real ${Math.round(printColumn.columnMm)}mm printed column at the printed text size, so image sizes match the PDF. Click for the full-width canvas.`
                  : `Full-width canvas: image sizes here will not match the PDF. Click to model the ${Math.round(printColumn.columnMm)}mm printed column.`
              }
            >
              <Columns size={13} /> {Math.round(printColumn.columnMm)}mm
            </button>
          )}

          {/* Mode toggle — the one control that is about the editor, not the content, so
              it stays pinned right and out of the groups. */}
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); mode === 'rich' ? switchToHtml() : switchToRich(); }}
            className={`${printColumn && !minimal ? '' : 'ml-auto '}flex items-center gap-1 px-2 h-7 rounded-md text-[11px] font-medium border transition-colors ${mode === 'html' ? 'bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-100'}`}
            title={mode === 'rich' ? 'Edit raw HTML source' : 'Back to visual editor'}
          >
            <Code size={13} /> {mode === 'rich' ? 'HTML' : 'Visual'}
          </button>
        </div>

        {/* CONTEXT ROW — the table the caret is in. Its own row so row 1 never moves. */}
        {mode === 'rich' && !minimal && caretInTable && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 flex-wrap border-t border-gray-200 bg-white/60">
            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wide pr-0.5" title="Applies to the table the cursor is in">Table</span>
            <TbGroup>
              <TbPill onPress={addTableRow} title="Add a row below the current one">+ Row</TbPill>
              <TbPill onPress={addTableColumn} title="Add a column after the current one">+ Col</TbPill>
            </TbGroup>
            <TbGroup>
              <TbPill tone="rose" onPress={removeTableRow} title="Delete the current row (header can't be removed)">− Row</TbPill>
              <TbPill tone="rose" onPress={removeTableColumn} title="Delete the current column">− Col</TbPill>
              <TbPill tone="rose" onPress={removeCaretTable} title="Delete this entire table">− Table</TbPill>
            </TbGroup>
            <TbCaption title="How wide the table is on the page">Width</TbCaption>
            <TbGroup>
              <TbPill active={caretTableFit !== 'content'} onPress={() => setTableFit(undefined)} title="Stretch the table across the full text column (the house style for data tables)">Fit page</TbPill>
              <TbPill active={caretTableFit === 'content'} onPress={() => setTableFit('content')} title="Shrink the table to what its content needs — no stretched columns">Fit content</TbPill>
            </TbGroup>
            <TbCaption title="Pin the current column to an exact width, in mm — the other columns still size to their own content. Leave empty for automatic.">Col</TbCaption>
            <input
              value={caretColWidth}
              onChange={(e) => setCaretColWidth(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitCaretColWidth(); } }}
              onBlur={commitCaretColWidth}
              placeholder="auto"
              className="w-16 px-1.5 h-7 text-[11px] border border-gray-200 rounded-md bg-white"
              title="Current column's width in mm — the other columns keep sizing to their own content. Empty = automatic."
            />
            {printColumn && caretColWidth.trim() !== '' && Number.isFinite(Number(caretColWidth)) && (
              <TbCaption title={`${caretColWidth}mm is ${Math.round((Number(caretColWidth) / printColumn.columnMm) * 100)}% of the ${Math.round(printColumn.columnMm)}mm printed column`}>
                ≈{Math.round((Number(caretColWidth) / printColumn.columnMm) * 100)}% of column
              </TbCaption>
            )}
            <TbCaption title="Align the current cell's content (text or image)">Cell</TbCaption>
            <TbGroup>
              {([
                { value: 'left' as const,   Icon: AlignLeft,   title: 'Align cell content left' },
                { value: 'center' as const, Icon: AlignCenter, title: 'Center cell content — also centers an image inside it' },
                { value: 'right' as const,  Icon: AlignRight,  title: 'Align cell content right' },
              ]).map(({ value, Icon, title }) => (
                <TbIcon key={value} active={caretCellAlign === value} onPress={() => setCellAlign(value)} title={title}><Icon size={14} /></TbIcon>
              ))}
            </TbGroup>
          </div>
        )}

        {/* CONTEXT ROW — the selected image. */}
        {mode === 'rich' && imgSelected && (
          <div className="flex items-center gap-1.5 px-2 py-1.5 flex-wrap border-t border-gray-200 bg-white/60">
            <span className="text-[10px] font-bold text-indigo-500 uppercase tracking-wide pr-0.5" title="Applies to the selected image">Image</span>
            <TbCaption title="Size of the selected image">Size</TbCaption>
            <TbGroup>
              {/* What a pixel width actually comes to on the page — the relationship that was
                  invisible, and the reason a 150px image read as small here and printed large. */}
              {printColumn && widthAsColumnPercent(imgWidth, printColumn.columnPx) !== null && (
                <TbCaption title={`${imgWidth} is ${widthAsColumnPercent(imgWidth, printColumn.columnPx)}% of the ${Math.round(printColumn.columnMm)}mm printed column`}>
                  ≈{widthAsColumnPercent(imgWidth, printColumn.columnPx)}% of column
                </TbCaption>
              )}
              {['25%', '50%', '75%', '100%'].map((w) => (
                <TbPill key={w} active={imgWidth === w} onPress={() => applyImgWidth(w)} title={`Scale the image to ${w} of the text width`}>{w}</TbPill>
              ))}
              <TbPill active={imgWidth === ''} onPress={() => applyImgWidth('')} title="Reset to original size">Auto</TbPill>
            </TbGroup>
            {/* Free-typed exact size, e.g. 320px or 60% */}
            <input
              value={imgWidth}
              onChange={(e) => setImgWidth(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitCustomWidth(); } }}
              onBlur={commitCustomWidth}
              placeholder="e.g. 320px"
              className="w-20 px-1.5 h-7 text-[11px] border border-gray-200 rounded-md bg-white"
              title="Exact width — a number (px) or a CSS length like 60%"
            />
            <TbCaption title="Placement of the selected image">Align</TbCaption>
            <TbGroup>
              {([
                { value: 'inline', Icon: WrapText,    title: 'Inline — sits on a single text line, which grows to the image height' },
                { value: 'left',   Icon: AlignLeft,   title: 'Left — text wraps down the right side, over as many lines as the image is tall' },
                { value: 'center', Icon: AlignCenter, title: 'Centered on its own line' },
                { value: 'right',  Icon: AlignRight,  title: 'Right — text wraps down the left side, over as many lines as the image is tall' },
              ] as const).map(({ value, Icon, title }) => (
                <TbIcon key={value} active={imgAlign === value} onPress={() => applyImgAlign(value)} title={title}><Icon size={14} /></TbIcon>
              ))}
            </TbGroup>
            {/* Vertical seat of an INLINE image against its text line — meaningless for
                floats/blocks, so the group only appears when the image is inline. */}
            {imgAlign === 'inline' && (
              <>
                <TbCaption title="Where the image sits against the text line beside it">Seat</TbCaption>
                <TbGroup>
                  {([
                    { value: 'top' as const,      label: 'Top',    title: 'Top of the image level with the top of the text line' },
                    { value: 'middle' as const,   label: 'Middle', title: 'Image centered on the text line (default)' },
                    { value: 'baseline' as const, label: 'Base',   title: 'Bottom of the image on the text baseline' },
                  ]).map(({ value, label, title }) => (
                    <TbPill key={value} active={(imgValign ?? 'middle') === value} onPress={() => applyImgValign(value)} title={title}>{label}</TbPill>
                  ))}
                </TbGroup>
              </>
            )}
            <TbGroup>
              <TbPill
                active={imgBorder}
                onPress={() => applyImgBorder(!imgBorder)}
                title={imgBorder ? 'Remove the border from the selected image' : 'Add a border around the selected image'}
              ><span className="flex items-center gap-1"><Square size={13} /> Border</span></TbPill>
            </TbGroup>
            <TbCaption title="Alt text of the selected image (read by screen readers; part of the published manual)">Alt</TbCaption>
            <input
              value={imgAlt}
              onChange={(e) => setImgAlt(e.target.value)}
              onMouseDown={(e) => e.stopPropagation()}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitImgAlt(); } }}
              onBlur={commitImgAlt}
              placeholder="Describe the image…"
              className="w-36 px-1.5 h-7 text-[11px] border border-gray-200 rounded-md bg-white"
              title="Accessibility description of the selected image — press Enter to apply"
            />
          </div>
        )}
      </div>

      <div ref={editorShellRef} className="flex-1 min-h-0 relative bg-white cursor-text overflow-y-auto" onClick={() => { if (mode === 'rich') contentRef.current?.focus(); }}>
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
            <div ref={canvasWrapRef} className={printPreview ? 'p-4 overflow-x-auto' : ''}>
            <div
              ref={contentRef}
              className={`min-h-[160px] outline-none im-content max-w-none font-sans ${printPreview ? '' : 'p-4'}`}
              style={
                printColumn
                  ? {
                      // Every density var in em (shared with all preview surfaces), so it stays
                      // proportional to the text whether or not the print-width canvas is on.
                      ...imContentVars(printColumn),
                      // Exact print geometry, then zoomed for legibility. zoom scales every
                      // length uniformly — %, px and mm — which is the whole point: a pixel
                      // width finally means the same here as it does on the page.
                      ...(printPreview
                        ? {
                            width: `${printColumn.columnPx}px`,
                            fontSize: `${printColumn.bodyPx}px`,
                            zoom: previewZoom,
                          }
                        : {}),
                    }
                  : undefined
              }
              contentEditable
              lang={lang}
              spellCheck={true}
              onInput={handleChange}
              onPaste={handlePaste}
              onDrop={handleDrop}
              onKeyDown={handleKeyDown}
              onClick={handleEditorClick}
              onFocus={() => { setIsFocused(true); registerAsInsertTarget(); }}
              onBlur={() => { setIsFocused(false); saveSelection(); decorateVerbatims(); }}
              onMouseUp={() => { saveSelection(); refreshCaretTable(); }}
              onKeyUp={() => { saveSelection(); refreshCaretTable(); }}
            />
            </div>
            {/* Drag-resize handle on the selected image's corner. Lives OUTSIDE the zoomed
                canvas (in the scroll shell), positioned in visual space, so it stays a
                constant, grabbable size at any preview zoom. */}
            {imgSelected && imgHandle && (
              <div
                onPointerDown={handleResizeStart}
                className="absolute z-30 w-3.5 h-3.5 rounded-sm bg-indigo-600 border-2 border-white shadow cursor-nwse-resize touch-none"
                style={{ left: imgHandle.left, top: imgHandle.top }}
                title="Drag to resize — the width is stored as % of the printed text column"
              />
            )}
            {/* The modelled column is squeezed below legibility — say so rather than letting
                the tiny text read as a rendering bug. Proportions are still exact. */}
            {printPreview && previewZoom < CRAMPED_PREVIEW_ZOOM && (
              <div className="sticky bottom-0 px-3 py-1 text-[10px] text-amber-700 bg-amber-50 border-t border-amber-200">
                Print-width preview at {Math.round(previewZoom * 100)}% — sizes are still exact, but widen the pane (or collapse a sidebar) for a legible view.
              </div>
            )}
          </>
        )}
      </div>

      {showAssetPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setShowAssetPicker(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-3xl h-[80vh] flex flex-col overflow-hidden" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2"><Images size={18} className="text-indigo-600" /> Asset Library</h2>
              <button onClick={() => setShowAssetPicker(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <AssetLibraryPanel onInsert={(html) => { insertHtmlAtCursor(html); setShowAssetPicker(false); }} />
          </div>
        </div>
      )}

      {verbatimModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm" onMouseDown={() => setVerbatimModal(null)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in fade-in zoom-in duration-200 flex flex-col max-h-[90vh]" onMouseDown={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-1">
              <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                <ShieldCheck size={18} className="text-purple-600" /> {verbatimModal.id ? 'Edit Verbatim' : 'Save as Verbatim'}
              </h3>
              <button onClick={() => setVerbatimModal(null)} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <p className="text-xs text-muted mb-4">
              The English phrase is matched exactly (case-sensitive) whenever this box is translated. The stored
              wording below is substituted directly instead of the AI translating it. Languages left blank keep the
              English phrase unchanged (right for identifiers like "(EU) 2019/2016").
            </p>
            <form onSubmit={handleSaveVerbatimEntry} className="space-y-4 overflow-y-auto flex-1 pr-1">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">English phrase (exact, case-sensitive)</label>
                <textarea
                  required
                  rows={2}
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm font-mono focus:ring-2 focus:ring-purple-500 outline-none"
                  value={verbatimModal.phrase}
                  onChange={(e) => setVerbatimModal({ ...verbatimModal, phrase: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
                <input
                  className="w-full border border-gray-300 p-2.5 rounded-md text-sm focus:ring-2 focus:ring-purple-500 outline-none"
                  value={verbatimModal.note}
                  onChange={(e) => setVerbatimModal({ ...verbatimModal, note: e.target.value })}
                  placeholder="Where this comes from / why it must stay verbatim"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Official wording per language</label>
                <div className="border border-gray-200 rounded-md divide-y divide-gray-100 max-h-60 overflow-y-auto">
                  {(verbatimLanguages || []).filter((l) => l.code !== 'en').map((l) => (
                    <div key={l.code} className="flex items-center gap-3 px-3 py-1.5">
                      <span className="text-xs font-mono font-semibold text-gray-500 w-8 shrink-0 uppercase">{l.code}</span>
                      <input
                        className="flex-1 border-0 bg-transparent text-sm py-1 focus:ring-0 outline-none placeholder:text-gray-300"
                        value={verbatimModal.translations[l.code] ?? ''}
                        onChange={(e) => setVerbatimModal({ ...verbatimModal, translations: { ...verbatimModal.translations, [l.code]: e.target.value } })}
                        placeholder={`${l.label} — blank keeps the English phrase`}
                      />
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
                <button type="button" onClick={() => setVerbatimModal(null)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-md text-sm font-medium">Cancel</button>
                <button type="submit" disabled={savingVerbatim} className="px-4 py-2 bg-purple-600 text-white hover:bg-purple-700 rounded-md text-sm font-medium disabled:opacity-50">
                  {savingVerbatim ? 'Saving…' : verbatimModal.id ? 'Save Changes' : 'Save Verbatim'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
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
  /** Per-box AI translation: "Translate from EN" on non-English tabs, "Translate to all" on EN. */
  enableTranslate?: boolean;
  /**
   * Category attributes — enables click-to-edit on existing placeholder/condition
   * chips (the edit modals need the attribute list). Absent = chips stay inert.
   */
  attributes?: CategoryAttribute[];
  /**
   * Language this row should open on because the operator was SENT here to fill it (a
   * missing-translation row in the pre-publish review panel). Rows otherwise keep their own
   * tab independently of the section-level language — see the note above — so this is applied
   * only when a jump asks for it, never on every section-language change.
   */
  focusLang?: string;
  /**
   * Bumped by the caller on each jump, so asking for the SAME language twice re-points a row
   * the operator has since tabbed away from.
   */
  focusToken?: number;
  /**
   * Which print profile this content will be set in. Given both, the editor models the real
   * printed column so image sizes match the PDF; omitted, it keeps its fluid canvas.
   */
  printTemplateType?: IMTemplateType;
  printPageSize?: PrintPageSizeKey;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Matches one placeholder chip span by its data-id (chip inner is plain text — no nested tags). */
const placeholderChipRe = (id: string) =>
  new RegExp(`<span[^>]*class="[^"]*im-placeholder[^"]*"[^>]*data-id="${escapeRegExp(id)}"[^>]*>[^<]*</span>`, 'g');

export const InlineHtmlRow: React.FC<InlineHtmlRowProps> = ({ content, variant, languages, sectionId, index, onChange, onVariantChange, onInsertPlaceholder, onInsertCondition, enableTranslate, attributes, focusLang, focusToken, printTemplateType, printPageSize }) => {
  const [rowLang, setRowLang] = useState(focusLang ?? 'en');
  // Print density vars for the row's read-only English-reference pane (cached per profile).
  const rowGeometry = usePrintColumn(printTemplateType, printPageSize);
  const [translating, setTranslating] = useState(false);
  const [translateErr, setTranslateErr] = useState<string | null>(null);
  // English reference pane (shown while editing a translation). Open/closed is a
  // GLOBAL preference — a translator who collapses it once means it, everywhere.
  const [showEnRef, setShowEnRef] = useState<boolean>(() => {
    try { return localStorage.getItem('im-en-ref-open') !== '0'; } catch { return true; }
  });
  const toggleEnRef = () => setShowEnRef((v) => {
    const next = !v;
    try { localStorage.setItem('im-en-ref-open', next ? '1' : '0'); } catch { /* ignore */ }
    return next;
  });
  // A jump that named a language (see focusLang) re-points this row at it.
  useEffect(() => {
    if (focusLang) setRowLang(focusLang);
  }, [focusLang, focusToken]);
  // Click-to-edit modal state for existing chips (data + in-place replace callback).
  const [editPlaceholder, setEditPlaceholder] = useState<{ data: PlaceholderChipData; replace: (html: string) => void } | null>(null);
  const [editCondition, setEditCondition] = useState<{ data: ConditionChipData; replace: (html: string) => void } | null>(null);
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
      insertToActiveEditor(chipHtml);
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
    setCommitPlaceholderTarget(commitPlaceholder);
    onInsertPlaceholder(type);
  }, [commitPlaceholder, onInsertPlaceholder]);

  // Commit an EDITED placeholder chip: replace it in the active language's live DOM,
  // then swap the same chip (matched by its OLD data-id) in every other language, so
  // a renamed/re-bound placeholder stays one placeholder everywhere.
  const commitPlaceholderEdit = useCallback((oldId: string, html: string, replace: (h: string) => void) => {
    replace(html);
    const cnt = contentRef.current;
    const active = activeCodeRef.current;
    languagesRef.current.forEach(l => {
      if (l.code === active) return;
      const existing = cnt[l.code] ?? '';
      const re = placeholderChipRe(oldId);
      if (!re.test(existing)) return;
      onChangeRef.current(l.code, existing.replace(placeholderChipRe(oldId), html));
    });
  }, []);

  useEffect(() => () => clearCommitPlaceholderTarget(commitPlaceholder), [commitPlaceholder]);

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
      // Marked with the EN source hash so the tab dot can flag this translation as
      // stale if English is edited later (see im-translation-marker.ts).
      onChangeRef.current(target, markTranslatedFromEn(out, source));
    } catch (e: any) {
      setTranslateErr(e?.message || 'Translation failed');
    } finally {
      setTranslating(false);
    }
  }, [translating]);

  // Per-box "translate to ALL languages": one click re-translates JUST this row from
  // English into every other enabled language (overwriting stale translations — the
  // usual reason to reach for it is an edited EN source). Small pool, per-language
  // failure list; results land via onChange for review, nothing persists here.
  const [translatingAll, setTranslatingAll] = useState<{ done: number; total: number } | null>(null);
  const handleTranslateRowAll = useCallback(async () => {
    const source = contentRef.current['en'] ?? '';
    if (!source.trim() || translating || translatingAll) return;
    const targets = languagesRef.current.map(l => l.code).filter(c => c !== 'en');
    if (!targets.length) return;
    setTranslateErr(null);
    setTranslatingAll({ done: 0, total: targets.length });
    const failed: string[] = [];
    let done = 0;
    let cursor = 0;
    const runner = async () => {
      while (cursor < targets.length) {
        const t = targets[cursor++];
        try {
          const out = await translateHtml(source, 'en', t);
          onChangeRef.current(t, markTranslatedFromEn(out, source));
        } catch { failed.push(t.toUpperCase()); }
        done += 1;
        setTranslatingAll({ done, total: targets.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, targets.length) }, runner));
    setTranslatingAll(null);
    if (failed.length) setTranslateErr(`Translation failed for ${failed.join(', ')} — those languages were left unchanged. Try again.`);
  }, [translating, translatingAll]);

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

      {/* Per-row language tabs. Dot per language: green = has content; amber = this
          translation was machine-translated from an English source that has since been
          EDITED (stale — retranslate or review). Human-edited translations carry no
          marker and are never flagged. */}
      <div className="flex items-center gap-1 flex-wrap shrink-0">
        {languages.map(l => {
          const filled = !!(content[l.code] && content[l.code].trim());
          const stale = l.code !== 'en' && filled && translationStaleAgainstEn(content['en'], content[l.code]);
          const isActive = activeCode === l.code;
          return (
            <button
              key={l.code}
              type="button"
              onClick={() => handleSelectLang(l.code)}
              title={stale ? 'English was edited after this translation was made — retranslate or review' : undefined}
              className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                isActive ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {l.code.toUpperCase()}
              {filled && <span className={`w-1.5 h-1.5 rounded-full ${stale ? 'bg-amber-400' : isActive ? 'bg-white' : 'bg-emerald-500'}`} />}
            </button>
          );
        })}
        {enableTranslate && activeCode !== 'en' && (
          <button
            type="button"
            onClick={handleTranslateRow}
            disabled={!canTranslate || translating || !!translatingAll}
            title={enSource.trim() ? `Translate this box from English into ${activeCode.toUpperCase()} — review before saving` : 'Add English content first'}
            className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {translating ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
            {translating ? 'Translating…' : `Translate from EN`}
          </button>
        )}
        {enableTranslate && activeCode === 'en' && languages.length > 1 && (
          <button
            type="button"
            onClick={handleTranslateRowAll}
            disabled={!enSource.trim() || !!translatingAll || translating}
            title={enSource.trim()
              ? 'Translate JUST this box from English into every enabled language (overwrites existing translations of this box) — review before saving'
              : 'Add English content first'}
            className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium border border-indigo-200 text-indigo-700 bg-white hover:bg-indigo-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {translatingAll ? <Loader2 size={12} className="animate-spin" /> : <Languages size={12} />}
            {translatingAll ? `Translating… ${translatingAll.done}/${translatingAll.total}` : 'Translate to all'}
          </button>
        )}
      </div>
      {translateErr && <div className="text-[11px] text-rose-600 shrink-0 -mt-1">{translateErr}</div>}

      {/* English reference — read-only EN source shown while editing a translation, so
          fixing a stale DE/FR doesn't mean flipping tabs and holding English in your head.
          This is the natural companion of the stale (amber) dot on the language tabs. */}
      {activeCode !== 'en' && enSource.trim() && (
        <div className="shrink-0 border border-gray-200 rounded-lg bg-gray-50 overflow-hidden">
          <button
            type="button"
            onClick={toggleEnRef}
            className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold text-gray-500 uppercase tracking-wide hover:bg-gray-100"
            title={showEnRef ? 'Hide the English source' : 'Show the English source while translating'}
          >
            {showEnRef ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            English reference
            {translationStaleAgainstEn(content['en'], content[activeCode] ?? '') && (
              <span className="normal-case font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                English was edited after this translation
              </span>
            )}
          </button>
          {showEnRef && (
            <div
              className="im-content text-xs text-gray-700 px-3 py-2 border-t border-gray-200 bg-white max-h-48 overflow-y-auto"
              style={rowGeometry ? imContentVars(rowGeometry) : undefined}
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(enSource) }}
            />
          )}
        </div>
      )}

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
          <SimpleRichTextEditor printTemplateType={printTemplateType} printPageSize={printPageSize}
            key={`${sectionId}-inline-${index}-${activeCode}`}
            initialContent={content[activeCode] || ''}
            onChange={(html) => onChange(activeCode, html)}
            placeholder="Enter content…"
            onInsertPlaceholder={handleInsertPlaceholder}
            onInsertCondition={onInsertCondition}
            onEditPlaceholder={attributes ? (data, replace) => setEditPlaceholder({ data, replace }) : undefined}
            onEditCondition={attributes ? (data, replace) => setEditCondition({ data, replace }) : undefined}
            verbatimLanguages={activeCode === 'en' ? languages : undefined}
            lang={activeCode}
          />
        </div>
      </div>

      {/* Click-to-edit modals for existing chips (only when attributes were provided). */}
      {editPlaceholder && attributes && (
        <PlaceholderModal
          type={editPlaceholder.data.type}
          attributes={attributes}
          initial={editPlaceholder.data}
          onCommit={(html) => commitPlaceholderEdit(editPlaceholder.data.id, html, editPlaceholder.replace)}
          onClose={() => setEditPlaceholder(null)}
        />
      )}
      {editCondition && attributes && (
        <ConditionModal
          attributes={attributes}
          initial={editCondition.data}
          onCommit={(html) => editCondition.replace(html)}
          onClose={() => setEditCondition(null)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Self-contained placeholder + condition insertion modals
// ---------------------------------------------------------------------------

/** Routes an insert to whichever SimpleRichTextEditor most recently had focus. */
const insertHtmlToCurrentEditor = (html: string) => { insertToActiveEditor(html); };

const PlaceholderModal: React.FC<{
  type: 'text' | 'image';
  attributes: CategoryAttribute[];
  /** Prefill for click-to-edit; absent = inserting a new chip. */
  initial?: PlaceholderChipData;
  /** Receives the built chip HTML. Insert flows fan out / insert at caret; edit flows replace in place. */
  onCommit: (html: string) => void;
  onClose: () => void;
}> = ({ type, attributes, initial, onCommit, onClose }) => {
  const [label, setLabel] = useState(initial?.label ?? '');
  const [attrId, setAttrId] = useState(initial?.attrId ?? '');

  const attrOptions = attributes.filter(f =>
    type === 'image' ? (f as any).dataType === 'image' : (f as any).dataType !== 'image'
  );

  const confirm = () => {
    const finalLabel = label.trim() || (type === 'text' ? 'Text' : 'Image');
    // When bound to an attribute, use the attribute id as data-id so the generator
    // resolves the value (e.g. a supplier-uploaded product image) automatically.
    // On edit, an unbound chip keeps its original id so filled-in values stay attached.
    const id = attrId || initial?.id || createId();
    const colorClass = type === 'text' ? 'bg-amber-100 border-yellow-300 text-amber-800' : 'bg-indigo-100 border-indigo-300 text-blue-800';
    const attrAttr = attrId ? ` data-attr-id="${attrId}"` : '';
    const html = `&nbsp;<span class="im-placeholder ${colorClass} border px-2 py-0.5 rounded text-xs font-bold select-none mx-1 cursor-pointer" contenteditable="false" data-type="${type}" data-id="${id}"${attrAttr} data-label="${encodeURIComponent(finalLabel)}" title="Placeholder: ${finalLabel} — click to edit">[${finalLabel}]</span>&nbsp;`;
    onCommit(html);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in fade-in zoom-in duration-200">
        <h3 className="font-bold text-lg mb-4">{initial ? 'Edit' : 'Add'} {type === 'text' ? 'Text' : 'Image'} Placeholder</h3>
        {attrOptions.length > 0 && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">From Attribute (optional)</label>
            <AttributePicker
              attributes={attrOptions}
              value={attrId}
              onChange={id => {
                setAttrId(id);
                const attr = attributes.find(f => f.id === id);
                setLabel(id && attr ? attr.name : '');
              }}
              leadingOptions={[{ id: '', label: 'Custom label', hint: 'Enter your own label below' }]}
              searchPlaceholder={type === 'image' ? 'Search image attributes…' : 'Search attributes…'}
            />
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
  /** Prefill for click-to-edit; absent = inserting a new chip. */
  initial?: ConditionChipData;
  /** Receives the built chip HTML. Insert flows insert at caret; edit flows replace in place. */
  onCommit: (html: string) => void;
  onClose: () => void;
}> = ({ attributes, initial, onCommit, onClose }) => {
  // Best-effort prefill of the typed value controls from the chip's display value
  // (the chip stores only the rendered string, e.g. "10–50 W" / "Yes" / "A, B").
  const pre = (() => {
    const out = { enumSelected: [] as string[], numMin: '', numMax: '', boolValue: 'true', textValue: '' };
    if (!initial?.conditionLabel) return out;
    const attr = attributes.find(f => f.id === initial.featureId) as any;
    const label = initial.conditionLabel;
    switch (attr?.dataType) {
      case 'enum':
        out.enumSelected = label.split(',').map(s => s.trim()).filter(v => (attr.validationRules?.enumOptions || []).includes(v));
        break;
      case 'integer':
      case 'decimal': {
        const m = label.match(/^([\d.]+)?(?:\s*–\s*([\d.]+))?/);
        out.numMin = m?.[1] ?? '';
        out.numMax = m?.[2] ?? '';
        break;
      }
      case 'boolean':
        out.boolValue = label === 'Yes' ? 'true' : 'false';
        break;
      default:
        out.textValue = label;
    }
    return out;
  })();

  const [featureId, setFeatureId] = useState(initial?.featureId ?? 'manual');
  const [text, setText] = useState(initial && !initial.always && initial.content !== initial.conditionLabel ? initial.content : '');
  const [enumSelected, setEnumSelected] = useState<string[]>(pre.enumSelected);
  const [numMin, setNumMin] = useState(pre.numMin);
  const [numMax, setNumMax] = useState(pre.numMax);
  const [boolValue, setBoolValue] = useState(pre.boolValue);
  const [textValue, setTextValue] = useState(pre.textValue);
  const [useAttrValue, setUseAttrValue] = useState(!!initial && !initial.always && !!initial.conditionLabel && initial.content === initial.conditionLabel);
  const [anyValue, setAnyValue] = useState(initial?.always ?? false);

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
    // Editing keeps the chip's id so the generator's saved cond_<id> toggle stays attached.
    const id = initial?.id || createId();
    let featureName = '';
    let conditionLabel = '';
    if (featureId !== 'manual') {
      const feat = attributes.find(f => f.id === featureId);
      if (feat) featureName = feat.name;
      if (!anyValue) conditionLabel = buildConditionValue();
    }

    // "Any value" mode: inserts an always-visible value placeholder
    if (anyValue && featureId !== 'manual') {
      const html = `&nbsp;<span class="im-condition bg-amber-50 border-amber-300 text-amber-800 border border-dashed px-2 py-1 rounded text-sm mx-1 cursor-pointer" contenteditable="false" data-id="${id}" data-feature-id="${featureId}" data-feature-name="${featureName}" data-content="${encodeURIComponent(featureName)}" data-condition-value="*" data-always="true" title="Value: ${featureName} — click to edit"><span class="font-bold text-xs uppercase mr-1">[${featureName}]</span></span>&nbsp;`;
      onCommit(html);
      onClose();
      return;
    }

    const effectiveContent = useAttrValue && conditionLabel ? conditionLabel : text;
    if (!effectiveContent.trim()) return;
    const displayLabel = featureId === 'manual' ? 'Optional' : conditionLabel ? `${featureName}: ${conditionLabel}` : featureName;
    const html = `&nbsp;<span class="im-condition bg-purple-50 border-indigo-300 text-purple-800 border border-dashed px-2 py-1 rounded text-sm mx-1 cursor-pointer" contenteditable="false" data-id="${id}" data-feature-id="${featureId}" data-content="${encodeURIComponent(effectiveContent)}" data-feature-name="${featureName}" data-condition-value="${encodeURIComponent(conditionLabel)}" title="Condition: ${displayLabel} — click to edit"><span class="font-bold text-xs uppercase mr-1">[${displayLabel}]</span> ${effectiveContent.substring(0, 20)}${effectiveContent.length > 20 ? '...' : ''}</span>&nbsp;`;
    onCommit(html);
    onClose();
  };

  const attr = attributes.find(f => f.id === featureId) as any;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6">
        <h3 className="font-bold text-lg mb-4">{initial ? 'Edit' : 'Add'} Condition</h3>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Condition Trigger</label>
          <AttributePicker
            attributes={attributes}
            value={featureId}
            onChange={(id) => { setFeatureId(id); resetValue(); }}
            leadingOptions={[{ id: 'manual', label: 'Manual Selection', hint: 'Optional block — user decides at generation time' }]}
          />
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
  /** Per-box AI translation: "Translate from EN" on non-English tabs, "Translate to all" on EN. */
  enableTranslate?: boolean;
  /** Open the row on this language — see InlineHtmlRowProps.focusLang. */
  focusLang?: string;
  /** Bumped per jump, so the same language can be requested twice. */
  focusToken?: number;
  /**
   * Which print profile this content will be set in. Given both, the editor models the real
   * printed column so image sizes match the PDF; omitted, it keeps its fluid canvas.
   */
  printTemplateType?: IMTemplateType;
  printPageSize?: PrintPageSizeKey;
}

export const InlineBlockEditor: React.FC<InlineBlockEditorProps> = ({ content, variant, languages, attributes, rowKey, onChange, onVariantChange, enableTranslate, focusLang, focusToken, printTemplateType, printPageSize }) => {
  const [placeholderType, setPlaceholderType] = useState<'text' | 'image' | null>(null);
  const [conditionOpen, setConditionOpen] = useState(false);

  return (
    <>
      <InlineHtmlRow printTemplateType={printTemplateType} printPageSize={printPageSize}
        content={content}
        variant={variant}
        languages={languages}
        sectionId={rowKey}
        index={0}
        onChange={onChange}
        onVariantChange={onVariantChange}
        enableTranslate={enableTranslate}
        attributes={attributes}
        focusLang={focusLang}
        focusToken={focusToken}
        onInsertPlaceholder={(type) => setPlaceholderType(type)}
        onInsertCondition={() => setConditionOpen(true)}
      />
      {placeholderType && (
        // Insert flow: the row-aware fan-out shares the new placeholder across all
        // languages (falls back to a plain caret insert if no row registered one).
        <PlaceholderModal type={placeholderType} attributes={attributes} onCommit={commitPlaceholderToTarget} onClose={() => setPlaceholderType(null)} />
      )}
      {conditionOpen && (
        <ConditionModal attributes={attributes} onCommit={insertHtmlToCurrentEditor} onClose={() => setConditionOpen(false)} />
      )}
    </>
  );
};
