import { describe, it, expect } from 'vitest';

import { freeze } from '../im/im-chip-freeze';
import {
  splitForTranslation,
  countTranslatablePieces,
  MAX_CHUNK_CHARS,
  type TranslationPiece,
} from './translation-chunk';

const join = (pieces: TranslationPiece[]) => pieces.map((p) => p.text).join('');
const chunks = (pieces: TranslationPiece[]) => pieces.filter((p) => p.translate).map((p) => p.text);

/** `<p>` blocks totalling well over the budget — the common oversized-block shape. */
const paragraphs = (n: number, chars = 400) =>
  Array.from({ length: n }, (_, i) => `<p>${`Sentence ${i} about the induction hob. `.repeat(Math.ceil(chars / 40))}</p>`).join('\n');

/** A single table big enough that only descending into it can split it. */
const bigTable = (rows: number) =>
  `<table class="im-table"><tbody>${
    Array.from({ length: rows }, (_, i) =>
      `<tr><td>Fault ${i}</td><td>${`Check the pan is ferromagnetic and centred on the zone. `.repeat(8)}</td></tr>`).join('')
  }</tbody></table>`;

describe('splitForTranslation — the join invariant', () => {
  const corpus: Array<[string, string]> = [
    ['empty', ''],
    ['short title', 'Welcome!'],
    ['single paragraph', '<p>Keep the appliance dry.</p>'],
    ['paragraph blocks', paragraphs(30)],
    ['big table', bigTable(40)],
    ['nested lists', `<div><ul>${Array.from({ length: 60 }, (_, i) => `<li>Step ${i}: ${'turn the dial slowly. '.repeat(10)}</li>`).join('')}</ul></div>`],
    ['table inside a wrapper with prose around it', `<p>Intro.</p>${bigTable(30)}<p>Outro.</p>`],
    ['void tags and entities', `<p>Hot&nbsp;surface.<br>Do not touch.</p>${paragraphs(20)}`],
    ['unbalanced markup', `<p>Unclosed paragraph${'x'.repeat(4000)}`],
    ['stray close tag', `</p>${paragraphs(10)}</div>`],
    ['one giant text run', 'Very important safety text. '.repeat(400)],
    ['deeply nested', `<div><div><div><div>${paragraphs(20)}</div></div></div></div>`],
    ['frozen chips', freeze(`<p>Rated <span class="im-placeholder" data-id="1" data-attr-id="a">[Power]</span> W.</p>${paragraphs(20)}`).text],
  ];

  it.each(corpus)('rebuilds %s byte-identically', (_name, html) => {
    expect(join(splitForTranslation(html))).toBe(html);
  });

  it.each(corpus)('rebuilds %s byte-identically at a tiny budget', (_name, html) => {
    expect(join(splitForTranslation(html, 120))).toBe(html);
  });
});

describe('splitForTranslation — when it splits', () => {
  it('leaves a fragment inside the budget as one untouched piece', () => {
    const html = '<p>Keep the appliance dry.</p>';
    expect(splitForTranslation(html)).toEqual([{ text: html, translate: true }]);
  });

  it('leaves a fragment exactly at the budget as one piece', () => {
    const html = 'x'.repeat(MAX_CHUNK_CHARS);
    expect(countTranslatablePieces(splitForTranslation(html))).toBe(1);
  });

  it('splits an oversized fragment into several under-budget chunks', () => {
    const pieces = splitForTranslation(paragraphs(30));
    expect(countTranslatablePieces(pieces)).toBeGreaterThan(1);
    for (const c of chunks(pieces)) expect(c.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
  });

  it('never cuts inside a tag', () => {
    for (const c of chunks(splitForTranslation(bigTable(40)))) {
      // Balanced angle brackets in every chunk: a cut mid-tag would leave a lone one.
      expect((c.match(/</g) || []).length).toBe((c.match(/>/g) || []).length);
      expect(c.startsWith('>')).toBe(false);
      expect(c.endsWith('<')).toBe(false);
    }
  });

  it('descends into a single oversized container instead of giving up on it', () => {
    const pieces = splitForTranslation(bigTable(40));
    expect(countTranslatablePieces(pieces)).toBeGreaterThan(1);
    // The container's own tags are emitted verbatim, never sent to the model.
    expect(pieces[0]).toEqual({ text: '<table class="im-table">', translate: false });
    expect(pieces.at(-1)).toEqual({ text: '</table>', translate: false });
    expect(chunks(pieces).join('')).not.toContain('<table');
  });

  it('never cuts inside a {{FRZ_n}} token', () => {
    const { text } = freeze(
      Array.from({ length: 200 }, (_, i) =>
        `<p>Model <span class="im-placeholder" data-id="${i}" data-attr-id="m">[Model]</span> is rated for continuous use.</p>`).join(''),
    );
    const tokens = /\{\{FRZ_\d+\}\}/g;
    const whole = (text.match(tokens) || []).length;
    const perChunk = chunks(splitForTranslation(text)).reduce((n, c) => n + (c.match(tokens) || []).length, 0);
    // Every token survives intact inside exactly one chunk — none was cut in half.
    expect(perChunk).toBe(whole);
    for (const c of chunks(splitForTranslation(text))) {
      expect(c).not.toMatch(/\{\{FRZ_\d*$/);
      expect(c).not.toMatch(/^\d*\}\}/);
    }
  });

  it('splits a giant tag-free text run at sentence boundaries', () => {
    const pieces = splitForTranslation('Keep the hob clean. '.repeat(400));
    for (const c of chunks(pieces)) {
      expect(c.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      // A cut landed after a sentence, so no chunk starts mid-word.
      expect(c.startsWith('Keep')).toBe(true);
    }
  });

  it('does not spend a call on a chunk with no prose', () => {
    const structural = `<table><tbody>${'<tr><td><img src="x.png"></td></tr>'.repeat(200)}</tbody></table>`;
    const pieces = splitForTranslation(freeze(structural).text);
    expect(countTranslatablePieces(pieces)).toBe(0);
    expect(join(pieces)).toBe(freeze(structural).text);
  });

  it('keeps whitespace at chunk edges out of the model’s hands', () => {
    const pieces = splitForTranslation(paragraphs(30));
    for (const c of chunks(pieces)) expect(c).toBe(c.trim());
  });
});
