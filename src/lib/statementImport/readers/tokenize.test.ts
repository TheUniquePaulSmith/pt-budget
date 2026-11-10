import { describe, expect, it } from 'vitest';

import { detectDelimiter, modalWidth, tokenizeDelimited } from './tokenize';

const cellsOf = (text: string, delimiter = ',') => tokenizeDelimited(text, delimiter).records.map((record) => record.cells);
const linesOf = (text: string, delimiter = ',') => tokenizeDelimited(text, delimiter).records.map((record) => record.line);

describe('tokenizeDelimited', () => {
  it('splits lines into cells for every kind of line ending', () => {
    const expected = [
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ];
    expect(cellsOf('a,b,c\n1,2,3\n4,5,6\n')).toEqual(expected);
    expect(cellsOf('a,b,c\r\n1,2,3\r\n4,5,6\r\n')).toEqual(expected);
    expect(cellsOf('a,b,c\r1,2,3\r4,5,6')).toEqual(expected);
    expect(linesOf('a,b,c\r1,2,3\r4,5,6')).toEqual([1, 2, 3]);
  });

  it('keeps cell text as written: untrimmed, empty cells included', () => {
    expect(cellsOf(' a , b,,c \n')).toEqual([[' a ', ' b', '', 'c ']]);
    expect(cellsOf('a,b,\n')).toEqual([['a', 'b', '']]);
    expect(cellsOf('a,b,')).toEqual([['a', 'b', '']]);
  });

  it('respects quotes: delimiters, doubled quotes and line breaks inside a cell', () => {
    expect(cellsOf('"COFFEE, BEANS & CO",-4.50\n')).toEqual([['COFFEE, BEANS & CO', '-4.50']]);
    expect(cellsOf('"He said ""hi""",1\n')).toEqual([['He said "hi"', '1']]);
    expect(cellsOf('"",1\n')).toEqual([['', '1']]);
    expect(cellsOf('1,"line one\nline two",2\n3,4,5\n')).toEqual([
      ['1', 'line one\nline two', '2'],
      ['3', '4', '5'],
    ]);
  });

  it('treats a quote in the middle of a cell as an ordinary character', () => {
    expect(cellsOf('5" PIPE,12.00\nBOB "THE BUILDER" LLC,3\n')).toEqual([
      ['5" PIPE', '12.00'],
      ['BOB "THE BUILDER" LLC', '3'],
    ]);
  });

  it('accepts a quoted cell after spaces and keeps text that trails a closing quote', () => {
    expect(cellsOf('a, "b, c", d\n')).toEqual([['a', 'b, c', ' d']]);
    expect(cellsOf('"ACME" INC,1\n')).toEqual([['ACME INC', '1']]);
    expect(cellsOf('"padded"  ,1\n')).toEqual([['padded', '1']]);
  });

  it('numbers records by the file line they start on, counting blank lines and quoted line breaks', () => {
    const text = ['h1,h2', '', 'a,"x', 'y', 'z"', '', '', 'b,c', '   ', ',', 'd,e'].join('\r\n');
    const { records } = tokenizeDelimited(text, ',');
    expect(records.map((record) => [record.line, record.cells])).toEqual([
      [1, ['h1', 'h2']],
      [3, ['a', 'x\r\ny\r\nz']],
      [8, ['b', 'c']],
      [11, ['d', 'e']],
    ]);
  });

  it('records where each record sits in the text, without its line break', () => {
    const text = 'a,b\r\n\r\n"c\nd",e\n';
    const { records } = tokenizeDelimited(text, ',');
    expect(records.map((record) => text.slice(record.start, record.end))).toEqual(['a,b', '"c\nd",e']);
  });

  it('says whether the last record was followed by a line break', () => {
    expect(tokenizeDelimited('a,b\nc,d\n', ',').lastRecordTerminated).toBe(true);
    expect(tokenizeDelimited('a,b\nc,d', ',').lastRecordTerminated).toBe(false);
    // Blank lines after the last record do not count against it.
    expect(tokenizeDelimited('a,b\nc,d\n\n  \n', ',').lastRecordTerminated).toBe(true);
  });

  it('flags a file that ends inside a quoted cell on its last line', () => {
    const { records } = tokenizeDelimited('a,b\n1,"unfinished cel', ',');
    expect(records).toHaveLength(2);
    expect(records[1]).toMatchObject({ cells: ['1', 'unfinished cel'], openQuote: true, line: 2 });
  });

  it('does not let a quote that never closes swallow the lines below it', () => {
    const { records } = tokenizeDelimited('a,b\n1,"STRAY QUOTE\n2,ok\n3,ok\n', ',');
    expect(records.map((record) => record.cells)).toEqual([
      ['a', 'b'],
      ['1', '"STRAY QUOTE'],
      ['2', 'ok'],
      ['3', 'ok'],
    ]);
    expect(records.every((record) => !record.openQuote)).toBe(true);
    expect(records.map((record) => record.line)).toEqual([1, 2, 3, 4]);
  });

  it('works with tab, semicolon, pipe and multi-character delimiters', () => {
    expect(cellsOf('a\tb c\t"d\te"\n', '\t')).toEqual([['a', 'b c', 'd\te']]);
    expect(cellsOf('a;b,c;"d;e"\n', ';')).toEqual([['a', 'b,c', 'd;e']]);
    expect(cellsOf('a|b|c\n', '|')).toEqual([['a', 'b', 'c']]);
    expect(cellsOf('a||b|c||d\n', '||')).toEqual([['a', 'b|c', 'd']]);
  });

  it('stops after the number of records asked for', () => {
    const { records } = tokenizeDelimited('1,a\n2,b\n3,c\n4,d\n', ',', 2);
    expect(records.map((record) => record.cells[0])).toEqual(['1', '2']);
  });
});

