/**
 * Serialize an IM template into the compact English document the AI regulatory
 * check audits, and split it into invocation-sized chunks.
 *
 * WHY THIS IS NOT `exportTemplateForReview` (src/services/im/im-import.service.ts).
 * That function is right for its own job — giving a section-matching reviewer enough
 * to classify a supplier draft — and wrong for a compliance audit on four counts,
 * every one of which manufactures a FALSE "requirement is missing" finding, which is
 * the failure mode that destroys trust in this feature fastest:
 *
 *   1. It truncates each section to 800 characters, so a requirement satisfied 900
 *      characters in reads as absent.
 *   2. It joins all of a section's blocks into one string, so a finding can never
 *      point at the block that is actually wrong.
 *   3. It takes `Object.keys(ref.content)[0]` — whichever language key PostgREST
 *      happened to return first, not English.
 *   4. It flattens a shared block to the literal string "[shared standardized
 *      block]" — precisely the approved safety text a regulation check must read.
 *
 * So this is a separate module and `exportTemplateForReview` is left untouched
 * (importSupplierDraftIntoProject depends on its exact shape).
 *
 * Pure string/array code — no port import, no `db`, no fetch — so it is cheap to
 * test exhaustively and runs identically in the browser and in Node.
 */

import type { BlockRef, IMBlock, IMSection, IMTemplate, IMTemplateType } from '../../types';

export type RegCheckBlockKind = 'inline' | 'block' | 'sku_slot';

export interface RegCheckBlock {
  /** `BlockRef.id`, or `${sectionId}#${index}` for legacy refs that predate id backfill. */
  refId: string;
  kind: RegCheckBlockKind;
  /** Callout variant (inline ref) or `im_blocks.block_type` (shared ref). */
  variant?: string;
  /** `im_blocks.id` for a shared ref, so a finding can name the library block. */
  blockId?: string;
  blockSlug?: string;
  /** English plain text. Tags stripped, list/table structure preserved, {{chips}} kept. */
  text: string;
  /** Gated on a product feature — renders only for some products. */
  conditional?: boolean;
  /** Opt-in per project (an inline placeholder row) — may legitimately be absent. */
  optional?: boolean;
  /** Text was cut at REG_CHECK_BLOCK_CHAR_CAP. */
  truncated?: boolean;
}

export interface RegCheckSection {
  /** The real `im_sections.id` — the model echoes this back as a finding anchor. */
  sectionId: string;
  parentSectionId: string | null;
  /** Human-readable outline number, e.g. "3.2". For the report UI, never for lookup. */
  path: string;
  title: string;
  blocks: RegCheckBlock[];
}

export interface RegCheckDocument {
  templateId: string;
  templateType: IMTemplateType;
  templateName: string;
  categoryId: string;
  /** Always 'en'. The check runs on the source language only, by design. */
  language: 'en';
  sections: RegCheckSection[];
  totalChars: number;
  truncatedBlocks: number;
}

/** Per-block text cap. A block longer than this is legacy dumped HTML, not prose. */
export const REG_CHECK_BLOCK_CHAR_CAP = 4000;

/**
 * Character budget per model call. Sized against the ~26 s Netlify synchronous
 * ceiling with a 40 kB regulation summary also in the prompt — this and
 * `ai_prompts.max_tokens` are the two tuning knobs if runs start coming back partial.
 */
export const REG_CHECK_CHUNK_CHARS = 18_000;

/** The language the check reads. Pinned, never "whichever key came first". */
const SOURCE_LANG = 'en';

/**
 * HTML -> plain text, PRESERVING BLOCK STRUCTURE.
 *
 * Not `stripHtmlPreview`: rating-plate and energy-label requirements are table rows,
 * and collapsing a table into one run-on line is exactly how you get a hallucinated
 * "the required data table is missing". So closing block tags become newlines and
 * cell boundaries become " | " BEFORE tags are stripped.
 *
 * `{{placeholder}}` chips are left verbatim — the prompt tells the model what they
 * are. Stripping them would read as a missing value.
 */
