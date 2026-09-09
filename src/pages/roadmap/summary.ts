/**
 * Roadmap Creator — the plain-text change summary.
 *
 * The digest of everything a planner has marked on one board. Pure string building so it can be
 * asserted on directly in a test; the download itself is the caller's problem.
 *
 * Note what the last section does: delisted SKUs get their own block that says WHY they are still
 * listed ("kept because they still carry roadmap notes or history"). The summary is often the
 * artefact that leaves the room, so the guarantee has to be legible in it too — otherwise a
 * reader sees a SKU that is not in the current file and assumes the report is stale.
 */
import { ITEM_FLAGS } from './roadmap.constants';
import type {
  RoadmapAxisValue,
  RoadmapFlag,
  RoadmapItemFlag,
  RoadmapPlacer,
  RoadmapSku,
} from '../../types';

const FLAG_HEADINGS: Record<RoadmapFlag, string> = {
  replace: 'REPLACEMENTS',
  eol: 'END OF LIFE (EOL)',
  aeol: 'ALREADY EOL',
  upcoming: 'UPCOMING (existing SKUs)',
};

const FLAG_ORDER = ITEM_FLAGS.map(f => f.key);

export interface BuildSummaryInput {
  category?: string;
  skus?: readonly RoadmapSku[];
  flags?: readonly RoadmapItemFlag[];
  placers?: readonly RoadmapPlacer[];
  axisValues?: readonly RoadmapAxisValue[];
  /** Injectable so the output is deterministic in tests. */
  generatedAt?: string | null;
}

export function buildSummary({
  category,
  skus = [],
  flags = [],
  placers = [],
  axisValues = [],
  generatedAt = null,
}: BuildSummaryInput = {}): string {
  const lines: string[] = [];
  const bySku = new Map(skus.map(s => [s.sku, s]));

  const grouped = Object.fromEntries(FLAG_ORDER.map(k => [k, [] as RoadmapItemFlag[]])) as Record<
    RoadmapFlag,
    RoadmapItemFlag[]
  >;
  for (const f of flags) {
    if (!f.flag || !grouped[f.flag]) continue;
    if (!bySku.has(f.sku)) continue;
    grouped[f.flag].push(f);
  }

  const newPlacers = placers.filter(p => p.type === 'new');
  const upcPlacers = placers.filter(p => p.type === 'upcoming');

  lines.push('KLARSTEIN ROADMAP — CHANGE SUMMARY');
  lines.push(`Category: ${category || '(none)'}`);
  lines.push(`Generated: ${generatedAt || new Date().toLocaleString()}`);
  lines.push(
    `Totals: ${newPlacers.length} new-item spot(s), ${upcPlacers.length} upcoming spot(s), ` +
      `${grouped.replace.length} replacement(s), ${grouped.eol.length} EOL, ` +
      `${grouped.aeol.length} already-EOL, ${grouped.upcoming.length} upcoming SKU(s).`,
  );
  lines.push('');
  lines.push('='.repeat(60));
  lines.push('');

  let any = false;

  for (const key of FLAG_ORDER) {
    const list = grouped[key];
    if (!list.length) continue;
    any = true;
    lines.push(`${FLAG_HEADINGS[key]} (${list.length})`);
    lines.push('-'.repeat(40));
    list
      .map(f => ({ f, s: bySku.get(f.sku) as RoadmapSku }))
      .sort(
        (a, b) =>
          (a.s.family || '').localeCompare(b.s.family || '') || a.s.sku.localeCompare(b.s.sku),
      )
      .forEach(({ f, s }) => {
        const stale = s.isCurrent === false ? '  [not in latest file]' : '';
        lines.push(
          `  • ${s.sku} — ${s.description || '(no description)'}` +
            (s.family ? `  [${s.family}]` : '') +
            stale +
            (f.comment ? `\n      note: ${f.comment}` : '') +
            (f.updatedBy ? `\n      by: ${f.updatedBy}` : ''),
        );
      });
    lines.push('');
  }

  const dumpPlacers = (list: readonly RoadmapPlacer[], title: string): void => {
    if (!list.length) return;
    any = true;
    lines.push(`${title} (${list.length})`);
    lines.push('-'.repeat(40));
    [...list]
      .sort((a, b) =>
        `${a.family} / ${a.yValue} / ${a.xValue}`.localeCompare(
          `${b.family} / ${b.yValue} / ${b.xValue}`,
        ),
      )
      .forEach(p => {
        lines.push(
          `  • ${p.family} / ${p.yValue} / ${p.xValue}   (axes: ${p.yField} × ${p.xField})` +
            (p.comment ? `\n      note: ${p.comment}` : '') +
            (p.updatedBy ? `\n      by: ${p.updatedBy}` : ''),
        );
      });
    lines.push('');
  };
  dumpPlacers(newPlacers, 'NEW ITEMS TO LAUNCH (flagged spots)');
  dumpPlacers(upcPlacers, 'UPCOMING ITEMS (flagged spots)');

  const dumpAxis = (kind: RoadmapAxisValue['kind'], title: string): void => {
    const list = axisValues.filter(a => a.kind === kind);
    if (!list.length) return;
    any = true;
    lines.push(`${title} (${list.length})`);
    lines.push('-'.repeat(40));
    list.forEach(a => lines.push(`  • ${a.value}${a.field ? `  (${a.field})` : ''}`));
    lines.push('');
  };
  dumpAxis('family', 'ADDED FAMILIES');
  dumpAxis('row', 'ADDED ROWS');
  dumpAxis('col', 'ADDED COLUMNS');

  const delisted = skus.filter(s => s.isCurrent === false);
  if (delisted.length) {
    any = true;
    lines.push(`NOT IN LATEST FILE (${delisted.length})`);
    lines.push('-'.repeat(40));
    lines.push('  These SKUs are kept because they still carry roadmap notes or history.');
    delisted
      .slice()
      .sort((a, b) => a.sku.localeCompare(b.sku))
      .forEach(s => lines.push(`  • ${s.sku} — ${s.description || '(no description)'}`));
    lines.push('');
  }

  if (!any) lines.push('(No flags or changes recorded for this category.)');

  return lines.join('\n');
}
