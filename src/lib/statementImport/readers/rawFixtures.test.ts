/**
 * What the reader must make of each file in tests/fixtures/statements/raw,
 * beyond what the manifests state (the corpus test checks those): the cells,
 * the real source lines, the skipped lines, the account hints and the
 * parameters of each note.
 */

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { ReadResult, StatementTable } from '../types';

import { readStatement } from './index';

const RAW = path.resolve(process.cwd(), 'tests', 'fixtures', 'statements', 'raw');

async function readFixture(name: string): Promise<ReadResult> {
  const bytes = new Uint8Array(fs.readFileSync(path.join(RAW, name)));
  return readStatement({ name, size: bytes.length, bytes });
}

async function tableOf(name: string): Promise<StatementTable> {
  const { tables, issues } = await readFixture(name);
  expect(issues).toEqual([]);
  expect(tables).toHaveLength(1);
  return tables[0];
}

describe('raw statement fixtures', () => {
  it('has a manifest for every data file and a data file for every manifest', () => {
    const names = fs.readdirSync(RAW);
    const manifests = names.filter((name) => name.endsWith('.expected.json'));
    const dataFiles = names.filter((name) => !name.endsWith('.expected.json') && !name.endsWith('.mjs'));
    expect(dataFiles.length).toBeGreaterThanOrEqual(12);
    expect(manifests.map((name) => JSON.parse(fs.readFileSync(path.join(RAW, name), 'utf8')).file).sort()).toEqual(
      dataFiles.sort()
    );
  });

  it('utf8-bom-crlf.csv: the byte-order mark is not part of the first header name', async () => {
    const table = await tableOf('utf8-bom-crlf.csv');
    expect(table.columns[0]).toEqual({ index: 0, name: 'Date' });
    expect(table.rows).toEqual([
      ['2026-09-01', 'CAFÉ DU COIN', '-4.50'],
      ['2026-09-02', 'REFUND, ONLINE ORDER', '19.99'],
    ]);
    expect(table.sourceLines).toEqual([2, 3]);
  });

  it('utf16-tab.txt: UTF-16 with a mark, tab-separated, a comma inside a cell', async () => {
    const table = await tableOf('utf16-tab.txt');
    expect(table.meta).toMatchObject({ encoding: 'utf-16le', delimiter: '\t', headerLine: 1, preamble: [], trailer: [] });
    expect(table.rows).toEqual([
      ['09/03/2026', 'CAFÉ LUNA', '-6.75', '1,243.25'],
      ['09/04/2026', 'PAYROLL NORTHWIND LLC', '2,150.00', '3,393.25'],
      ['09/05/2026', "GROCER'S OUTLET, MAIN ST", '-82.19', '3,311.06'],
    ]);
    expect(table.sourceLines).toEqual([2, 3, 4]);
  });

  it('windows-1252-accents.csv: decoded as Windows-1252 and says it guessed', async () => {
    const table = await tableOf('windows-1252-accents.csv');
    expect(table.rows.map((row) => row[1])).toEqual(['CRÉDIT AGRICOLE – VIREMENT', 'BÄCKEREI MÜLLER', 'FRAIS BANCAIRES, 2 €']);
    expect(table.notes).toEqual([
      { code: 'encodingGuessed', severity: 'info', scope: 'file', params: { encoding: 'windows-1252' } },
    ]);
  });

  it('semicolon-decimal-comma.csv: the decimal commas do not make it a comma file', async () => {
    const table = await tableOf('semicolon-decimal-comma.csv');
    expect(table.meta.delimiter).toBe(';');
    expect(table.rows[0]).toEqual(['01.09.2026', 'Miete September', '-1.250,00', 'EUR']);
    expect(table.rows[2]).toEqual(['14.09.2026', 'Bäckerei Sonnenschein', '-7,35', 'EUR']);
    expect(table.columns.every((column) => !column.synthetic)).toBe(true);
  });

  it('pipe-delimited.txt: commas and semicolons in the text are left alone', async () => {
    const table = await tableOf('pipe-delimited.txt');
    expect(table.meta.delimiter).toBe('|');
    expect(table.rows.map((row) => row[1])).toEqual(['TRANSIT PASS, MONTHLY', 'REFUND; ORDER 1182', 'BOOKSHOP']);
  });

  it('preamble-account-number.csv: skips the preamble, keeps it, and reads the account from it', async () => {
    const table = await tableOf('preamble-account-number.csv');
    expect(table.meta.headerLine).toBe(6);
    expect(table.meta.preamble).toEqual([
      'Northwind Community Bank',
      'Account Number: 000123456789',
      'Account Type: Checking',
      'Statement Period: 09/01/2026 - 09/30/2026',
    ]);
    expect(table.sourceLines).toEqual([7, 8, 9]);
    expect(table.rows[0]).toEqual(['09/02/2026', 'COFFEE ROASTERS', '-4.25', '995.75']);
    expect(table.notes).toEqual([{ code: 'preambleSkipped', severity: 'info', scope: 'file', params: { count: 4 } }]);
    expect(table.meta.accountHints.filter((hint) => hint.source === 'preamble')).toEqual([
      { kind: 'number', value: '000123456789', source: 'preamble' },
      { kind: 'accountType', value: 'checking', source: 'preamble' },
    ]);
  });

  it('trailing-total-row.csv: the total and the disclaimer are not transactions', async () => {
    const table = await tableOf('trailing-total-row.csv');
    expect(table.rows.map((row) => row[1])).toEqual(['RENT', 'GROCERY MART', 'INTEREST PAID']);
    expect(table.meta.trailer).toEqual([
      'Total,,,-1255.18',
      '"This export lists posted transactions only, as of 2026-09-30."',
    ]);
    expect(table.notes).toEqual([{ code: 'trailerSkipped', severity: 'info', scope: 'file', params: { count: 2 } }]);
  });

  it('no-header-row.csv: made-up column names, and the first line is data', async () => {
    const table = await tableOf('no-header-row.csv');
    expect(table.columns).toEqual([
      { index: 0, name: 'Column 1', synthetic: true },
      { index: 1, name: 'Column 2', synthetic: true },
      { index: 2, name: 'Column 3', synthetic: true },
      { index: 3, name: 'Column 4', synthetic: true },
    ]);
    expect(table.meta.headerLine).toBeNull();
    expect(table.rows[0]).toEqual(['2026-09-01', 'CARD PURCHASE', 'HARDWARE DEPOT', '-35.99']);
    expect(table.sourceLines).toEqual([1, 2, 3]);
    expect(table.notes).toEqual([{ code: 'headerMissing', severity: 'warning', scope: 'file', params: { columns: 4 } }]);
  });

  it('ragged-rows.csv: every row is as wide as the header, and the odd ones are named', async () => {
    const table = await tableOf('ragged-rows.csv');
    expect(table.rows).toEqual([
      ['2026-09-01', 'COFFEE BAR', '-3.50', ''],
      ['2026-09-02', 'STREAMING SERVICE', '-12.99', ''],
      ['2026-09-03', 'ACME SUPPLY', ' UNIT 4', '-41.00'],
      ['2026-09-04', 'PAYROLL', '2000.00', ''],
    ]);
    expect(table.notes).toEqual([
      { code: 'raggedRows', severity: 'warning', scope: 'row', rows: [1, 2], params: { count: 2 } },
    ]);
  });

  it('truncated-mid-row.csv: the half row is left out and the file is flagged', async () => {
    const table = await tableOf('truncated-mid-row.csv');
    expect(table.rows).toEqual([
      ['2026-09-20', 'PHARMACY', '-18.20', '512.44'],
      ['2026-09-21', 'GAS STATION', '-40.00', '472.44'],
    ]);
    expect(table.meta.trailer).toEqual(['2026-09-22,ONLINE MARKETP']);
    expect(table.notes).toEqual([{ code: 'truncatedFile', severity: 'warning', scope: 'file', params: { line: 4 } }]);
  });

  it('quoted-multiline-blank-lines.csv: source lines are the real file lines', async () => {
    const table = await tableOf('quoted-multiline-blank-lines.csv');
    expect(table.sourceLines).toEqual([2, 6, 9]);
    expect(table.rows[0]).toEqual(['2026-09-01', 'WIRE TRANSFER\r\nREF 99-1182\r\nBENEFICIARY: ACME SUPPLY', '-410.00']);
    expect(table.rows[2]).toEqual(['2026-09-05', 'PAYROLL', '2000.00']);
  });

  it('duplicate-header-names.csv: the second "Amount" gets its own name', async () => {
    const table = await tableOf('duplicate-header-names.csv');
    expect(table.columns.map((column) => column.name)).toEqual(['Date', 'Description', 'Amount', 'Amount (2)']);
    expect(table.columns.some((column) => column.synthetic)).toBe(false);
    expect(table.notes).toEqual([
      { code: 'duplicateHeaderNames', severity: 'info', scope: 'file', params: { names: 'Amount', count: 1 } },
    ]);
  });

  it('ofx1-bank.ofx: OFX 1.x SGML, bank statement, declared charset', async () => {
    const table = await tableOf('ofx1-bank.ofx');
    expect(table.format).toBe('ofx');
    expect(table.rows).toEqual([
      ['2026-09-02', '-4.25', 'CAFÉ LUNA', 'CARD 4821 CAFÉ LUNA & BAKERY', '202609020001', 'DEBIT', ''],
      ['2026-09-09', '1500.00', 'NORTHWIND LLC PAYROLL', '', '202609090001', 'DIRECTDEP', ''],
      ['2026-09-15', '-250.00', 'CHECK 1042', '', '202609150001', 'CHECK', '1042'],
    ]);
    expect(table.sourceLines).toEqual([43, 51, 59]);
    expect(table.meta).toEqual({
      fileName: 'ofx1-bank.ofx',
      encoding: 'windows-1252',
      preamble: [],
      trailer: [],
      accountHints: [
        { kind: 'number', value: '000123456789', source: 'ofx' },
        { kind: 'accountType', value: 'checking', source: 'ofx' },
        { kind: 'institution', value: 'Northwind Community Bank', source: 'ofx' },
        { kind: 'currency', value: 'USD', source: 'ofx' },
      ],
      statementStart: '2026-09-01',
      statementEnd: '2026-09-30',
      ledgerBalance: { amount: 2245.75, asOf: '2026-09-30' },
      presetLayout: {
        roles: { date: 0, amount: 1, description: [2, 3], reference: 4 },
        dateOrder: 'YMD',
        decimal: '.',
        amountSign: 'asIs',
      },
    });
  });

  it('ofx2-credit-card.ofx: OFX 2.x XML, credit card statement', async () => {
    const table = await tableOf('ofx2-credit-card.ofx');
    expect(table.rows).toEqual([
      ['2026-09-04', '-58.12', "GROCER'S OUTLET", '', 'CC-20260904-0001', 'DEBIT', ''],
      ['2026-09-11', '-19.99', 'STREAMBOX', 'Monthly plan — 東京', 'CC-20260911-0001', 'DEBIT', ''],
      ['2026-09-20', '250.00', 'PAYMENT THANK YOU', '', 'CC-20260920-0001', 'CREDIT', ''],
    ]);
    expect(table.sourceLines).toEqual([22, 30, 38]);
    expect(table.meta.accountHints).toEqual([
      { kind: 'number', value: '4000000000004821', source: 'ofx' },
      { kind: 'accountType', value: 'credit', source: 'ofx' },
      { kind: 'institution', value: 'Harbor Card Services', source: 'ofx' },
      { kind: 'currency', value: 'USD', source: 'ofx' },
    ]);
    expect(table.meta).toMatchObject({
      encoding: 'utf-8',
      statementStart: '2026-09-01',
      statementEnd: '2026-09-30',
      ledgerBalance: { amount: -431.07, asOf: '2026-09-30' },
    });
  });

  it('qfx-two-accounts.qfx: one table per account, each told the file has two', async () => {
    const { tables, issues } = await readFixture('qfx-two-accounts.qfx');
    expect(issues).toEqual([]);
    expect(tables).toHaveLength(2);
    const [checking, savings] = tables;
    const note = { code: 'multipleAccountsInFile', severity: 'info', scope: 'file', params: { count: 2 } };

    expect(checking.fingerprint).toBe('ofx:lakeside credit union:checking');
    expect(checking.rows).toEqual([
      ['2026-09-05', '-23.10', 'FARM STAND', '', 'C1', 'POS', ''],
      ['2026-09-10', '-300.00', 'TRANSFER TO SAVINGS', 'To share 0002', 'C2', 'XFER', ''],
    ]);
    expect(checking.sourceLines).toEqual([17, 18]);
    expect(checking.meta.accountHints[0]).toEqual({ kind: 'number', value: '5550001111', source: 'ofx' });
    expect(checking.meta.ledgerBalance).toEqual({ amount: 1820.44, asOf: '2026-09-30' });
    expect(checking.notes).toEqual([note]);

    expect(savings.fingerprint).toBe('ofx:lakeside credit union:savings');
    expect(savings.rows).toEqual([
      ['2026-09-10', '300.00', 'TRANSFER FROM CHECKING', '', 'S1', 'XFER', ''],
      ['2026-09-30', '0.42', 'DIVIDEND', '', 'S2', 'INT', ''],
    ]);
    expect(savings.sourceLines).toEqual([25, 26]);
    expect(savings.meta.accountHints.slice(0, 2)).toEqual([
      { kind: 'number', value: '5550002222', source: 'ofx' },
      { kind: 'accountType', value: 'savings', source: 'ofx' },
    ]);
    expect(savings.notes).toEqual([note]);
    // Each table has its own layout object, so changing one cannot change the other.
    expect(savings.meta.presetLayout).toEqual(checking.meta.presetLayout);
    expect(savings.meta.presetLayout).not.toBe(checking.meta.presetLayout);
  });

  it.each([
    ['unsupported-workbook.xlsx', 'xlsx'],
    ['unsupported-statement.pdf', 'pdf'],
    ['unsupported-quicken.qif', 'qif'],
    ['unsupported-html-table.xls', 'html'],
  ])('%s: not read, and says what it is (%s)', async (name, kind) => {
    expect(await readFixture(name)).toEqual({
      tables: [],
      issues: [{ code: 'unsupportedFormat', severity: 'blocker', scope: 'file', params: { kind } }],
    });
  });
});
