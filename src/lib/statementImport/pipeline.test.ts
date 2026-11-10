/**
 * The pipeline end to end, through the public entry point only:
 * readStatement → proposeLayout → analyzeStatement (and the AI fallback).
 * Each stage has its own detailed tests beside its code (readers/, interpret/,
 * ai/); these cases pin how the stages fit together.
 */

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

describe('statement import pipeline', () => {
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
  });

  it('reports an empty file and a header-only file instead of an empty table', async () => {
    const empty = await readStatement(sourceFileFromText('  \n'));
    expect(empty.tables).toEqual([]);
    expect(empty.issues.map((issue) => [issue.code, issue.severity])).toEqual([['emptyFile', 'blocker']]);

    const headerOnly = await readStatement(sourceFileFromText('Date,Amount,Description\n'));
    expect(headerOnly.tables).toEqual([]);
    expect(headerOnly.issues.map((issue) => [issue.code, issue.severity])).toEqual([['noDataRows', 'blocker']]);
  });

  it('proposes a layout for what was read and analyses the rows', async () => {
    const { tables } = await readStatement(sourceFileFromText(SAMPLE));
    const proposal = proposeLayout(tables[0]);

    expect(proposal.missing).toEqual([]);
    expect(proposal.layout).toEqual({
      roles: { account: 0, date: 1, amount: 2, description: [3], reference: 4 },
      // "10/02/2026" could be 2 October or 10 February: the rows are only in date order month-first.
      dateOrder: 'MDY',
      decimal: '.',
      amountSign: 'asIs',
    });
    expect(proposal.assumptions.map((assumption) => assumption.code)).toEqual([
      'columnsByName',
      'accountColumn',
      'monthFirstBySequence',
      'decimalFromFile',
      'signAsPrintedByShare',
    ]);

    const report = analyzeStatement(tables[0], proposal.layout, { today: TODAY });
    expect(report.rows.map((row) => [row.date, row.amount, row.description, row.reference, row.accountValue])).toEqual([
      ['2026-10-01', -42.1, 'COFFEE, BEANS & CO', 'R1', '4821'],
      ['2026-10-02', 1250, 'PAYROLL', 'R2', '4821'],
      ['2026-10-03', -15, '', 'R3', '4821'],
    ]);
    expect(report.issues).toEqual([
      // One date that works both ways and no date that settles it: the order rests on the row sequence.
      { code: 'dateOrderAmbiguous', severity: 'warning', scope: 'column', column: 1, params: { example: '10/02/2026', readAs: '2026-10-02' } },
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
      2026-10-01,-12.00,GROCERY
      someday,-5.00,BAD DATE
      2026-10-03,lots,BAD AMOUNT
      2026-10-04,900.00,PAYROLL DEPOSIT
      2026-10-05,-30.00,GAS STATION
    `);
    const { layout } = proposeLayout(table);

    const report = analyzeStatement(table, layout, { today: TODAY });
    expect(report.rows.map((row) => row.blocked)).toEqual([false, true, true, false, false]);
    expect(report.issues.map((issue) => [issue.code, issue.severity, issue.rows])).toEqual([
      ['unreadableDate', 'blocker', [1]],
      ['unreadableAmount', 'blocker', [2]],
    ]);
    expect(report.stats).toMatchObject({ readyRows: 3, blockedRows: 2, skippedRows: 0 });

    const fixed = analyzeStatement(table, layout, {
      today: TODAY,
      overrides: { 1: { date: '2026-10-02' }, 2: { skip: true } },
    });
    expect(fixed.issues).toEqual([]);
    expect(fixed.rows[1]).toMatchObject({ date: '2026-10-02', blocked: false });
    expect(fixed.rows[2]).toMatchObject({ skipped: true, blocked: false });
    expect(fixed.stats).toMatchObject({ readyRows: 4, blockedRows: 0, skippedRows: 1 });
  });

  it('decides the date order from the file, not the fallback, and reads every row with that one order', () => {
    const table = tableFromCsv(`
      Date,Amount,Description
      04/06/2026,-1.00,AMBIGUOUS ON ITS OWN
      23/06/2026,-1.00,DAY FIRST ONLY
    `);
    // The second row can only be 23 June, so the first is 4 June: whatever the UI language says.
    for (const fallbackDateOrder of ['MDY', 'DMY', undefined] as const) {
      const proposal = proposeLayout(table, { fallbackDateOrder });
      expect(proposal.layout.dateOrder).toBe('DMY');
      const report = analyzeStatement(table, proposal.layout, { today: TODAY });
      expect(report.rows.map((row) => row.date)).toEqual(['2026-06-04', '2026-06-23']);
    }

    // Forced to month-first, the second row is not quietly read day-first: it is blocked.
    const forced = analyzeStatement(table, { ...proposeLayout(table).layout, dateOrder: 'MDY' }, { today: TODAY });
    expect(forced.rows.map((row) => [row.date, row.blocked])).toEqual([
      ['2026-04-06', false],
      [null, true],
    ]);
    expect(forced.issues.map((issue) => issue.code)).toContain('dateOrderMixed');
  });

  it('imports a card export with positive purchases as spending', async () => {
    const card = [
      'Trans. Date,Post Date,Description,Amount',
      '09/14/2026,09/15/2026,CORNER BAKERY,8.45',
      '09/16/2026,09/17/2026,FUEL STOP,41.10',
      '09/20/2026,09/21/2026,GROCERY MART,96.37',
      '09/22/2026,09/22/2026,PAYMENT THANK YOU,-500.00',
    ].join('\n');
    const { tables } = await readStatement(sourceFileFromText(card));
    const proposal = proposeLayout(tables[0], { accountType: 'credit' });
    expect(proposal.layout.amountSign).toBe('inverted');

    const report = analyzeStatement(tables[0], proposal.layout, { today: TODAY, accountType: 'credit' });
    expect(report.rows.map((row) => row.amount)).toEqual([-8.45, -41.1, -96.37, 500]);
    expect(report.stats.moneyOut).toBeCloseTo(145.92, 2);
    expect(report.stats.moneyIn).toBe(500);
    expect(report.issues).toEqual([]);
  });

  it('applies a layout as given: inverted sign, debit / credit columns, joined descriptions, decimal comma', () => {
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
    // Detection arrives at the same layout on its own.
    expect(proposeLayout(table).layout).toEqual(layout);

    const card = tableFromCsv('Date,Amount,Description\n2026-10-01,25.00,GROCERY');
    const inverted = analyzeStatement(card, { ...proposeLayout(card).layout, amountSign: 'inverted' }, { today: TODAY });
    expect(inverted.rows[0].amount).toBe(-25);
    expect(inverted.stats.moneyOut).toBe(25);
  });

  it('works out a layout from the contents when the headers say nothing', () => {
    const table = tableFromCsv(`
      When,Who,How much
      2026-10-01,ACME HARDWARE,-12.50
      2026-10-02,CORNER CAFE,-4.75
      2026-10-03,EMPLOYER PAYROLL DEPOSIT,2000.00
    `);
    const proposal = proposeLayout(table);
    expect(proposal.missing).toEqual([]);
    expect(proposal.layout.roles).toEqual({ date: 0, description: [1], amount: 2 });
    expect(proposal.assumptions[0]).toMatchObject({ code: 'columnsByContent', basis: 'file' });
    expect(proposal.confidence).toBeGreaterThanOrEqual(0.6);
    expect(proposal.confidence).toBeLessThan(0.9);
  });

  it('says which required parts are missing instead of guessing', () => {
    const table = tableFromCsv('Code,Flag\nA1,x\nB2,y');
    const proposal = proposeLayout(table);
    expect(proposal.missing).toEqual(['date', 'description', 'amount']);
    expect(proposal.confidence).toBe(0);

    const report = analyzeStatement(table, proposal.layout, { today: TODAY });
    expect(report.issues.map((issue) => issue.code)).toEqual(['noDateColumn', 'noAmountColumn', 'noDescriptionColumn']);
    expect(report.stats.readyRows).toBe(0);
  });

  it('a saved layout wins over detection, and a reader preset over detection too', () => {
    const table = tableFromCsv('Date,Amount,Description\n2026-10-01,1.00,X');
    const saved: ImportLayout = { roles: { date: 0, description: [2], amount: 1 }, dateOrder: 'DMY', decimal: ',', amountSign: 'inverted' };

    const fromProfile = proposeLayout(table, { profile: { version: 1, layout: saved } });
    expect(fromProfile.layout).toBe(saved);
    expect(fromProfile.assumptions).toEqual([{ subject: 'columns', code: 'savedLayout', basis: 'profile', confidence: 1 }]);

    const preset = proposeLayout({ ...table, meta: { ...table.meta, presetLayout: saved } });
    expect(preset.layout).toBe(saved);
    expect(preset.confidence).toBe(1);
  });

  it('asks the AI with a masked sample only, and treats its answer as a suggestion', async () => {
    const table = tableFromCsv(`
      F1,F2,F3,F4
      400000000004821,23/10/2026,CARD 1234 REF 99887766,-54.20
      400000000004821,24/10/2026,PAYROLL,2400.00
    `);
    expect(buildAiLayoutSample(table)).toEqual({
      headers: ['F1', 'F2', 'F3', 'F4'],
      rows: [
        ['•••4821', '23/10/2026', 'CARD 1234 REF •••7766', '-54.20'],
        ['•••4821', '24/10/2026', 'PAYROLL', '2400.00'],
      ],
    });

    let sent = '';
    const proposal = await suggestLayoutWithAi(table, async (prompt) => {
      sent = prompt.system + prompt.user;
      return '{"date": 1, "description": [2], "amount": 3, "account": 0}';
    });
    expect(sent).not.toContain('400000000004821');
    expect(sent).not.toContain('99887766');
    expect(proposal?.layout).toMatchObject({ roles: { date: 1, description: [2], amount: 3, account: 0 }, dateOrder: 'DMY' });
    expect(proposal?.confidence).toBeLessThanOrEqual(0.7);
    expect(proposal?.assumptions.every((assumption) => assumption.basis === 'ai' && assumption.confidence <= 0.7)).toBe(true);
    // The suggestion goes through the same analysis as a detected layout.
    const report = analyzeStatement(table, (proposal as NonNullable<typeof proposal>).layout, { today: TODAY });
    expect(report.stats).toMatchObject({ readyRows: 2, blockedRows: 0 });

    await expect(suggestLayoutWithAi(table, async () => 'no idea, sorry')).resolves.toBeNull();
  });

  it('every issue code has a severity and a scope', () => {
    expect(ALL_IMPORT_ISSUE_CODES.length).toBeGreaterThan(40);
    for (const code of ALL_IMPORT_ISSUE_CODES) {
      expect(['blocker', 'warning', 'info']).toContain(IMPORT_ISSUE_CODES[code].severity);
      expect(['file', 'column', 'row', 'account', 'coverage']).toContain(IMPORT_ISSUE_CODES[code].scope);
    }
  });
});
