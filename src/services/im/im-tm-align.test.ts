import { describe, it, expect } from 'vitest';
import { alignTargetToSource } from './im-tm-align';
import { buildTmSourceUnits, translatableUnits } from './im-tm-core';

const align = (sourceHtml: string, targetHtml: string, targetLocale = 'de') => {
  const built = buildTmSourceUnits('frag-1', sourceHtml, { sourceLocale: 'en' });
  return alignTargetToSource(translatableUnits(built), built.segmented, targetHtml, { targetLocale });
};

describe('alignTargetToSource — the happy paths', () => {
  it('aligns a single-sentence fragment', () => {
    const r = align('<p>Do not immerse in water.</p>', '<p>Nicht in Wasser eintauchen.</p>');
    expect(r.rejection).toBeUndefined();
    expect(r.aligned).toEqual([
      { segmentIndex: 0, targetText: 'Nicht in Wasser eintauchen.', unit: expect.anything() },
    ]);
  });

  it('aligns a two-sentence paragraph sentence by sentence', () => {
    const r = align(
      '<p>Do not immerse in water. Wipe with a damp cloth.</p>',
      '<p>Nicht in Wasser eintauchen. Mit einem feuchten Tuch abwischen.</p>',
    );
    expect(r.aligned.map((a) => a.targetText)).toEqual([
      'Nicht in Wasser eintauchen.',
      'Mit einem feuchten Tuch abwischen.',
    ]);
  });

  it('aligns list items and table cells', () => {
    const r = align(
      '<ul><li>Unplug the appliance.</li><li>Let it cool down.</li></ul>',
      '<ul><li>Gerat ausstecken.</li><li>Abkuhlen lassen.</li></ul>',
    );
    expect(r.aligned).toHaveLength(2);
    expect(r.aligned[1].targetText).toBe('Abkuhlen lassen.');
  });

  it('stores the target verbatim, without normalizing its punctuation or spacing', () => {
    // target_text is published content, not a matching key: normalizing it here would
    // silently alter the wording that reaches a printed manual.
    const curly = String.fromCharCode(0x2019);
    const r = align('<p>Do not touch it.</p>', '<p>Ne le touchez pas' + curly + '.</p>', 'fr');
    expect(r.aligned[0].targetText).toBe('Ne le touchez pas' + curly + '.');
  });

  it('keeps a chip token in place and stores it in marker form', () => {
    const chip = '<span class="im-placeholder" data-id="p1" data-attr-id="model_name">[Model]</span>';
    const r = align(
      '<p>The ' + chip + ' must be earthed.</p>',
      '<p>Das ' + chip + ' muss geerdet sein.</p>',
    );
    expect(r.aligned[0].targetText).toBe('Das {{T0:chip.model_name}} muss geerdet sein.');
  });

  it('keeps inline formatting in marker form', () => {
    const r = align(
      '<p>Fill to the <strong>MAX</strong> line.</p>',
      '<p>Bis zur <strong>MAX</strong> Markierung.</p>',
    );
    expect(r.aligned[0].targetText).toBe(
      'Bis zur {{T0:o.strong}}MAX{{T1:c.strong}} Markierung.',
    );
  });
});

describe('placeholder substitution', () => {
  it('replaces a value with its marker so the row is reusable', () => {
    const r = align('<p>The tank holds 2.5 l of water.</p>', '<p>Der Tank fasst 2.5 l Wasser.</p>');
    expect(r.aligned[0].targetText).toBe('Der Tank fasst {{P0}} Wasser.');
  });

  it('finds a value the engine reformatted for the target locale', () => {
    // The German target writes "2,5 l" for an English source "2.5 l".
    const r = align('<p>The tank holds 2.5 l of water.</p>', '<p>Der Tank fasst 2,5 l Wasser.</p>');
    expect(r.rejection).toBeUndefined();
    expect(r.aligned[0].targetText).toBe('Der Tank fasst {{P0}} Wasser.');
  });

  it('numbers several placeholders in source order', () => {
    const r = align(
      '<p>Supply: 230 V ~ 50 Hz nominal.</p>',
      '<p>Versorgung: 230 V ~ 50 Hz nominal.</p>',
    );
    expect(r.aligned[0].targetText).toBe('Versorgung: {{P0}} ~ {{P1}} nominal.');
  });

  it('rejects when a placeholder value is missing from the translation', () => {
    // The engine dropped the measurement — remembering this would lose it forever.
    const r = align('<p>The tank holds 2.5 l of water.</p>', '<p>Der Tank fasst Wasser.</p>');
    expect(r.aligned).toHaveLength(0);
    expect(r.rejection).toBe('placeholder_not_found');
  });

  it('rejects when a placeholder value is ambiguous in the translation', () => {
    const r = align(
      '<p>Set the timer to 10 min now.</p>',
      '<p>Stellen Sie 10 min ein, dann erneut 10 min.</p>',
    );
    expect(r.aligned).toHaveLength(0);
    expect(r.rejection).toBe('placeholder_ambiguous');
  });

  it('leaves an unsafe segment literal, with nothing to substitute', () => {
    // "Wait 2 minutes" is not placeholder-safe, so no markers are introduced.
    const r = align('<p>Wait 2 minutes before opening.</p>', '<p>2 Minuten warten.</p>');
    expect(r.rejection).toBeUndefined();
    expect(r.aligned[0].targetText).toBe('2 Minuten warten.');
  });
});

