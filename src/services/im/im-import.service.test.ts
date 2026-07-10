import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// Avoid pulling the Supabase client (and DOM-only sanitizeHtml) into this
// node-env unit test — validateImImport itself uses none of them.
let uuidSeq = 0;
vi.mock('./im-template.service', () => ({
  createIMTemplate: vi.fn(),
  updateIMTemplate: vi.fn(),
  getOrCreateBlankTemplate: vi.fn(),
}));
vi.mock('./im-section.service', () => ({ saveIMSection: vi.fn() }));
vi.mock('./project-im.service', () => ({ saveProjectIM: vi.fn() }));
vi.mock('../../utils', () => ({ sanitizeHtml: (s: string) => s, generateUUID: () => `uuid${++uuidSeq}00000000` }));

import { validateImImport, importIMTemplate, buildExtraSectionsFromDoc, importProjectIMFromDoc } from './im-import.service';
import { createIMTemplate, getOrCreateBlankTemplate } from './im-template.service';
import { saveIMSection } from './im-section.service';
import { saveProjectIM } from './project-im.service';

const exampleDoc = () =>
  JSON.parse(readFileSync(join(__dirname, '../../../docs/im-import/example.import.json'), 'utf8'));

describe('validateImImport', () => {
  it('accepts the shipped coffee-machine example', () => {
    const res = validateImImport(exampleDoc());
    expect(res.errors).toEqual([]);
    expect(res.doc).toBeDefined();
    expect(res.doc!.sections.length).toBe(9);
  });

  it('accepts a JSON string as well as an object', () => {
    const res = validateImImport(readFileSync(join(__dirname, '../../../docs/im-import/example.import.json'), 'utf8'));
    expect(res.errors).toEqual([]);
  });

  it('reports invalid JSON rather than throwing', () => {
    const res = validateImImport('{ not json ');
    expect(res.errors[0]).toMatch(/Not valid JSON/);
    expect(res.doc).toBeUndefined();
  });

  it('requires importSchemaVersion === 1 and a valid kind', () => {
    const d = exampleDoc(); d.importSchemaVersion = 2; d.kind = 'booklet';
    const res = validateImImport(d);
    expect(res.errors.some(e => /importSchemaVersion/.test(e))).toBe(true);
    expect(res.errors.some(e => /kind/.test(e))).toBe(true);
  });

  it('rejects a sourceLanguage that is not in languages', () => {
    const d = exampleDoc(); d.sourceLanguage = 'fr';
    expect(validateImImport(d).errors.some(e => /sourceLanguage must be one of/.test(e))).toBe(true);
  });

  it('rejects duplicate section keys', () => {
    const d = exampleDoc(); d.sections[1].key = d.sections[0].key;
    expect(validateImImport(d).errors.some(e => /duplicated/.test(e))).toBe(true);
  });

  it('rejects an unresolved parentKey', () => {
    const d = exampleDoc(); d.sections[0].parentKey = 'does-not-exist';
    expect(validateImImport(d).errors.some(e => /does not match any section key/.test(e))).toBe(true);
  });

  it('detects a multi-node parentKey cycle (would otherwise silently drop sections)', () => {
    const d = exampleDoc();
    d.sections[0].parentKey = d.sections[1].key;
    d.sections[1].parentKey = d.sections[0].key;
    expect(validateImImport(d).errors.some(e => /cycle/.test(e))).toBe(true);
  });

  it('rejects a callout block with a bad variant', () => {
    const d = exampleDoc();
    const s = d.sections.find((x: any) => x.blocks.some((b: any) => b.type === 'callout'));
    s.blocks.find((b: any) => b.type === 'callout').variant = 'danger';
    expect(validateImImport(d).errors.some(e => /variant must be one of/.test(e))).toBe(true);
  });

  it('rejects an image block missing imageNeed.description', () => {
    const d = exampleDoc();
    const s = d.sections.find((x: any) => x.blocks.some((b: any) => b.type === 'image'));
    delete s.blocks.find((b: any) => b.type === 'image').imageNeed;
    expect(validateImImport(d).errors.some(e => /imageNeed\.description/.test(e))).toBe(true);
  });

  it('rejects an empty title map (isLangMap must be non-empty)', () => {
    const d = exampleDoc(); d.sections[0].title = {};
    expect(validateImImport(d).errors.some(e => /title must be/.test(e))).toBe(true);
  });

  it('warns about undeclared content languages without failing', () => {
    const d = exampleDoc();
    const s = d.sections.find((x: any) => x.blocks.some((b: any) => b.type === 'paragraph'));
    const b = s.blocks.find((b: any) => b.type === 'paragraph');
    b.content.fr = '<p>bonjour</p>';
    const res = validateImImport(d);
    expect(res.errors).toEqual([]);
    expect(res.warnings.some(w => /undeclared language "fr"/.test(w))).toBe(true);
  });

  it('accepts valid scope values on sections and blocks', () => {
    const d = exampleDoc();
    d.sections[0].scope = 'generic';
    d.sections[0].blocks[0].scope = 'model-specific';
    expect(validateImImport(d).errors).toEqual([]);
  });

  it('rejects an invalid scope', () => {
    const d = exampleDoc(); d.sections[0].scope = 'per-region';
    expect(validateImImport(d).errors.some(e => /scope must be one of/.test(e))).toBe(true);
  });
});

