import { describe, it, expect } from 'vitest';
import {
  TM_AUTO_APPLY_MIN,
  TM_CANDIDATE_MIN,
  TM_CRITICAL_CAP,
  TM_SUGGEST_MIN,
  isAutoApplicable,
  prefilterPass,
  renderEditInstruction,
  scoreMatch,
  tierFor,
  tokenizeForCompare,
} from './im-tm-similarity';
import type { TierFacts } from './im-tm-similarity';
import type { PlaceholderType } from './im-tm-types';

const tok = (s: string, types: PlaceholderType[] = []) => tokenizeForCompare(s, types);
const cmp = (a: string, b: string, types: PlaceholderType[] = []) =>
  scoreMatch(tok(a, types), tok(b, types));

const FACTS: TierFacts = {
  keyEqual: false,
  contextEqual: false,
  placeholderSafeBoth: true,
  placeholderKindsEqual: true,
  approved: true,
  versionsEqual: true,
};

describe('threshold invariants', () => {
  it('keeps the critical cap strictly below the auto-apply floor', () => {
    // If these ever cross, a changed numeral could be auto-applied. The entire
    // safety story of the module rests on this one inequality.
    expect(TM_CRITICAL_CAP).toBeLessThan(TM_AUTO_APPLY_MIN);
  });

  it('orders the remaining thresholds sensibly', () => {
    expect(TM_AUTO_APPLY_MIN).toBeGreaterThan(TM_SUGGEST_MIN);
    expect(TM_SUGGEST_MIN).toBeGreaterThan(TM_CANDIDATE_MIN);
  });
});

describe('tokenizeForCompare', () => {
  it('keeps a chip marker whole', () => {
    expect(tok('The {{T0:chip.model_name}} is earthed.').map((t) => t.text)).toEqual([
      'The', '{{T0:chip.model_name}}', 'is', 'earthed', '.',
    ]);
  });

  it('classifies a placeholder marker by its type, not its index', () => {
    const asMeasure = tok('Use {{P0}} now.', ['measure'])[1];
    const asCode = tok('Use {{P0}} now.', ['code'])[1];
    expect(asMeasure.cls).toBe('marker');
    expect(asMeasure.key).not.toBe(asCode.key);
  });

  it('treats a formatting marker differently from a chip marker', () => {
    expect(tok('{{T0:o.strong}}')[0].key).toMatch(/^f\./);
    expect(tok('{{T0:chip.x}}')[0].key).toMatch(/^m\./);
  });

  it('canonicalizes numbers so 2,50 equals 2.5', () => {
    expect(tok('2,50')[0].key).toBe(tok('2.5')[0].key);
  });

  it('lowercases words but keeps accents', () => {
    expect(tok('Water')[0].key).toBe('water');
    const eacute = String.fromCharCode(0x00e9);
    expect(tok('caf' + eacute)[0].key).not.toBe(tok('cafe')[0].key);
  });

  it('classifies numbers, identifiers and words apart', () => {
    expect(tok('KG350X')[0].cls).toBe('identifier');
    expect(tok('water')[0].cls).toBe('word');
    expect(tok('230')[0].cls).toBe('number');
  });

  const clsOf = (s: string, text: string) => tok(s).find((t) => t.text === text)?.cls;

  it('only reads a unit symbol as a unit when a quantity precedes it', () => {
    expect(clsOf('12 kWh', 'kWh')).toBe('unit');
    // Punctuation between the quantity and the symbol is skipped.
    expect(clsOf('2.5 (l)', 'l')).toBe('unit');
    // Bare symbols are ordinary words: several units are also English words or letters,
    // and reading the article "A" as amperes wrongly marked sentences critically different.
    expect(tok('kWh')[0].cls).toBe('word');
    expect(tok('A completely different sentence.')[0].cls).toBe('word');
  });

  it('does not treat a difference around the article "A" as critical', () => {
    const r = cmp('A completely different sentence.', 'One completely different sentence.');
    expect(r.criticalDiff).toBe(false);
  });
});

