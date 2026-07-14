import { describe, it, expect } from 'vitest';
import { freeze, thaw } from './im-chip-freeze';
import { encodeInlineXliff, decodeInlineXliff, sameMarkerSet } from './im-xliff-codec';

describe('im-xliff-codec — encode/decode round trip', () => {
  it('round-trips prose, paired tags, a chip span, and <br/> byte-identically', () => {
    const html =
      '<p>Fill the tank to the <strong>MAX</strong> line before use.<br/>' +
      '<span class="im-placeholder" data-id="p1">[Model number]</span></p>';

    const { text, frozen } = freeze(html);
    const encoded = encodeInlineXliff(text, frozen);

    // Protected content shows up as inline XLIFF elements; the tag text itself is
    // XML-escaped since it's embedded as element text content, not raw markup.
    expect(encoded).toContain('<bpt id="1">&lt;p&gt;</bpt>');
    expect(encoded).toContain('<ept id="1">&lt;/p&gt;</ept>');
    expect(encoded).toContain('<x id="');
    expect(encoded).toContain('<ph id="');

    const decoded = decodeInlineXliff(encoded);
    const restored = thaw(decoded.html, frozen);
    expect(restored).toBe(html);
  });

  it('tolerates a translator reordering markers for target word order', () => {
    const html = '<p><strong>Warning:</strong> do not immerse the base in water.</p>';
    const { text, frozen } = freeze(html);
    const sourceEncoded = encodeInlineXliff(text, frozen);
    const sourceDecoded = decodeInlineXliff(sourceEncoded);

    // Simulate a CAT tool where the translator moved the bold phrase to the end —
    // same set of protected elements, different order, different surrounding text.
    const manualTarget =
      '<bpt id="1">&lt;p&gt;</bpt>Ne pas immerger la base dans l\'eau : ' +
      '<bpt id="2">&lt;strong&gt;</bpt>Attention<ept id="2">&lt;/strong&gt;</ept>' +
      '<ept id="1">&lt;/p&gt;</ept>';
    const targetDecoded = decodeInlineXliff(manualTarget);

    expect(sameMarkerSet(sourceDecoded.markerIds, targetDecoded.markerIds)).toBe(true);
    expect(targetDecoded.html).toBe(
      "<p>Ne pas immerger la base dans l'eau : <strong>Attention</strong></p>",
    );
  });

  it('flags a mismatched marker set (translator dropped a protected element)', () => {
    const html = '<p><strong>Warning:</strong> do not immerse the base in water.</p>';
    const { text, frozen } = freeze(html);
    const sourceDecoded = decodeInlineXliff(encodeInlineXliff(text, frozen));

    // Translator deleted the <strong>…</strong> pair entirely.
    const corruptedTarget =
      '<bpt id="1">&lt;p&gt;</bpt>Ne pas immerger la base dans l\'eau.<ept id="1">&lt;/p&gt;</ept>';
    const targetDecoded = decodeInlineXliff(corruptedTarget);

    expect(sameMarkerSet(sourceDecoded.markerIds, targetDecoded.markerIds)).toBe(false);
  });

  it('leaves an out-of-allow-list tag as unprotected literal text (degrades, does not throw)', () => {
    const html = '<ul><li>Item one</li></ul>';
    const { text, frozen } = freeze(html);
    const encoded = encodeInlineXliff(text, frozen);
    expect(encoded).not.toContain('<bpt');
    expect(encoded).not.toContain('<ept');
    const decoded = decodeInlineXliff(encoded);
    expect(decoded.html).toBe(html);
  });

  it('round-trips plain prose with no tags or chips at all', () => {
    const html = 'Safety Instructions';
    const { text, frozen } = freeze(html);
    const encoded = encodeInlineXliff(text, frozen);
    const decoded = decodeInlineXliff(encoded);
    expect(decoded.html).toBe(html);
    expect(decoded.markerIds).toEqual([]);
  });

  it('escapes & < > inside plain text and restores them on decode', () => {
    const html = '<p>Power &lt; 1500 W &amp; rated for 220-240V</p>';
    const { text, frozen } = freeze(html);
    const encoded = encodeInlineXliff(text, frozen);
    const decoded = decodeInlineXliff(encoded);
    expect(thaw(decoded.html, frozen)).toBe(html);
  });
});
