/**
 * Repairing author HTML that overrides the print settings.
 *
 * Runs on two paths — the renderer on every export, and the editor on every HTML ingress — so
 * idempotence is a hard requirement, not a nicety.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeAuthorHtml } from './im-author-html';

describe('table cells', () => {
  // The real markup found in the corpus.
  const pasted = '<table><tr><th style="width: 22%; padding: 12px; border: 1px solid #ccc; text-align: center;">H</th></tr></table>';

  it('drops padding that beat the setting on every row', () => {
    // 12px is 3.18mm a side: 6.35mm per row against a 1.2mm setting.
    expect(sanitizeAuthorHtml(pasted)).not.toContain('padding: 12px');
  });

  it('drops a visible border so the hairline setting reaches the table', () => {
    expect(sanitizeAuthorHtml(pasted)).not.toContain('border: 1px solid #ccc');
  });

  it('keeps alignment and percentage widths, which print correctly', () => {
    const out = sanitizeAuthorHtml(pasted);
    expect(out).toContain('text-align: center');
    expect(out).toContain('width: 22%');
  });

  it('keeps a border the author zeroed — an invisible layout table is a real decision', () => {
    expect(sanitizeAuthorHtml('<td style="padding:8px; border:0;">x</td>')).toContain('border:0');
    expect(sanitizeAuthorHtml('<td style="border: none;">x</td>')).toContain('border: none');
    expect(sanitizeAuthorHtml('<td style="border: 0px;">x</td>')).toContain('border: 0px');
  });

  it('drops a pinned px column width', () => {
    expect(sanitizeAuthorHtml('<th style="width: 40px; padding: 5px;">x</th>')).not.toContain('width: 40px');
  });

  it('drops the presentational width attribute on a cell', () => {
    expect(sanitizeAuthorHtml('<td width="120">x</td>')).not.toContain('width="120"');
  });

  it('leaves non-cell elements alone', () => {
    expect(sanitizeAuthorHtml('<p style="padding: 12px;">x</p>')).toContain('padding: 12px');
  });
});

describe('images', () => {
  it('drops the inline margins that beat both stylesheets', () => {
    const out = sanitizeAuthorHtml('<img src="a.png" style="max-width:100%;height:auto;margin:1rem 0;" />');
    expect(out).not.toContain('margin:1rem 0');
    expect(out).toContain('max-width:100%');
  });

  it('drops a px width inside a table, which pinned the column on every row', () => {
    const out = sanitizeAuthorHtml('<table><tr><td><img src="a.png" style="width:160px;max-width:100%;" /></td></tr></table>');
    expect(out).not.toContain('width:160px');
  });

  it('preserves a px width outside a table — there it is a deliberate choice', () => {
    const out = sanitizeAuthorHtml('<p><img src="logo.png" style="width:150px;float:left;" /></p>');
    expect(out).toContain('width:150px');
    expect(out).toContain('float:left');
  });

  it('preserves placement, which the renderer and editor both read back', () => {
    const out = sanitizeAuthorHtml('<img src="a.png" data-align="right" style="float:right;margin:1rem;" />');
    expect(out).toContain('data-align="right"');
    expect(out).toContain('float:right');
  });
});

describe('idempotence', () => {
  const samples = [
    '<table><tr><th style="width: 22%; padding: 12px; border: 1px solid #ccc;">H</th></tr></table>',
    '<img src="a.png" style="margin:1rem 0;max-width:100%;" />',
    '<td style="border:0;padding:8px;">x</td>',
    '<p>Plain content, nothing to repair.</p>',
    '',
  ];

  it('changes nothing on a second pass', () => {
    // The renderer runs it after the editor already has; a second pass must be a no-op.
    for (const sample of samples) {
      const once = sanitizeAuthorHtml(sample);
      expect(sanitizeAuthorHtml(once)).toBe(once);
    }
  });

  it('leaves already-clean content byte-identical', () => {
    const clean = '<p>Text</p><table><tr><td style="text-align: center;">c</td></tr></table>';
    expect(sanitizeAuthorHtml(clean)).toBe(clean);
  });
});
