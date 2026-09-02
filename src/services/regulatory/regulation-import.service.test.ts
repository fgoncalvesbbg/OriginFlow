import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  findExistingRegulation,
  planRegulationImport,
  toRegulationInput,
  validateRegulationImport,
  type RegulationImportDoc,
} from './regulation-import.service';
import type { CategoryL3, Regulation } from '../../types';

const doc = (over: Partial<RegulationImportDoc> = {}): any => ({
  importSchemaVersion: 1,
  regulation: {
    referenceCode: 'Directive 2014/35/EU',
    title: 'Low Voltage Directive',
    sourceUrl: 'https://eur-lex.europa.eu/x',
    tcfDescription: 'LVD test report and certificate.',
    ...(over.regulation ?? {}),
  },
  summaryMd: '# LVD\n\nArticle 6 …',
  clauses: [{ number: 'Annex III', kind: 'annex' }],
  obligations: [{ clause: 'Annex III', text: 'Keep the technical documentation', carriers: ['Product'] }],
  ...Object.fromEntries(Object.entries(over).filter(([k]) => k !== 'regulation')),
});

const regulation = (over: Partial<Regulation> = {}): Regulation => ({
  id: 'reg-1',
  title: 'Low Voltage Directive',
  referenceCode: 'Directive 2014/35/EU',
  summaryBytes: 0,
  applicableCategories: [],
  status: 'active',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...over,
});

const categories: CategoryL3[] = [
  { id: 'cat-hob', name: 'Induction Hobs', active: true, isFinalized: false },
  { id: 'cat-cooler', name: 'Beverage Coolers', active: true, isFinalized: false },
];

describe('validateRegulationImport — shape', () => {
  it('accepts a well-formed document', () => {
    const v = validateRegulationImport(doc());
    expect(v.errors).toEqual([]);
    expect(v.doc).toBeDefined();
  });

  it('parses a JSON string as well as an object', () => {
    expect(validateRegulationImport(JSON.stringify(doc())).errors).toEqual([]);
  });

  it('reports invalid JSON as one clear error', () => {
    expect(validateRegulationImport('{ not json').errors[0]).toMatch(/Not valid JSON/);
  });

  it('requires the schema version, reference code and title', () => {
    const v = validateRegulationImport({ importSchemaVersion: 2, regulation: {} });
    expect(v.errors).toContain('importSchemaVersion must be 1.');
    expect(v.errors).toContain('regulation.referenceCode (string) is required.');
    expect(v.errors).toContain('regulation.title (string) is required.');
  });

  it('reports every problem at once rather than the first', () => {
    // A researcher fixing one error per model round-trip is a slow, expensive loop.
    const v = validateRegulationImport({ importSchemaVersion: 1, regulation: {} });
    expect(v.errors.length).toBeGreaterThan(1);
  });

  it('rejects a non-ISO date', () => {
    const v = validateRegulationImport(doc({ regulation: { issuedAt: '01/03/2021' } as any }));
    expect(v.errors.some(e => e.includes('regulation.issuedAt'))).toBe(true);
  });

  it('rejects an implausible edition year', () => {
    const v = validateRegulationImport(doc({ regulation: { editionYear: 21 } as any }));
    expect(v.errors.some(e => e.includes('editionYear'))).toBe(true);
  });
});

