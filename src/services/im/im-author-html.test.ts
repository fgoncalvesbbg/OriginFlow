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

  it('drops a pinned px column width in a DATA cell', () => {
    const out = sanitizeAuthorHtml('<th style="width: 40px; padding: 5px; border: 1px solid #ccc;">x</th>');
    expect(out).not.toContain('width: 40px');
  });

  it('leaves a LAYOUT cell entirely alone, geometry included', () => {
    // The disposal block sets an icon beside its text this way. Every declaration is deliberate:
    // stripping them collapsed the icon column and removed the gutter between icon and text.
    const layout = '<td style="width:120px;vertical-align:top;padding:0 12px 0 0;border:none;">x</td>';
    expect(sanitizeAuthorHtml(layout)).toBe(layout);
  });

  it('treats a cell with no border declaration as layout, so nothing is guessed away', () => {
    const bare = '<td width="120">x</td>';
    expect(sanitizeAuthorHtml(bare)).toBe(bare);
  });

  it('leaves non-cell elements alone', () => {
    expect(sanitizeAuthorHtml('<p style="padding: 12px;">x</p>')).toContain('padding: 12px');
  });
});

describe('table tag', () => {
  // Real shape found in migrated content: `data-table-fit="content"` set at import time
  // SIDE BY SIDE with an inline `width:100%` — the exact combination that made the Fit
  // page/Fit content toggle silently do nothing, since the inline declaration beats
  // `[data-table-fit="content"] { width: auto }` regardless of the stylesheet's specificity.
  it('drops an inline width that would defeat data-table-fit', () => {
    const out = sanitizeAuthorHtml('<table style="width:100%;border-collapse:collapse;border:1px solid #ccc" data-table-fit="content"><tr><td>x</td></tr></table>');
    expect(out).not.toContain('width:100%');
    expect(out).toContain('data-table-fit="content"');
    // Untouched: doesn't conflict with anything the print stylesheet controls.
    expect(out).toContain('border-collapse:collapse');
    expect(out).toContain('border:1px solid #ccc');
  });

  it('drops table-layout the same way — it competes with data-col-widths', () => {
    const out = sanitizeAuthorHtml('<table style="table-layout:fixed;width:600px" data-col-widths="1"><tr><td>x</td></tr></table>');
    expect(out).not.toContain('table-layout:fixed');
    expect(out).not.toContain('width:600px');
  });

  it('does not touch max-width, or width declared on a cell', () => {
    const out = sanitizeAuthorHtml('<table style="max-width:600px"><tr><td style="width:120px;border:none;">x</td></tr></table>');
    expect(out).toContain('max-width:600px');
    expect(out).toContain('width:120px');
  });

  it('leaves a table with no inline style alone', () => {
    const clean = '<table class="im-table" data-table-fit="content"><tr><td>x</td></tr></table>';
    expect(sanitizeAuthorHtml(clean)).toBe(clean);
  });
});

describe('images', () => {
  it('drops the inline margins that beat both stylesheets', () => {
    const out = sanitizeAuthorHtml('<img src="a.png" style="max-width:100%;height:auto;margin:1rem 0;" />');
    expect(out).not.toContain('margin:1rem 0');
    expect(out).toContain('max-width:100%');
  });

  it('PRESERVES an image width inside a table — a column must fit the widest image it holds', () => {
    // An earlier version stripped this, on the theory that it caused the phantom image column.
    // It does not: the phantom column is one holding NO images, which no width can explain.
    const out = sanitizeAuthorHtml('<table><tr><td><img src="a.png" style="width:160px;max-width:100%;" /></td></tr></table>');
    expect(out).toContain('width:160px');
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
    '<table style="width:100%" data-table-fit="content"><tr><td>x</td></tr></table>',
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
