/**
 * What the export actually produced: page budget and preflight.
 *
 * WHY this exists. Two things were invisible before:
 *
 *  - Nobody knew how long a booklet was. render-print-merge computed each part's page count to
 *    print the cover's language directory, then discarded it, so a template change that added
 *    pages across five languages only surfaced when someone opened two PDFs side by side.
 *    Migration 124 stores the counts; this shows them, and diffs them against the last
 *    comparable render.
 *
 *  - Nobody knew whether the PDF would pass a print vendor's preflight. Every stamped footer,
 *    page number and edge tab used pdf-lib's StandardFonts.Helvetica — a base-14 font, which is
 *    referenced by name and never embedded — and the running footer's baseline was
 *    `bottomMargin / 2`, putting ink 6.9mm from trim at the live 15mm margin, inside a
 *    bookbinder's trim tolerance. Both are fixed; this is the check that they stay fixed.
 *
 * Warn-only by design: everything here is reported after the PDF exists and nothing blocks an
 * export, because a false positive must never stop production. The judgement calls live in
 * ./print-export-report.ts; this file only renders them.
 */

import React from 'react';
import { AlertCircle, CheckCircle2, FileText } from 'lucide-react';
import type { PrintPdfResult, PrintRender } from '../../../services';
import { summarisePageBudget, summarisePreflight } from './print-export-report';

const Check: React.FC<{ ok: boolean; children: React.ReactNode }> = ({ ok, children }) => (
  <li className="flex items-start gap-1.5">
    {ok ? (
      <CheckCircle2 size={12} className="mt-0.5 shrink-0 text-emerald-600" />
    ) : (
      <AlertCircle size={12} className="mt-0.5 shrink-0 text-amber-600" />
    )}
    <span className="min-w-0">{children}</span>
  </li>
);

/** Signed page delta, e.g. "+12" / "-3". Amber for growth, emerald for a saving. */
const Delta: React.FC<{ value: number; suffix?: string }> = ({ value, suffix = '' }) => (
  <span className={value > 0 ? 'text-amber-700' : 'text-emerald-700'}>
    ({value > 0 ? '+' : ''}
    {value}
    {suffix})
  </span>
);

export interface PrintExportReportProps {
  result: PrintPdfResult;
  /** Render history, newest first, including the row just written for `result`. */
  renders: PrintRender[];
  pageSize: 'a4' | 'a5';
}

export const PrintExportReport: React.FC<PrintExportReportProps> = ({ result, renders, pageSize }) => {
  // A server predating migration 124 / the font audit sends neither. Render nothing rather than
  // an empty panel, which would imply the checks ran and passed.
  if (result.pages == null && !result.preflight) return null;

  const budget = summarisePageBudget(result, renders, pageSize);
  const preflight = summarisePreflight(result.preflight);
  const clean = (!preflight || preflight.clean) && !budget.spreadSuspicious;

  return (
    <div
      className={`rounded border px-3 py-2.5 text-xs ${
        clean ? 'border-gray-200 bg-gray-50 text-gray-700' : 'border-amber-200 bg-amber-50 text-amber-900'
      }`}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        <FileText size={13} className="shrink-0" />
        <span>
          {budget.total != null ? <>{budget.total} pages</> : 'Preflight'}
          {budget.delta != null && budget.delta !== 0 && (
            <span className="ml-1.5">
              <Delta value={budget.delta} /> <span className="font-normal text-gray-500">vs previous render</span>
            </span>
          )}
          {budget.delta === 0 && (
            <span className="ml-1.5 font-normal text-gray-500">(unchanged from previous render)</span>
          )}
        </span>
      </div>

      {budget.perLanguage.length > 0 && (
        <p className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-1">
          {budget.perLanguage.map(({ language, pages, delta }) => (
            <span key={language} className="whitespace-nowrap">
              <span className="font-semibold uppercase">{language}</span>{' '}
              <span className="text-gray-600">{pages}pp</span>
              {delta != null && delta !== 0 && (
                <>
                  {' '}
                  <Delta value={delta} />
                </>
              )}
            </span>
          ))}
        </p>
      )}

      <ul className="mt-2 space-y-1">
        {budget.perLanguage.length > 1 && (
          <Check ok={!budget.spreadSuspicious}>
            {budget.spreadSuspicious ? (
              <>
                Languages differ by <strong>{budget.spread} pages</strong> — more than translation
                length usually accounts for, so it is worth checking for a layout accident (an
                oversized image, or a table breaking badly in one language).
              </>
            ) : (
              <>
                Languages differ by {budget.spread} page{budget.spread === 1 ? '' : 's'} — normal for
                translation length.
              </>
            )}
          </Check>
        )}

        {preflight && (
          <>
            <Check ok={!preflight.nonEmbedded.length}>
              {preflight.nonEmbedded.length ? (
                <>
                  <strong>
                    {preflight.nonEmbedded.length} font
                    {preflight.nonEmbedded.length > 1 ? 's are' : ' is'} not embedded
                  </strong>{' '}
                  ({preflight.nonEmbedded.join(', ')}) — this fails preflight at any print vendor.
                  Do not send this file out.
                </>
              ) : (
                <>
                  All {preflight.fontCount} font{preflight.fontCount === 1 ? '' : 's'} embedded.
                </>
              )}
            </Check>

            {result.preflight?.footerInkClearanceMm != null && (
              <Check ok={!preflight.inkTooClose}>
                Footer ink sits <strong>{result.preflight.footerInkClearanceMm}mm</strong> from the
                trimmed edge
                {preflight.inkTooClose ? (
                  <>
                    {' '}
                    — under the {result.preflight.minInkClearanceMm}mm guard, so trimming could clip
                    it.
                  </>
                ) : (
                  <> (guard: {result.preflight.minInkClearanceMm}mm).</>
                )}
              </Check>
            )}

            {preflight.bottomMarginTooThin && (
              <Check ok={false}>
                The bottom margin is too thin to hold the footer clear of both the trim guard and the
                text block, so the footer may overlap body text. Raise it in Admin → IM Print.
              </Check>
            )}

            {preflight.unsupported.length > 0 && (
              <Check ok={false}>
                No embedded font covers <strong>{preflight.unsupported.join(' ')}</strong> in the
                stamped footer, so those characters were left out of it.
              </Check>
            )}
          </>
        )}
      </ul>
    </div>
  );
};
