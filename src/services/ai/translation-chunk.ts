/**
 * Splits one CHIP-FROZEN fragment into pieces small enough to translate in a
 * single model call.
 *
 * WHY THIS EXISTS
 * ---------------
 * The translate proxy is a SYNCHRONOUS Netlify function (see netlify.toml: ~10s,
 * 26s at best). A fragment big enough that the model needs longer than that to
 * re-emit it in the target language can never succeed: the platform kills the
 * invocation and the browser sees a 502/504 with a non-JSON body. That is not a
 * transient failure — it is deterministic, so the built-in retries burn three
 * timeouts and the fragment is reported as failed in every target language.
 *
 * Observed on the "Induction Hob Manual" template: every inline block at/above
 * ~13k chars failed in all 21 languages, the 5.4k-char one failed in 8 of 21
 * (Estonian, Finnish, Greek, Hungarian, Latvian, Lithuanian, Slovak — i.e. the
 * languages that tokenize least efficiently, so the same source costs the most
 * output tokens), and the 4.9k-char one passed everywhere. MAX_CHUNK_CHARS is
 * set to roughly half of that empirical boundary so the worst-expanding target
 * language still has headroom.
 *
 * THE INVARIANT
 * -------------
 *   pieces.map(p => p.text).join('') === input
 *
 * holds for every input (asserted over a corpus in the test suite). Only pieces
 * flagged `translate` are sent to the model; everything else — the open/close
 * tags of a container we had to descend into, inter-element whitespace, and any
 * run that carries no prose — is emitted byte-identically. So the reassembled
 * fragment has exactly the structure of the source, and a chunk boundary cannot
 * silently drop markup even if the model returns something unexpected for a chunk.
 *
 * BOUNDARIES ARE STRUCTURAL, NEVER MID-ELEMENT. A chunk is always a whole number
 * of sibling nodes: we group top-level siblings up to the budget, and when one
 * sibling is over budget on its own we emit its open tag verbatim, recurse into
 * its children, and emit its close tag verbatim. So a 26k-char `<table>` becomes
 * `<table><tbody>` + one chunk per group of `<tr>`s + `</tbody></table>`, and no
 * call ever receives half a tag. Cutting inside prose happens only for a text run
 * that is itself over budget with no markup to cut at (pathological for IM
 * content), and then only at a sentence or word boundary, never inside a
 * `{{FRZ_n}}` token.
 *
 * COST: a chunked fragment loses cross-chunk context, so the "translate a
 * recurring term the same way" rule only holds within a chunk. That is the price
 * of the fragment translating at all, and it applies to the handful of oversized
 * blocks only — everything under the budget is still one call, byte-for-byte the
 * old behaviour.
 *
 * Pure string functions, no DOM, so this runs identically in the browser and
 * under Node/vitest — same convention as im-chip-freeze.ts.
 */

import { hasProse } from '../im/im-chip-freeze';

/**
 * Per-call character budget. Derived from the ~10s synchronous function limit
 * and the empirical pass/fail boundary documented above, NOT from a model limit.
 * Raising the proxy's timeout (e.g. moving it to a Supabase Edge Function, as
 * the regulatory check already is) is what would let this grow.
 */
export const MAX_CHUNK_CHARS = 2500;

/** One slice of the fragment: either sent to the model, or emitted verbatim. */
export interface TranslationPiece {
  /** The exact source slice. Concatenating every piece's text rebuilds the input. */
  text: string;
  /** True when this slice must be translated; false when it is emitted unchanged. */
  translate: boolean;
}

/** Elements with no closing tag — never descended into. `<img>` is already frozen. */
const VOID_TAGS = new Set([
  'br', 'hr', 'img', 'input', 'meta', 'link', 'col', 'area', 'base', 'source', 'track', 'wbr',
]);

/** Depth cap so pathological nesting cannot recurse without bound. */
const MAX_DEPTH = 12;

/** A parsed sibling: its raw slice, plus its shell when we can descend into it. */
interface SiblingNode {
  raw: string;
  shell?: { open: string; inner: string; close: string };
}

/** Locate the close tag matching an already-consumed open tag, depth-aware. */
const findCloseTag = (
  s: string,
  name: string,
  from: number,
): { start: number; end: number } | null => {
  // Tag names are alphanumeric HTML names, but escape anyway rather than trust input.
  const re = new RegExp(`<(/?)${name.replace(/[^a-zA-Z0-9-]/g, '\\$&')}(?=[\\s/>])`, 'gi');
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const tagEnd = s.indexOf('>', m.index);
    if (tagEnd === -1) return null;
    if (m[1]) {
      depth -= 1;
      if (depth === 0) return { start: m.index, end: tagEnd + 1 };
    } else if (s[tagEnd - 1] !== '/') {
      depth += 1;
    }
    re.lastIndex = tagEnd + 1; // never rescan inside the tag we just consumed
  }
  return null;
};

