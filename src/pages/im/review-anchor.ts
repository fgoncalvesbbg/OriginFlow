/**
 * Anchoring for supplier review comments — how a note made in the online IM viewer finds its
 * way back to the right place in the PM's editor.
 *
 * A note is anchored to a CHAPTER plus the text the reviewer selected (see
 * db_migrations/131_create_im_review_comments.sql for why it is not anchored to a block).
 * That leaves two jobs, both pure and both here so they can be unit-tested under the repo's
 * `environment: 'node'` vitest setup:
 *
 *   buildReviewAnchor  — supplier side: turn a raw selection into the stored anchor.
 *   markQuoteInHtml    — PM side: find that quote again in rendered chapter HTML and wrap it.
 *
 * Neither touches the DOM. The caller does the DOM reading (which element, what text) and
 * hands strings in; that is what keeps them testable.
 */

/** How much surrounding text is kept either side of the quote, to relocate it after edits. */
export const QUOTE_CONTEXT_CHARS = 60;

/** Server-side cap (im_review_add_comment). Mirrored here so the UI fails before the RPC does. */
export const MAX_QUOTE_CHARS = 2000;

export interface ReviewAnchor {
  sectionId: string;
  sectionTitle: string | null;
  quote: string;
  quoteBefore: string;
  quoteAfter: string;
}

export interface ReviewAnchorInput {
  /** im_sections.id, or a project-only 'proj-…' chapter id. */
  sectionId: string;
  sectionTitle?: string | null;
  /** Plain text of the whole chapter, used only to slice context around the quote. */
  sectionText?: string;
  /** The reviewer's selection, verbatim. */
  quote: string;
}

/** Collapse every run of whitespace (incl. NBSP and newlines) to one space, and trim. */
export const normalizeQuote = (s: string): string =>
  s.replace(/[\s ]+/g, ' ').trim();

/**
 * Build the stored anchor from a raw selection.
 *
 * Returns null when there is nothing to anchor — an empty/whitespace-only selection, or a
 * missing chapter id. Callers treat null as "this selection can't be commented on" rather
 * than as an error, because it happens routinely (a stray click collapses the selection).
 *
 * The quote is stored whitespace-normalized, not verbatim: the viewer renders the manual
 * with different line wrapping than the editor does, so a verbatim quote would carry
 * newlines that never appear in the editor's HTML and would never match again.
 */
export const buildReviewAnchor = (input: ReviewAnchorInput): ReviewAnchor | null => {
  const sectionId = input.sectionId?.trim();
  if (!sectionId) return null;

  const quote = normalizeQuote(input.quote ?? '').slice(0, MAX_QUOTE_CHARS);
  if (!quote) return null;

  const haystack = normalizeQuote(input.sectionText ?? '');
  const at = haystack.indexOf(quote);

  // Context is a relocation hint, not evidence — if the quote can't be found in the chapter
  // text (truncated quote, or the caller passed no chapter text) we simply store none.
  const quoteBefore = at > 0 ? haystack.slice(Math.max(0, at - QUOTE_CONTEXT_CHARS), at) : '';
  const quoteAfter = at >= 0
    ? haystack.slice(at + quote.length, at + quote.length + QUOTE_CONTEXT_CHARS)
    : '';

  return {
    sectionId,
    sectionTitle: input.sectionTitle?.trim() || null,
    quote,
    quoteBefore,
    quoteAfter,
  };
};

// ---------------------------------------------------------------------------
// markQuoteInHtml
// ---------------------------------------------------------------------------

/** CSS class the highlight is wrapped in — styled in src/pages/im/styles/im-content.css. */
export const REVIEW_HIT_CLASS = 'im-review-hit';

const MARK_OPEN = `<mark class="${REVIEW_HIT_CLASS}">`;
const MARK_CLOSE = '</mark>';

/**
 * The handful of entities that actually show up in editor content. Decoding them matters
 * because &nbsp; is emitted constantly by contenteditable and would otherwise never match a
 * plain space in the reviewer's quote.
 */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

interface DecodedChar {
  ch: string;
  /** Half-open span in the source HTML that produced this character. */
  start: number;
  end: number;
}

/**
 * Decode the text content of an HTML string into characters, each tagged with the source span
 * it came from. Markup is skipped entirely, so a match is never found inside a tag name or an
 * attribute value (a quote of "manual" must not highlight `href="/manual"`).
 */