export const htmlToStructuredText = (html: string): string => {
  if (!html) return '';
  return html
    // Cell boundaries first, so a stray </td></tr> still yields "a | b" then a break.
    .replace(/<\/(?:td|th)\s*>/gi, ' | ')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|blockquote|section|table|thead|tbody|ul|ol)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    // Collapse runs of spaces/tabs per line, then collapse blank-line runs.
    .split('\n')
    .map((line) => line
      .replace(/[ \t]+/g, ' ')
      .replace(/\s+\|\s+/g, ' | ')
      // The last cell of a row leaves a dangling separator (its </td> became " | "
      // before </tr> became a newline). Drop it — a trailing pipe would otherwise
      // read as an empty final column.
      .replace(/\s*\|\s*$/, '')
      .trim())
    .filter((line, i, all) => line !== '' || (i > 0 && all[i - 1] !== ''))
    .join('\n')
    .trim();
};

/** True when any feature-condition field on a ref is set. */
const isConditional = (ref: any): boolean =>
  Boolean(
    ref?.requires_feature ||
    ref?.requires_feature_absent ||
    ref?.requires_feature_label ||
    ref?.requires_feature_num_min ||
    ref?.requires_feature_num_max,
  );

const cap = (text: string): { text: string; truncated: boolean } =>
  text.length > REG_CHECK_BLOCK_CHAR_CAP
    ? { text: `${text.slice(0, REG_CHECK_BLOCK_CHAR_CAP)}…`, truncated: true }
    : { text, truncated: false };

/**
 * Outline numbers ("1", "1.2", "1.2.1") for a section tree, keyed by section id.
 * Siblings are ordered by `order` then title, so the numbering a reviewer sees
 * matches the editor. Sections whose parent is missing from the set are treated as
 * roots rather than dropped — a corrupt parent link must not hide content from a
 * compliance audit.
 */
const buildPaths = (sections: IMSection[]): Map<string, string> => {
  const ids = new Set(sections.map((s) => s.id));
  const byParent = new Map<string, IMSection[]>();
  for (const s of sections) {
    const parent = s.parentId && ids.has(s.parentId) ? s.parentId : '__root__';
    const list = byParent.get(parent) ?? [];
    list.push(s);
    byParent.set(parent, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title));
  }
  const paths = new Map<string, string>();
  const walk = (parentKey: string, prefix: string) => {
    const children = byParent.get(parentKey) ?? [];
    children.forEach((child, i) => {
      const path = prefix ? `${prefix}.${i + 1}` : String(i + 1);
      // A cycle in parent links would recurse forever; a section can only be numbered once.
      if (paths.has(child.id)) return;
      paths.set(child.id, path);
      walk(child.id, path);
    });
  };
  walk('__root__', '');
  // Anything a cycle kept out of the walk still gets a stable, obviously-odd path.
  sections.forEach((s, i) => {
    if (!paths.has(s.id)) paths.set(s.id, `?${i + 1}`);
  });
  return paths;
};

/** Depth-first section order matching the outline paths, so chunks read in document order. */
const outlineOrder = (sections: IMSection[], paths: Map<string, string>): IMSection[] => {
  const key = (id: string) =>
    (paths.get(id) ?? '').split('.').map((part) => part.padStart(6, '0')).join('.');
  return [...sections].sort((a, b) => key(a.id).localeCompare(key(b.id)));
};

const serializeBlock = (
  ref: BlockRef,
  sectionId: string,
  index: number,
  blocksById: Map<string, IMBlock>,
): RegCheckBlock | null => {
  const refId = (ref as { id?: string }).id || `${sectionId}#${index}`;

  if (ref.kind === 'inline') {
    const { text, truncated } = cap(htmlToStructuredText(ref.content?.[SOURCE_LANG] ?? ''));
    if (!text) return null;
    return {
      refId,
      kind: 'inline',
      ...(ref.variant ? { variant: ref.variant } : {}),
      text,
      ...(isConditional(ref) ? { conditional: true } : {}),
      ...(ref.isPlaceholder ? { optional: true } : {}),
      ...(truncated ? { truncated: true } : {}),
    };
  }

  if (ref.kind === 'block') {
    // Resolve the shared library block: this text IS the approved safety wording a
    // regulation check exists to read. A missing block row is reported as such rather
    // than silently omitted, so the model does not judge a gap that isn't one.
    const block = blocksById.get(ref.block_id);
    const raw = block?.content?.[SOURCE_LANG] ?? '';
    const { text, truncated } = cap(htmlToStructuredText(raw));
    return {
      refId,
      kind: 'block',
      blockId: ref.block_id,
      ...(block?.slug ? { blockSlug: block.slug } : {}),
      ...(block?.blockType ? { variant: block.blockType } : {}),
      text: text || `[shared block ${block?.slug ?? ref.block_id} has no English content]`,
      ...(isConditional(ref) ? { conditional: true } : {}),
      ...(truncated ? { truncated: true } : {}),
    };
  }

  // A typed SKU slot is filled per product at generation time. Its label is all the
  // template carries, and prompt rule 4 tells the model such values are absent by design.
  const label = ref.label?.[SOURCE_LANG] || Object.values(ref.label ?? {})[0] || ref.slot;
  return {
    refId,
    kind: 'sku_slot',
    text: `[per-product ${ref.schema} slot: ${label}]`,
    ...(ref.required ? {} : { optional: true }),
  };
};

