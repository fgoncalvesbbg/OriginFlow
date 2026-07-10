#!/usr/bin/env node
/**
 * One-off sweep: externalize inline base64 images out of IM jsonb columns into
 * the public `im-assets` Storage bucket, replacing each data URI with its
 * public URL.
 *
 * WHY: pasted screenshots used to be stored inline as base64 and duplicated
 * into every language (content AND block_refs) — single im_sections rows grew
 * to ~20 MB, which is what made every save time out ("Request timed out after
 * 12s"). The app now externalizes on save and heals sections when a template
 * is opened in the editor; this script bulk-heals everything up front instead,
 * including project_ims and im_blocks rows nobody has re-opened yet.
 *
 * Idempotent: files are keyed by a hash of the data URI (upsert), replacements
 * are exact-string, and a re-run on a clean row is a no-op.
 *
 * -------------------------------------------------------------------------
 * SETUP (run from repo root):
 *   export SUPABASE_URL="https://ecueltibpmpnhnaxlskx.supabase.co"
 *   export SUPABASE_SERVICE_ROLE_KEY="<service_role key — NOT the anon key>"
 *
 * USAGE:
 *   node scripts/sweep-im-images.mjs --dry-run          # report only, write nothing
 *   node scripts/sweep-im-images.mjs --id <row-uuid>    # heal a single row (any table)
 *   node scripts/sweep-im-images.mjs                    # heal everything
 *
 * FLAGS:
 *   --dry-run       Report what would change; write NOTHING (no uploads either).
 *   --id <uuid>     Only process the row with this id (searched in all tables).
 *   --table <name>  Only process one table: im_sections | im_blocks | project_ims
 */
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};
const DRY_RUN = argv.includes('--dry-run');
const ONLY_ID = arg('id');
const ONLY_TABLE = arg('table');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first (see header).');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const BUCKET = 'im-assets';
const DATA_URI_RE = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;

// table → jsonb columns that can carry HTML with inline images
const TABLES = {
  im_sections: ['content', 'block_refs'],
  im_blocks: ['content'],
  project_ims: ['placeholder_data', 'sku_content', 'section_additions', 'extra_sections', 'section_overrides', 'block_overrides'],
};

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

// data URI → uploaded public URL, deduped across the whole run so an image
// shared by many languages/rows is stored exactly once.
const urlByUri = new Map();

const externalizeUri = async (uri) => {
  let url = urlByUri.get(uri);
  if (url) return url;
  const comma = uri.indexOf(',');
  const mime = uri.slice(5, comma).split(';')[0] || 'image/png';
  const ext = (mime.split('/')[1] || 'png').split('+')[0];
  const bytes = Buffer.from(uri.slice(comma + 1), 'base64');
  const path = `migrated/${createHash('sha256').update(uri).digest('hex').slice(0, 24)}.${ext}`;
  if (!DRY_RUN) {
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, { contentType: mime, cacheControl: '31536000', upsert: true });
    if (error) throw new Error(`upload ${path} failed: ${error.message}`);
  }
  url = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  urlByUri.set(uri, url);
  console.log(`    ↳ ${DRY_RUN ? '(dry) would upload' : 'uploaded'} ${kb(bytes.length)} → ${path}`);
  return url;
};

const sweepRow = async (table, cols, row) => {
  const update = {};
  let before = 0;
  let after = 0;
  for (const col of cols) {
    if (row[col] == null) continue;
    let text = JSON.stringify(row[col]);
    const uris = [...new Set(text.match(DATA_URI_RE) ?? [])];
    if (!uris.length) continue;
    before += text.length;
    for (const uri of uris) text = text.split(uri).join(await externalizeUri(uri));
    after += text.length;
    update[col] = JSON.parse(text);
  }
  if (!before) return false;
  console.log(`  ${table} ${row.id}: ${kb(before)} → ${kb(after)} across ${Object.keys(update).join(', ')}`);
  if (!DRY_RUN) {
    const { error } = await supabase.from(table).update(update).eq('id', row.id);
    if (error) throw new Error(`update ${table}/${row.id} failed: ${error.message}`);
  }
  return true;
};

let rowsHealed = 0;
for (const [table, cols] of Object.entries(TABLES)) {
  if (ONLY_TABLE && table !== ONLY_TABLE) continue;
  console.log(`\nScanning ${table}…`);
  // Page by id so a single huge row can't blow memory alongside 100 others.
  let query = supabase.from(table).select('id').order('id');
  if (ONLY_ID) query = query.eq('id', ONLY_ID);
  const { data: ids, error } = await query;
  if (error) throw new Error(`list ${table} failed: ${error.message}`);
  for (const { id } of ids ?? []) {
    const { data: row, error: readErr } = await supabase.from(table).select(['id', ...cols].join(', ')).eq('id', id).single();
    if (readErr) throw new Error(`read ${table}/${id} failed: ${readErr.message}`);
    if (await sweepRow(table, cols, row)) rowsHealed++;
  }
}

console.log(`\n${DRY_RUN ? '(dry run) rows that would be healed' : 'rows healed'}: ${rowsHealed}, distinct images: ${urlByUri.size}`);
if (!DRY_RUN && rowsHealed) {
  console.log('Tip: run VACUUM on the affected tables (or let autovacuum) to reclaim TOAST space.');
}
