/**
 * The leaflet's last-page copyright + version line.
 *
 * Worth its own guard because the failure was silent and shipped: the v8 production booklet
 * (44 pages, 22 languages) printed "© 2026 . All rights reserved. · v8" — a literal hole where
 * the company should be — because the leaflet export dialog offers no cover fields, so
 * `cover.companyName` is always empty for a leaflet and the blank was interpolated straight
 * into the string. Nothing failed; the PDF was just wrong, on every leaflet, for months.
 */
import { describe, it, expect } from 'vitest';
import { buildCopyrightLine } from './print-render-shared';

describe('buildCopyrightLine', () => {
  it('prints company and version', () => {
    expect(buildCopyrightLine({ year: 2026, companyName: 'Chal-Tec GmbH', version: 8 })).toBe(
      '© 2026 Chal-Tec GmbH. All rights reserved. · v8',
    );
  });

  it('prints the document code between the company and the version', () => {
    // Code then version is the order someone reads them in: which document, then which
    // revision of it.
    expect(
      buildCopyrightLine({ year: 2026, companyName: 'Chal-Tec GmbH', version: 8, docCode: 'WL-RAN-ANGLED-8MJ-A5' }),
    ).toBe('© 2026 Chal-Tec GmbH. All rights reserved. · WL-RAN-ANGLED-8MJ-A5 · v8');
  });

  it('refuses to print a document code that is not one', () => {
    // The code arrives from the browser and is stamped onto a safety document, so anything
    // that is not a real code is dropped rather than printed.
    for (const bad of ['', 'not a code', 'WL-RAN-ANGLED-8MJ', '<script>alert(1)</script>']) {
      expect(buildCopyrightLine({ year: 2026, companyName: 'Acme', version: 2, docCode: bad })).toBe(
        '© 2026 Acme. All rights reserved. · v2',
      );
    }
  });

  it('drops the code segment cleanly when there is none', () => {
    expect(buildCopyrightLine({ year: 2026, companyName: 'Acme', version: 2 })).toBe(
      '© 2026 Acme. All rights reserved. · v2',
    );
  });

  it('leaves no hole when the company is missing — the shipped bug', () => {
    const line = buildCopyrightLine({ year: 2026, version: 8 });
    expect(line).toBe('© 2026. All rights reserved. · v8');
    // The exact shape that reached production.
    expect(line).not.toContain('© 2026 .');
    expect(line).not.toContain('  ');
  });

  it('treats a blank or whitespace company as missing', () => {
    expect(buildCopyrightLine({ year: 2026, companyName: '', version: 3 })).toBe('© 2026. All rights reserved. · v3');
    expect(buildCopyrightLine({ year: 2026, companyName: '   ', version: 3 })).toBe('© 2026. All rights reserved. · v3');
  });

  it('drops the version segment AND its separator when there is no version', () => {
    const line = buildCopyrightLine({ year: 2026, companyName: 'Chal-Tec GmbH' });
    expect(line).toBe('© 2026 Chal-Tec GmbH. All rights reserved.');
    expect(line).not.toContain('·');
  });

  it('drops both segments cleanly when neither is known', () => {
    expect(buildCopyrightLine({ year: 2026 })).toBe('© 2026. All rights reserved.');
  });

  it('does not print v0 as a version', () => {
    // An unpublished/zero version is "no version", not "version zero".
    expect(buildCopyrightLine({ year: 2026, companyName: 'Acme', version: 0 })).toBe(
      '© 2026 Acme. All rights reserved.',
    );
  });

  it('trims a padded company name rather than printing the padding', () => {
    expect(buildCopyrightLine({ year: 2026, companyName: '  Acme  ', version: 1 })).toBe(
      '© 2026 Acme. All rights reserved. · v1',
    );
  });
});
