import { describe, expect, it } from 'vitest';

import { sourceFileFromText } from '../testing/tableFromCsv';
import type { ReadOptions, StatementTable } from '../types';

import { readStatement } from './index';

const lines = (...parts: string[]) => `${parts.join('\n')}\n`;

async function read(text: string, options?: ReadOptions, name = 'statement.csv'): Promise<StatementTable> {
  const { tables, issues } = await readStatement(sourceFileFromText(text, name), options);
  expect(issues).toEqual([]);
  expect(tables).toHaveLength(1);
  return tables[0];
}

const codes = (table: StatementTable) => table.notes.map((note) => note.code);
const names = (table: StatementTable) => table.columns.map((column) => column.name);

describe('delimited reader: finding the header', () => {
  it('skips bank preamble, keeps it, and reports the header line', async () => {
    const table = await read(
      lines(
        'Example Bank',
        'Account: Everyday Checking',
        'From 09/01/2026 to 09/30/2026',
        '',
        'Date,Description,Amount',
        '09/02/2026,COFFEE,-4.50',
        '09/03/2026,PAYROLL,1250.00'
      )
    );
    expect(names(table)).toEqual(['Date', 'Description', 'Amount']);
    expect(table.meta.headerLine).toBe(5);
    expect(table.meta.preamble).toEqual(['Example Bank', 'Account: Everyday Checking', 'From 09/01/2026 to 09/30/2026']);
    expect(table.sourceLines).toEqual([6, 7]);
    expect(table.notes).toEqual([{ code: 'preambleSkipped', severity: 'info', scope: 'file', params: { count: 3 } }]);
  });

  it('copes with preamble padded to the table width, as a spreadsheet saves it', async () => {
    const table = await read(
      lines(
        'Example Bank,,,',
        'Account Number:,000123456789,,',
        ',,,',
        'Date,Description,Amount,Balance',
        '09/02/2026,COFFEE,-4.50,995.50',
        '09/03/2026,PAYROLL,1250.00,2245.50'
      )
    );
    expect(names(table)).toEqual(['Date', 'Description', 'Amount', 'Balance']);
    expect(table.meta.headerLine).toBe(4);
    // The padding is not part of what the line says.
    expect(table.meta.preamble).toEqual(['Example Bank', 'Account Number:,000123456789']);
    expect(table.rows).toHaveLength(2);
    expect(table.meta.accountHints).toContainEqual({ kind: 'number', value: '000123456789', source: 'preamble' });
  });

  it('is not misled by a preamble line that happens to be as wide as the table', async () => {
    const table = await read(
      lines(
        'Statement Period,09/01/2026,09/30/2026',
        'Date,Description,Amount',
        '09/02/2026,COFFEE,-4.50',
        '09/03/2026,PAYROLL,1250.00',
        '09/04/2026,BOOKS,-12.00'
      )
    );
    expect(names(table)).toEqual(['Date', 'Description', 'Amount']);
    expect(table.meta.headerLine).toBe(2);
    expect(table.meta.preamble).toEqual(['Statement Period,09/01/2026,09/30/2026']);
    expect(table.rows).toHaveLength(3);
  });

  it('finds a short table under a longer block of label / value lines', async () => {
    const table = await read(
      lines(
        'Bank,Example Bank',
        'Account Number,000123456789',
        'From,09/01/2026',
        'To,09/30/2026',
        'Opening balance,"1,000.00"',
        'Closing balance,"2,245.50"',
        'Total credits,1250.00',
        '',
        'Date,Description,Amount,Balance',
        '09/02/2026,COFFEE,-4.50,995.50',
        '09/03/2026,PAYROLL,1250.00,2245.50'
      )
    );
    expect(names(table)).toEqual(['Date', 'Description', 'Amount', 'Balance']);
    expect(table.meta.headerLine).toBe(9);
    expect(table.meta.preamble).toHaveLength(7);
    expect(table.rows).toEqual([
      ['09/02/2026', 'COFFEE', '-4.50', '995.50'],
      ['09/03/2026', 'PAYROLL', '1250.00', '2245.50'],
    ]);
    expect(table.meta.accountHints).toContainEqual({ kind: 'number', value: '000123456789', source: 'preamble' });
    expect(codes(table)).toEqual(['preambleSkipped']);
  });

  it('reads a two-column table, and is not thrown by one wider line above it', async () => {
    const table = await read(
      lines('Statement Period,09/01/2026,09/30/2026', 'Date,Amount', '09/02/2026,-4.50', '09/03/2026,1250.00', '09/04/2026,-12.00')
    );
    expect(names(table)).toEqual(['Date', 'Amount']);
    expect(table.rows).toHaveLength(3);
    expect(table.meta.preamble).toEqual(['Statement Period,09/01/2026,09/30/2026']);
  });

  it('finds the header by the shape of the cells, whatever language it is in', async () => {
    const japanese = await read(lines('ご利用明細', '日付,摘要,金額', '2026年9月1日,コーヒー,-450', '2026年9月2日,給与,250000'));
    expect(names(japanese)).toEqual(['日付', '摘要', '金額']);
    expect(japanese.meta.headerLine).toBe(2);
    expect(japanese.rows).toHaveLength(2);

    const german = await read(lines('Buchungstag;Verwendungszweck;Betrag', '01.09.2026;Miete;-1.250,00', '02.09.2026;Gehalt;3.400,50'));
    expect(names(german)).toEqual(['Buchungstag', 'Verwendungszweck', 'Betrag']);
    expect(german.meta.delimiter).toBe(';');

    // Dates with month names, amounts with currency symbols and accounting negatives.
    const monthNames = await read(
      lines('Statement', 'When,What,How much', '14 Sep 2026,COFFEE,($4.50)', '"Sep 15, 2026",BOOKS,"$1,200.00"', '16-Sep-26,TEA,3.00 CR')
    );
    expect(names(monthNames)).toEqual(['When', 'What', 'How much']);
    expect(monthNames.meta.headerLine).toBe(2);
    expect(monthNames.rows).toHaveLength(3);
  });

  it('keeps a first data row that has an unreadable cell', async () => {
    const table = await read(
      lines('Date,Description,Amount', 'someday,ODD ROW,5.00', '2026-09-02,COFFEE,-4.50', '2026-09-03,PAYROLL,1250.00')
    );
    expect(table.meta.headerLine).toBe(1);
    expect(table.rows.map((row) => row[0])).toEqual(['someday', '2026-09-02', '2026-09-03']);
    expect(table.notes).toEqual([]);
  });

  it('trims header names and collapses the white space inside them', async () => {
    const table = await read(lines(' Posting   Date ,"Description\nof payment", Amount ', '2026-09-02,COFFEE,-4.50'));
    expect(names(table)).toEqual(['Posting Date', 'Description of payment', 'Amount']);
    expect(table.fingerprint).toBe('delimited:posting date|description of payment|amount');
    expect(table.sourceLines).toEqual([3]);
  });

  it('falls back to the first full line when nothing in the file is a date or a number', async () => {
    const table = await read(lines('When,Payee,Value', 'yesterday,ACME,some', 'today,BETA,more'));
    expect(names(table)).toEqual(['When', 'Payee', 'Value']);
    expect(table.rows).toHaveLength(2);
  });
});

