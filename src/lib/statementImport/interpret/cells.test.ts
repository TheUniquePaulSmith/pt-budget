import { describe, expect, it } from 'vitest';

import { parseCsvDate } from '../../dateOnly';

import { DateReader, decimalEvidenceOf, isAmountShaped, isExcelMangled, readAmountCell } from './cells';

describe('amount cells', () => {
  it.each([
    '12.34',
    '-12.34',
    '+12.34',
    '(12.34)',
    '12.34-',
    '$1,234.56',
    '-$12.34',
    '€ 1.234,56',
    '1 234,56 €',
    "1'234.56",
    'USD 12.34',
    '12.34 USD',
    '12.34 CR',
    'DR 12.34',
    '.50',
    '0',
    '−12.34',
  ])('%s is an amount', (cell) => {
    expect(isAmountShaped(cell)).toBe(true);
  });

  it.each(['', '   ', 'N/A', '-', 'GROCERY MART 0421', '12/05/2026', '2026-10-01', 'lots', '25%', '1.23E+05', 'ABC123'])(
    '"%s" is not an amount',
    (cell) => {
      expect(isAmountShaped(cell)).toBe(false);
    }
  );

  it('recognises numbers a spreadsheet rewrote', () => {
    expect(isExcelMangled('4.00E+14')).toBe(true);
    expect(isExcelMangled('-1.25e4')).toBe(true);
    expect(isExcelMangled('1,23E+05')).toBe(true);
    expect(isExcelMangled('1.25')).toBe(false);
    expect(isExcelMangled('E+14')).toBe(false);
  });

  it.each([
    ['12.50', 'point'],
    ['1,234.56', 'point'],
    ['1,234,567', 'point'],
    ['.50', 'point'],
    ['12,50', 'comma'],
    ['1.234,56', 'comma'],
    ['1.234.567', 'comma'],
    ['1 234,5', 'comma'],
    ['0,234', 'comma'],
    ['1234,567', 'comma'],
    ['1,234', 'ambiguousComma'],
    ['-285,000', 'ambiguousComma'],
    ['1.234', 'ambiguousPoint'],
    ['1234', 'none'],
    ["Fr. 1'234.50", 'point'],
    ['kr. 99', 'none'],
  ] as const)('%s says "%s" about the decimal mark', (cell, expected) => {
    expect(decimalEvidenceOf(cell)).toBe(expected);
  });

  it('reads a cell with the file mark, and nothing that is not an amount', () => {
    expect(readAmountCell('1.234,56', ',')).toBe(1234.56);
    expect(readAmountCell('1,234.56', '.')).toBe(1234.56);
    expect(readAmountCell('1,234', '.')).toBe(1234);
    expect(readAmountCell('1,234', ',')).toBe(1.234);
    expect(readAmountCell('(15.00)', '.')).toBe(-15);
    expect(readAmountCell('12.34 DR', '.')).toBe(-12.34);
    // The typographic minus some exports use is a minus.
    expect(readAmountCell('−42.10', '.')).toBe(-42.1);
    expect(readAmountCell('GROCERY MART 0421', '.')).toBeNull();
    expect(readAmountCell('1.23E+05', '.')).toBeNull();
    expect(readAmountCell('', '.')).toBeNull();
  });
});

describe('date cells', () => {
  const reader = new DateReader();

  it.each([
    ['2026-10-01', 'fixed'],
    ['2026/10/01', 'fixed'],
    ['2026.10.01', 'fixed'],
    ['2026年9月1日', 'fixed'],
    ['20261001', 'fixed'],
    ['2026-04-26T10:00:00Z', 'fixed'],
    ['12 Oct 2026', 'fixed'],
    ['Oct 12, 2026', 'fixed'],
    ['05/05/2026', 'fixed'],
    ['23/04/2026', 'dayFirst'],
    ['01.10.2026', 'dayFirst'],
    ['04/23/2026', 'monthFirst'],
    ['04/06/2026', 'either'],
    ['4/6/26', 'either'],
    ['04/06/2026 14:33:12', 'either'],
    ['someday', 'none'],
    ['54.20', 'none'],
    ['31/31/2026', 'none'],
    ['', 'none'],
  ] as const)('%s is "%s"', (cell, expected) => {
    expect(reader.read(cell).evidence).toBe(expected);
  });

  it('reads exactly what the strict parser reads, in either order', () => {
    const cells = [
      '2026-10-01', '2026/1/5', '04/06/2026', '23/04/2026', '04/23/2026', '01.10.2026', '1.10.26', '12-Oct-2026',
      'Oct 12 2026', '2026年10月1日', '20261001', '04/06/2026 08:15', '10-02-2026', 'someday', '13/13/2026', '  2026-10-01  ',
      '"2026-10-01"', '99.99', '1/2/3',
      // Timestamps take a shortcut through their date part: it must give what the parser gives.
      '04/06/2026 14:33:12', '23/06/2026 00:00', '6/23/2026 23:59:59', '2026-10-01 07:05', '2026-10-01 07:05:09',
      '2026-02-30 10:00:00', '04/06/2026 25:00', '04/06/2026 9:05', '04/06/26 10:00', '04-06-2026 10:00', '2026/10/01 10:00',
      '04.06.2026 10:00', ' 04/06/2026 10:00 ',
    ];
    for (const cell of cells) {
      expect(reader.inOrder(cell, 'DMY'), `${cell} day first`).toBe(parseCsvDate(cell, { order: 'DMY', strict: true }));
      expect(reader.inOrder(cell, 'MDY'), `${cell} month first`).toBe(parseCsvDate(cell, { order: 'MDY', strict: true }));
      expect(reader.inOrder(cell, 'YMD'), `${cell} year first`).toBe(parseCsvDate(cell, { order: 'YMD', strict: true }));
    }
  });

  it('never falls back to the other order for one row', () => {
    expect(reader.inOrder('23/04/2026', 'MDY')).toBeNull();
    expect(reader.inOrder('04/23/2026', 'DMY')).toBeNull();
    expect(reader.inOrder('04/06/2026', 'MDY')).toBe('2026-04-06');
    expect(reader.inOrder('04/06/2026', 'DMY')).toBe('2026-06-04');
  });
});