describe('importIMTemplate — scope → placeholder mapping', () => {
  it('flags model-specific sections/blocks/images as placeholders and leaves generic auto-included', async () => {
    vi.mocked(createIMTemplate).mockResolvedValue({
      id: 't1', categoryId: 'cat', templateType: 'im', name: 'T', languages: ['en'], isFinalized: false, metadata: {} as any,
    } as any);
    const saved: any[] = [];
    vi.mocked(saveIMSection).mockImplementation(async (s: any) => {
      const row = { ...s, id: `sec-${saved.length}` };
      saved.push(row);
      return row;
    });

    const doc: any = {
      importSchemaVersion: 1, kind: 'im', category: 'Coffee Machines',
      product: { name: 'X' }, languages: ['en'], sourceLanguage: 'en',
      sections: [
        { key: 'safety', order: 1, title: { en: 'Safety' }, scope: 'generic',
          blocks: [
            { type: 'paragraph', content: { en: '<p>generic</p>' } },
            { type: 'paragraph', content: { en: '<p>this model only</p>' }, scope: 'model-specific' },
            { type: 'image', imageNeed: { description: 'front view' }, content: { en: '' } },
          ] },
        { key: 'specs', order: 2, title: { en: 'Specs' }, scope: 'model-specific',
          blocks: [{ type: 'table', content: { en: '<table class="im-table"></table>' }, scope: 'model-specific' }] },
      ],
    };

    const res = await importIMTemplate(doc, 'cat', 'Coffee Machines Manual Template');

    const safety = saved.find(s => s.title === 'Safety');
    const specs = saved.find(s => s.title === 'Specs');
    // generic section, model-specific section
    expect(safety.isPlaceholder).toBe(false);
    expect(specs.isPlaceholder).toBe(true);
    // block-level flags
    expect(safety.blockRefs[0].isPlaceholder).toBeUndefined();          // generic paragraph → auto-included
    expect(safety.blockRefs[1].isPlaceholder).toBe(true);              // model-specific paragraph
    expect(safety.blockRefs[2].isPlaceholder).toBe(true);             // image always placeholder
    expect(safety.blockRefs[2].variant).toBe('info');
    // counts: 1 model-specific block + 1 model-specific section + (1 model-specific block in specs) = 3
    expect(res.modelSpecificCount).toBe(3);
    expect(res.imageNeedCount).toBe(1);
    expect(res.sectionCount).toBe(2);
  });
});

describe('importIMTemplate — grouping / normalization', () => {
  beforeEach(() => {
    vi.mocked(createIMTemplate).mockResolvedValue({
      id: 't1', categoryId: 'cat', templateType: 'im', name: 'T', languages: ['en'], isFinalized: false, metadata: {} as any,
    } as any);
  });

  const runOneSection = async (blocks: any[]) => {
    const saved: any[] = [];
    vi.mocked(saveIMSection).mockImplementation(async (s: any) => {
      const row = { ...s, id: `sec-${saved.length}` }; saved.push(row); return row;
    });
    const doc: any = {
      importSchemaVersion: 1, kind: 'im', category: 'C', product: { name: 'X' },
      languages: ['en'], sourceLanguage: 'en',
      sections: [{ key: 'body', order: 1, title: { en: 'Body' }, blocks }],
    };
    await importIMTemplate(doc, 'cat', 'T');
    return saved[0].blockRefs as any[];
  };

  it('merges consecutive plain paragraph blocks into a single grouped ref', async () => {
    const refs = await runOneSection([
      { type: 'paragraph', content: { en: '<p>Sentence one.</p>' } },
      { type: 'paragraph', content: { en: '<p>Sentence two.</p>' } },
      { type: 'paragraph', content: { en: '<p>Sentence three.</p>' } },
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0].content.en).toBe('<p>Sentence one.</p><p>Sentence two.</p><p>Sentence three.</p>');
  });

  it('groups a sub-heading with its following paragraphs and table into one ref', async () => {
    const refs = await runOneSection([
      { type: 'heading', level: 3, content: { en: '<h3>General safety</h3>' } },
      { type: 'paragraph', content: { en: '<p>Rule one.</p>' }, note: 'from draft' },
      { type: 'paragraph', content: { en: '<p>Rule two.</p>' } },
      { type: 'table', content: { en: '<table class="im-table"></table>' } },
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0].content.en).toBe('<h3>General safety</h3><p>Rule one.</p><p>Rule two.</p><table class="im-table"></table>');
  });

  it('does not merge across a callout or a scope boundary', async () => {
    const refs = await runOneSection([
      { type: 'paragraph', content: { en: '<p>a</p>' } },
      { type: 'callout', variant: 'warning', content: { en: '<p>be careful</p>' } },
      { type: 'paragraph', content: { en: '<p>b</p>' } },
      { type: 'paragraph', content: { en: '<p>c</p>' }, scope: 'model-specific' },
    ]);
    // a | callout | b | c(model-specific) — the callout and the scope change both break the run
    expect(refs).toHaveLength(4);
    expect(refs[3].isPlaceholder).toBe(true);
  });

  it('wraps bare/inline text so it is not stored as raw legacy HTML', async () => {
    const refs = await runOneSection([
      { type: 'paragraph', content: { en: 'Just a bare sentence.' } },
    ]);
    expect(refs[0].content.en).toBe('<p>Just a bare sentence.</p>');
  });
});