describe('validateRegulationImport — the safety rules', () => {
  it('REFUSES an unknown carrier instead of dropping it', () => {
    // Coercing "im " to "IM" would be invisible in a diff, and getting it wrong decides
    // whether the obligation ever reaches a manual's checklist.
    const v = validateRegulationImport(doc({
      obligations: [{ clause: 'Annex III', text: 'x', carriers: ['im ', 'Website'] }],
    } as any));
    expect(v.errors.some(e => e.includes('obligations[0].carriers'))).toBe(true);
    expect(v.doc).toBeUndefined();
  });

  it('REFUSES an obligation citing a clause the document never defines', () => {
    // A dangling citation is the signature of an invented clause number.
    const v = validateRegulationImport(doc({
      obligations: [{ clause: '7.99.99', text: 'x' }],
    } as any));
    expect(v.errors.some(e => e.includes('is not defined in clauses[]'))).toBe(true);
  });

  it('REFUSES verbatim wording that was not quoted from a source', () => {
    // This is the text a translation must preserve byte-for-byte. Wording a model composed
    // rather than copied is worse than no wording at all.
    const v = validateRegulationImport(doc({
      obligations: [{ clause: 'Annex III', text: 'x', verbatim: '"WARNING: do not…"' }],
    } as any));
    expect(v.errors.some(e => e.includes('sourceQuoted'))).toBe(true);
  });

  it('accepts verbatim wording marked as quoted', () => {
    const v = validateRegulationImport(doc({
      obligations: [{
        clause: 'Annex III', text: 'x', verbatim: '"WARNING: do not…"', sourceQuoted: true,
      }],
    } as any));
    expect(v.errors).toEqual([]);
  });

  it('rejects an oversized summaryMd with a sentence, not a constraint error', () => {
    const v = validateRegulationImport(doc({ summaryMd: 'x'.repeat(400_001) }));
    expect(v.errors.some(e => /the limit is/.test(e))).toBe(true);
  });

  it('rejects a duplicated clause number', () => {
    const v = validateRegulationImport(doc({
      clauses: [{ number: '7.12' }, { number: ' 7.12 ' }],
    } as any));
    expect(v.errors.some(e => e.includes('is duplicated'))).toBe(true);
  });

  it('validates TCF requirement enums and clause references', () => {
    const v = validateRegulationImport(doc({
      tcfRequirements: [{
        title: 'Report', description: 'd', timingType: 'WHENEVER',
        testReportOrigin: 'guesswork', clause: 'Annex IX',
      }],
    } as any));
    expect(v.errors.some(e => e.includes('timingType'))).toBe(true);
    expect(v.errors.some(e => e.includes('testReportOrigin'))).toBe(true);
    expect(v.errors.some(e => e.includes('is not defined in clauses[]'))).toBe(true);
  });
});

describe('validateRegulationImport — warnings that do not block', () => {
  it('warns when there is no summaryMd, because a check would then be refused', () => {
    const d = doc();
    delete d.summaryMd;
    const v = validateRegulationImport(d);
    expect(v.errors).toEqual([]);
    expect(v.warnings.some(w => /check against this regulation will be refused/.test(w))).toBe(true);
  });

  it('warns when nothing can be checked against the original', () => {
    const d = doc();
    delete d.regulation.sourceUrl;
    expect(validateRegulationImport(d).warnings.some(w => /sourceUrl/.test(w))).toBe(true);
  });

  it('surfaces the researcher\'s own unverified list', () => {
    const v = validateRegulationImport(doc({
      research: { unverified: ['Clause 7.13 wording could not be confirmed'] },
    } as any));
    expect(v.warnings.some(w => /could not verify/.test(w))).toBe(true);
  });

  it('warns about an obligation with no clause but still accepts it', () => {
    const v = validateRegulationImport(doc({
      obligations: [{ text: 'Something with no citation' }],
    } as any));
    expect(v.errors).toEqual([]);
    expect(v.warnings.some(w => /no clause/.test(w))).toBe(true);
  });
});

describe('the shipped example document', () => {
  it('validates clean, so the doc can never drift from the schema', () => {
    // docs/regulation-import/example.import.json is what a researcher copies as a model.
    // An example that does not itself pass validation teaches the wrong shape.
    const example = JSON.parse(
      readFileSync(resolve(__dirname, '../../../docs/regulation-import/example.import.json'), 'utf8'),
    );
    const v = validateRegulationImport(example);
    expect(v.errors).toEqual([]);
    expect(v.doc).toBeDefined();
  });

  it('exercises the fields the validator is strictest about', () => {
    const example = JSON.parse(
      readFileSync(resolve(__dirname, '../../../docs/regulation-import/example.import.json'), 'utf8'),
    );
    // A verbatim with its sourceQuoted flag, an optionalCarriers entry, and a TCF
    // requirement citing a clause — the three shapes most likely to be got wrong.
    expect(example.obligations.some((o: any) => o.verbatim && o.sourceQuoted === true)).toBe(true);
    expect(example.obligations.some((o: any) => o.optionalCarriers?.length)).toBe(true);
    expect(example.tcfRequirements.some((r: any) => r.clause)).toBe(true);
    expect(example.research.unverified.length).toBeGreaterThan(0);
  });
});