/** Split one level of HTML into sibling nodes (text runs and elements). */
const parseSiblings = (s: string): SiblingNode[] => {
  const nodes: SiblingNode[] = [];
  let i = 0;
  const pushText = (end: number) => {
    nodes.push({ raw: s.slice(i, end) });
    i = end;
  };
  while (i < s.length) {
    if (s[i] !== '<') {
      const next = s.indexOf('<', i);
      pushText(next === -1 ? s.length : next);
      continue;
    }
    // Only an opening tag can start an element here; anything else (a stray `</p>`,
    // a bare `<`) is treated as text so it survives verbatim.
    const nameMatch = /^<([a-zA-Z][^\s/>]*)/.exec(s.slice(i, i + 48));
    if (!nameMatch) {
      const next = s.indexOf('<', i + 1);
      pushText(next === -1 ? s.length : next);
      continue;
    }
    const openEnd = s.indexOf('>', i);
    if (openEnd === -1) { pushText(s.length); continue; } // truncated tag — keep as-is
    const name = nameMatch[1].toLowerCase();
    if (s[openEnd - 1] === '/' || VOID_TAGS.has(name)) {
      nodes.push({ raw: s.slice(i, openEnd + 1) });
      i = openEnd + 1;
      continue;
    }
    const close = findCloseTag(s, name, openEnd + 1);
    if (!close) { pushText(s.length); continue; } // unbalanced — keep the rest as one node
    nodes.push({
      raw: s.slice(i, close.end),
      shell: {
        open: s.slice(i, openEnd + 1),
        inner: s.slice(openEnd + 1, close.start),
        close: s.slice(close.start, close.end),
      },
    });
    i = close.end;
  }
  return nodes;
};

/**
 * Append a chunk, peeling its leading/trailing whitespace into verbatim pieces.
 *
 * The proxy trims every model response, so whitespace at a chunk edge would be
 * lost on reassembly — harmless between block elements, but able to weld two
 * words together where a text run was cut. Keeping it out of the model's hands
 * makes the join invariant hold regardless of what the model returns.
 */
const pushChunk = (pieces: TranslationPiece[], text: string): void => {
  if (!text) return;
  const lead = /^\s+/.exec(text)?.[0] ?? '';
  if (lead.length === text.length) {
    pieces.push({ text, translate: false });
    return;
  }
  const trail = /\s+$/.exec(text)?.[0] ?? '';
  const core = text.slice(lead.length, text.length - trail.length);
  if (lead) pieces.push({ text: lead, translate: false });
  // A run of only tags and frozen chips has nothing to translate — emit it as-is
  // rather than spending a call the model could only get wrong.
  pieces.push({ text: core, translate: hasProse(core) });
  if (trail) pieces.push({ text: trail, translate: false });
};

/** Back off a hard cut that would land inside a `{{FRZ_n}}` token. */
const safeHardCut = (window: string): number => {
  const open = window.lastIndexOf('{{FRZ_');
  if (open > 0 && !window.slice(open).includes('}}')) return open;
  return window.length;
};

/** Where to cut an over-budget text run: sentence end, else word end, else hard. */
const cutPoint = (text: string, maxChars: number): number => {
  const window = text.slice(0, maxChars);
  const sentence = Math.max(
    window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '),
  );
  if (sentence > maxChars / 2) return sentence + 2;
  const space = window.lastIndexOf(' ');
  if (space > maxChars / 2) return space + 1;
  return safeHardCut(window);
};

/**
 * Last resort: a text run over budget with no markup to cut at. Splits at
 * sentence/word boundaries; every cut still satisfies the join invariant.
 */
const splitTextRun = (text: string, maxChars: number): TranslationPiece[] => {
  const pieces: TranslationPiece[] = [];
  let rest = text;
  while (rest.length > maxChars) {
    const cut = cutPoint(rest, maxChars);
    pushChunk(pieces, rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  pushChunk(pieces, rest);
  return pieces;
};

const split = (s: string, maxChars: number, depth: number): TranslationPiece[] => {
  const pieces: TranslationPiece[] = [];
  let buf = '';
  const flush = () => { pushChunk(pieces, buf); buf = ''; };
  for (const node of parseSiblings(s)) {
    if (node.raw.length > maxChars) {
      flush();
      if (node.shell?.inner.trim() && depth < MAX_DEPTH) {
        // Descend: the container's own tags are structure, not content.
        pieces.push({ text: node.shell.open, translate: false });
        pieces.push(...split(node.shell.inner, maxChars, depth + 1));
        pieces.push({ text: node.shell.close, translate: false });
      } else {
        pieces.push(...splitTextRun(node.raw, maxChars));
      }
      continue;
    }
    if (buf.length + node.raw.length > maxChars) flush();
    buf += node.raw;
  }
  flush();
  return pieces;
};

/**
 * Split a chip-frozen fragment into per-call pieces.
 *
 * A fragment already inside the budget short-circuits to a single translatable
 * piece — byte-for-byte the pre-chunking behaviour, including the fragment's own
 * outer whitespace, so nothing changes for the fragments that always worked.
 */
export const splitForTranslation = (
  frozenText: string,
  maxChars: number = MAX_CHUNK_CHARS,
): TranslationPiece[] => {
  if (frozenText.length <= maxChars) return [{ text: frozenText, translate: true }];
  return split(frozenText, maxChars, 0);
};

/** How many pieces of a split actually cost a model call. */
export const countTranslatablePieces = (pieces: TranslationPiece[]): number =>
  pieces.filter((p) => p.translate).length;
