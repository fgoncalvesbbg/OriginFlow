/**
 * Template-wide find & replace.
 *
 * A renamed standard or corrected term otherwise means opening every section ×
 * every language and eyeballing. This module scans a template's sections
 * (inline-row HTML per language, section titles per language, and — read-only —
 * the shared blocks they reference) and applies replacements CHIP-SAFELY:
 * placeholder/condition chips and <img> tags are frozen to opaque tokens
 * (im-chip-freeze) and ordinary markup is segmented out, so replacement only
 * ever touches prose. A match can therefore never corrupt a chip, an attribute,
 * or a tag — the flip side is that a phrase spanning a tag boundary
 * ("foo</p><p>bar") is deliberately NOT matched.
 *
 * Pure string/data functions — the UI (IMTemplateEditor) owns state and saving.
 */

import { freeze, thaw } from './im-chip-freeze';
import type { IMSection, IMBlock, InlineBlockRef } from '../../types';

/** Tags and frozen-chip tokens — the segments replacement must never touch. */
const SEG_RE = /(<[^>]*>|\{\{FRZ_\d+\}\})/g;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const queryRe = (query: string, caseSensitive: boolean): RegExp =>
  new RegExp(escapeRe(query), caseSensitive ? 'g' : 'gi');

/** Occurrences of `query` in the PROSE of `html` (chips, tags, frozen regions excluded). */
export const countInHtml = (html: string, query: string, caseSensitive: boolean): number => {
  if (!query) return 0;
  const { text } = freeze(html);
  let count = 0;
  text.split(SEG_RE).forEach((seg, i) => {
    if (i % 2 === 1) return;
    count += (seg.match(queryRe(query, caseSensitive)) ?? []).length;
  });
  return count;
};

/** Replace `query` in the PROSE of `html`. Chips/<img>/tags are untouchable by construction. */
export const replaceInHtml = (
  html: string,
  query: string,
  replacement: string,
  caseSensitive: boolean,
): { html: string; replaced: number } => {
  if (!query) return { html, replaced: 0 };
  const { text, frozen } = freeze(html);
  let replaced = 0;
  const out = text.split(SEG_RE).map((seg, i) => {
    if (i % 2 === 1) return seg;
    return seg.replace(queryRe(query, caseSensitive), () => { replaced++; return replacement; });
  }).join('');
  return { html: thaw(out, frozen), replaced };
};

/** ±35 chars of stripped-text context around the first match, for the results list. */
const snippetOf = (html: string, query: string, caseSensitive: boolean): string => {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
  const idx = caseSensitive ? text.indexOf(query) : text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, 70);
  const start = Math.max(0, idx - 35);
  const end = Math.min(text.length, idx + query.length + 35);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
};

export type FindTarget =
  | { kind: 'inline'; refIndex: number }
  | { kind: 'title' }
  | { kind: 'block'; blockId: string; blockTitle: string };

export interface FindReplaceMatch {
  sectionId: string;
  sectionTitle: string;
  /** Language code the match is in (lowercase). */
  language: string;
  target: FindTarget;
  count: number;
  snippet: string;
  /** Shared-block matches are informational — those are edited in the Block Library. */
  replaceable: boolean;
}

/** Stable row key for selection sets. */
export const matchKey = (m: FindReplaceMatch): string =>
  `${m.sectionId}|${m.language}|${m.target.kind}|${'refIndex' in m.target ? m.target.refIndex : 'blockId' in m.target ? m.target.blockId : ''}`;

/** Section title in one language, mirroring localizedSectionTitle's en preference. */
const titleIn = (s: IMSection, lang: string): string =>
  lang === 'en' ? (s.titleI18n?.en ?? s.title ?? '') : (s.titleI18n?.[lang] ?? '');

/**
 * Every match of `query` across the template: inline-row HTML and section
 * titles (replaceable), plus the shared blocks sections reference (read-only —
 * one row per block × language, deduped across sections via the first section
 * seen using it).
 */