describe('delimited reader: files with no header row', () => {
  it('names the columns "Column n" and starts the data on the first line', async () => {
    const table = await read(lines('2026-09-01,COFFEE,-4.50', '2026-09-02,PAYROLL,1250.00'));
    expect(table.columns).toEqual([
      { index: 0, name: 'Column 1', synthetic: true },
      { index: 1, name: 'Column 2', synthetic: true },
      { index: 2, name: 'Column 3', synthetic: true },
    ]);
    expect(table.meta.headerLine).toBeNull();
    expect(table.sourceLines).toEqual([1, 2]);
    expect(table.fingerprint).toBe('delimited:noheader:3');
    expect(table.notes).toEqual([{ code: 'headerMissing', severity: 'warning', scope: 'file', params: { columns: 3 } }]);
  });

  it('works for a single line of data', async () => {
    const table = await read('2026-09-01,COFFEE,-4.50');
    expect(table.rows).toEqual([['2026-09-01', 'COFFEE', '-4.50']]);
    expect(codes(table)).toEqual(['headerMissing']);
  });

  it('still skips preamble above headerless data', async () => {
    const table = await read(lines('Example Bank', 'Account 000123456789', '2026-09-01,COFFEE,-4.50', '2026-09-02,PAYROLL,1250.00'));
    expect(table.meta.preamble).toEqual(['Example Bank', 'Account 000123456789']);
    expect(table.sourceLines).toEqual([3, 4]);
    expect(codes(table)).toEqual(['preambleSkipped', 'headerMissing']);
  });

  it('reports a header with no rows under it instead of an empty table', async () => {
    const noRows = { tables: [], issues: [{ code: 'noDataRows', severity: 'blocker', scope: 'file' }] };
    expect(await readStatement(sourceFileFromText('Date,Description,Amount\n'))).toEqual(noRows);
    expect(await readStatement(sourceFileFromText('Example Bank\n\nDate,Description,Amount'))).toEqual(noRows);
  });
});

