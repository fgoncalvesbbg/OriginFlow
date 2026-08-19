import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../ai/translation-verbatim.service', () => ({
  getTranslationVerbatims: vi.fn(async () => []),
}));

import {
  TM_PREFILL_ORIGIN,
  TM_SUGGESTION_ORIGIN,
  buildTranslationXliff,
} from './im-translation-export.service';
import {
  applyTranslationImport,
  countChangedPrefills,
  countTranslationOverwrites,
  parseTranslationXliff,
} from './im-translation-import.service';
import { collectTranslationFragments } from './im-translation-fragments';
import { planKey, type TmFragmentPlan, type TmPlanResult } from './im-tm-translate';
import type { IMSection, IMTemplate, InlineBlockRef } from '../../types';

const template = { id: 'tpl-1', name: 'Kettle' } as Pick<IMTemplate, 'id' | 'name'>;

/** Two inline rows with stable ids, so fragment ids are the id-based form. */
const sections: IMSection[] = [
  {
    id: 'sec-a',
    templateId: 'tpl-1',
    title: 'Safety',
    order: 0,
    isPlaceholder: false,
    content: {},
    blockRefs: [
      { kind: 'inline', id: 'ref-1', content: { en: '<p>Do not immerse in water.</p>' } },
      { kind: 'inline', id: 'ref-2', content: { en: '<p>Unplug before cleaning.</p>' } },
    ],
  } as IMSection,
];

const fragmentIdFor = (snippet: string): string =>
  collectTranslationFragments(sections).find((f) => f.sourceHtml.includes(snippet))!.id;

const emptyPlan = (): TmPlanResult => ({
  plans: new Map(),
  segmented: new Map(),
  units: new Map(),
  placeholders: new Map(),
  memoryUnavailable: false,
  stats: {},
});

const planEntry = (over: Partial<TmFragmentPlan> & { fragmentId: string }): TmFragmentPlan => ({
  targetLocale: 'de',
  fullyCovered: false,
  html: null,
  misses: [],
  references: new Map(),
  outcomes: [],
  appliedSegmentIds: [],
  referenceHtml: null,
  referenceQuality: null,
  reuseEvents: [],
  ...over,
});

/** A plan that fully covers the "Do not immerse" row and suggests for the other. */
const coveringPlan = (): TmPlanResult => {
  const plan = emptyPlan();
  const covered = fragmentIdFor('immerse');
  const suggested = fragmentIdFor('Unplug');
  plan.plans.set(
    planKey(covered, 'de'),
    planEntry({
      fragmentId: covered,
      fullyCovered: true,
      html: '<p>Nicht in Wasser eintauchen.</p>',
      appliedSegmentIds: ['seg-1'],
    }),
  );
  plan.plans.set(
    planKey(suggested, 'de'),
    planEntry({
      fragmentId: suggested,
      referenceHtml: '<p>Vor der Reinigung ausstecken.</p>',
      referenceQuality: 87,
    }),
  );
  return plan;
};

const build = (tmPlan?: TmPlanResult) =>
  buildTranslationXliff({ template, sections, targetLangs: ['de'], skipExisting: false, tmPlan });

/**
 * Simulate a vendor's CAT tool filling in one unit: copy the unit's own `<source>`
 * inline markup into its `<target>`, replacing only the readable prose.
 *
 * Copying the inline codes is essential, not incidental. A target that drops the
 * `<bpt>`/`<ept>` pair fails the importer's marker-integrity gate before any
 * pre-fill comparison happens — which is correct behaviour, but it means a test that
 * writes plain text into a target is testing the wrong gate.
 *
 * Index-based rather than regex-based, and it THROWS when anything is missing, so a
 * broken helper fails loudly instead of quietly returning unmodified XML.
 */
