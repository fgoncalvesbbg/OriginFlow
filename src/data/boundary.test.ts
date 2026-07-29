/**
 * Architecture test: the backend boundary is real, and stays real.
 *
 * The whole point of `src/data` is that swapping Supabase for an internal SQL Server means
 * writing one new adapter instead of editing 30 service files. That property is only true
 * while NOTHING outside the adapter folder touches a driver SDK — and a single convenient
 * `import { supabase }` in a new service silently destroys it. Code review does not reliably
 * catch that; this test does.
 *
 * If this fails, do not add an exemption. Add the capability you need to the port
 * (src/data/ports) and implement it in the adapter.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..');

/** The only directory allowed to know which database product we use. */
const ADAPTER_DIR = join('data', 'supabase');

const collectSourceFiles = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
};

const sourceFiles = collectSourceFiles(SRC).map((f) => ({
  path: relative(SRC, f).split(sep).join('/'),
  text: readFileSync(f, 'utf8'),
}));

/** Matches a real import/re-export of a module, ignoring mentions inside comments. */
const importsFrom = (text: string, modulePattern: string): boolean =>
  new RegExp(String.raw`^\s*(?:import|export)\b[^;\n]*?from\s+['"]${modulePattern}['"]`, 'm').test(text)
  || new RegExp(String.raw`\bimport\s*\(\s*['"]${modulePattern}['"]`).test(text);

describe('data-access boundary', () => {
  it('finds source files to check (guards against a broken glob silently passing)', () => {
    expect(sourceFiles.length).toBeGreaterThan(50);
  });

  it('confines the Supabase SDK to src/data/supabase', () => {
    const offenders = sourceFiles
      .filter((f) => !f.path.startsWith('data/supabase/'))
      .filter((f) => importsFrom(f.text, String.raw`@supabase/supabase-js`))
      .map((f) => f.path);

    expect(offenders, 'these files must go through the ports in src/data instead').toEqual([]);
  });

  it('keeps the concrete adapter private to src/data', () => {
    const offenders = sourceFiles
      .filter((f) => !f.path.startsWith('data/'))
      .filter((f) => importsFrom(f.text, String.raw`[^'"]*data/supabase[^'"]*`))
      .map((f) => f.path);

    expect(offenders, 'import { db, auth, storage } from "src/data" instead').toEqual([]);
  });

  it('has an adapter folder that does implement the SDK (the rule is not vacuous)', () => {
    const adapters = sourceFiles
      .filter((f) => f.path.startsWith('data/supabase/'))
      .filter((f) => importsFrom(f.text, String.raw`@supabase/supabase-js`));

    expect(adapters.length).toBeGreaterThan(0);
    expect(ADAPTER_DIR).toBe(join('data', 'supabase'));
  });
});
