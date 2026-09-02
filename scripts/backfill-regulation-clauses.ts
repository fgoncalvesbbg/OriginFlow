/**
 * One-off backfill for migration 141: turn each `regulations.checklist` line into a clause
 * and an obligation row.
 *
 * Run with vite-node so it imports the SAME parser the app and its tests use — a second
 * implementation written for the migration is how a backfill and the code that reads it end
 * up disagreeing about what the data means:
 *
 *   npx vite-node scripts/backfill-regulation-clauses.ts -- <output.sql> [--apply]
 *
 * It READS the live `regulations.checklist` column with the service-role key from .env and
 * WRITES SQL to a file. Applying is opt-in behind `--apply`, and never the default: a
 * backfill that derives and commits in one step gives nobody a chance to read what it
 * decided. Generate first, read the SQL, then re-run with --apply.
 *
 * IDEMPOTENT BY CONSTRUCTION: clauses upsert on (regulation_id, number), and obligations are
 * only inserted for regulations that currently have none. Running it twice does nothing the
 * second time.
 */

import { readFileSync, writeFileSync } from 'node:fs';

import {
  parseObligationBlock,
  type ParsedObligation,
} from '../src/services/regulatory/obligation-parse';
import { clauseSortKey, inferClauseKind } from '../src/services/regulatory/regulation-clause.service';

interface InputRow {
  id: string;
  reference_code: string;
  checklist: string | null;
}

/** Postgres string literal. Doubling the quote is the whole escape rule for a text literal. */
const lit = (v: string | null | undefined): string =>
  v === null || v === undefined || v === '' ? 'NULL' : `'${v.replace(/'/g, "''")}'`;

const arrayLit = (values: readonly string[]): string =>
  values.length === 0 ? `'{}'` : `ARRAY[${values.map(lit).join(',')}]::text[]`;

/** Read SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY out of .env without adding a dependency. */
const readEnv = (): { url: string; key: string } => {
  const env = readFileSync('.env', 'utf8');
  const pick = (name: string): string => {
    const m = env.match(new RegExp(`^${name}=(.*)$`, 'm'));
    if (!m) throw new Error(`${name} is not set in .env`);
    return m[1].trim();
  };
  return { url: pick('SUPABASE_URL').replace(/\/+$/, ''), key: pick('SUPABASE_SERVICE_ROLE_KEY') };
};

const fetchRegulations = async (): Promise<InputRow[]> => {
  const { url, key } = readEnv();
  const res = await fetch(
    `${url}/rest/v1/regulations?select=id,reference_code,checklist&checklist=not.is.null&order=reference_code`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`Supabase returned ${res.status}: ${await res.text()}`);
  return (await res.json()) as InputRow[];
};

/** POST rows to a table, or throw with the server's own message. */
const insertRows = async (table: string, rows: object[]): Promise<void> => {
  if (rows.length === 0) return;
  const { url, key } = readEnv();
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`insert into ${table} failed (${res.status}): ${await res.text()}`);
};