describe('buildExtraSectionsFromDoc (project-based import)', () => {
  const doc: any = {
    importSchemaVersion: 1, kind: 'im', category: 'C', product: { name: 'X' },
    languages: ['en'], sourceLanguage: 'en',
    sections: [
      { key: 'safety', order: 1, title: { en: 'Safety' },
        blocks: [
          { type: 'paragraph', content: { en: '<p>one</p>' } },
          { type: 'paragraph', content: { en: '<p>two</p>' } },
          { type: 'paragraph', content: { en: '<p>model only</p>' }, scope: 'model-specific' },
          { type: 'image', imageNeed: { description: 'front view' }, content: { en: '' } },
        ] },
      { key: 'controls', parentKey: 'safety', order: 2, title: { en: 'Controls' },
        blocks: [{ type: 'paragraph', content: { en: '<p>panel</p>' } }] },
    ],
  };

  it('produces proj- ids, resolves parent nesting, and keeps order', () => {
    const secs = buildExtraSectionsFromDoc(doc, { placeholderModelSpecific: false });
    expect(secs).toHaveLength(2);
    expect(secs.every(s => s.id.startsWith('proj-'))).toBe(true);
    const safety = secs.find(s => s.title === 'Safety')!;
    const controls = secs.find(s => s.title === 'Controls')!;
    expect(safety.parentId).toBeNull();
    expect(controls.parentId).toBe(safety.id);
    expect(safety.order).toBe(1);
  });

  it('renders model-specific content normally (NOT placeholder) but keeps images as placeholders', () => {
    const secs = buildExtraSectionsFromDoc(doc, { placeholderModelSpecific: false });
    const safety = secs.find(s => s.title === 'Safety')!;
    const blocks = safety.blocks as any[]; // all inline in this fixture
    // two generic paragraphs merge → 1 ref; model-specific paragraph → separate; image → separate
    expect(blocks).toHaveLength(3);
    expect(blocks[0].content.en).toBe('<p>one</p><p>two</p>');        // coalesced
    expect(blocks[1].isPlaceholder).toBeUndefined();                  // model-specific shows normally
    expect(blocks[2].isPlaceholder).toBe(true);                       // image stays a placeholder
    expect(blocks[2].variant).toBe('info');
  });
});

describe('importProjectIMFromDoc', () => {
  it('binds to the blank template and saves all content as extraSections (draft)', async () => {
    vi.mocked(getOrCreateBlankTemplate).mockResolvedValue({ id: 'blank1', name: 'Blank' } as any);
    vi.mocked(saveProjectIM).mockResolvedValue({} as any);
    const doc: any = {
      importSchemaVersion: 1, kind: 'im', category: 'C',
      product: { name: 'DryFy' }, languages: ['en', 'de'], sourceLanguage: 'en',
      cover: { title: { en: 'DryFy Manual' } },
      sections: [{ key: 's', order: 1, title: { en: 'S' }, blocks: [{ type: 'paragraph', content: { en: '<p>x</p>' } }] }],
    };
    const res = await importProjectIMFromDoc('proj-123', doc, 'im');
    expect(res.sectionCount).toBe(1);
    expect(getOrCreateBlankTemplate).toHaveBeenCalledWith('im');
    const args = vi.mocked(saveProjectIM).mock.calls[0];
    expect(args[0]).toBe('proj-123');                  // projectId
    expect(args[1]).toBe('blank1');                    // templateId = blank template
    expect(args[2].__cover_title).toBe('DryFy Manual');
    expect(args[2].__required_languages).toBe('["en","de"]');
    expect(args[3]).toBe('draft');                     // status
    expect(Array.isArray(args[7])).toBe(true);         // extraSections positional arg
    expect(args[7]).toHaveLength(1);
  });
});
