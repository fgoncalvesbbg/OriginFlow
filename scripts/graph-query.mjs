#!/usr/bin/env node
/**
 * Targeted queries against graphify-out/graph.json.
 *
 * The graph is ~4.7MB of JSON and GRAPH_REPORT.md is ~9k tokens. Reading either
 * one whole to answer "what touches this file?" wastes most of what it costs.
 * This prints the slice you asked for, capped, and nothing else.
 *
 *   node scripts/graph-query.mjs help
 */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'graphify-out');
const GRAPH = resolve(OUT, 'graph.json');
const LABELS = resolve(OUT, '.graphify_labels.json');

const DEFAULT_LIMIT = 25;

// ---------------------------------------------------------------- arg parsing

const argv = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--limit' || a === '-n') flags.limit = Number(argv[++i]);
  else if (a === '--all') flags.all = true;
  else if (a === '--write') flags.write = true;
  else args.push(a);
}
const LIMIT = flags.all ? Infinity : (Number.isFinite(flags.limit) ? flags.limit : DEFAULT_LIMIT);

// ------------------------------------------------------------------ graph load

function load() {
  if (!existsSync(GRAPH)) die(`missing ${rel(GRAPH)} — run graphify to regenerate it`);
  const g = JSON.parse(readFileSync(GRAPH, 'utf8'));
  const labels = existsSync(LABELS) ? JSON.parse(readFileSync(LABELS, 'utf8')) : {};

  const byId = new Map();
  const byFile = new Map();
  for (const n of g.nodes) {
    byId.set(n.id, n);
    if (!byFile.has(n.source_file)) byFile.set(n.source_file, []);
    byFile.get(n.source_file).push(n);
  }

  const out = new Map(); // id -> links where it is the source
  const inc = new Map(); // id -> links where it is the target
  const degree = new Map();
  for (const l of g.links) {
    push(out, l.source, l);
    push(inc, l.target, l);
    degree.set(l.source, (degree.get(l.source) || 0) + 1);
    degree.set(l.target, (degree.get(l.target) || 0) + 1);
  }

  return { g, labels, byId, byFile, out, inc, degree };
}

function push(map, key, val) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(val);
}

// -------------------------------------------------------------------- printing

function die(msg) {
  console.error(`graph-query: ${msg}`);
  process.exit(1);
}

const rel = (p) => p.replace(ROOT + '\\', '').replace(ROOT + '/', '').split('\\').join('/');

/** Print a capped list; always say how much was withheld. */
function list(header, items, render = (x) => x) {
  if (!items.length) return;
  const shown = items.slice(0, LIMIT === Infinity ? items.length : LIMIT);
  const more = items.length - shown.length;
  console.log(`\n${header} (${items.length})`);
  for (const it of shown) console.log(`  ${render(it)}`);
  if (more > 0) console.log(`  ... +${more} more (--limit N / --all)`);
}

const nodeRef = (n) => `${n.label} [${n.source_file}${n.source_location ? ':' + n.source_location : ''}]`;

// ------------------------------------------------------------------ resolution

function resolveFile(ctx, q) {
  const needle = q.split('\\').join('/').toLowerCase();
  const files = [...ctx.byFile.keys()];
  const exact = files.filter((f) => f.toLowerCase() === needle);
  if (exact.length) return exact;
  const suffix = files.filter((f) => f.toLowerCase().endsWith(needle));
  if (suffix.length) return suffix;
  return files.filter((f) => f.toLowerCase().includes(needle));
}

function resolveNodes(ctx, q) {
  const needle = q.toLowerCase();
  if (ctx.byId.has(q)) return [ctx.byId.get(q)];
  const nodes = ctx.g.nodes;
  const exact = nodes.filter((n) => n.norm_label === needle || n.label.toLowerCase() === needle);
  if (exact.length) return exact;
  const fn = nodes.filter((n) => n.label.toLowerCase() === `${needle}()`);
  if (fn.length) return fn;
  return nodes.filter((n) => n.label.toLowerCase().includes(needle));
}

function communityLabel(ctx, id) {
  return ctx.labels[String(id)] || `community ${id}`;
}

// -------------------------------------------------------------------- commands

const commands = {};

commands.stats = (ctx) => {
  const { g } = ctx;
  const communities = new Set(g.nodes.map((n) => n.community));
  console.log(`${g.nodes.length} nodes · ${g.links.length} edges · ${communities.size} communities · ${ctx.byFile.size} files`);
  console.log(`built at commit ${g.built_at_commit ? g.built_at_commit.slice(0, 12) : '?'}`);
  console.log('run "node scripts/graph-query.mjs stale" to see how far the graph has drifted');
};

