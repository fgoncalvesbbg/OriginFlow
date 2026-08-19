import { describe, it, expect } from 'vitest';
import {
  NORMALIZATION_VERSION,
  normalizeForMatch,
  normalizeLoose,
  normalizeWhitespace,
} from './im-tm-normalize';

const ch = String.fromCharCode;

describe('NORMALIZATION_VERSION', () => {
  it('is 1 — a change rehashes the whole corpus and needs a migration', () => {
    expect(NORMALIZATION_VERSION).toBe(1);
  });
});

describe('whitespace', () => {
  it.each([
    ['a non-breaking space', ch(0x00a0)],
    ['a narrow non-breaking space', ch(0x202f)],
    ['a thin space', ch(0x2009)],
    ['an em space', ch(0x2003)],
    ['an ideographic space', ch(0x3000)],
    ['a tab', ch(0x09)],
    ['a newline', ch(0x0a)],
  ])('converges %s to a plain space', (_label, space) => {
    expect(normalizeForMatch('Fill' + space + 'the tank')).toBe('Fill the tank');
  });

  it.each(['&nbsp;', '&#160;', '&#xa0;', '&thinsp;', '&#8239;'])(
    'converges the %s entity to a plain space',
    (entity) => {
      expect(normalizeForMatch('Fill' + entity + 'the tank')).toBe('Fill the tank');
    },
  );

  it('collapses runs and trims', () => {
    expect(normalizeForMatch('  Fill   the    tank  ')).toBe('Fill the tank');
  });

  it('maps every control character to a space, which is what makes U+001F a safe delimiter', () => {
    expect(normalizeWhitespace('a' + ch(31) + 'b')).toBe('a b');
    expect(normalizeForMatch('a' + ch(0) + 'b')).toBe('a b');
  });
});

describe('invisible characters', () => {
  it.each([
    ['a zero-width space', ch(0x200b)],
    ['a zero-width joiner', ch(0x200d)],
    ['a word joiner', ch(0x2060)],
    ['a byte-order mark', ch(0xfeff)],
    ['a soft hyphen', ch(0x00ad)],
  ])('removes %s entirely', (_label, invisible) => {
    expect(normalizeForMatch('water' + invisible + 'tank')).toBe('watertank');
  });
});

describe('punctuation unification', () => {
  it('unifies single quotes and apostrophes', () => {
    for (const q of [ch(0x2018), ch(0x2019), ch(0x201a), ch(0x2032), ch(0x00b4), ch(0x0060)]) {
      expect(normalizeForMatch('Don' + q + 't')).toBe("Don't");
    }
  });

  it('unifies double quotes and guillemets', () => {
    for (const q of [ch(0x201c), ch(0x201d), ch(0x201e), ch(0x00ab), ch(0x00bb)]) {
      expect(normalizeForMatch(q + 'MAX' + q)).toBe('"MAX"');
    }
  });

  it('unifies dashes to a hyphen', () => {
    for (const d of [ch(0x2010), ch(0x2013), ch(0x2014), ch(0x2212)]) {
      expect(normalizeForMatch('20' + d + '25 mm')).toBe('20-25 mm');
    }
  });

  it('does not collapse a deliberate double hyphen', () => {
    expect(normalizeForMatch('a -- b')).toBe('a -- b');
  });

  it('expands an ellipsis to three full stops', () => {
    expect(normalizeForMatch('Wait' + ch(0x2026))).toBe('Wait...');
  });
});

describe('what is deliberately preserved', () => {
  it('preserves case', () => {
    expect(normalizeForMatch('Fill to MAX')).toBe('Fill to MAX');
    expect(normalizeForMatch('fill to max')).not.toBe(normalizeForMatch('Fill to MAX'));
  });

  it('preserves accents', () => {
    const eacute = ch(0x00e9);
    expect(normalizeForMatch('caf' + eacute)).toBe('caf' + eacute);
    expect(normalizeForMatch('caf' + eacute)).not.toBe(normalizeForMatch('cafe'));
  });

  it('applies NFC so a combining accent equals its precomposed form', () => {
    const combining = 'e' + ch(0x0301);
    expect(normalizeForMatch(combining)).toBe(ch(0x00e9));
  });
});

describe('entities', () => {
  it('decodes the ordinary entity set', () => {
    expect(normalizeForMatch('a &amp; b')).toBe('a & b');
    expect(normalizeForMatch('&quot;MAX&quot;')).toBe('"MAX"');
  });

  it('never decodes an entity into a brace, which would forge one of our markers', () => {
    // A decoded "{{" would look like a {{Tn}} / {{Pn}} marker to every downstream gate.
    const out = normalizeForMatch('&#123;&#123;P0&#125;&#125;');
    expect(out).not.toContain('{{');
  });
});

describe('markers survive normalization', () => {
  it('leaves token and placeholder markers untouched', () => {
    const s = 'The {{T0:chip.model_name}} holds {{P0}} at {{T1:o.strong}}MAX{{T2:c.strong}}.';
    expect(normalizeForMatch(s)).toBe(s);
  });
});

describe('idempotence', () => {
  it.each([
    'Fill to the MAX line.',
    '  spaced   out  ',
    'Don' + ch(0x2019) + 't 20' + ch(0x2013) + '25 mm' + ch(0x00a0) + 'wide',
  ])('is idempotent for %s', (s) => {
    const once = normalizeForMatch(s);
    expect(normalizeForMatch(once)).toBe(once);
  });
});

describe('normalizeLoose', () => {
  it('case-folds and strips terminal punctuation', () => {
    expect(normalizeLoose('Do Not Immerse In Water.')).toBe('do not immerse in water');
  });

  it('unifies sentences differing only in case and final stop', () => {
    expect(normalizeLoose('Do not immerse in water.')).toBe(normalizeLoose('do not immerse in water'));
    // ...while the strict form keeps them apart, which is why loose is recall-only.
    expect(normalizeForMatch('Do not immerse in water.')).not.toBe(
      normalizeForMatch('do not immerse in water'),
    );
  });

  it('strips an ellipsis that normalization turned into full stops', () => {
    expect(normalizeLoose('Wait' + ch(0x2026))).toBe('wait');
  });
});

describe('empty input', () => {
  it('returns an empty string', () => {
    expect(normalizeForMatch('')).toBe('');
    expect(normalizeLoose('')).toBe('');
  });
});
