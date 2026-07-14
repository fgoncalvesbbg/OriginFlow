/**
 * XLIFF 1.2 inline-code codec for IM template translation export/import.
 *
 * Encodes chip/verbatim-frozen HTML (see im-chip-freeze.ts) into XLIFF inline
 * markup that protects placeholders from an external translator/CAT tool (e.g.
 * XTM), and decodes a translated fragment back into HTML:
 *  - `{{FRZ_n}}` chip/verbatim tokens -> `<ph id="…">payload</ph>` — the payload
 *    (original chip/<img> markup, or the target-language's approved verbatim
 *    wording) is embedded directly as escaped text, so decoding is self-contained
 *    and needs no external skeleton file.
 *  - Paired structural tags (the allow-list `docs/im-import/schema.md` documents:
 *    p, h1-h3, strong, em, u, table/thead/tbody/tr/th/td) -> `<bpt id="…">open
 *    tag</bpt>` … `<ept id="…">close tag</ept>`, so a CAT tool shows/protects each
 *    as a single tag pill instead of editable angle-bracket text.
 *  - `<br>` / `<br/>` -> `<x id="…"/>`.
 *  - Anything else (prose, and any tag outside the allow-list) passes through as
 *    escaped plain text — an unrecognized tag simply isn't protected, matching
 *    how the IM import schema already treats out-of-allow-list markup ("degrades
 *    to non-editable raw HTML").
 *
 * No DOMParser/XML-DOM dependency — same "pure string functions, no DOM"
 * convention as im-chip-freeze.ts, so this runs identically in the browser and
 * under plain Node (vitest). The grammar here is small and self-generated on the
 * way out (source); on the way back (target) a well-behaved CAT tool round-trips
 * these ids/elements verbatim, so a tokenizer/regex walk is a good dependency-free
 * fit. If a specific tool proves to reformat this markup in ways the parser below
 * can't tolerate, that's the point to reach for a real XML parser instead.
 */

const PAIRED_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'strong', 'em', 'u',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);

/** Splits into {{FRZ_n}} tokens, HTML tags, and plain-text runs, in document order. */
const SEGMENT_RE = /(\{\{FRZ_\d+\}\}|<\/?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?\/?>)/;

const escText = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const unescText = (s: string): string =>
  s
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

const tagName = (tag: string): string => {
  const m = /^<\/?([a-zA-Z][a-zA-Z0-9]*)/.exec(tag);
  return m ? m[1].toLowerCase() : '';
};

const isClosingTag = (tag: string): boolean => tag.startsWith('</');
const isSelfClosingTag = (tag: string): boolean => /\/>\s*$/.test(tag);

/**
 * Encode chip/verbatim-tokenized text (the `text` from `freeze`/`freezeVerbatims`)
 * plus its matching `frozen` array into XLIFF inline markup, ready to drop into an
 * XLIFF `<source>` element.
 */
export const encodeInlineXliff = (tokenizedText: string, frozen: string[]): string => {
  const segments = tokenizedText.split(SEGMENT_RE);
  let out = '';
  let nextId = 1;
  const openStack: Array<{ tag: string; id: number }> = [];

  for (const seg of segments) {
    if (!seg) continue;

    const frzMatch = /^\{\{FRZ_(\d+)\}\}$/.exec(seg);
    if (frzMatch) {
      const payload = frozen[Number(frzMatch[1])] ?? '';
      out += `<ph id="${nextId++}">${escText(payload)}</ph>`;
      continue;
    }

    if (seg[0] === '<') {
      const name = tagName(seg);
      if (name === 'br') {
        out += `<x id="${nextId++}"/>`;
        continue;
      }
      if (PAIRED_TAGS.has(name) && isSelfClosingTag(seg)) {
        // A self-closed instance of an otherwise-paired tag (malformed/unexpected
        // input) — don't guess at pairing, just pass it through as a literal.
        out += escText(seg);
        continue;
      }
      if (PAIRED_TAGS.has(name) && !isClosingTag(seg)) {
        const id = nextId++;
        openStack.push({ tag: name, id });
        out += `<bpt id="${id}">${escText(seg)}</bpt>`;
        continue;
      }
      if (PAIRED_TAGS.has(name) && isClosingTag(seg)) {
        const top = openStack[openStack.length - 1];
        if (top && top.tag === name) {
          openStack.pop();
          out += `<ept id="${top.id}">${escText(seg)}</ept>`;
          continue;
        }
        // Unbalanced/mismatched closing tag — fall back to a literal rather than
        // ever emitting an <ept> without a matching <bpt>.
        out += escText(seg);
        continue;
      }
      // Unrecognized tag — left unprotected, as plain escaped text.
      out += escText(seg);
      continue;
    }

    out += escText(seg);
  }
  return out;
};

/** Matches a self-closing <x id="n"/>, or a paired <ph|bpt|ept id="n">…</ph|bpt|ept>. */
const ELEMENT_RE = /<x\s+id="(\d+)"\s*\/>|<(ph|bpt|ept)\s+id="(\d+)">([\s\S]*?)<\/\2>/g;

/**
 * Decode XLIFF inline markup (the content of a `<source>` or `<target>` element)
 * back into HTML, plus the ordered list of marker ids encountered (for the
 * integrity check in `sameMarkerSet`).
 */
export const decodeInlineXliff = (xml: string): { html: string; markerIds: string[] } => {
  let html = '';
  const markerIds: string[] = [];
  let lastIndex = 0;
  ELEMENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ELEMENT_RE.exec(xml))) {
    html += unescText(xml.slice(lastIndex, m.index));
    if (m[1] !== undefined) {
      markerIds.push(`x${m[1]}`);
      html += '<br/>';
    } else {
      const kind = m[2];
      const id = m[3];
      const payload = m[4] ?? '';
      markerIds.push(`${kind}${id}`);
      html += unescText(payload);
    }
    lastIndex = ELEMENT_RE.lastIndex;
  }
  html += unescText(xml.slice(lastIndex));
  return { html, markerIds };
};

/**
 * True when both marker-id lists contain exactly the same ids the same number
 * of times — order may differ (a translator may reorder markers for target word
 * order) but nothing may be added, dropped, or duplicated. Mirrors the
 * `countTokens` safety net the AI translate path already applies.
 */
export const sameMarkerSet = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
};