describe('delimited reader: options that replace detection', () => {
  const twoLabelRows = lines('Posted,Details,Value', 'Date,Description,Amount', '2026-09-01,COFFEE,-4.50', '2026-09-02,PAYROLL,1250.00');

  it('headerLine names the header row', async () => {
    const detected = await read(twoLabelRows);
    expect(detected.meta.headerLine).toBe(2);
    expect(detected.meta.preamble).toEqual(['Posted,Details,Value']);

    const chosen = await read(twoLabelRows, { headerLine: 1 });
    expect(names(chosen)).toEqual(['Posted', 'Details', 'Value']);
    expect(chosen.meta.headerLine).toBe(1);
    expect(chosen.meta.preamble).toEqual([]);
    expect(chosen.rows[0]).toEqual(['Date', 'Description', 'Amount']);
    expect(chosen.sourceLines).toEqual([2, 3, 4]);
  });

  it('headerLine on a blank line means the next line down', async () => {
    const table = await read(lines('Example Bank', '', 'Date,Description,Amount', '2026-09-01,COFFEE,-4.50'), { headerLine: 2 });
    expect(names(table)).toEqual(['Date', 'Description', 'Amount']);
    expect(table.meta.headerLine).toBe(3);
  });

  it('headerLine: null means the file has no header, so a row of names is data', async () => {
    const table = await read(lines('Example Bank', 'Date,Description,Amount', '2026-09-01,COFFEE,-4.50'), { headerLine: null });
    expect(names(table)).toEqual(['Column 1', 'Column 2', 'Column 3']);
    expect(table.meta.headerLine).toBeNull();
    expect(table.rows).toEqual([
      ['Date', 'Description', 'Amount'],
      ['2026-09-01', 'COFFEE', '-4.50'],
    ]);
    expect(table.meta.preamble).toEqual(['Example Bank']);
  });

  it('delimiter wins over what the file looks like', async () => {
    const text = lines('Date;Description, long;Amount', '2026-09-01;COFFEE, large;-4.50', '2026-09-02;TEA, small;-3.00');
    expect((await read(text)).meta.delimiter).toBe(';');
    const forced = await read(text, { delimiter: ',' });
    expect(forced.meta.delimiter).toBe(',');
    expect(names(forced)).toEqual(['Date;Description', 'long;Amount']);
  });

  it('encoding wins over detection and is reported under its standard label', async () => {
    const table = await read(lines('Date,Description,Amount', '2026-09-01,Café,-4.50'), { encoding: 'latin1' });
    expect(table.meta.encoding).toBe('windows-1252');
    expect(table.rows[0][1]).toBe('CafÃ©');
    expect(table.notes).toEqual([]);
  });

  it("follows a spreadsheet's sep= line without counting it as preamble", async () => {
    const table = await read(lines('sep=;', 'Date;Description;Amount', '2026-09-01;COFFEE, large;-4.50'));
    expect(table.meta.delimiter).toBe(';');
    expect(table.meta.headerLine).toBe(2);
    expect(table.meta.preamble).toEqual([]);
    expect(table.sourceLines).toEqual([3]);
    expect(table.notes).toEqual([]);
  });
});