describe('modalWidth', () => {
  const widths = (text: string) => modalWidth(tokenizeDelimited(text, ',').records);

  it('is the cell count most lines have, ignoring one-cell lines', () => {
    expect(widths('Bank\nAccount 1\n\na,b,c\n1,2,3\n4,5,6\nEnd\n')).toBe(3);
    expect(widths('a,b,c\n1,2\n3,4,5\n6,7,8,9\n')).toBe(3);
  });

  it('prefers the wider table on a tie and is 1 when nothing has two cells', () => {
    expect(widths('a,b,c\n1,2,3,\n')).toBe(4);
    expect(widths('one\ntwo\n')).toBe(1);
    expect(modalWidth([])).toBe(1);
  });
});

describe('detectDelimiter', () => {
  it('finds comma, semicolon, tab and pipe', () => {
    expect(detectDelimiter('Date,Description,Amount\n2026-09-01,COFFEE,-4.50\n')).toBe(',');
    expect(detectDelimiter('Date;Description;Amount\n2026-09-01;COFFEE;-4.50\n')).toBe(';');
    expect(detectDelimiter('Date\tDescription\tAmount\n2026-09-01\tCOFFEE\t-4.50\n')).toBe('\t');
    expect(detectDelimiter('Date|Description|Amount\n2026-09-01|COFFEE|-4.50\n')).toBe('|');
  });

  it('is not fooled by decimal commas in a semicolon file', () => {
    const withHeader = 'Datum;Text;Betrag\n01.09.2026;Miete;-1.250,00\n02.09.2026;Lohn;3.400,50\n03.09.2026;Brot;-7,35\n';
    expect(detectDelimiter(withHeader)).toBe(';');
    // No header to break the tie: both split every line alike, the wider table wins.
    const headerless = '01.09.2026;Miete;-1.250,00\n02.09.2026;Lohn;3.400,50\n03.09.2026;Brot;-7,35\n';
    expect(detectDelimiter(headerless)).toBe(';');
  });

  it('is not fooled by other separators inside the text', () => {
    const tabbed = 'Date\tDescription\tAmount\n2026-09-01\tACME, INC\t1,250.00\n2026-09-02\tSHOP; DELI\t-4.50\n2026-09-03\tA|B\t-1.00\n';
    expect(detectDelimiter(tabbed)).toBe('\t');
    const quoted = 'Date,Description,Amount\n2026-09-01,"A;B;C;D",1\n2026-09-02,"E;F;G;H",2\n';
    expect(detectDelimiter(quoted)).toBe(',');
  });

  it('looks past preamble lines that have no separator', () => {
    const text = 'Example Bank\nAccount 000123\nPeriod September\n\nDate;Text;Betrag\n01.09.2026;Miete;-1250\n02.09.2026;Lohn;3400\n';
    expect(detectDelimiter(text)).toBe(';');
  });

  it('returns null when no candidate splits any line', () => {
    expect(detectDelimiter('Dear customer\nYour statement is ready\n')).toBeNull();
    expect(detectDelimiter('')).toBeNull();
  });
});
