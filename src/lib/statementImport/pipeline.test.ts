import { describe, expect, it } from 'vitest';

import {
  ALL_IMPORT_ISSUE_CODES,
  IMPORT_ISSUE_CODES,
  analyzeStatement,
  buildAiLayoutSample,
  proposeLayout,
  readStatement,
  suggestLayoutWithAi,
} from './index';
import { sourceFileFromText, tableFromCells, tableFromCsv } from './testing/tableFromCsv';
import type { ImportLayout } from './types';

const TODAY = '2026-11-10';

const SAMPLE = [
  'Account Number,Date,Amount,Description,Reference',
  '4821,2026-10-01,-42.10,"COFFEE, BEANS & CO",R1',
  '4821,10/02/2026,"1,250.00",PAYROLL,R2',
  '4821,2026-10-03,(15.00),,R3',
].join('\n');

describe('statement import pipeline (foundation baseline)', () => {
  it('reads a delimited file into one table of raw cells', async () => {
    const { tables, issues } = await readStatement(sourceFileFromText(SAMPLE, 'export.csv'));

    expect(issues).toEqual([]);
    expect(tables).toHaveLength(1);
    const [table] = tables;
    expect(table.format).toBe('delimited');
    expect(table.columns.map((column) => column.name)).toEqual(['Account Number', 'Date', 'Amount', 'Description', 'Reference']);
    expect(table.rows).toHaveLength(3);
    // Quoted commas stay inside the cell; every row is as wide as the header.
    expect(table.rows[0][3]).toBe('COFFEE, BEANS & CO');
    expect(table.rows.every((row) => row.length === table.columns.length)).toBe(true);
    expect(table.sourceLines).toEqual([2, 3, 4]);
    expect(table.meta).toMatchObject({ fileName: 'export.csv', encoding: 'utf-8', delimiter: ',', headerLine: 1 });
    expect(table.fingerprint).toBe('delimited:account number|date|amount|description|reference');
  });

  it('gives two exports of the same shape the same fingerprint whatever their rows', async () => {
    const other = 'ACCOUNT NUMBER, Date ,Amount,Description,Reference\n9034,2026-01-01,1.00,X,R9';
    const first = await readStatement(sourceFileFromText(SAMPLE));
    const second = await readStatement(sourceFileFromText(other));
    expect(second.tables[0].fingerprint).toBe(first.tables[0].fingerprint);
  });

  it('reports an empty file and a header-only file instead of an empty table', async () => {
    expect(await readStatement(sourceFileFromText('  \n'))).toEqual({
      tables: [],
      issues: [{ code: 'emptyFile', severity: 'blocker', scope: 'file' }],
    });
    expect(await readStatement(sourceFileFromText('Date,Amount,Description\n'))).toEqual({
      tables: [],
      issues: [{ code: 'noDataRows', severity: 'blocker', scope: 'file' }],
    });
  });

  it('proposes a layout from the header names and analyses the rows', async () => {
    const { tables } = await readStatement(sourceFileFromText(SAMPLE));
    const proposal = proposeLayout(tables[0]);

    expect(proposal.missing).toEqual([]);
    expect(proposal.layout.roles).toMatchObject({ account: 0, date: 1, amount: 2, description: [3], reference: 4 });

    const report = analyzeStatement(tables[0], proposal.layout, { today: TODAY });
    expect(report.rows.map((row) => [row.date, row.amount, row.description, row.reference])).toEqual([
      ['2026-10-01', -42.1, 'COFFEE, BEANS & CO', 'R1'],
      ['2026-10-02', 1250, 'PAYROLL', 'R2'],
      ['2026-10-03', -15, '', 'R3'],
    ]);
    expect(report.issues).toEqual([
      { code: 'blankDescription', severity: 'warning', scope: 'row', rows: [2], params: { count: 1 } },
    ]);
    expect(report.stats).toEqual({
      totalRows: 3,
      readyRows: 3,
      blockedRows: 0,
      skippedRows: 0,
      firstDate: '2026-10-01',
      lastDate: '2026-10-03',
      moneyIn: 1250,
      moneyOut: 57.1,
    });
  });

  it('blocks rows it cannot read and lets an override fix or skip them', () => {
    const table = tableFromCsv(`
      Date,Amount,Description
      2026-10-01,12.00,OK
      someday,5.00,BAD DATE
      2026-10-03,lots,BAD AMOUNT
    `);
    const { layout } = proposeLayout(table);

    const report = analyzeStatement(table, layout, { today: TODAY });
    expect(report.rows.map((row) => row.blocked)).toEqual([false, true, true]);
    expect(report.issues.map((issue) => [issue.code, issue.severity, issue.rows])).toEqual([
      ['unreadableDate', 'blocker', [1]],
      ['unreadableAmount', 'blocker', [2]],
    ]);
    expect(report.stats).toMatchObject({ readyRows: 1, blockedRows: 2, skippedRows: 0 });

    const fixed = analyzeStatement(table, layout, {
      today: TODAY,
      overrides: { 1: { date: '2026-10-02' }, 2: { skip: true } },
    });
    expect(fixed.issues).toEqual([]);
    expect(fixed.rows[1]).toMatchObject({ date: '2026-10-02', blocked: false });
    expect(fixed.rows[2]).toMatchObject({ skipped: true, blocked: false });
    expect(fixed.stats).toMatchObject({ readyRows: 2, blockedRows: 0, skippedRows: 1 });
  });

  it('reads one date order per file: a value that only works the other way is unreadable', () => {
    const table = tableFromCsv(`
      Date,Amount,Description
      04/06/2026,1.00,AMBIGUOUS
      23/06/2026,1.00,DAY FIRST ONLY
    `);
    const monthFirst = analyzeStatement(table, proposeLayout(table, { fallbackDateOrder: 'MDY' }).layout, { today: TODAY });
    expect(monthFirst.rows.map((row) => row.date)).toEqual(['2026-04-06', null]);

    const dayFirst = analyzeStatement(table, proposeLayout(table, { fallbackDateOrder: 'DMY' }).layout, { today: TODAY });
    expect(dayFirst.rows.map((row) => row.date)).toEqual(['2026-06-04', '2026-06-23']);
  });

  it('applies the layout: inverted sign, debit / credit columns, joined descriptions, decimal comma', () => {
    const table = tableFromCells([
      ['Posted', 'Payee', 'Memo', 'Out', 'In'],
      ['01.10.2026', 'ACME', 'Invoice 7', '1.234,50', ''],
      ['02.10.2026', 'EMPLOYER', '', '', '2.000,00'],
    ]);
    const layout: ImportLayout = {
      roles: { date: 0, description: [1, 2], debit: 3, credit: 4 },
      dateOrder: 'DMY',
      decimal: ',',
      amountSign: 'asIs',
    };
    const report = analyzeStatement(table, layout, { today: TODAY });
    expect(report.rows.map((row) => [row.date, row.amount, row.description])).toEqual([
      ['2026-10-01', -1234.5, 'ACME Invoice 7'],
      ['2026-10-02', 2000, 'EMPLOYER'],
    ]);

    const card = tableFromCsv('Date,Amount,Description\n2026-10-01,25.00,GROCERY');
    const inverted = analyzeStatement(card, { ...proposeLayout(card).layout, amountSign: 'inverted' }, { today: TODAY });
    expect(inverted.rows[0].amount).toBe(-25);
    expect(inverted.stats.moneyOut).toBe(25);
  });

  it('says which required parts are missing instead of guessing', () => {
    const table = tableFromCsv('When,Payee,Value\n2026-10-01,ACME,1.00');
    const proposal = proposeLayout(table);
    expect(proposal.missing).toEqual(['date', 'description', 'amount']);
    expect(proposal.confidence).toBe(0);

    const report = analyzeStatement(table, proposal.layout, { today: TODAY });
    expect(report.issues.map((issue) => issue.code)).toEqual(['noDateColumn', 'noAmountColumn', 'noDescriptionColumn']);
    expect(report.stats.readyRows).toBe(0);
  });

  it('a saved layout wins over detection, and a reader preset over header names', () => {
    const table = tableFromCsv('Date,Amount,Description\n2026-10-01,1.00,X');
    const saved: ImportLayout = { roles: { date: 0, description: [2], amount: 1 }, dateOrder: 'DMY', decimal: ',', amountSign: 'inverted' };

    const fromProfile = proposeLayout(table, { profile: { version: 1, layout: saved } });
    expect(fromProfile.layout).toBe(saved);
    expect(fromProfile.assumptions).toEqual([{ subject: 'columns', code: 'savedLayout', basis: 'profile', confidence: 1 }]);

    const preset = proposeLayout({ ...table, meta: { ...table.meta, presetLayout: saved } });
    expect(preset.layout).toBe(saved);
    expect(preset.confidence).toBe(1);
  });

  it('masks long digit runs in the sample shown before an AI provider is called', async () => {
    const table = tableFromCsv('Account,Date,Description\n400000000004821,2026-10-01,CARD 1234 REF 99887766');
    expect(buildAiLayoutSample(table)).toEqual({
      headers: ['Account', 'Date', 'Description'],
      rows: [['•••4821', '2026-10-01', 'CARD 1234 REF •••7766']],
    });
    // The baseline never calls the provider.
    await expect(suggestLayoutWithAi(table, async () => { throw new Error('must not be called'); })).resolves.toBeNull();
  });

  it('every issue code has a severity and a scope', () => {
    expect(ALL_IMPORT_ISSUE_CODES.length).toBeGreaterThan(40);
    for (const code of ALL_IMPORT_ISSUE_CODES) {
      expect(['blocker', 'warning', 'info']).toContain(IMPORT_ISSUE_CODES[code].severity);
      expect(['file', 'column', 'row', 'account', 'coverage']).toContain(IMPORT_ISSUE_CODES[code].scope);
    }
  });
});