describe('delimited reader: lines below the data', () => {
  it('skips totals, closing lines and disclaimers and keeps them in meta.trailer', async () => {
    const table = await read(
      lines(
        'Date,Description,Amount,Balance',
        '2026-09-01,RENT,-1200.00,800.00',
        '2026-09-05,GROCERY,-56.30,743.70',
        ',Closing balance,,743.70',
        'Total,,-1256.30,',
        '',
        'End of report',
        '"Balances are provisional, and may change, until the statement is issued"'
      )
    );
    expect(table.rows).toHaveLength(2);
    expect(table.meta.trailer).toEqual([
      ',Closing balance,,743.70',
      'Total,,-1256.30',
      'End of report',
      '"Balances are provisional, and may change, until the statement is issued"',
    ]);
    expect(table.notes).toEqual([{ code: 'trailerSkipped', severity: 'info', scope: 'file', params: { count: 4 } }]);
  });

  it('leaves a complete last row with a bad date for the analysis to report', async () => {
    const table = await read(lines('Date,Description,Amount', '2026-09-01,RENT,-1200.00', '2026-09-05,GROCERY,-56.30', 'someday,MYSTERY,-5.00'));
    expect(table.rows).toHaveLength(3);
    expect(table.meta.trailer).toEqual([]);
    expect(table.notes).toEqual([]);
  });

  it('keeps a pending row with no posting date when the table is wide enough to tell it from a total', async () => {
    const table = await read(
      lines(
        'Posted,Description,Category,Status,Amount',
        '2026-09-01,RENT,Housing,Posted,-1200.00',
        '2026-09-05,GROCERY,Food,Posted,-56.30',
        ',COFFEE,Food,Pending,-4.50',
        'Total,,,,-1260.80'
      )
    );
    expect(table.rows.map((row) => row[1])).toEqual(['RENT', 'GROCERY', 'COFFEE']);
    expect(table.meta.trailer).toEqual(['Total,,,,-1260.80']);
  });

  it('does not take a total in the middle of the data: only what follows the last row', async () => {
    const table = await read(
      lines('Date,Description,Amount', '2026-09-01,RENT,-1200.00', 'Subtotal,,-1200.00', '2026-09-05,GROCERY,-56.30')
    );
    expect(table.rows).toHaveLength(3);
    expect(table.meta.trailer).toEqual([]);
  });

  it('reports a file whose only lines under the header are notes as having no rows', async () => {
    const result = await readStatement(sourceFileFromText(lines('Date,Description,Amount', 'No activity in this period')));
    expect(result.tables).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual(['noDataRows']);
  });

  it('leaves a lone total under the header to the analysis: there are no rows to tell it from', async () => {
    const table = await read(lines('Date,Description,Amount', 'Total,,0.00'));
    expect(table.rows).toEqual([['Total', '', '0.00']]);
    expect(table.meta.trailer).toEqual([]);
  });

  it('keeps a two-cell label line above three columns of data as preamble, not as a header', async () => {
    const table = await read(lines('Account,Everyday Checking', '2026-09-01,COFFEE,-4.50', '2026-09-02,TEA,-3.00'));
    expect(table.meta.headerLine).toBeNull();
    expect(table.meta.preamble).toEqual(['Account,Everyday Checking']);
    expect(table.rows).toHaveLength(2);
  });
});

