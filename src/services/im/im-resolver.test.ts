import { describe, it, expect } from 'vitest';
import { resolveManual } from './im-resolver';
import type { IMTemplate, IMSection, IMBlock } from '../../types';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

const baseTemplate: IMTemplate = {
  id: 'tmpl-1',
  categoryId: 'cat-1',
  templateType: 'im',
  name: 'Test Template',
  languages: ['en', 'de'],
  isFinalized: false,
  metadata: { pageSize: 'a4', primaryColor: '#000' },
};

const makeSection = (overrides: Partial<IMSection> & { id: string }): IMSection => ({
  templateId: 'tmpl-1',
  parentId: null,
  title: 'Section',
  order: 0,
  isPlaceholder: false,
  content: {},
  blockRefs: [],
  ...overrides,
});

const makeBlock = (overrides: Partial<IMBlock> & { id: string; slug: string }): IMBlock => ({
  title: 'Block',
  blockType: 'content',
  sourceLanguage: 'en',
  content: {},
  placeholders: [],
  applicableCategories: [],
  regulationRefs: [],
  approvalStatus: 'approved',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('resolveManual', () => {
  it('stamps the current schema version on the resolved artifact', () => {
    const section = makeSection({ id: 's0', content: { en: '<p>x</p>' } });
    const result = resolveManual(baseTemplate, [section], {}, null, 'en');
    expect(result.schemaVersion).toBe(2);
  });

  it('legacy fallback: section with empty blockRefs emits a single html node equal to content[language]', () => {
    const section = makeSection({
      id: 's1',
      content: { en: '<p>Hello world</p>', de: '<p>Hallo Welt</p>' },
      blockRefs: [],
    });

    const result = resolveManual(baseTemplate, [section], {}, null, 'en');

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].nodes).toHaveLength(1);
    const node = result.sections[0].nodes[0];
    expect(node.type).toBe('html');
    if (node.type === 'html') {
      expect(node.html).toBe('<p>Hello world</p>');
    }
    expect(result.warnings).toHaveLength(0);
  });

  it('inline ref: section with one inline blockRef emits html node with ref content', () => {
    const section = makeSection({
      id: 's2',
      content: {},
      blockRefs: [{ kind: 'inline', content: { en: '<p>Inline content</p>' } }],
    });

    const result = resolveManual(baseTemplate, [section], {}, null, 'en');

    expect(result.sections[0].nodes).toHaveLength(1);
    const node = result.sections[0].nodes[0];
    expect(node.type).toBe('html');
    if (node.type === 'html') {
      expect(node.html).toBe('<p>Inline content</p>');
    }
  });

  it('inline ref with a variant emits a callout node that wraps the whole row content', () => {
    const section = makeSection({
      id: 's2v',
      content: {},
      blockRefs: [{ kind: 'inline', variant: 'flammable', content: { en: '<p>Keep away from fire</p>' } }],
    });

    const result = resolveManual(baseTemplate, [section], {}, null, 'en');

    expect(result.sections[0].nodes).toHaveLength(1);
    const node = result.sections[0].nodes[0];
    expect(node.type).toBe('callout');
    if (node.type === 'callout') {
      expect(node.variant).toBe('flammable');
      expect(node.html).toBe('<p>Keep away from fire</p>');
    }
  });

  it('placeholder chip resolves by data-id, then falls back to data-attr-id', () => {
    const chip = (dataId: string, attrId?: string) =>
      `<span class="im-placeholder" contenteditable="false" data-type="text" data-id="${dataId}"${attrId ? ` data-attr-id="${attrId}"` : ''} data-label="Model%20Name">[Model Name]</span>`;

    // 1) data-id matches a value → substituted directly.
    const direct = makeSection({ id: 'sp1', blockRefs: [{ kind: 'inline', content: { en: `<p>${chip('attr-model')}</p>` } }] });
    const r1 = resolveManual(baseTemplate, [direct], {}, { id: 'p', templateId: 'tmpl-1', placeholderData: { 'attr-model': 'Beersafe XL' }, skuContent: {}, status: 'draft', updatedAt: 'x' }, 'en');
    expect((r1.sections[0].nodes[0] as any).html).toContain('Beersafe XL');

    // 2) data-id diverged (random), but data-attr-id binding still resolves the value.
    const viaAttr = makeSection({ id: 'sp2', blockRefs: [{ kind: 'inline', content: { en: `<p>${chip('rnd-xyz', 'attr-model')}</p>` } }] });
    const r2 = resolveManual(baseTemplate, [viaAttr], {}, { id: 'p', templateId: 'tmpl-1', placeholderData: { 'attr-model': 'Beersafe XL' }, skuContent: {}, status: 'draft', updatedAt: 'x' }, 'en');
    expect((r2.sections[0].nodes[0] as any).html).toContain('Beersafe XL');

    // 3) no value anywhere → falls back to the label.
    const r3 = resolveManual(baseTemplate, [viaAttr], {}, { id: 'p', templateId: 'tmpl-1', placeholderData: {}, skuContent: {}, status: 'draft', updatedAt: 'x' }, 'en');
    expect((r3.sections[0].nodes[0] as any).html).toContain('Model Name');
  });

  it('block ref present and approved: emits html node from blocksById', () => {
    const block = makeBlock({
      id: 'blk-1',
      slug: 'safety_electrical',
      content: { en: '<p>Electrical safety</p>' },
    });
    const section = makeSection({
      id: 's3',
      content: {},
      blockRefs: [{ kind: 'block', block_id: 'blk-1' }],
    });

    const result = resolveManual(baseTemplate, [section], { 'blk-1': block }, null, 'en');

    expect(result.sections[0].nodes).toHaveLength(1);
    const node = result.sections[0].nodes[0];
    expect(node.type).toBe('html');
    if (node.type === 'html') {
      expect(node.html).toBe('<p>Electrical safety</p>');
      expect(node.sourceBlock).toBe('safety_electrical');
    }
  });

  it('block ref with missing translation: falls back to en and adds a warning', () => {
    const block = makeBlock({
      id: 'blk-2',
      slug: 'info_block',
      content: { en: '<p>English only</p>' },
    });
    const section = makeSection({
      id: 's4',
      content: {},
      blockRefs: [{ kind: 'block', block_id: 'blk-2' }],
    });

    const result = resolveManual(baseTemplate, [section], { 'blk-2': block }, null, 'de');

    // Should still emit a node (en fallback)
    expect(result.sections[0].nodes).toHaveLength(1);
    // Should warn about missing translation
    expect(result.warnings.some(w => w.includes("'info_block'") && w.includes("'de'"))).toBe(true);
  });

  it('section-level condition excludes a section when the condition is not met', () => {
    const visibleSection = makeSection({
      id: 's5',
      title: 'Visible',
      order: 0,
      content: { en: '<p>Visible</p>' },
    });
    const hiddenSection = makeSection({
      id: 's6',
      title: 'Hidden',
      order: 1,
      content: { en: '<p>Should not appear</p>' },
      conditionFeatureId: 'attr-compressor',
      conditionLabel: 'true',
    });

    // placeholderData does not include attr-compressor → section should be excluded
    const result = resolveManual(baseTemplate, [visibleSection, hiddenSection], {}, null, 'en');

    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].id).toBe('s5');
  });

  it('token substitution replaces {{ token }} in html body', () => {
    const section = makeSection({
      id: 's7',
      content: { en: '<p>Model: {{model_name}}</p>' },
      blockRefs: [],
    });

    const projectIM = {
      id: 'proj-1',
      templateId: 'tmpl-1',
      placeholderData: { model_name: 'Beersafe XL' },
      skuContent: {},
      status: 'draft' as const,
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const result = resolveManual(baseTemplate, [section], {}, projectIM, 'en');

    const node = result.sections[0].nodes[0];
    expect(node.type).toBe('html');
    if (node.type === 'html') {
      expect(node.html).toBe('<p>Model: Beersafe XL</p>');
    }
  });

  it('conditional inline ref: hidden when its required feature is absent, shown when present', () => {
    const makeCondSection = () => makeSection({
      id: 's-inline-cond',
      content: {},
      blockRefs: [{ kind: 'inline', content: { en: '<p>Only for compressor models</p>' }, requires_feature: 'attr-compressor' }],
    });

    // No data → condition not met → inline row hidden entirely
    const hidden = resolveManual(baseTemplate, [makeCondSection()], {}, null, 'en');
    expect(hidden.sections[0].nodes).toHaveLength(0);

    // Feature present → inline row shown
    const projectIM = {
      id: 'p', templateId: 'tmpl-1',
      placeholderData: { 'attr-compressor': 'yes' },
      skuContent: {}, status: 'draft' as const, updatedAt: '2026-01-01T00:00:00Z',
    };
    const shown = resolveManual(baseTemplate, [makeCondSection()], {}, projectIM, 'en');
    expect(shown.sections[0].nodes).toHaveLength(1);
    expect(shown.sections[0].nodes[0].type).toBe('html');
  });

  it('per-ref override: Include forces a failing condition to show; Exclude hides a passing one', () => {
    // Inline ref at index 0 of section 's-ovr', condition requires attr-compressor.
    const makeOvrSection = () => makeSection({
      id: 's-ovr',
      content: {},
      blockRefs: [{ kind: 'inline', content: { en: '<p>Compressor-only note</p>' }, requires_feature: 'attr-compressor' }],
    });
    const mkProj = (data: Record<string, string>) => ({
      id: 'p', templateId: 'tmpl-1', placeholderData: data,
      skuContent: {}, status: 'draft' as const, updatedAt: '2026-01-01T00:00:00Z',
    });

    // Condition fails (no attr value) but Include override (bare key 's-ovr:0' = 'true') forces it on.
    const forcedOn = resolveManual(baseTemplate, [makeOvrSection()], {}, mkProj({ 's-ovr:0': 'true' }), 'en');
    expect(forcedOn.sections[0].nodes).toHaveLength(1);

    // Condition passes but Exclude override forces it off.
    const forcedOff = resolveManual(baseTemplate, [makeOvrSection()], {}, mkProj({ 'attr-compressor': 'yes', 's-ovr:0': 'false' }), 'en');
    expect(forcedOff.sections[0].nodes).toHaveLength(0);
  });

  it('requires_feature: block excluded when attribute value absent from placeholderData', () => {
    const block = makeBlock({ id: 'blk-cond', slug: 'compressor_block', content: { en: '<p>Compressor info</p>' } });
    const section = makeSection({
      id: 's9',
      content: {},
      blockRefs: [{ kind: 'block', block_id: 'blk-cond', requires_feature: 'attr-compressor' }],
    });

    // No placeholderData → requires_feature is falsy → block excluded
    const result = resolveManual(baseTemplate, [section], { 'blk-cond': block }, null, 'en');
    expect(result.sections[0].nodes).toHaveLength(0);
  });

  it('requires_feature: block included when attribute value present in placeholderData', () => {
    const block = makeBlock({ id: 'blk-cond2', slug: 'compressor_block2', content: { en: '<p>Compressor info</p>' } });
    const section = makeSection({
      id: 's10',
      content: {},
      blockRefs: [{ kind: 'block', block_id: 'blk-cond2', requires_feature: 'attr-compressor' }],
    });

    const projectIM = {
      id: 'proj-2', templateId: 'tmpl-1',
      placeholderData: { 'attr-compressor': 'yes' }, // attribute has a value
      skuContent: {}, status: 'draft' as const, updatedAt: '2026-01-01T00:00:00Z',
    };
    const result = resolveManual(baseTemplate, [section], { 'blk-cond2': block }, projectIM, 'en');
    expect(result.sections[0].nodes).toHaveLength(1);
    expect(result.sections[0].nodes[0].type).toBe('html');
  });

  it('requires_feature_absent: block included when attribute absent, excluded when present', () => {
    const block = makeBlock({ id: 'blk-absent', slug: 'no_compressor_block', content: { en: '<p>No compressor</p>' } });
    const section = makeSection({
      id: 's11',
      content: {},
      blockRefs: [{ kind: 'block', block_id: 'blk-absent', requires_feature_absent: 'attr-compressor' }],
    });

    // No value → feature absent → block included
    const noVal = resolveManual(baseTemplate, [section], { 'blk-absent': block }, null, 'en');
    expect(noVal.sections[0].nodes).toHaveLength(1);

    // Value present → feature NOT absent → block excluded
    const withVal = resolveManual(baseTemplate, [section], { 'blk-absent': block }, {
      id: 'p', templateId: 'tmpl-1', placeholderData: { 'attr-compressor': 'yes' },
      skuContent: {}, status: 'draft', updatedAt: '',
    }, 'en');
    expect(withVal.sections[0].nodes).toHaveLength(0);
  });

  it('requires_feature_label: block excluded when value not in expected enum list', () => {
    const block = makeBlock({ id: 'blk-enum', slug: 'enum_block', content: { en: '<p>Rotary/Piston info</p>' } });
    const section = makeSection({
      id: 's13', content: {},
      blockRefs: [{ kind: 'block', block_id: 'blk-enum', requires_feature: 'attr-comp-type', requires_feature_label: 'Rotary, Piston' }],
    });

    // Value "Scroll" not in expected list → excluded
    const excluded = resolveManual(baseTemplate, [section], { 'blk-enum': block }, {
      id: 'p4', templateId: 'tmpl-1', placeholderData: { 'attr-comp-type': 'Scroll' },
      skuContent: {}, status: 'draft', updatedAt: '',
    }, 'en');
    expect(excluded.sections[0].nodes).toHaveLength(0);

    // Value "Rotary" in expected list → included
    const included = resolveManual(baseTemplate, [section], { 'blk-enum': block }, {
      id: 'p5', templateId: 'tmpl-1', placeholderData: { 'attr-comp-type': 'Rotary' },
      skuContent: {}, status: 'draft', updatedAt: '',
    }, 'en');
    expect(included.sections[0].nodes).toHaveLength(1);
  });

  it('requires_feature_num_min/max: block excluded when value out of range', () => {
    const block = makeBlock({ id: 'blk-num', slug: 'range_block', content: { en: '<p>High power</p>' } });
    const section = makeSection({
      id: 's14', content: {},
      blockRefs: [{ kind: 'block', block_id: 'blk-num', requires_feature: 'attr-power', requires_feature_num_min: '1000', requires_feature_num_max: '3000' }],
    });

    const mkProj = (power: string) => ({
      id: 'px', templateId: 'tmpl-1', placeholderData: { 'attr-power': power },
      skuContent: {} as Record<string, never>, status: 'draft' as const, updatedAt: '',
    });

    expect(resolveManual(baseTemplate, [section], { 'blk-num': block }, mkProj('500'), 'en').sections[0].nodes).toHaveLength(0);  // below min
    expect(resolveManual(baseTemplate, [section], { 'blk-num': block }, mkProj('4000'), 'en').sections[0].nodes).toHaveLength(0); // above max
    expect(resolveManual(baseTemplate, [section], { 'blk-num': block }, mkProj('2000'), 'en').sections[0].nodes).toHaveLength(1); // in range
    expect(resolveManual(baseTemplate, [section], { 'blk-num': block }, mkProj('text'), 'en').sections[0].nodes).toHaveLength(0); // non-numeric excluded
  });

  it('{{token}} in block content is substituted from placeholderData', () => {
    const block = makeBlock({ id: 'blk-tok', slug: 'token_block', content: { en: '<p>Model: {{attr-model}}</p>' } });
    const section = makeSection({ id: 's12', content: {}, blockRefs: [{ kind: 'block', block_id: 'blk-tok' }] });
    const projectIM = {
      id: 'p3', templateId: 'tmpl-1',
      placeholderData: { 'attr-model': 'Beersafe XL' },
      skuContent: {}, status: 'draft' as const, updatedAt: '',
    };
    const result = resolveManual(baseTemplate, [section], { 'blk-tok': block }, projectIM, 'en');
    const node = result.sections[0].nodes[0];
    expect(node.type).toBe('html');
    if (node.type === 'html') expect(node.html).toBe('<p>Model: Beersafe XL</p>');
  });

  it('image placeholder chip renders bound image as <img> from placeholderData', () => {
    const imgUrl = 'https://example.com/im-assets/sku/front.jpg';
    const section = makeSection({
      id: 's-img',
      content: {
        en: '<p>Control panel: <span class="im-placeholder" data-type="image" data-id="attr-front" data-attr-id="attr-front" data-label="Front">[Front]</span></p>',
      },
      blockRefs: [],
    });

    const projectIM = {
      id: 'p-img', templateId: 'tmpl-1',
      placeholderData: { 'attr-front': imgUrl },
      skuContent: {}, status: 'draft' as const, updatedAt: '',
    };

    const result = resolveManual(baseTemplate, [section], {}, projectIM, 'en');
    const node = result.sections[0].nodes[0];
    expect(node.type).toBe('html');
    if (node.type === 'html') {
      expect(node.html).toContain(`<img src="${imgUrl}"`);
      expect(node.html).toContain('alt="Front"');
      expect(node.html).not.toContain('im-placeholder');
    }
  });

  it('unfilled image placeholder chip renders nothing', () => {
    const section = makeSection({
      id: 's-img2',
      content: {
        en: '<p>Photo:<span class="im-placeholder" data-type="image" data-id="attr-side" data-label="Side">[Side]</span></p>',
      },
      blockRefs: [],
    });

    // No placeholderData for attr-side
    const result = resolveManual(baseTemplate, [section], {}, null, 'en');
    const node = result.sections[0].nodes[0];
    expect(node.type).toBe('html');
    if (node.type === 'html') {
      expect(node.html).toBe('<p>Photo:</p>');
    }
  });

  it('text placeholder chip still resolves to value or label (backward compatible)', () => {
    const section = makeSection({
      id: 's-txt',
      content: {
        en: '<p><span class="im-placeholder" data-type="text" data-id="attr-model" data-label="Model">[Model]</span></p>',
      },
      blockRefs: [],
    });

    const withVal = resolveManual(baseTemplate, [section], {}, {
      id: 'pt', templateId: 'tmpl-1', placeholderData: { 'attr-model': 'XL-9000' },
      skuContent: {}, status: 'draft', updatedAt: '',
    }, 'en');
    const n1 = withVal.sections[0].nodes[0];
    if (n1.type === 'html') expect(n1.html).toBe('<p>XL-9000</p>');

    // No value → falls back to label
    const noVal = resolveManual(baseTemplate, [section], {}, null, 'en');
    const n2 = noVal.sections[0].nodes[0];
    if (n2.type === 'html') expect(n2.html).toBe('<p>Model</p>');
  });

  // -------------------------------------------------------------------------
  // Project-only content additions (sectionAdditions + extraSections)
  // -------------------------------------------------------------------------

  const mkProjectIM = (overrides: any = {}) => ({
    id: 'proj-add', templateId: 'tmpl-1',
    placeholderData: {}, skuContent: {}, status: 'draft' as const, updatedAt: '',
    ...overrides,
  });

  it('section addition at position 0 is emitted before the template blocks', () => {
    const section = makeSection({
      id: 'sa1',
      blockRefs: [
        { kind: 'inline', content: { en: '<p>Template A</p>' } },
        { kind: 'inline', content: { en: '<p>Template B</p>' } },
      ],
    });
    const projectIM = mkProjectIM({
      sectionAdditions: {
        sa1: [{ id: 'add-1', position: 0, block: { kind: 'inline', content: { en: '<p>Project first</p>' } } }],
      },
    });

    const result = resolveManual(baseTemplate, [section], {}, projectIM, 'en');
    const htmls = result.sections[0].nodes.map(n => (n as any).html);
    expect(htmls).toEqual(['<p>Project first</p>', '<p>Template A</p>', '<p>Template B</p>']);
  });

  it('section addition mid-section is interleaved between the right template blocks', () => {
    const section = makeSection({
      id: 'sa2',
      blockRefs: [
        { kind: 'inline', content: { en: '<p>Template A</p>' } },
        { kind: 'inline', content: { en: '<p>Template B</p>' } },
      ],
    });
    const projectIM = mkProjectIM({
      sectionAdditions: {
        sa2: [{ id: 'add-2', position: 1, block: { kind: 'inline', content: { en: '<p>Between</p>' } } }],
      },
    });

    const result = resolveManual(baseTemplate, [section], {}, projectIM, 'en');
    const htmls = result.sections[0].nodes.map(n => (n as any).html);
    expect(htmls).toEqual(['<p>Template A</p>', '<p>Between</p>', '<p>Template B</p>']);
  });

  it('section addition at (or past) the end is appended after the template blocks', () => {
    const section = makeSection({
      id: 'sa3',
      blockRefs: [{ kind: 'inline', content: { en: '<p>Template A</p>' } }],
    });
    const projectIM = mkProjectIM({
      sectionAdditions: {
        // position 5 is past the end (1 ref) → clamped to the end
        sa3: [{ id: 'add-3', position: 5, block: { kind: 'inline', content: { en: '<p>Project last</p>' } } }],
      },
    });

    const result = resolveManual(baseTemplate, [section], {}, projectIM, 'en');
    const htmls = result.sections[0].nodes.map(n => (n as any).html);
    expect(htmls).toEqual(['<p>Template A</p>', '<p>Project last</p>']);
  });

  it('section addition with a callout variant emits a callout node', () => {
    const section = makeSection({ id: 'sa4', blockRefs: [] });
    const projectIM = mkProjectIM({
      sectionAdditions: {
        sa4: [{ id: 'add-4', position: 0, block: { kind: 'inline', variant: 'warning', content: { en: '<p>Be careful</p>' } } }],
      },
    });

    const result = resolveManual(baseTemplate, [section], {}, projectIM, 'en');
    const node = result.sections[0].nodes[0];
    expect(node.type).toBe('callout');
    if (node.type === 'callout') {
      expect(node.variant).toBe('warning');
      expect(node.html).toBe('<p>Be careful</p>');
    }
  });

  it('section addition resolves placeholders/tokens from placeholderData', () => {
    const section = makeSection({ id: 'sa5', blockRefs: [] });
    const projectIM = mkProjectIM({
      placeholderData: { 'attr-model': 'Beersafe XL' },
      sectionAdditions: {
        sa5: [{ id: 'add-5', position: 0, block: { kind: 'inline', content: { en: '<p>Model: {{attr-model}}</p>' } } }],
      },
    });

    const result = resolveManual(baseTemplate, [section], {}, projectIM, 'en');
    expect((result.sections[0].nodes[0] as any).html).toBe('<p>Model: Beersafe XL</p>');
  });

  it('extraSection renders as a new section under its template parent, ordered among siblings', () => {
    const parent = makeSection({ id: 'p-sec', title: 'Parent', order: 0, content: { en: '<p>Parent body</p>' } });
    const childA = makeSection({ id: 'c-a', parentId: 'p-sec', title: 'Child A', order: 0, content: { en: '<p>A</p>' } });
    const childC = makeSection({ id: 'c-c', parentId: 'p-sec', title: 'Child C', order: 20, content: { en: '<p>C</p>' } });

    const projectIM = mkProjectIM({
      extraSections: [
        {
          id: 'proj-extra-1',
          parentId: 'p-sec',
          title: 'Project Child B',
          order: 10, // between childA (0) and childC (20)
          blocks: [{ kind: 'inline', content: { en: '<p>Project-only body</p>' } }],
        },
      ],
    });

    const result = resolveManual(baseTemplate, [parent, childA, childC], {}, projectIM, 'en');

    const ids = result.sections.map(s => s.id);
    expect(ids).toEqual(['p-sec', 'c-a', 'proj-extra-1', 'c-c']);
    const extra = result.sections.find(s => s.id === 'proj-extra-1')!;
    expect(extra.title).toBe('Project Child B');
    expect(extra.parentId).toBe('p-sec');
    expect((extra.nodes[0] as any).html).toBe('<p>Project-only body</p>');
  });

  it('sectionOverride replaces a placeholder section\'s template content for the project', () => {
    const section = makeSection({
      id: 'ph1',
      isPlaceholder: true,
      content: { en: '<p>Template placeholder prose</p>' },
      blockRefs: [],
    });
    const projectIM = mkProjectIM({
      sectionOverrides: {
        ph1: [{ kind: 'inline', content: { en: '<p>Project-authored content</p>' } }],
      },
    });

    const result = resolveManual(baseTemplate, [section], {}, projectIM, 'en');
    const htmls = result.sections[0].nodes.map(n => (n as any).html);
    expect(htmls).toEqual(['<p>Project-authored content</p>']);
    // Template content must not leak through when overridden.
    expect(htmls.join('')).not.toContain('Template placeholder prose');
  });

  it('an empty sectionOverride renders nothing (no fallback to template content)', () => {
    const section = makeSection({
      id: 'ph2',
      isPlaceholder: true,
      content: { en: '<p>Template prose</p>' },
      blockRefs: [],
    });
    const projectIM = mkProjectIM({ sectionOverrides: { ph2: [] } });

    const result = resolveManual(baseTemplate, [section], {}, projectIM, 'en');
    expect(result.sections[0].nodes).toHaveLength(0);
  });

  it('resolves the section title for the target language, falling back to the base title', () => {
    const section = makeSection({
      id: 'st1',
      title: 'Operation',
      titleI18n: { de: 'Betrieb' },
      content: { en: '<p>x</p>', de: '<p>x</p>' },
    });

    expect(resolveManual(baseTemplate, [section], {}, null, 'de').sections[0].title).toBe('Betrieb');
    // No French translation → falls back to the base title.
    expect(resolveManual(baseTemplate, [section], {}, null, 'fr').sections[0].title).toBe('Operation');
  });

  it('callout block type emits a callout node with correct variant', () => {
    const block = makeBlock({
      id: 'blk-3',
      slug: 'warning_general',
      blockType: 'warning',
      content: { en: '<p>Warning text</p>' },
    });
    const section = makeSection({
      id: 's8',
      content: {},
      blockRefs: [{ kind: 'block', block_id: 'blk-3' }],
    });

    const result = resolveManual(baseTemplate, [section], { 'blk-3': block }, null, 'en');

    const node = result.sections[0].nodes[0];
    expect(node.type).toBe('callout');
    if (node.type === 'callout') {
      expect(node.variant).toBe('warning');
      expect(node.sourceBlock).toBe('warning_general');
    }
  });
});