/** What does this file define, and which files does it reach? */
commands.file = (ctx, [q]) => {
  if (!q) die('usage: file <path-or-suffix>');
  const files = resolveFile(ctx, q);
  if (!files.length) die(`no file in the graph matches "${q}"`);
  if (files.length > 1) {
    list(`${files.length} files match "${q}" — narrow it`, files);
    return;
  }
  const file = files[0];
  const nodes = ctx.byFile.get(file);
  const comms = [...new Set(nodes.map((n) => n.community))];
  console.log(`\n=== ${file}`);
  console.log(`community: ${comms.map((c) => `${c} "${communityLabel(ctx, c)}"`).join(', ')}`);

  const ids = new Set(nodes.map((n) => n.id));
  const outward = new Map(); // other file -> edge descriptions
  const inward = new Map();
  for (const n of nodes) {
    for (const l of ctx.out.get(n.id) || []) {
      const t = ctx.byId.get(l.target);
      if (!t || ids.has(t.id)) continue;
      push(outward, t.source_file, `${n.label} --${l.relation}--> ${t.label}`);
    }
    for (const l of ctx.inc.get(n.id) || []) {
      const s = ctx.byId.get(l.source);
      if (!s || ids.has(s.id)) continue;
      push(inward, s.source_file, `${s.label} --${l.relation}--> ${n.label}`);
    }
  }

  list('defines', nodes.map((n) => `${n.label}${n.source_location ? ' ' + n.source_location : ''} (${ctx.degree.get(n.id) || 0} edges)`));
  list('reaches out to', [...outward.entries()].sort((a, b) => b[1].length - a[1].length),
    ([f, e]) => `${f}  (${e.length}) ${e[0]}${e.length > 1 ? ' ...' : ''}`);
  list('reached from', [...inward.entries()].sort((a, b) => b[1].length - a[1].length),
    ([f, e]) => `${f}  (${e.length}) ${e[0]}${e.length > 1 ? ' ...' : ''}`);
};

/** One symbol and its immediate neighbourhood. */
commands.node = (ctx, [q]) => {
  if (!q) die('usage: node <symbol>');
  const hits = resolveNodes(ctx, q);
  if (!hits.length) die(`no node matches "${q}"`);
  if (hits.length > 1) {
    list(`${hits.length} nodes match "${q}" — narrow it`, hits, nodeRef);
    return;
  }
  const n = hits[0];
  console.log(`\n=== ${nodeRef(n)}`);
  console.log(`id: ${n.id}`);
  console.log(`community: ${n.community} "${communityLabel(ctx, n.community)}" · ${ctx.degree.get(n.id) || 0} edges · ${n.file_type}`);
  if (n.rationale) console.log(`rationale: ${n.rationale}`);
  const other = (l, id) => nodeRef(ctx.byId.get(id) || { label: id, source_file: '?' }) + (l.confidence === 'INFERRED' ? ' [INFERRED]' : '');
  list('outgoing', ctx.out.get(n.id) || [], (l) => `--${l.relation}--> ${other(l, l.target)}`);
  list('incoming', ctx.inc.get(n.id) || [], (l) => `<--${l.relation}-- ${other(l, l.source)}`);
};

/** A community: which files it spans and its busiest symbols. */
commands.community = (ctx, [q]) => {
  if (!q) die('usage: community <id-or-name>');
  let id = null;
  if (/^\d+$/.test(q)) id = Number(q);
  else {
    const hit = Object.entries(ctx.labels).find(([, l]) => l.toLowerCase().includes(q.toLowerCase()));
    if (!hit) die(`no community matches "${q}"`);
    id = Number(hit[0]);
  }
  const nodes = ctx.g.nodes.filter((n) => n.community === id);
  if (!nodes.length) die(`community ${id} has no nodes`);
  const files = new Map();
  for (const n of nodes) files.set(n.source_file, (files.get(n.source_file) || 0) + 1);
  console.log(`\n=== community ${id} "${communityLabel(ctx, id)}" — ${nodes.length} nodes across ${files.size} files`);
  list('files', [...files.entries()].sort((a, b) => b[1] - a[1]), ([f, c]) => `${f} (${c})`);
  list('busiest symbols', [...nodes].sort((a, b) => (ctx.degree.get(b.id) || 0) - (ctx.degree.get(a.id) || 0)),
    (n) => `${n.label} — ${ctx.degree.get(n.id) || 0} edges [${n.source_file}]`);
};