const setUnitTargetFromSource = (
  xml: string,
  unitId: string,
  find: string,
  replace: string,
): string => {
  const start = xml.indexOf('<trans-unit id="' + unitId + '"');
  if (start === -1) throw new Error('test helper: no trans-unit with id ' + unitId);
  const end = xml.indexOf('</trans-unit>', start);
  if (end === -1) throw new Error('test helper: unterminated trans-unit ' + unitId);
  const unit = xml.slice(start, end);

  const sOpen = unit.indexOf('<source>');
  const sClose = unit.indexOf('</source>', sOpen);
  if (sOpen === -1 || sClose === -1) throw new Error('test helper: no <source> in ' + unitId);
  const sourceInline = unit.slice(sOpen + '<source>'.length, sClose);
  if (!sourceInline.includes(find)) {
    throw new Error('test helper: source of ' + unitId + ' does not contain "' + find + '"');
  }
  const targetInline = sourceInline.replace(find, replace);

  const tOpen = unit.indexOf('<target', sClose);
  const tGt = unit.indexOf('>', tOpen);
  const tClose = unit.indexOf('</target>', tGt);
  if (tOpen === -1 || tClose === -1) throw new Error('test helper: no <target> in ' + unitId);

  const edited = unit.slice(0, tGt + 1) + targetInline + unit.slice(tClose);
  return xml.slice(0, start) + edited + xml.slice(end);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('export without a translation memory', () => {
  it('leaves every target empty and counts everything as fresh', async () => {
    const built = await build();
    expect(built!.prefilled).toBe(0);
    expect(built!.suggested).toBe(0);
    expect(built!.fresh).toBe(3); // title + two inline rows
    expect(built!.xml).not.toContain('alt-trans');
    expect(built!.xml).not.toContain('approved="yes"');
  });
});

describe('export with translation-memory coverage', () => {
  it('emits a covered fragment already translated and marked for wordcount exclusion', async () => {
    const built = await build(coveringPlan());
    expect(built!.prefilled).toBe(1);
    expect(built!.xml).toContain('approved="yes"');
    expect(built!.xml).toContain('state="translated"');
    expect(built!.xml).toContain('state-qualifier="exact-match"');
    expect(built!.xml).toContain(TM_PREFILL_ORIGIN);
    expect(built!.xml).toContain('Nicht in Wasser eintauchen.');
  });

  it('does NOT mark a pre-fill translate="no" or state="final"', async () => {
    // Both are stronger exclusion signals but remove the vendor's ability to flag a
    // pre-fill that is actually wrong. Keeping that path open is deliberate.
    const built = await build(coveringPlan());
    expect(built!.xml).not.toContain('translate="no"');
    expect(built!.xml).not.toContain('state="final"');
  });

  it('emits a suggestion with an EMPTY target so it cannot be mistaken for a translation', async () => {
    const built = await build(coveringPlan());
    expect(built!.suggested).toBe(1);
    expect(built!.xml).toContain(TM_SUGGESTION_ORIGIN);
    expect(built!.xml).toContain('match-quality="87%"');
    // The suggestion text appears only inside the alternative.
    const suggestionUnit = /<trans-unit id="[^"]*"(?![^>]*approved)[^>]*>[\s\S]*?Vor der Reinigung[\s\S]*?<\/trans-unit>/.exec(
      built!.xml,
    );
    expect(suggestionUnit).not.toBeNull();
    expect(suggestionUnit![0]).toMatch(/<target><\/target>/);
  });

  it('reports coverage per language and tells the vendor in the file header', async () => {
    const built = await build(coveringPlan());
    expect(built!.byLang.de).toEqual({ prefilled: 1, suggested: 1, fresh: 1 });
    expect(built!.xml).toContain('excluded from the quoted word count');
  });

  it('names the units that actually shipped, so reuse is logged only for those', async () => {
    const built = await build(coveringPlan());
    expect(built!.unitIdsByLang.de).toHaveLength(3);
    expect(built!.unitIdsByLang.de).toContain(fragmentIdFor('immerse'));
  });

  it('omits skipped units from unitIdsByLang when skipExisting drops them', async () => {
    const partlyTranslated: IMSection[] = [
      {
        ...sections[0],
        blockRefs: [
          { kind: 'inline', id: 'ref-1', content: { en: '<p>Do not immerse in water.</p>', de: '<p>Schon da.</p>' } },
          sections[0].blockRefs![1],
        ],
      } as IMSection,
    ];
    const built = await buildTranslationXliff({
      template,
      sections: partlyTranslated,
      targetLangs: ['de'],
      skipExisting: true,
    });
    expect(built!.unitIdsByLang.de).not.toContain('sec-a#inline:ref:ref-1');
  });

  it('warns rather than silently pre-filling nothing when the memory was unreadable', async () => {
    const plan = emptyPlan();
    plan.memoryUnavailable = true;
    const built = await build(plan);
    expect(built!.prefilled).toBe(0);
    expect(built!.warnings.join(' ')).toMatch(/could not be read/i);
  });
});