export const findInTemplate = (
  sections: IMSection[],
  blocksById: Record<string, IMBlock>,
  languages: string[],
  query: string,
  caseSensitive: boolean,
): FindReplaceMatch[] => {
  const out: FindReplaceMatch[] = [];
  if (!query.trim()) return out;
  const seenBlocks = new Set<string>();

  for (const s of sections) {
    const sectionTitle = titleIn(s, 'en') || s.title || 'Untitled section';

    for (const lang of languages) {
      // Titles — plain strings, no chips to protect.
      const title = titleIn(s, lang);
      const titleCount = (title.match(queryRe(query, caseSensitive)) ?? []).length;
      if (titleCount > 0) {
        out.push({
          sectionId: s.id, sectionTitle, language: lang,
          target: { kind: 'title' }, count: titleCount, snippet: title, replaceable: true,
        });
      }

      (s.blockRefs ?? []).forEach((ref, refIndex) => {
        if (ref.kind === 'inline') {
          const html = (ref as InlineBlockRef).content?.[lang] ?? '';
          const count = countInHtml(html, query, caseSensitive);
          if (count > 0) {
            out.push({
              sectionId: s.id, sectionTitle, language: lang,
              target: { kind: 'inline', refIndex }, count,
              snippet: snippetOf(html, query, caseSensitive), replaceable: true,
            });
          }
        } else if (ref.kind === 'block') {
          const blockId = (ref as { block_id: string }).block_id;
          const dedupeKey = `${blockId}|${lang}`;
          if (seenBlocks.has(dedupeKey)) return;
          const blk = blocksById[blockId];
          const html = blk?.content?.[lang] ?? '';
          const count = countInHtml(html, query, caseSensitive);
          if (count > 0) {
            seenBlocks.add(dedupeKey);
            out.push({
              sectionId: s.id, sectionTitle, language: lang,
              target: { kind: 'block', blockId, blockTitle: blk?.title ?? 'Unknown block' },
              count, snippet: snippetOf(html, query, caseSensitive), replaceable: false,
            });
          }
        }
      });
    }
  }
  return out;
};

/**
 * Apply the replacement to the SELECTED replaceable matches, returning new
 * section objects (untouched sections are returned by reference, so the
 * caller's dirty-diffing only sees what actually changed).
 */
export const applyReplacements = (
  sections: IMSection[],
  selected: FindReplaceMatch[],
  query: string,
  replacement: string,
  caseSensitive: boolean,
): { sections: IMSection[]; replaced: number } => {
  let replaced = 0;
  const bySection = new Map<string, FindReplaceMatch[]>();
  for (const m of selected) {
    if (!m.replaceable) continue;
    if (!bySection.has(m.sectionId)) bySection.set(m.sectionId, []);
    bySection.get(m.sectionId)!.push(m);
  }

  const next = sections.map((s) => {
    const ms = bySection.get(s.id);
    if (!ms?.length) return s;
    let sec: IMSection = { ...s, blockRefs: (s.blockRefs ?? []).map((r) => ({ ...r })) };
    for (const m of ms) {
      if (m.target.kind === 'title') {
        const re = queryRe(query, caseSensitive);
        const current = titleIn(sec, m.language);
        const nextTitle = current.replace(re, () => { replaced++; return replacement; });
        // English edits BOTH the base title and titleI18n.en, mirroring the editor's
        // title field — writing only one would desync what actually renders.
        sec = {
          ...sec,
          ...(m.language === 'en' ? { title: nextTitle } : {}),
          titleI18n: { ...(sec.titleI18n ?? {}), [m.language]: nextTitle },
        };
      } else if (m.target.kind === 'inline') {
        const ref = sec.blockRefs?.[m.target.refIndex];
        if (!ref || ref.kind !== 'inline') continue;
        const html = (ref as InlineBlockRef).content?.[m.language] ?? '';
        const r = replaceInHtml(html, query, replacement, caseSensitive);
        replaced += r.replaced;
        (sec.blockRefs![m.target.refIndex] as InlineBlockRef) = {
          ...(ref as InlineBlockRef),
          content: { ...(ref as InlineBlockRef).content, [m.language]: r.html },
        };
      }
    }
    return sec;
  });
  return { sections: next, replaced };
};