/** Every community with its size — the tail the index leaves out. */
commands.communities = (ctx) => {
  const sizes = new Map();
  for (const n of ctx.g.nodes) sizes.set(n.community, (sizes.get(n.community) || 0) + 1);
  const ranked = [...sizes.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`${ranked.length} communities:`);
  for (const [id, count] of ranked) console.log(`  ${String(id).padStart(3)}  ${String(count).padStart(3)} nodes  ${communityLabel(ctx, id)}`);
};

commands.search = (ctx, [q]) => {
  if (!q) die('usage: search <term>');
  const needle = q.toLowerCase();
  const nodes = ctx.g.nodes.filter((n) => n.label.toLowerCase().includes(needle) || n.source_file.toLowerCase().includes(needle));
  if (!nodes.length) {
    console.log(`no match for "${q}"`);
    return;
  }
  list(`nodes matching "${q}"`, nodes.sort((a, b) => (ctx.degree.get(b.id) || 0) - (ctx.degree.get(a.id) || 0)),
    (n) => `${n.label} — ${ctx.degree.get(n.id) || 0} edges · c${n.community} "${communityLabel(ctx, n.community)}" [${n.source_file}]`);
};

commands.hubs = (ctx, [n]) => {
  const top = [...ctx.degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(n) || 20);
  console.log('most connected symbols:');
  for (const [id, d] of top) {
    const node = ctx.byId.get(id);
    if (node) console.log(`  ${d}\t${node.label} [${node.source_file}]`);
  }
};

/** Shortest chain between two symbols — cheaper than reading both files. */
commands.path = (ctx, [a, b]) => {
  if (!a || !b) die('usage: path <from> <to>');
  const from = resolveNodes(ctx, a);
  const to = resolveNodes(ctx, b);
  if (from.length !== 1) {
    list(`ambiguous start "${a}"`, from, nodeRef);
    return;
  }
  if (to.length !== 1) {
    list(`ambiguous end "${b}"`, to, nodeRef);
    return;
  }
  const goal = to[0].id;
  const prev = new Map([[from[0].id, null]]);
  const queue = [from[0].id];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === goal) break;
    for (const l of [...(ctx.out.get(cur) || []), ...(ctx.inc.get(cur) || [])]) {
      const next = l.source === cur ? l.target : l.source;
      if (prev.has(next)) continue;
      prev.set(next, { from: cur, relation: l.relation });
      queue.push(next);
    }
  }
  if (!prev.has(goal)) {
    console.log(`no path between ${from[0].label} and ${to[0].label}`);
    return;
  }
  const chain = [];
  for (let cur = goal; cur; ) {
    const step = prev.get(cur);
    chain.unshift({ id: cur, relation: step ? step.relation : null });
    if (!step) break;
    cur = step.from;
  }
  console.log(`${chain.length - 1} hops:`);
  for (const [i, step] of chain.entries()) {
    const n = ctx.byId.get(step.id);
    console.log(`  ${i === 0 ? '' : `--${step.relation}--> `}${nodeRef(n)}`);
  }
};