describe('the gates that must fail closed', () => {
  it('rejects a translation that merged two sentences into one', () => {
    const r = align(
      '<p>Do not immerse in water. Wipe with a damp cloth.</p>',
      '<p>Nicht eintauchen und abwischen.</p>',
    );
    expect(r.aligned).toHaveLength(0);
    expect(r.rejection).toBe('segment_count_differs');
    expect(r.detail).toContain('2 segment(s)');
  });

  it('rejects a translation that split one sentence into two', () => {
    const r = align(
      '<p>Do not immerse the appliance in water at any time.</p>',
      '<p>Nicht eintauchen. Niemals.</p>',
    );
    expect(r.aligned).toHaveLength(0);
    expect(r.rejection).toBe('segment_count_differs');
  });

  it('rejects a translation that changed the container structure', () => {
    const r = align('<p>Unplug the appliance.</p>', '<h2>Gerat ausstecken.</h2>');
    expect(r.aligned).toHaveLength(0);
    expect(r.rejection).toBe('container_differs');
  });

  it('rejects a translation that dropped a chip', () => {
    const chip = '<span class="im-placeholder" data-id="p1" data-attr-id="model_name">[Model]</span>';
    const r = align('<p>The ' + chip + ' must be earthed.</p>', '<p>Das muss geerdet sein.</p>');
    expect(r.aligned).toHaveLength(0);
    expect(r.rejection).toBe('token_sequence_differs');
  });

  it('rejects a translation that swapped a chip for a different one', () => {
    const a = '<span class="im-placeholder" data-id="p1" data-attr-id="model_name">[Model]</span>';
    const b = '<span class="im-placeholder" data-id="p2" data-attr-id="brand_name">[Brand]</span>';
    const r = align('<p>The ' + a + ' is earthed.</p>', '<p>Das ' + b + ' ist geerdet.</p>');
    expect(r.aligned).toHaveLength(0);
    expect(r.rejection).toBe('token_sequence_differs');
  });

  it('rejects a translation that REORDERED its tokens, rather than renumbering them', () => {
    // Legitimate for many target languages, but accepting it would mean pairing
    // same-identity tokens by guesswork. Losing the row is the cheaper mistake.
    const r = align(
      '<p>Press <strong>START</strong> then <em>STOP</em>.</p>',
      '<p><em>STOP</em> nach <strong>START</strong> drucken.</p>',
    );
    expect(r.aligned).toHaveLength(0);
    expect(r.rejection).toBe('token_sequence_differs');
  });

  it('rejects when the source fragment could not be segmented safely', () => {
    const built = buildTmSourceUnits('f', '<p data-note="a > b">Text here.</p>', { sourceLocale: 'en' });
    const r = alignTargetToSource(translatableUnits(built), built.segmented, '<p>x</p>', {
      targetLocale: 'de',
    });
    expect(r.rejection).toBe('source_ineligible');
  });

  it('reports nothing to align for a fragment with no translatable segments', () => {
    const built = buildTmSourceUnits('f', '<p>230 V</p>', { sourceLocale: 'en' });
    const r = alignTargetToSource(translatableUnits(built), built.segmented, '<p>230 V</p>', {
      targetLocale: 'de',
    });
    expect(r.rejection).toBe('nothing_to_align');
  });

  it('never returns a partial alignment — it is all or nothing', () => {
    // Second sentence loses its measurement; the FIRST must not be remembered either,
    // because a fragment half-remembered is a fragment whose context is now wrong.
    const r = align(
      '<p>Unplug the appliance. The tank holds 2.5 l of water.</p>',
      '<p>Gerat ausstecken. Der Tank fasst Wasser.</p>',
    );
    expect(r.aligned).toHaveLength(0);
    expect(r.rejection).toBe('placeholder_not_found');
  });
});