/**
 * Build the English audit document for a template.
 *
 * `blocks` need only contain the shared blocks actually referenced (the loader in
 * regulatory-check.service.ts passes the whole library, which is small).
 */
export const serializeTemplateForRegCheck = (
  template: Pick<IMTemplate, 'id' | 'templateType' | 'name' | 'categoryId'>,
  sections: IMSection[],
  blocks: IMBlock[],
): RegCheckDocument => {
  const blocksById = new Map(blocks.map((b) => [b.id, b]));
  const paths = buildPaths(sections);

  let truncatedBlocks = 0;
  let totalChars = 0;

  const serialized: RegCheckSection[] = outlineOrder(sections, paths).map((s) => {
    const refs = s.blockRefs ?? [];
    let out: RegCheckBlock[] = refs
      .map((ref, i) => serializeBlock(ref, s.id, i, blocksById))
      .filter((b): b is RegCheckBlock => b !== null);

    // Legacy sections predate block_refs and keep their HTML in `content` — the same
    // fallback the resolver honours. Without it, an old template audits as empty.
    if (!out.length) {
      const { text, truncated } = cap(htmlToStructuredText(s.content?.[SOURCE_LANG] ?? ''));
      if (text) {
        out = [{
          refId: `${s.id}#legacy`,
          kind: 'inline',
          text,
          ...(truncated ? { truncated: true } : {}),
        }];
      }
    }

    out.forEach((b) => {
      if (b.truncated) truncatedBlocks++;
      totalChars += b.text.length;
    });
    totalChars += s.title.length;

    return {
      sectionId: s.id,
      parentSectionId: s.parentId ?? null,
      path: paths.get(s.id) ?? '',
      title: s.title,
      blocks: out,
    };
  });

  return {
    templateId: template.id,
    templateType: template.templateType,
    templateName: template.name,
    categoryId: template.categoryId,
    language: SOURCE_LANG,
    sections: serialized,
    totalChars,
    truncatedBlocks,
  };
};

const sectionChars = (s: RegCheckSection): number =>
  s.title.length + s.blocks.reduce((n, b) => n + b.text.length, 0);

/**
 * Split a document into chunks of WHOLE sections, each under REG_CHECK_CHUNK_CHARS.
 *
 * Whole sections, always: a section split across two calls lets each half report the
 * other half's content as missing. A single section over the budget becomes its own
 * oversized chunk rather than being cut — one slow call beats a fabricated finding.
 * An empty document yields one empty chunk, so callers never special-case zero.
 */
export const chunkRegCheckDocument = (doc: RegCheckDocument): RegCheckDocument[] => {
  const chunks: RegCheckDocument[] = [];
  let current: RegCheckSection[] = [];
  let size = 0;

  const flush = () => {
    if (!current.length) return;
    chunks.push({ ...doc, sections: current, totalChars: size, truncatedBlocks: 0 });
    current = [];
    size = 0;
  };

  for (const section of doc.sections) {
    const n = sectionChars(section);
    if (current.length && size + n > REG_CHECK_CHUNK_CHARS) flush();
    current.push(section);
    size += n;
    // An over-budget single section is its own chunk — never split.
    if (n > REG_CHECK_CHUNK_CHARS) flush();
  }
  flush();

  if (!chunks.length) chunks.push({ ...doc, sections: [], totalChars: 0, truncatedBlocks: 0 });
  // truncatedBlocks is a whole-document statistic; only the first chunk carries it so
  // summing across chunks does not double-count.
  chunks[0].truncatedBlocks = doc.truncatedBlocks;
  return chunks;
};