/** How stale is the graph? Answer this before trusting anything it says. */
commands.stale = (ctx) => {
  const commit = ctx.g.built_at_commit;
  console.log(`graph built at ${commit ? commit.slice(0, 12) : '?'}`);
  let changed = [];
  try {
    const diff = execFileSync('git', ['diff', '--name-only', commit, 'HEAD'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    changed = diff.split('\n').filter(Boolean);
  } catch {
    console.log('cannot diff against that commit (not in this clone) — treat the graph as unverified');
  }
  try {
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    changed.push(...dirty.split('\n').filter(Boolean).map((l) => l.slice(3).trim()));
  } catch {}
  const known = new Set(ctx.byFile.keys());
  const unique = [...new Set(changed)];
  const stale = unique.filter((f) => known.has(f));
  const fresh = unique.filter((f) => !known.has(f));
  console.log(`${unique.length} files changed since then`);
  list('changed AND in the graph — its edges for these are suspect', stale);
  list('changed but never graphed — no edges exist for these', fresh);

  // The post-commit hook rebuilds graph.json but not GRAPH_INDEX.md, so the
  // community map drifts silently behind the edges it claims to summarise.
  const index = resolve(OUT, 'GRAPH_INDEX.md');
  if (existsSync(index) && statSync(index).mtimeMs < statSync(GRAPH).mtimeMs) {
    console.log('\nGRAPH_INDEX.md is older than graph.json — its community map is out of date.');
    console.log('  node scripts/graph-query.mjs index --write');
  }
};

/** Regenerate the compact index that gets read instead of GRAPH_REPORT.md. */
commands.index = (ctx) => {
  const { g } = ctx;
  const comms = new Map();
  for (const n of g.nodes) {
    if (!comms.has(n.community)) comms.set(n.community, { nodes: 0, dirs: new Map() });
    const c = comms.get(n.community);
    c.nodes++;
    const dir = n.source_file.includes('/') ? n.source_file.slice(0, n.source_file.lastIndexOf('/')) : '.';
    c.dirs.set(dir, (c.dirs.get(dir) || 0) + 1);
  }
  const ranked = [...comms.entries()].sort((a, b) => b[1].nodes - a[1].nodes);
  const hubs = [...ctx.degree.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .map(([id, d]) => ({ n: ctx.byId.get(id), d })).filter((x) => x.n);

  const lines = [];
  lines.push('# Graph Index');
  lines.push('');
  lines.push(`${g.nodes.length} nodes · ${g.links.length} edges · ${comms.size} communities · ${ctx.byFile.size} files · built at \`${g.built_at_commit ? g.built_at_commit.slice(0, 12) : '?'}\``);
  lines.push('');
  lines.push('Regenerate with `node scripts/graph-query.mjs index --write`. This is the whole-graph');
  lines.push('view; anything more specific comes from a query, not from reading a bigger file.');
  lines.push('');
  lines.push('## Query it');
  lines.push('');
  lines.push('```');
  lines.push('node scripts/graph-query.mjs file src/services/im/im-print-html.ts   # defines / reaches / reached-from');
  lines.push('node scripts/graph-query.mjs node buildImPrintDocument               # one symbol + neighbours');
  lines.push('node scripts/graph-query.mjs community "IM Print"                   # files + busiest symbols');
  lines.push('node scripts/graph-query.mjs search print-settings                   # find a symbol or file');
  lines.push('node scripts/graph-query.mjs path renderPart buildParts              # how two symbols connect');
  lines.push('node scripts/graph-query.mjs stale                                   # what drifted since the build');
  lines.push('```');
  lines.push('');
  lines.push('Lists are capped at 25; `--limit N` / `--all` widen them. Never read `graph.json` (4.7MB),');
  lines.push('`graph.html` (3.7MB), `manifest.json`, or `cache/` — query instead.');
  lines.push('');
  const INDEX_COMMUNITIES = 30;
  lines.push(`## Communities (top ${Math.min(INDEX_COMMUNITIES, ranked.length)} of ${comms.size})`);
  lines.push('');
  for (const [id, c] of ranked.slice(0, INDEX_COMMUNITIES)) {
    const where = [...c.dirs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([d]) => d).join(', ');
    lines.push(`- \`${id}\` **${communityLabel(ctx, id)}** — ${c.nodes} nodes · ${where}`);
  }
  const tail = ranked.slice(INDEX_COMMUNITIES);
  if (tail.length) {
    lines.push('');
    lines.push(`${tail.length} smaller communities (${tail[0][1]} nodes and under) are left out on purpose —`);
    lines.push('`node scripts/graph-query.mjs communities` lists all of them.');
  }
  lines.push('');
  lines.push('## Core abstractions (most connected)');
  lines.push('');
  for (const { n, d } of hubs) lines.push(`- \`${n.label}\` — ${d} edges · ${n.source_file}`);
  lines.push('');

  const text = lines.join('\n');
  if (flags.write) {
    const dest = resolve(OUT, 'GRAPH_INDEX.md');
    writeFileSync(dest, text);
    console.log(`wrote ${rel(dest)} (${text.length} bytes)`);
  } else {
    console.log(text);
  }
};

commands.help = () => {
  console.log(`graph-query — targeted slices of graphify-out/graph.json

  stats                     size and build commit
  stale                     files changed since the graph was built
  file <path>               what a file defines, reaches, and is reached from
  node <symbol>             one symbol, its edges and community
  community <id|name>       files and busiest symbols in a community
  communities               every community with its size
  search <term>             find symbols or files
  hubs [n]                  most connected symbols
  path <from> <to>          shortest chain between two symbols
  index [--write]           regenerate graphify-out/GRAPH_INDEX.md

flags: --limit N | --all | --write`);
};

// ------------------------------------------------------------------------ main

const cmd = args.shift() || 'help';
if (!commands[cmd]) die(`unknown command "${cmd}" — try: help`);
if (cmd === 'help') commands.help();
else commands[cmd](load(), args);