const decodeTextChars = (html: string): DecodedChar[] => {
  const out: DecodedChar[] = [];
  let i = 0;
  while (i < html.length) {
    const c = html[i];
    if (c === '<') {
      // Skip to the end of the tag. An unterminated '<' is treated as text, matching how
      // browsers recover, so we never drop the tail of a malformed fragment.
      const close = html.indexOf('>', i);
      if (close === -1) {
        out.push({ ch: c, start: i, end: i + 1 });
        i += 1;
      } else {
        i = close + 1;
      }
      continue;
    }
    if (c === '&') {
      const semi = html.indexOf(';', i);
      if (semi !== -1 && semi - i <= 10) {
        const entity = html.slice(i, semi + 1);
        const decoded = ENTITIES[entity.toLowerCase()];
        if (decoded !== undefined) {
          out.push({ ch: decoded, start: i, end: semi + 1 });
          i = semi + 1;
          continue;
        }
      }
    }
    out.push({ ch: c, start: i, end: i + 1 });
    i += 1;
  }
  return out;
};

/**
 * Wrap the first occurrence of `quote` in `html` with a highlight <mark>.
 *
 * Matching is on TEXT, with whitespace collapsed on both sides, so a quote survives the
 * inline markup and line wrapping between the viewer and the editor: quoting "do not
 * immerse" still matches `do <strong>not</strong>&nbsp;immerse`.
 *
 * When a match spans markup, the run is wrapped PIECEWISE — one <mark> per contiguous stretch
 * of text — rather than with a single pair around the whole thing. A single pair would
 * produce `f<mark>oo<b>bar</mark></b>`, which every HTML parser re-nests into something
 * wrong. Piecewise wrapping is always well-formed.
 *
 * Returns `html` unchanged when there is no quote, no match, or nothing to highlight. Callers
 * rely on that: a stale comment whose wording has since been edited away simply shows no
 * highlight, and the PM still lands on the right chapter.
 */
export const markQuoteInHtml = (html: string, quote: string | null | undefined): string => {
  if (!html || !quote) return html;
  const needle = normalizeQuote(quote);
  if (!needle) return html;

  const chars = decodeTextChars(html);
  if (chars.length === 0) return html;

  // Whitespace-collapsed projection of the text, keeping a map back to the source characters.
  let norm = '';
  const firstChar: number[] = []; // norm index -> index of first source char
  const lastChar: number[] = []; //  norm index -> index of last source char
  let pendingSpace = false;
  let spaceFirst = -1;
  let spaceLast = -1;

  const flushSpace = () => {
    if (!pendingSpace) return;
    // Leading whitespace is dropped, matching normalizeQuote's trim.
    if (norm.length > 0) {
      norm += ' ';
      firstChar.push(spaceFirst);
      lastChar.push(spaceLast);
    }
    pendingSpace = false;
  };

  for (let idx = 0; idx < chars.length; idx++) {
    const { ch } = chars[idx];
    if (/[\s ]/.test(ch)) {
      if (!pendingSpace) { pendingSpace = true; spaceFirst = idx; }
      spaceLast = idx;
      continue;
    }
    flushSpace();
    norm += ch;
    firstChar.push(idx);
    lastChar.push(idx);
  }
  // Trailing whitespace is intentionally not flushed — normalizeQuote trims it too.

  let at = norm.indexOf(needle);
  if (at === -1) at = norm.toLowerCase().indexOf(needle.toLowerCase());
  if (at === -1) return html;

  const from = firstChar[at];
  const to = lastChar[at + needle.length - 1];
  if (from === undefined || to === undefined) return html;

  // Group the matched source characters into stretches that are contiguous in the HTML.
  // A gap between one character's end and the next one's start means markup sits between
  // them, so the highlight has to break and resume on the other side.
  const ranges: Array<{ start: number; end: number }> = [];
  let runStart = chars[from].start;
  let runEnd = chars[from].end;
  for (let idx = from + 1; idx <= to; idx++) {
    if (chars[idx].start === runEnd) {
      runEnd = chars[idx].end;
    } else {
      ranges.push({ start: runStart, end: runEnd });
      runStart = chars[idx].start;
      runEnd = chars[idx].end;
    }
  }
  ranges.push({ start: runStart, end: runEnd });

  // Splice from the end so earlier offsets stay valid.
  let out = html;
  for (let r = ranges.length - 1; r >= 0; r--) {
    const { start, end } = ranges[r];
    out = out.slice(0, start) + MARK_OPEN + out.slice(start, end) + MARK_CLOSE + out.slice(end);
  }
  return out;
};