const selectRows = async <T>(path: string): Promise<T[]> => {
  const { url, key } = readEnv();
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`select ${path} failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as T[];
};

/**
 * Write the parsed structure. Skips anything already present, so re-running is a no-op:
 * clauses are matched on (regulation_id, number) and obligations on (regulation_id, text),
 * which is what the generated SQL guards on too.
 */
const applyBackfill = async (
  plan: Array<{ row: InputRow; parsed: ParsedObligation[] }>,
): Promise<void> => {
  for (const { row, parsed } of plan) {
    const wanted = new Map<string, ParsedObligation>();
    for (const o of parsed) if (o.clause && !wanted.has(o.clause)) wanted.set(o.clause, o);

    const existingClauses = await selectRows<{ id: string; number: string }>(
      `regulation_clauses?select=id,number&regulation_id=eq.${row.id}`,
    );
    const haveClause = new Set(existingClauses.map(c => c.number.trim().toLowerCase()));
    await insertRows('regulation_clauses', [...wanted].
      filter(([number]) => !haveClause.has(number.trim().toLowerCase())).
      map(([number, sample]) => ({
        regulation_id: row.id,
        number,
        qualifier: sample.qualifier || null,
        kind: inferClauseKind(number),
        sort_key: clauseSortKey(number),
        created_by: 'migration:141',
      })));

    // Re-read so both pre-existing and just-inserted clauses resolve the same way.
    const clauseIdByNumber = new Map(
      (await selectRows<{ id: string; number: string }>(
        `regulation_clauses?select=id,number&regulation_id=eq.${row.id}`,
      )).map(c => [c.number.trim().toLowerCase(), c.id]),
    );

    const existingTexts = new Set(
      (await selectRows<{ text: string }>(
        `regulation_obligations?select=text&regulation_id=eq.${row.id}`,
      )).map(o => o.text),
    );

    await insertRows('regulation_obligations', parsed
      .filter(o => !existingTexts.has(o.text))
      .map((o, index) => ({
        regulation_id: row.id,
        clause_id: o.clause ? clauseIdByNumber.get(o.clause.trim().toLowerCase()) ?? null : null,
        text: o.text,
        verbatim: o.verbatim ?? null,
        carriers: o.carriers,
        optional_carriers: o.optionalCarriers,
        sort_order: index,
        created_by: 'migration:141',
      })));

    console.log(`  applied ${row.reference_code}`);
  }
};

const main = async () => {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const outputPath = args.find(a => !a.startsWith('--'));
  if (!outputPath) {
    console.error('usage: vite-node scripts/backfill-regulation-clauses.ts -- <output.sql> [--apply]');
    process.exit(1);
  }

  const rows: InputRow[] = (await fetchRegulations()).filter(r => (r.checklist ?? '').trim() !== '');
  const sql: string[] = [
    '-- Generated by scripts/backfill-regulation-clauses.ts — do not hand-edit.',
    '-- Parser: src/services/regulatory/obligation-parse.ts (see its tests for the grammars).',
    'BEGIN;',
    '',
  ];

  let clauseCount = 0;
  let obligationCount = 0;
  let unclassified = 0;
  const perRegulation: Array<{ ref: string; clauses: number; obligations: number; unparsed: number }> = [];
  const plan: Array<{ row: InputRow; parsed: ParsedObligation[] }> = [];

  for (const row of rows) {
    const parsed: ParsedObligation[] = parseObligationBlock(row.checklist);
    if (parsed.length === 0) continue;
    plan.push({ row, parsed });

    // One clause row per distinct citation. The first sighting supplies the qualifier, since
    // "7.12 Addition" and a later bare "7.12" are the same clause of the same document.
    const clauses = new Map<string, ParsedObligation>();
    for (const o of parsed) {
      if (o.clause && !clauses.has(o.clause)) clauses.set(o.clause, o);
    }

    sql.push(`-- ${row.reference_code}: ${clauses.size} clause(s), ${parsed.length} obligation(s)`);

    for (const [number, sample] of clauses) {
      sql.push(
        `INSERT INTO public.regulation_clauses (regulation_id, number, qualifier, kind, sort_key, created_by)`,
        `VALUES (${lit(row.id)}, ${lit(number)}, ${lit(sample.qualifier || null)}, ` +
          `${lit(inferClauseKind(number))}, ${lit(clauseSortKey(number))}, 'migration:141')`,
        `ON CONFLICT DO NOTHING;`,
      );
      clauseCount++;
    }

    let order = 0;
    for (const o of parsed) {
      if (o.carriers.length === 0) unclassified++;
      // The clause is resolved by sub-select rather than by a returned id, so the statement
      // stays correct whether the clause was just inserted or already existed.
      const clauseRef = o.clause
        ? `(SELECT id FROM public.regulation_clauses WHERE regulation_id = ${lit(row.id)} ` +
          `AND lower(btrim(number)) = lower(btrim(${lit(o.clause)})))`
        : 'NULL';
      sql.push(
        `INSERT INTO public.regulation_obligations`,
        `  (regulation_id, clause_id, text, verbatim, carriers, optional_carriers, sort_order, created_by)`,
        `SELECT ${lit(row.id)}, ${clauseRef}, ${lit(o.text)}, ${lit(o.verbatim ?? null)},`,
        `       ${arrayLit(o.carriers)}, ${arrayLit(o.optionalCarriers)}, ${order}, 'migration:141'`,
        // Guarded on (regulation_id, text), NOT on "this regulation has any obligations":
        // the latter is self-defeating inside one transaction, because the first insert
        // makes it false and silently skips every obligation after it.
        `WHERE NOT EXISTS (SELECT 1 FROM public.regulation_obligations o`,
        `                   WHERE o.regulation_id = ${lit(row.id)} AND o.text = ${lit(o.text)});`,
      );
      order++;
      obligationCount++;
    }
    sql.push('');

    perRegulation.push({
      ref: row.reference_code,
      clauses: clauses.size,
      obligations: parsed.length,
      unparsed: parsed.filter(o => o.parsed === 'none').length,
    });
  }

  sql.push('COMMIT;');
  writeFileSync(outputPath, sql.join('\n'), 'utf8');

  console.log(`Wrote ${outputPath}`);
  console.table(perRegulation);
  console.log(
    `TOTAL: ${clauseCount} clauses, ${obligationCount} obligations, ` +
    `${unclassified} with no carrier recorded (these still show on the IM checklist).`,
  );

  if (apply) {
    console.log('\nApplying…');
    await applyBackfill(plan);
    console.log('Done.');
  } else {
    console.log('\nNothing written. Re-run with --apply once the SQL above reads correctly.');
  }
};

main().catch(e => { console.error(e); process.exit(1); });