describe('scoreMatch', () => {
  it('scores identical sentences 100 with no critical difference', () => {
    const r = cmp('Do not immerse the appliance in water.', 'Do not immerse the appliance in water.');
    expect(r.score).toBe(100);
    expect(r.criticalDiff).toBe(false);
    expect(r.ops.every((o) => o.op === 'equal')).toBe(true);
  });

  it('scores a single inserted word high but below 100', () => {
    const r = cmp(
      'Do not immerse the appliance in water.',
      'Do not immerse the appliance in clean water.',
    );
    expect(r.score).toBeGreaterThan(85);
    expect(r.score).toBeLessThan(100);
    expect(r.criticalDiff).toBe(false);
  });

  it('caps a changed numeral below the auto-apply floor', () => {
    const r = cmp('The tank holds 2.5 l of water.', 'The tank holds 3.0 l of water.');
    expect(r.criticalDiff).toBe(true);
    expect(r.score).toBeLessThanOrEqual(TM_CRITICAL_CAP);
    expect(r.score).toBeLessThan(TM_AUTO_APPLY_MIN);
  });

  it('never rates 2.5 l against 25 l as a near match', () => {
    // The character-level failure mode this module exists to prevent.
    const r = cmp('Fill with 2.5 l of water.', 'Fill with 25 l of water.');
    expect(r.criticalDiff).toBe(true);
    expect(r.score).toBeLessThanOrEqual(TM_CRITICAL_CAP);
  });

  it('caps a changed unit', () => {
    const r = cmp('Add 5 l of water now.', 'Add 5 ml of water now.');
    expect(r.criticalDiff).toBe(true);
    expect(r.score).toBeLessThanOrEqual(TM_CRITICAL_CAP);
  });

  it('caps a changed identifier', () => {
    const r = cmp('Order part KG350X today.', 'Order part KG350Y today.');
    expect(r.criticalDiff).toBe(true);
    expect(r.score).toBeLessThanOrEqual(TM_CRITICAL_CAP);
  });

  it('caps a dropped chip', () => {
    const r = cmp('The {{T0:chip.model_name}} is earthed.', 'The is earthed.');
    expect(r.criticalDiff).toBe(true);
    expect(r.score).toBeLessThanOrEqual(TM_CRITICAL_CAP);
  });

  it('caps a swapped chip identity', () => {
    const r = cmp('The {{T0:chip.model_name}} runs.', 'The {{T0:chip.brand_name}} runs.');
    expect(r.criticalDiff).toBe(true);
  });

  it('treats a punctuation-only difference as nearly free', () => {
    const r = cmp('Do not immerse in water.', 'Do not immerse in water!');
    expect(r.score).toBeGreaterThanOrEqual(TM_AUTO_APPLY_MIN);
    expect(r.criticalDiff).toBe(false);
  });

  it('flags a formatting-only difference without calling it critical', () => {
    const r = cmp(
      'Fill to the {{T0:o.strong}}MAX{{T1:c.strong}} line.',
      'Fill to the MAX line.',
    );
    expect(r.criticalDiff).toBe(false);
    expect(r.formatOnly).toBe(true);
  });

  it('produces one replace op for a one-word change', () => {
    const r = cmp('Rinse the filter well.', 'Rinse the filter twice.');
    const replaces = r.ops.filter((o) => o.op === 'replace');
    expect(replaces).toHaveLength(1);
    expect(replaces[0]).toMatchObject({ from: 'well', to: 'twice', critical: false });
  });

  it('handles an empty side without throwing', () => {
    expect(cmp('', '').score).toBe(100);
    expect(cmp('Something here.', '').score).toBe(0);
  });
});

