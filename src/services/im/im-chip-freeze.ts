/**
 * Placeholder/condition chip freezing for IM content translation.
 *
 * IM section/block HTML embeds chips — <span class="im-placeholder|im-condition"
 * data-id=… data-attr-id=…>…</span> — and <img> tags whose markup must survive a
 * translation round-trip BYTE-IDENTICAL. The im-resolver reads chips with regexes
 * that are attribute-ORDER-sensitive for conditions (see im-resolver.ts), so a
 * translator must never rewrite, reorder, or drop them.
 *
 * `freeze()` replaces every such region with an opaque `{{FRZ_n}}` token before
 * the prose is sent to a translation model; `thaw()` restores the originals
 * afterwards. Pure string functions (no DOM) so they run identically in the
 * browser and in Node/CLI scripts.
 *
 * The span scan is depth-aware because condition chips nest an inner <span>
 * (`<span class="im-condition …"><span …>[Label]</span> preview…</span>`).
 */

const FRZ_OPEN = '{{FRZ_';
const FRZ_CLOSE = '}}';

/** A single frozen fragment plus the tokenized text to translate. */
export interface FrozenHtml {
  /** The HTML with every chip / <img> replaced by a `{{FRZ_n}}` token. */
  text: string;
  /** The original fragments, indexed by token number. */
  frozen: string[];
}

/**
 * Replace every im-placeholder / im-condition span and every <img> with an
 * opaque `{{FRZ_n}}` token. Everything else (prose + ordinary tags like <p>,
 * <strong>, <table>) is left in place for the translator.
 */
export const freeze = (html: string): FrozenHtml => {
  const frozen: string[] = [];
  const lower = html.toLowerCase();
  let out = '';
  let i = 0;
  const push = (chunk: string) => {
    out += `${FRZ_OPEN}${frozen.length}${FRZ_CLOSE}`;
    frozen.push(chunk);
  };
  while (i < html.length) {
    if (html[i] === '<') {
      if (lower.startsWith('<img', i)) {
        const end = html.indexOf('>', i);
        if (end !== -1) { push(html.slice(i, end + 1)); i = end + 1; continue; }
      }
      if (lower.startsWith('<span', i)) {
        const openEnd = html.indexOf('>', i);
        if (openEnd !== -1 && /im-(placeholder|condition)/i.test(html.slice(i, openEnd + 1))) {
          // Walk forward, counting nested <span>/</span>, to the matching close.
          let depth = 1;
          let j = openEnd + 1;
          while (j < html.length && depth > 0) {
            if (lower.startsWith('<span', j)) { const e = html.indexOf('>', j); depth++; j = e === -1 ? html.length : e + 1; }
            else if (lower.startsWith('</span', j)) { depth--; const e = html.indexOf('>', j); const c = e === -1 ? html.length : e + 1; if (depth === 0) { j = c; break; } j = c; }
            else j++;
          }
          push(html.slice(i, j)); i = j; continue;
        }
      }
    }
    out += html[i]; i++;
  }
  return { text: out, frozen };
};

/** A verbatim to freeze: match `phrase`, thaw back `replacement` (default: the phrase itself). */
export interface VerbatimEntry {
  /** Exact (case-sensitive) source text to match. */
  phrase: string;
  /**
   * What `thaw()` restores in place of the match — the officially approved
   * wording for the TARGET language. Omitted/blank → the source phrase is kept
   * unchanged (right for language-neutral identifiers like "(EU) 2019/2016").
   */
  replacement?: string;
}

/**
 * Freeze exact (case-sensitive) occurrences of verbatim phrases — regulation
 * text, standard identifiers — into additional `{{FRZ_n}}` tokens on an
 * already chip-frozen fragment, so the translator physically cannot alter
 * them. The frozen value is the entry's `replacement` (the stored official
 * translation for the target language), so `thaw()` swaps the source phrase
 * for the approved wording instead of a model translation. Phrases are
 * matched longest-first (an overlapping shorter phrase can't partially eat a
 * longer one) and only in prose OUTSIDE `<...>` tag regions and outside
 * existing `{{FRZ_n}}` tokens, so markup and chips are never corrupted.
 */
export const freezeVerbatims = (fh: FrozenHtml, entries: VerbatimEntry[]): FrozenHtml => {
  const candidates = entries
    .filter((e) => e.phrase && e.phrase.trim())
    .sort((a, b) => b.phrase.length - a.phrase.length);
  if (!candidates.length) return fh;

  const frozen = [...fh.frozen];
  // Split into segments: tags and existing FRZ tokens stay untouched; phrase
  // replacement only happens inside the plain-prose segments between them.
  const segments = fh.text.split(/(<[^>]*>|\{\{FRZ_\d+\}\})/g);
  const out = segments.map((seg, i) => {
    if (i % 2 === 1) return seg; // a tag or an existing token (captured delimiter)
    // Build a parts list where already-minted tokens are opaque objects, so a
    // later (shorter) phrase can never match inside a token's own text.
    let parts: Array<string | { tok: string }> = [seg];
    for (const { phrase, replacement } of candidates) {
      parts = parts.flatMap((part) => {
        if (typeof part !== 'string' || !part.includes(phrase)) return [part];
        const tok = { tok: `${FRZ_OPEN}${frozen.length}${FRZ_CLOSE}` };
        frozen.push(replacement?.trim() ? replacement : phrase);
        const pieces = part.split(phrase);
        const expanded: Array<string | { tok: string }> = [];
        pieces.forEach((p, idx) => {
          if (idx > 0) expanded.push(tok);
          expanded.push(p);
        });
        return expanded;
      });
    }
    return parts.map((p) => (typeof p === 'string' ? p : p.tok)).join('');
  }).join('');

  return { text: out, frozen };
};

/** Restore the original chip / <img> fragments frozen by `freeze()`. */
export const thaw = (text: string, frozen: string[]): string =>
  text.replace(/\{\{FRZ_(\d+)\}\}/g, (_m, n: string) => frozen[Number(n)] ?? '');

/** Count `{{FRZ_n}}` tokens — used to assert the translator kept them all. */
export const countTokens = (text: string): number =>
  (text.match(/\{\{FRZ_\d+\}\}/g) || []).length;

/**
 * True when the (frozen) text has human-readable prose worth translating.
 * A fragment that is only whitespace, tags, entities, and frozen chips has
 * nothing to send to the model.
 */
export const hasProse = (frozenText: string): boolean =>
  frozenText
    .replace(/\{\{FRZ_\d+\}\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;/gi, ' ')
    .trim().length > 0;