describe('re-importing a pre-filled file', () => {
  it('recognizes a pre-fill returned untouched and applies nothing', async () => {
    const built = await build(coveringPlan());
    const parsed = parseTranslationXliff(built!.xml);

    const unit = parsed.files[0].units.find((u) => u.wasPrefilled)!;
    expect(unit.prefilledHtml).toBe('<p>Nicht in Wasser eintauchen.</p>');
    expect(unit.html).toBe(unit.prefilledHtml);

    const result = applyTranslationImport(sections, parsed);
    expect(result.report.unchangedPrefills).toBe(1);
    expect(result.report.changedPrefills).toBe(0);
    // Nothing to write, and — importantly — not reported as a failure either.
    expect(result.report.failures.filter(f => f.label.includes('row 1'))).toHaveLength(0);
    expect(result.changedPrefillUnits).toHaveLength(0);
  });

  it('does not count an untouched pre-fill as an overwrite', async () => {
    // Otherwise the "this will destroy N translations" warning inflates until nobody reads it.
    const built = await build(coveringPlan());
    const parsed = parseTranslationXliff(built!.xml);
    const withExisting: IMSection[] = [
      {
        ...sections[0],
        blockRefs: [
          { kind: 'inline', id: 'ref-1', content: { en: '<p>Do not immerse in water.</p>', de: '<p>Nicht in Wasser eintauchen.</p>' } },
          sections[0].blockRefs![1],
        ],
      } as IMSection,
    ];
    expect(countTranslationOverwrites(withExisting, parsed).de ?? 0).toBe(0);
  });

  it('refuses a vendor edit to approved wording unless explicitly accepted', async () => {
    const built = await build(coveringPlan());
    const coveredId = fragmentIdFor('immerse');
    // The vendor keeps our markup but rewords the sentence we had signed off.
    const tampered = setUnitTargetFromSource(
      built!.xml,
      coveredId,
      'Do not immerse in water.',
      'Bitte nicht eintauchen.',
    );
    const parsed = parseTranslationXliff(tampered);

    expect(countChangedPrefills(parsed).de).toBe(1);

    const blocked = applyTranslationImport(sections, parsed);
    expect(blocked.report.changedPrefills).toBe(1);
    expect(blocked.changedPrefillUnits[0]).toMatchObject({
      lang: 'de',
      ours: '<p>Nicht in Wasser eintauchen.</p>',
      theirs: '<p>Bitte nicht eintauchen.</p>',
    });
    // Not applied, and the reason says why.
    expect((blocked.sections[0].blockRefs![0] as InlineBlockRef).content.de).toBeUndefined();
    expect(blocked.report.failures.some(f => /approved memory/i.test(f.error))).toBe(true);

    const accepted = applyTranslationImport(sections, parsed, { acceptChangedPrefills: true });
    expect((accepted.sections[0].blockRefs![0] as InlineBlockRef).content.de).toBe(
      '<p>Bitte nicht eintauchen.</p>',
    );
  });

  it('still imports the units that were never pre-filled', async () => {
    const built = await build(coveringPlan());
    const suggestedId = fragmentIdFor('Unplug');
    const filled = setUnitTargetFromSource(
      built!.xml,
      suggestedId,
      'Unplug before cleaning.',
      'Vor der Reinigung ausstecken.',
    );
    const parsed = parseTranslationXliff(filled);
    const result = applyTranslationImport(sections, parsed);
    expect((result.sections[0].blockRefs![1] as InlineBlockRef).content.de).toBe(
      '<p>Vor der Reinigung ausstecken.</p>',
    );
  });

  it('does not mistake a suggestion alt-trans for a pre-fill', async () => {
    const built = await build(coveringPlan());
    const parsed = parseTranslationXliff(built!.xml);
    const suggestionUnit = parsed.files[0].units.find(
      (u) => u.id === fragmentIdFor('Unplug'),
    )!;
    expect(suggestionUnit.prefilledHtml).toBeNull();
    expect(suggestionUnit.html).toBeNull(); // its <target> was left empty
  });
});

describe('legacy positional ids', () => {
  it('flags a file that addresses rows by position', async () => {
    const legacy = parseTranslationXliff(
      '<xliff version="1.2"><file target-language="de"><body>'
      + '<trans-unit id="sec-a#inline:0"><source>x</source><target>y</target></trans-unit>'
      + '</body></file></xliff>',
    );
    expect(legacy.hasLegacyIds).toBe(true);
    expect(applyTranslationImport(sections, legacy).report.hadLegacyIds).toBe(true);
  });

  it('does not flag a file using stable ref ids', async () => {
    const built = await build();
    expect(parseTranslationXliff(built!.xml).hasLegacyIds).toBe(false);
  });
});