describe('planRegulationImport', () => {
  it('plans a create when nothing matches', () => {
    const plan = planRegulationImport(validateRegulationImport(doc()).doc!, [], categories);
    expect(plan.action).toBe('create');
    expect(plan.newClauses).toEqual(['Annex III']);
    expect(plan.newObligations).toBe(1);
  });

  it('matches an existing regulation case- and whitespace-insensitively', () => {
    // Mirrors uq_regulations_reference_code, so a re-import updates rather than failing.
    const existing = regulation({ referenceCode: '  directive 2014/35/eu ' });
    expect(findExistingRegulation(validateRegulationImport(doc()).doc!, [existing])?.id).toBe('reg-1');
  });

  it('lists field-level changes for the preview, ignoring fields the document omits', () => {
    const existing = regulation({ title: 'Old title', version: 'Ed. 1' });
    const plan = planRegulationImport(validateRegulationImport(doc()).doc!, [existing], categories);
    expect(plan.action).toBe('update');
    expect(plan.fieldChanges.map(c => c.field)).toContain('title');
    // The document has no `version`, so an existing one must not show as a change to ''.
    expect(plan.fieldChanges.map(c => c.field)).not.toContain('version');
  });

  it('counts obligations that already exist rather than planning duplicates', () => {
    const existing = regulation({
      clauses: [{
        id: 'cl-1', regulationId: 'reg-1', number: 'Annex III', kind: 'annex',
        sortKey: '~annex iii', createdAt: '', updatedAt: '',
      }],
      obligations: [{
        id: 'ob-1', regulationId: 'reg-1', clauseId: 'cl-1',
        text: 'Keep the technical documentation', carriers: [], optionalCarriers: [],
        sortOrder: 0, createdAt: '', updatedAt: '',
      }],
    });
    const plan = planRegulationImport(validateRegulationImport(doc()).doc!, [existing], categories);
    expect(plan.newObligations).toBe(0);
    expect(plan.existingObligations).toBe(1);
    expect(plan.updatedClauses).toEqual(['Annex III']);
    expect(plan.newClauses).toEqual([]);
  });

  it('resolves category names and reports the ones it could not match', () => {
    const d = validateRegulationImport(doc({
      regulation: { applicableCategoryNames: ['Induction Hobs', 'Toasters'] } as any,
    })).doc!;
    const plan = planRegulationImport(d, [], categories);
    expect(plan.matchedCategoryIds).toEqual(['cat-hob']);
    expect(plan.unmatchedCategories).toEqual(['Toasters']);
  });

  it('flags that applying would expire the regulation', () => {
    const d = validateRegulationImport(doc({ regulation: { status: 'expired' } as any })).doc!;
    expect(planRegulationImport(d, [regulation()], categories).wouldExpire).toBe(true);
  });
});

describe('toRegulationInput', () => {
  const expiredDoc = () => validateRegulationImport(doc({
    regulation: { status: 'expired', expiredAt: '2024-07-17', expiredReason: 'repealed' } as any,
  })).doc!;

  it('DROPS an expiry the caller has not confirmed', () => {
    // A paste must not be able to stop every manual citing the regulation.
    const d = expiredDoc();
    const plan = planRegulationImport(d, [regulation()], categories);
    expect(toRegulationInput(d, plan, false).status).toBeUndefined();
  });

  it('applies the expiry once confirmed', () => {
    const d = expiredDoc();
    const plan = planRegulationImport(d, [regulation()], categories);
    const input = toRegulationInput(d, plan, true);
    expect(input.status).toBe('expired');
    expect(input.expiredAt).toBe('2024-07-17');
  });

  it('MERGES categories rather than replacing them', () => {
    // An import must not silently un-apply a regulation from a category somebody ticked.
    const existing = regulation({ applicableCategories: ['cat-cooler'] });
    const d = validateRegulationImport(doc({
      regulation: { applicableCategoryNames: ['Induction Hobs'] } as any,
    })).doc!;
    const plan = planRegulationImport(d, [existing], categories);
    expect(toRegulationInput(d, plan, false).applicableCategories.sort())
      .toEqual(['cat-cooler', 'cat-hob']);
  });

  it('passes the summary through with a filename so provenance is recorded', () => {
    const d = validateRegulationImport(doc()).doc!;
    const input = toRegulationInput(d, planRegulationImport(d, [], categories), false);
    expect(input.summaryMd).toContain('# LVD');
    expect(input.summaryFileName).toBe('summary.md');
  });
});