describe('delimited reader: rows of the wrong width', () => {
  it('pads short rows, cuts long ones, and lists both', async () => {
    const table = await read(
      lines(
        'Date,Description,Amount,Memo',
        '2026-09-01,COFFEE,-4.50,morning',
        '2026-09-02,TEA',
        '2026-09-03,ACME, INC,-9.00,x',
        '2026-09-04,BOOKS,-12.00,'
      )
    );
    expect(table.rows).toEqual([
      ['2026-09-01', 'COFFEE', '-4.50', 'morning'],
      ['2026-09-02', 'TEA', '', ''],
      ['2026-09-03', 'ACME', ' INC', '-9.00'],
      ['2026-09-04', 'BOOKS', '-12.00', ''],
    ]);
    expect(table.rows.every((row) => row.length === table.columns.length)).toBe(true);
    expect(table.notes).toEqual([{ code: 'raggedRows', severity: 'warning', scope: 'row', rows: [1, 2], params: { count: 2 } }]);
  });

  it('does not call a trailing delimiter on every row ragged', async () => {
    const dataOnly = await read(lines('Date,Description,Amount', '2026-09-01,COFFEE,-4.50,', '2026-09-02,TEA,-3.00,'));
    expect(names(dataOnly)).toEqual(['Date', 'Description', 'Amount']);
    expect(dataOnly.rows[0]).toEqual(['2026-09-01', 'COFFEE', '-4.50']);
    expect(dataOnly.notes).toEqual([]);

    const everywhere = await read(lines('Date,Description,Amount,', '2026-09-01,COFFEE,-4.50,', '2026-09-02,TEA,-3.00,'));
    expect(names(everywhere)).toEqual(['Date', 'Description', 'Amount']);
    expect(everywhere.notes).toEqual([]);
    expect(everywhere.fingerprint).toBe(dataOnly.fingerprint);
  });

  it('adds columns when most rows carry values the header has no name for', async () => {
    const table = await read(lines('Date,Description,Amount', '2026-09-01,COFFEE,-4.50,995.50', '2026-09-02,TEA,-3.00,992.50'));
    expect(table.columns).toEqual([
      { index: 0, name: 'Date' },
      { index: 1, name: 'Description' },
      { index: 2, name: 'Amount' },
      { index: 3, name: 'Column 4', synthetic: true },
    ]);
    expect(table.rows[0]).toEqual(['2026-09-01', 'COFFEE', '-4.50', '995.50']);
    expect(table.notes).toEqual([]);
    // One made-up name does not make it a headerless file.
    expect(table.fingerprint).toBe('delimited:date|description|amount|column 4');
  });
});

describe('delimited reader: header names', () => {
  it('makes repeated names unique, whatever their case, and says which', async () => {
    const table = await read(lines('Date,Amount,Description,amount,Date,Amount', '2026-09-01,1.00,X,2.00,2026-09-02,3.00'));
    expect(names(table)).toEqual(['Date', 'Amount', 'Description', 'amount (2)', 'Date (2)', 'Amount (3)']);
    expect(table.notes).toEqual([
      { code: 'duplicateHeaderNames', severity: 'info', scope: 'file', params: { names: 'amount, Date, Amount', count: 3 } },
    ]);
  });

  it('gives an unnamed column a made-up name', async () => {
    const table = await read(lines('Date,,Amount', '2026-09-01,COFFEE,-4.50', '2026-09-02,TEA,-3.00'));
    expect(table.columns).toEqual([
      { index: 0, name: 'Date' },
      { index: 1, name: 'Column 2', synthetic: true },
      { index: 2, name: 'Amount' },
    ]);
    expect(table.notes).toEqual([]);
  });

  it('gives two exports of the same shape the same fingerprint', async () => {
    const first = await read(lines('Posting Date,Description,Amount', '2026-09-01,COFFEE,-4.50'));
    const second = await read(
      lines('Example Bank', '', 'POSTING  DATE, description ,Ａｍｏｕｎｔ', '2026-10-01,TEA,-3.00', '2026-10-02,BOOKS,-12.00', 'Total,,-15.00')
    );
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(first.fingerprint).toBe('delimited:posting date|description|amount');
  });
});