// ---------------------------------------------------------------------------
// Per-chapter SKU scope (SKU-specific chapter variants)
// ---------------------------------------------------------------------------

describe('resolveManual — per-chapter SKU scope', () => {
  const skus = [
    { id: 'sku-a', skuNumber: '10035294' },
    { id: 'sku-b', skuNumber: '10035295' },
    { id: 'sku-c', skuNumber: '10035296' },
  ];
  const mkIM = (overrides: any = {}) => ({
    id: 'proj-sku', templateId: 'tmpl-1',
    placeholderData: {}, skuContent: {}, status: 'draft' as const, updatedAt: '',
    boundSkuIds: ['sku-a', 'sku-b'],
    ...overrides,
  });

  it('no scope for a section → no skuScope header', () => {
    const section = makeSection({ id: 'ns', content: { en: '<p>x</p>' } });
    const result = resolveManual(baseTemplate, [section], {}, mkIM(), 'en', skus);
    expect(result.sections[0].skuScope).toBeUndefined();
  });

  it('scoped to bound SKUs → skuScope holds those SKU numbers', () => {
    const section = makeSection({ id: 'sc', content: { en: '<p>x</p>' } });
    const result = resolveManual(
      baseTemplate, [section], {},
      mkIM({ sectionSkus: { sc: ['sku-a'] } }), 'en', skus,
    );
    expect(result.sections[0].skuScope).toEqual(['10035294']);
  });

  it('scope intersects bound SKUs only (unbound ids dropped from the header)', () => {
    const section = makeSection({ id: 'sc2', content: { en: '<p>x</p>' } });
    const result = resolveManual(
      baseTemplate, [section], {},
      mkIM({ sectionSkus: { sc2: ['sku-a', 'sku-c'] } }), 'en', skus,
    );
    // sku-c is not bound → only sku-a's number appears.
    expect(result.sections[0].skuScope).toEqual(['10035294']);
  });

  it('section scoped only to unbound SKUs is hidden', () => {
    const kept = makeSection({ id: 'keep', order: 0, content: { en: '<p>keep</p>' } });
    const hidden = makeSection({ id: 'hide', order: 1, content: { en: '<p>hide</p>' } });
    const result = resolveManual(
      baseTemplate, [kept, hidden], {},
      mkIM({ sectionSkus: { hide: ['sku-c'] } }), 'en', skus,
    );
    expect(result.sections.map(s => s.id)).toEqual(['keep']);
  });

  it('empty binding treats all project SKUs as bound', () => {
    const section = makeSection({ id: 'sc3', content: { en: '<p>x</p>' } });
    const result = resolveManual(
      baseTemplate, [section], {},
      mkIM({ boundSkuIds: [], sectionSkus: { sc3: ['sku-c'] } }), 'en', skus,
    );
    expect(result.sections[0].skuScope).toEqual(['10035296']);
  });
});