describe('tierFor', () => {
  it('returns exact_in_context when key, context and approval all line up', () => {
    const r = scoreMatch(tok('Do not immerse.'), tok('Do not immerse.'));
    expect(tierFor(r, { ...FACTS, keyEqual: true, contextEqual: true })).toBe('exact_in_context');
  });

  it('returns exact when only the context differs', () => {
    const r = scoreMatch(tok('Do not immerse.'), tok('Do not immerse.'));
    expect(tierFor(r, { ...FACTS, keyEqual: true, contextEqual: false })).toBe('exact');
  });

  it('demotes an unreviewed 100% match to a reference, never an exact hit', () => {
    const r = scoreMatch(tok('Do not immerse.'), tok('Do not immerse.'));
    const tier = tierFor(r, { ...FACTS, keyEqual: true, contextEqual: true, approved: false });
    expect(tier).toBe('fuzzy_review');
    expect(isAutoApplicable(tier)).toBe(false);
  });

  it('demotes a version mismatch, because hash equality means nothing across normalizers', () => {
    const r = scoreMatch(tok('Do not immerse.'), tok('Do not immerse.'));
    const tier = tierFor(r, { ...FACTS, keyEqual: true, versionsEqual: false });
    expect(isAutoApplicable(tier)).toBe(false);
  });

  it('refuses to auto-apply when placeholder kinds differ', () => {
    const r = scoreMatch(tok('Do not immerse.'), tok('Do not immerse.'));
    const tier = tierFor(r, { ...FACTS, keyEqual: true, placeholderKindsEqual: false });
    expect(isAutoApplicable(tier)).toBe(false);
  });

  it('refuses to auto-apply a fuzzy match when either side is not placeholder-safe', () => {
    const r = cmp('Do not immerse the appliance in water.', 'Do not immerse the appliance in liquid.');
    const tier = tierFor(r, { ...FACTS, placeholderSafeBoth: false });
    expect(isAutoApplicable(tier)).toBe(false);
  });

  it('never auto-applies a formatting-only difference', () => {
    const r = cmp('Fill to the {{T0:o.strong}}MAX{{T1:c.strong}} line.', 'Fill to the MAX line.');
    expect(isAutoApplicable(tierFor(r, FACTS))).toBe(false);
  });

  it('never auto-applies anything with a critical difference, however similar', () => {
    const r = cmp(
      'The water tank of this appliance holds exactly 2.5 l when filled.',
      'The water tank of this appliance holds exactly 3.0 l when filled.',
    );
    expect(r.score).toBeLessThan(TM_AUTO_APPLY_MIN);
    expect(isAutoApplicable(tierFor(r, FACTS))).toBe(false);
  });

  it('drops to none below the candidate floor', () => {
    const r = cmp('Do not immerse in water.', 'Register the warranty online within thirty days.');
    expect(tierFor(r, FACTS)).toBe('none');
  });
});

describe('prefilterPass', () => {
  it('accepts a near neighbour', () => {
    expect(
      prefilterPass(
        tok('Do not immerse the appliance in water.'),
        tok('Do not immerse the appliance in clean water.'),
        TM_SUGGEST_MIN,
      ),
    ).toBe(true);
  });

  it('rejects a clearly distant candidate', () => {
    expect(
      prefilterPass(
        tok('Do not immerse the appliance in water.'),
        tok('Register the warranty online.'),
        TM_SUGGEST_MIN,
      ),
    ).toBe(false);
  });

  it('rejects on a large length difference before scoring', () => {
    expect(
      prefilterPass(tok('Short one.'), tok('A very much longer sentence with many more words in it.'), 70),
    ).toBe(false);
  });
});

describe('renderEditInstruction', () => {
  it('names each change and reports the critical ones', () => {
    const r = cmp('The tank holds 2.5 l of water.', 'The tank holds 3.0 l of water.');
    const { instruction, criticalOps } = renderEditInstruction(r.ops);
    expect(instruction).toContain('Make ONLY these changes');
    expect(instruction).toContain('replace "2.5" with "3.0"');
    expect(instruction).toContain('exactly as they are');
    expect(criticalOps).toHaveLength(1);
  });

  it('tells the engine to return an identical sentence unchanged', () => {
    const r = cmp('Do not immerse.', 'Do not immerse.');
    expect(renderEditInstruction(r.ops).instruction).toContain('Return it unchanged');
  });
});