describe('delimited reader: files cut off mid-row', () => {
  it('leaves out a last line that stops part-way and flags the file', async () => {
    const table = await read('Date,Description,Amount,Balance\n2026-09-01,COFFEE,-4.50,995.50\n2026-09-02,PAYROLL,1250.00,2245.50\n2026-09-03,BOO');
    expect(table.rows).toHaveLength(2);
    expect(table.meta.trailer).toEqual(['2026-09-03,BOO']);
    expect(table.notes).toEqual([{ code: 'truncatedFile', severity: 'warning', scope: 'file', params: { line: 4 } }]);
  });

  it('recognises a file that ends inside a quoted cell', async () => {
    const table = await read('Date,Description,Amount\n2026-09-01,COFFEE,-4.50\n2026-09-02,TEA,-3.00\n2026-09-03,"BOOKS AND');
    expect(table.rows).toHaveLength(2);
    expect(codes(table)).toEqual(['truncatedFile']);
    expect(table.meta.trailer).toEqual(['2026-09-03,"BOOKS AND']);
  });

  it('does not flag a complete last row that merely has no line break after it', async () => {
    const table = await read('Date,Description,Amount\n2026-09-01,COFFEE,-4.50\n2026-09-02,TEA,-3.00');
    expect(table.rows).toHaveLength(2);
    expect(table.notes).toEqual([]);
  });

  it('does not flag a short last row when other rows are short the same way', async () => {
    const table = await read('Date,Description,Amount,Memo\n2026-09-01,COFFEE,-4.50,x\n2026-09-02,TEA,-3.00\n2026-09-03,BOOKS,-12.00,y\n2026-09-04,PENS,-2.00');
    expect(table.rows).toHaveLength(4);
    expect(codes(table)).toEqual(['raggedRows']);
  });

  it('does not flag a short last line that ends with a line break', async () => {
    const table = await read(lines('Date,Description,Amount,Balance', '2026-09-01,COFFEE,-4.50,995.50', '2026-09-02,TEA,-3.00,992.50', '2026-09-03,BOO'));
    expect(table.rows).toHaveLength(3);
    expect(codes(table)).toEqual(['raggedRows']);
  });
});

describe('delimited reader: notes', () => {
  it('lists what it decided in reading order', async () => {
    // "é" as the single byte E9 makes the file Windows-1252.
    const text = lines('Bank of Examples', 'Date,Description,Amount,Amount', '2026-09-01,CAFé,-4.50,', '2026-09-02,TEA,-3.00', 'Total,,-7.50,');
    const bytes = Uint8Array.from(text, (character) => character.charCodeAt(0));
    const { tables } = await readStatement({ name: 'export.csv', size: bytes.length, bytes });
    expect(codes(tables[0])).toEqual(['encodingGuessed', 'preambleSkipped', 'duplicateHeaderNames', 'raggedRows', 'trailerSkipped']);
    expect(tables[0].rows[0][1]).toBe('CAFé');
    for (const note of tables[0].notes) {
      expect(note.severity).toMatch(/^(info|warning)$/);
    }
  });

  it('has none for a plain file', async () => {
    const table = await read(lines('Date,Description,Amount', '2026-09-01,COFFEE,-4.50'));
    expect(table.notes).toEqual([]);
    expect(table.meta).toEqual({
      fileName: 'statement.csv',
      encoding: 'utf-8',
      delimiter: ',',
      headerLine: 1,
      preamble: [],
      trailer: [],
      accountHints: [],
    });
  });
});
