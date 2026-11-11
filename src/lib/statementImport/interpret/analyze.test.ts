import { describe, expect, it } from 'vitest';

import { IMPORT_ISSUE_CODES, type ImportIssueCode } from '../issueCodes';
import { tableFromCells, tableFromCsv } from '../testing/tableFromCsv';
import type { AnalysisContext, AnalysisReport, ImportIssue, ImportLayout, StatementTable } from '../types';

import { analyzeStatement } from './analyze';
import { proposeLayout } from './proposeLayout';

const TODAY = '2026-11-10';
const context = (extra: Partial<AnalysisContext> = {}): AnalysisContext => ({ today: TODAY, ...extra });

/** Detect the layout, then analyse: what the wizard does for a file it has not seen before. */
function analyse(table: StatementTable, extra: Partial<AnalysisContext> = {}, layout?: ImportLayout): AnalysisReport {
  return analyzeStatement(table, layout ?? proposeLayout(table, { accountType: extra.accountType }).layout, context(extra));
}
const issue = (report: AnalysisReport, code: ImportIssueCode): ImportIssue | undefined =>
  report.issues.find((candidate) => candidate.code === code);
const issueCodes = (report: AnalysisReport) => report.issues.map((candidate) => candidate.code);

/** A clean statement the tests then damage one cell at a time. */
const CLEAN = [
  ['Date', 'Description', 'Amount'],
  ['2026-09-01', 'GROCERY MART 0421', '-54.20'],
  ['2026-09-03', 'PAYROLL DEPOSIT', '2400.00'],
  ['2026-09-05', 'STREAMING SERVICE', '-12.99'],
  ['2026-09-09', 'HARDWARE DEPOT 77', '-31.75'],
  ['2026-09-12', 'COFFEE HOUSE 22', '-6.75'],
];
function damaged(changes: Record<number, Partial<Record<'date' | 'description' | 'amount', string>>>, extraRows: string[][] = []) {
  const cells = CLEAN.map((row) => [...row]);
  for (const [row, change] of Object.entries(changes)) {
    const target = cells[Number(row) + 1];
    if (change.date !== undefined) target[0] = change.date;
    if (change.description !== undefined) target[1] = change.description;
    if (change.amount !== undefined) target[2] = change.amount;
  }
  return tableFromCells([...cells, ...extraRows]);
}

describe('analyzeStatement: a clean file', () => {
  it('normalises every row and reports nothing', () => {
    const report = analyse(tableFromCells(CLEAN));
    expect(report.issues).toEqual([]);
    expect(report.rows[0]).toEqual({
      index: 0,
      sourceLine: 2,
      date: '2026-09-01',
      amount: -54.2,
      description: 'GROCERY MART 0421',
      reference: null,
      accountValue: null,
      balance: null,
      skipped: false,
      blocked: false,
      issueCodes: [],
    });
    expect(report.stats).toEqual({
      totalRows: 5,
      readyRows: 5,
      blockedRows: 0,
      skippedRows: 0,
      firstDate: '2026-09-01',
      lastDate: '2026-09-12',
      moneyIn: 2400,
      moneyOut: 105.69,
    });
  });

  it('gives every finding the severity and scope of the catalog', () => {
    const report = analyse(damaged({ 0: { date: 'someday' }, 1: { description: '' }, 2: { amount: '0.00' } }));
    expect(report.issues.length).toBeGreaterThan(2);
    for (const found of report.issues) {
      expect(found.severity).toBe(IMPORT_ISSUE_CODES[found.code].severity);
      expect(found.scope).toBe(IMPORT_ISSUE_CODES[found.code].scope);
    }
  });
});

describe('analyzeStatement: rows that cannot be imported as they are', () => {
  it('unreadableDate: a blank or malformed date blocks the row', () => {
    const report = analyse(damaged({ 1: { date: 'someday' }, 3: { date: '' } }));
    expect(issue(report, 'unreadableDate')).toEqual({
      code: 'unreadableDate',
      severity: 'blocker',
      scope: 'row',
      rows: [1, 3],
      params: { count: 2 },
    });
    expect(report.rows[1]).toMatchObject({ date: null, blocked: true, issueCodes: ['unreadableDate'] });
    expect(report.stats).toMatchObject({ readyRows: 3, blockedRows: 2 });
  });

  it('unreadableAmount: blank, text, or digits buried in text', () => {
    const report = analyse(damaged({ 0: { amount: '' }, 2: { amount: 'lots' }, 4: { amount: 'REF 6.75 A' } }));
    expect(issue(report, 'unreadableAmount')).toMatchObject({ severity: 'blocker', rows: [0, 2, 4], params: { count: 3 } });
    expect(report.rows[4]).toMatchObject({ amount: null, blocked: true });
  });

  it('unreadableAmount: a direction word the layout does not know', () => {
    const table = tableFromCsv(`
      Date,Description,Amount,Dr/Cr
      2026-09-01,A,10.00,DR
      2026-09-02,B,20.00,CR
      2026-09-03,C,30.00,??
    `);
    const report = analyse(table);
    expect(report.rows.map((row) => row.amount)).toEqual([-10, 20, null]);
    expect(issue(report, 'unreadableAmount')?.rows).toEqual([2]);
  });

  it('unreadableAmount: a value that only makes sense with the other decimal mark is not guessed at', () => {
    // In a decimal-point file "12,50" would silently become 1250.
    const report = analyse(damaged({ 3: { amount: '-12,50' } }));
    expect(report.rows[3]).toMatchObject({ amount: null, blocked: true, issueCodes: ['unreadableAmount'] });
    // A thousands comma is fine in the same file.
    expect(analyse(damaged({ 3: { amount: '-1,250.00' } })).rows[3].amount).toBe(-1250);
  });

  it('excelMangledNumber: scientific notation is never read as an amount', () => {
    const report = analyse(damaged({ 2: { amount: '-1.25E+04' } }));
    expect(issue(report, 'excelMangledNumber')).toEqual({
      code: 'excelMangledNumber',
      severity: 'blocker',
      scope: 'row',
      rows: [2],
      params: { count: 1, example: '-1.25E+04' },
    });
    expect(report.rows[2]).toMatchObject({ amount: null, blocked: true });
    expect(issue(report, 'unreadableAmount')).toBeUndefined();
  });

  it('lets an override fix or skip a blocked row', () => {
    const table = damaged({ 1: { date: 'someday' }, 2: { amount: 'lots' }, 3: { amount: '1.5E+03' } });
    const fixed = analyse(table, {
      overrides: { 1: { date: '2026-09-04' }, 2: { amount: -13 }, 3: { skip: true }, 4: { description: 'Coffee with Sam' } },
    });
    expect(fixed.issues).toEqual([]);
    expect(fixed.rows[1]).toMatchObject({ date: '2026-09-04', blocked: false });
    expect(fixed.rows[2]).toMatchObject({ amount: -13, blocked: false });
    expect(fixed.rows[3]).toMatchObject({ skipped: true, blocked: false, issueCodes: [] });
    expect(fixed.rows[4].description).toBe('Coffee with Sam');
    expect(fixed.stats).toMatchObject({ readyRows: 4, blockedRows: 0, skippedRows: 1, moneyOut: 73.95 });
  });

  it('ignores an override date that is not a real date', () => {
    const report = analyse(damaged({ 1: { date: 'someday' } }), { overrides: { 1: { date: '2026-02-31' } } });
    expect(report.rows[1]).toMatchObject({ date: null, blocked: true });
  });
});

describe('analyzeStatement: rows worth a look', () => {
  it('blankDescription, and descriptionMostlyBlank when it is most of the file', () => {
    const some = analyse(damaged({ 1: { description: '' }, 4: { description: '   ' } }));
    expect(issue(some, 'blankDescription')).toMatchObject({ severity: 'warning', rows: [1, 4], params: { count: 2 } });
    expect(some.rows[1].blocked).toBe(false);

    const most = analyse(damaged({ 0: { description: '' }, 1: { description: '' }, 3: { description: '' } }));
    expect(issue(most, 'blankDescription')).toBeUndefined();
    expect(issue(most, 'descriptionMostlyBlank')).toMatchObject({
      severity: 'warning',
      scope: 'column',
      column: 1,
      rows: [0, 1, 3],
      params: { count: 3, total: 5 },
    });
  });

  it('zeroAmount', () => {
    const report = analyse(damaged({ 2: { amount: '0.00' } }));
    expect(issue(report, 'zeroAmount')).toMatchObject({ severity: 'warning', rows: [2] });
    expect(report.rows[2]).toMatchObject({ amount: 0, blocked: false });
  });

  it('futureDate is judged against the injected today', () => {
    const table = damaged({ 4: { date: '2026-11-11' } });
    expect(issue(analyse(table), 'futureDate')).toMatchObject({ severity: 'warning', rows: [4] });
    expect(issue(analyse(table, { today: '2026-11-11' }), 'futureDate')).toBeUndefined();
  });

  it('dateFarFromOthers: a year typo stands out from the rest of the file', () => {
    const report = analyse(damaged({ 2: { date: '2062-09-05' } }));
    expect(issue(report, 'dateFarFromOthers')).toMatchObject({
      severity: 'warning',
      rows: [2],
      params: { count: 1, from: '2026-09-01', to: '2026-09-12' },
    });
    // A file that really spans years is not flagged.
    const longFile = tableFromCsv(`
      Date,Description,Amount
      2022-01-05,A,-1.00
      2023-03-05,B,-2.00
      2024-06-05,C,-3.00
      2025-09-05,D,-4.00
      2026-10-05,E,5.00
    `);
    expect(issue(analyse(longFile), 'dateFarFromOthers')).toBeUndefined();
  });

  it('amountOutlier: more than ten times the largest of the rest, in a file with enough rows', () => {
    const rows = [
      ['2026-09-13', 'A', '-18.40'],
      ['2026-09-14', 'B', '-23.10'],
      ['2026-09-15', 'C', '-31750.00'],
    ];
    const report = analyse(damaged({}, rows));
    expect(issue(report, 'amountOutlier')).toMatchObject({ severity: 'info', rows: [7], params: { count: 1 } });
    // The payroll row (2400) is large but not out of line with the rest.
    expect(report.rows[1].issueCodes).toEqual([]);
    // Too few rows to say what is usual.
    expect(issue(analyse(damaged({ 0: { amount: '-99999.00' } })), 'amountOutlier')).toBeUndefined();
  });

  it('pendingTransaction: from the status column or a "PENDING" prefix', () => {
    const table = tableFromCsv(`
      Date,Description,Amount,Status
      2026-11-02,GROCERY MART,-52.18,Posted
      2026-11-03,PAYROLL DEPOSIT,2400.00,Posted
      2026-11-08,GAS STATION,-40.00,Pending
      2026-11-09,PENDING - ONLINE BOOKSHOP,-27.45,
      2026-11-09,COFFEE,-4.00,Vorgemerkt
    `);
    const report = analyse(table);
    expect(issue(report, 'pendingTransaction')).toMatchObject({ severity: 'warning', rows: [2, 3, 4], params: { count: 3 } });
    expect(report.stats.readyRows).toBe(5);
  });

  it('summaryRow: total and balance lines are skipped, and an override brings one back', () => {
    const table = damaged({}, [
      ['', 'Total', '2294.31'],
      ['', '', ''],
      ['2026-09-30', 'Closing balance', ''],
    ]);
    const report = analyse(table);
    expect(issue(report, 'summaryRow')).toMatchObject({ severity: 'info', rows: [5, 6, 7], params: { count: 3 } });
    expect(report.rows[5]).toMatchObject({ skipped: true, blocked: false, issueCodes: ['summaryRow'] });
    expect(report.stats).toMatchObject({ readyRows: 5, skippedRows: 3, blockedRows: 0, moneyIn: 2400 });
    expect(issue(report, 'unreadableDate')).toBeUndefined();

    const kept = analyse(table, { overrides: { 5: { skip: false } } });
    expect(kept.rows[5]).toMatchObject({ skipped: false, blocked: true, issueCodes: ['unreadableDate'] });
  });

  it('does not take a real transaction for a total line', () => {
    const report = analyse(damaged({ 3: { description: 'TOTAL WINE & MORE' } }));
    expect(report.rows[3]).toMatchObject({ skipped: false, description: 'TOTAL WINE & MORE' });
    expect(issue(report, 'summaryRow')).toBeUndefined();
  });
});

describe('analyzeStatement: the running balance', () => {
  const statement = (rows: string[][]) => tableFromCells([['Date', 'Description', 'Amount', 'Balance'], ...rows]);

  it('balanceMismatch: a row whose balance does not follow from the one before', () => {
    const report = analyse(
      statement([
        ['2026-09-01', 'A', '-50.00', '950.00'],
        ['2026-09-02', 'B', '200.00', '1150.00'],
        ['2026-09-03', 'C', '-25.00', '1100.00'],
        ['2026-09-04', 'D', '-10.00', '1090.00'],
        ['2026-09-05', 'E', '-40.00', '1050.00'],
      ])
    );
    expect(issue(report, 'balanceMismatch')).toMatchObject({ severity: 'warning', rows: [2], params: { count: 1 } });
    expect(report.rows[2]).toMatchObject({ balance: 1100, blocked: false });
  });

  it('works on a newest-first file and across a row the user skipped', () => {
    const table = statement([
      ['2026-09-05', 'E', '-40.00', '1075.00'],
      ['2026-09-04', 'D', '-10.00', '1115.00'],
      ['2026-09-03', 'C', '-25.00', '1125.00'],
      ['2026-09-02', 'B', '200.00', '1150.00'],
      ['2026-09-01', 'A', '-50.00', '950.00'],
    ]);
    expect(issue(analyse(table), 'balanceMismatch')).toBeUndefined();
    // The skipped row still happened at the bank, so its neighbours still reconcile.
    expect(issue(analyse(table, { overrides: { 2: { skip: true } } }), 'balanceMismatch')).toBeUndefined();
  });

  it('says nothing when the column is not a running balance of these amounts', () => {
    // A loan's remaining principal goes down by the principal part, not by the payment.
    const table = statement([
      ['2026-01-15', 'PAYMENT', '1450.00', '164587.82'],
      ['2026-02-15', 'PAYMENT', '1450.00', '164173.92'],
      ['2026-03-15', 'PAYMENT', '1450.00', '163758.30'],
      ['2026-04-15', 'PAYMENT', '1450.00', '163340.95'],
    ]);
    const layout: ImportLayout = { roles: { date: 0, description: [1], amount: 2, balance: 3 }, dateOrder: 'YMD', decimal: '.', amountSign: 'asIs' };
    expect(issue(analyse(table, { accountType: 'loan' }, layout), 'balanceMismatch')).toBeUndefined();
  });
});

describe('analyzeStatement: debit / credit columns', () => {
  const table = tableFromCsv(`
    Date,Description,Debit,Credit
    2026-09-01,RENT,950.00,
    2026-09-02,PAYROLL,,2400.00
    2026-09-03,REVERSAL,30.00,10.00
    2026-09-04,NOTHING,,
    2026-09-05,PRINTED NEGATIVE,-12.50,
  `);

  it('reads money out and money in, and nets a row that has both', () => {
    const report = analyse(table);
    expect(report.rows.map((row) => row.amount)).toEqual([-950, 2400, -20, null, -12.5]);
    expect(issue(report, 'debitCreditBothFilled')).toMatchObject({ severity: 'warning', rows: [2], params: { count: 1 } });
    // Neither side filled in: there is no amount to import.
    expect(issue(report, 'unreadableAmount')?.rows).toEqual([3]);
    // No sign question with a pair.
    expect(issue(report, 'signAssumed')).toBeUndefined();
  });

  it('ignores the amountSign of the layout: the columns already say which way', () => {
    const layout: ImportLayout = { roles: { date: 0, description: [1], debit: 2, credit: 3 }, dateOrder: 'YMD', decimal: '.', amountSign: 'inverted' };
    expect(analyse(table, {}, layout).rows.map((row) => row.amount)).toEqual([-950, 2400, -20, null, -12.5]);
  });
});

describe('analyzeStatement: what the file does not settle', () => {
  it('dateOrderAmbiguous: every date works both ways, so the order is the layout\'s word alone', () => {
    const table = tableFromCsv(`
      Date,Description,Amount
      01/02/2026,GROCERY MART,-54.20
      03/04/2026,PAYROLL DEPOSIT,2400.00
      05/06/2026,STREAMING SERVICE,-12.99
    `);
    const dayFirst = analyse(table, {}, proposeLayout(table, { fallbackDateOrder: 'DMY' }).layout);
    expect(issue(dayFirst, 'dateOrderAmbiguous')).toEqual({
      code: 'dateOrderAmbiguous',
      severity: 'warning',
      scope: 'column',
      column: 0,
      params: { example: '01/02/2026', readAs: '2026-02-01' },
    });
    const monthFirst = analyse(table, {}, proposeLayout(table, { fallbackDateOrder: 'MDY' }).layout);
    expect(issue(monthFirst, 'dateOrderAmbiguous')?.params).toEqual({ example: '01/02/2026', readAs: '2026-01-02' });
    expect(monthFirst.rows.map((row) => row.date)).toEqual(['2026-01-02', '2026-03-04', '2026-05-06']);
  });

  it('is silent about the date order once one row settles it', () => {
    const table = tableFromCsv(`
      Date,Description,Amount
      01/02/2026,GROCERY MART,-54.20
      23/04/2026,PAYROLL DEPOSIT,2400.00
      05/06/2026,STREAMING SERVICE,-12.99
    `);
    const report = analyse(table);
    expect(report.rows.map((row) => row.date)).toEqual(['2026-02-01', '2026-04-23', '2026-06-05']);
    expect(issueCodes(report)).toEqual([]);
  });

  it('dateOrderMixed: rows that only work in the other order are blocked, never read with it', () => {
    const table = tableFromCsv(`
      Date,Description,Amount
      13/09/2026,GROCERY MART,-54.20
      15/09/2026,PAYROLL DEPOSIT,2400.00
      09/17/2026,STREAMING SERVICE,-12.99
      20/09/2026,HARDWARE DEPOT,-31.75
    `);
    const report = analyse(table);
    expect(issue(report, 'dateOrderMixed')).toEqual({
      code: 'dateOrderMixed',
      severity: 'blocker',
      scope: 'column',
      column: 0,
      rows: [2],
      params: { count: 1, example: '09/17/2026', line: 4 },
    });
    expect(report.rows[2]).toMatchObject({ date: null, blocked: true, issueCodes: ['dateOrderMixed'] });
    expect(issue(report, 'unreadableDate')).toBeUndefined();

    // Fixing or skipping the odd rows clears the blocker.
    expect(issue(analyse(table, { overrides: { 2: { date: '2026-09-17' } } }), 'dateOrderMixed')).toBeUndefined();
    expect(issue(analyse(table, { overrides: { 2: { skip: true } } }), 'dateOrderMixed')).toBeUndefined();

    // The same finding when the layout's order is simply the wrong one for the file.
    const wrongOrder = analyse(table, {}, { ...proposeLayout(table).layout, dateOrder: 'MDY' });
    expect(issue(wrongOrder, 'dateOrderMixed')?.rows).toEqual([0, 1, 3]);
  });

  it('decimalAmbiguous: a few "1,234"-style amounts and nothing to prove the mark', () => {
    const table = tableFromCells([
      ['Date', 'Description', 'Amount'],
      ['2026-09-01', 'RENT', '-1,250'],
      ['2026-09-03', 'PAYROLL DEPOSIT', '3,400'],
      ['2026-09-05', 'PARKING', '-12'],
    ]);
    const report = analyse(table);
    expect(report.rows.map((row) => row.amount)).toEqual([-1250, 3400, -12]);
    expect(issue(report, 'decimalAmbiguous')).toEqual({
      code: 'decimalAmbiguous',
      severity: 'warning',
      scope: 'column',
      column: 2,
      params: { example: '-1,250', mark: '.' },
    });
    // Read the other way they become amounts with three decimals: also reported.
    const asDecimals = analyse(table, {}, { ...proposeLayout(table).layout, decimal: ',' });
    expect(asDecimals.rows.map((row) => row.amount)).toEqual([-1.25, 3.4, -12]);
    expect(issue(asDecimals, 'decimalAmbiguous')?.params).toEqual({ example: '-1,250', mark: ',' });
  });

  it('is silent about the decimal mark once one amount proves it, or when thousands are the only reading left', () => {
    const proven = tableFromCells([
      ['Date', 'Description', 'Amount'],
      ['2026-09-01', 'RENT', '-1,250'],
      ['2026-09-03', 'PAYROLL DEPOSIT', '3,400.50'],
      ['2026-09-04', 'SHOP', '-7.25'],
    ]);
    expect(issue(analyse(proven), 'decimalAmbiguous')).toBeUndefined();

    const wholeYen = tableFromCells([
      ['Date', 'Description', 'Amount'],
      ['2026-09-01', 'A', '-8,420'],
      ['2026-09-02', 'B', '-5,236'],
      ['2026-09-03', 'C', '-30,000'],
      ['2026-09-04', 'D', '-78,000'],
      ['2026-09-05', 'E', '285,000'],
    ]);
    expect(issue(analyse(wholeYen), 'decimalAmbiguous')).toBeUndefined();
  });

  it('signAssumed: only positive amounts and nothing to say what they are', () => {
    const table = tableFromCsv(`
      Date,Description,Amount
      2026-09-01,A,10.00
      2026-09-02,B,20.00
      2026-09-03,C,30.00
    `);
    const report = analyse(table);
    expect(issue(report, 'signAssumed')).toEqual({
      code: 'signAssumed',
      severity: 'warning',
      scope: 'column',
      column: 2,
      params: { moneyOutRows: 0, moneyInRows: 3 },
    });
    // With the account known to be a card, they are read as purchases, still flagged as an assumption.
    const card = analyse(table, { accountType: 'credit' });
    expect(card.rows.map((row) => row.amount)).toEqual([-10, -20, -30]);
    expect(issue(card, 'signAssumed')?.params).toEqual({ moneyOutRows: 3, moneyInRows: 0 });
  });

  it('asks nothing about the formats of a file whose layout the reader knows for certain (OFX)', () => {
    // A savings statement with deposits only: the sign of an OFX amount is not in question.
    const table = tableFromCsv(`
      Date,Amount,Name
      2026-09-10,300.00,TRANSFER FROM CHECKING
      2026-09-30,0.42,INTEREST PAID
    `);
    const preset: ImportLayout = { roles: { date: 0, amount: 1, description: [2] }, dateOrder: 'YMD', decimal: '.', amountSign: 'asIs' };
    expect(issue(analyse(table, {}, preset), 'signAssumed')).toBeDefined();
    const ofx = { ...table, format: 'ofx' as const, meta: { ...table.meta, presetLayout: preset } };
    const report = analyse(ofx, {}, preset);
    expect(report.issues).toEqual([]);
    expect(report.stats).toMatchObject({ readyRows: 2, moneyIn: 300.42, moneyOut: 0 });
  });

  it('signAssumed: also when the layout goes against clear evidence in the file', () => {
    const table = tableFromCells(CLEAN);
    expect(issue(analyse(table), 'signAssumed')).toBeUndefined();
    const flipped = analyse(table, {}, { ...proposeLayout(table).layout, amountSign: 'inverted' });
    expect(flipped.rows[0].amount).toBe(54.2);
    expect(issue(flipped, 'signAssumed')?.params).toEqual({ moneyOutRows: 1, moneyInRows: 4 });
  });
});

describe('analyzeStatement: columns', () => {
  it('noDateColumn / noAmountColumn / noDescriptionColumn', () => {
    const table = tableFromCsv('Code,Flag\nA1,x\nB2,y');
    const report = analyse(table);
    expect(issueCodes(report)).toEqual(['noDateColumn', 'noAmountColumn', 'noDescriptionColumn']);
    expect(report.issues.every((found) => found.severity === 'blocker' && found.scope === 'column')).toBe(true);
    expect(report.stats).toMatchObject({ readyRows: 0, blockedRows: 2 });
  });

  it('treats a role that points outside the table as missing', () => {
    const table = tableFromCells(CLEAN);
    const layout: ImportLayout = { roles: { date: 9, description: [1, 12], amount: 2, balance: 40 }, dateOrder: 'YMD', decimal: '.', amountSign: 'asIs' };
    const report = analyse(table, {}, layout);
    expect(issueCodes(report)).toContain('noDateColumn');
    expect(report.rows[0]).toMatchObject({ date: null, description: 'GROCERY MART 0421', amount: -54.2, balance: null });
  });

  it('columnNotImported: recognised columns the import has no place for', () => {
    const table = tableFromCsv(`
      Payment Date,Description,Total Payment,Principal,Interest,Escrow,Category,Check Number,Notes on file
      01/15/2026,MONTHLY PAYMENT,1450.00,412.18,687.82,350.00,Housing,1001,
      02/15/2026,MONTHLY PAYMENT,1450.00,413.90,686.10,350.00,Housing,1002,
    `);
    const report = analyse(table, { accountType: 'loan' });
    const notImported = report.issues.filter((found) => found.code === 'columnNotImported');
    expect(notImported.map((found) => [found.column, found.params])).toEqual([
      [3, { column: 'Principal' }],
      [4, { column: 'Interest' }],
      [5, { column: 'Escrow' }],
      [6, { column: 'Category' }],
      [7, { column: 'Check Number' }],
    ]);
    expect(notImported.every((found) => found.severity === 'info' && found.scope === 'column')).toBe(true);
  });

  it('referenceNotUnique: a repeated reference is dropped from every row', () => {
    const table = tableFromCsv(`
      Date,Description,Amount,Reference
      2026-09-01,A,-1.00,R1
      2026-09-02,B,-2.00,R2
      2026-09-03,C,-3.00,R2
    `);
    const layout: ImportLayout = { roles: { date: 0, description: [1], amount: 2, reference: 3 }, dateOrder: 'YMD', decimal: '.', amountSign: 'asIs' };
    const report = analyse(table, {}, layout);
    expect(issue(report, 'referenceNotUnique')).toEqual({
      code: 'referenceNotUnique',
      severity: 'info',
      scope: 'column',
      column: 3,
      params: { column: 'Reference' },
    });
    expect(report.rows.map((row) => row.reference)).toEqual([null, null, null]);

    // Detection does not pick such a column; the analysis still says why it is not used.
    const detected = analyse(table);
    expect(detected.rows.map((row) => row.reference)).toEqual([null, null, null]);
    expect(issue(detected, 'referenceNotUnique')?.column).toBe(3);
  });

  it('keeps unique references, and treats placeholders as no reference', () => {
    const table = tableFromCsv(`
      Date,Description,Amount,Reference
      2026-09-01,A,-1.00,R1
      2026-09-02,B,-2.00,0
      2026-09-03,C,-3.00,R3
    `);
    const report = analyse(table);
    expect(report.rows.map((row) => row.reference)).toEqual(['R1', null, 'R3']);
    expect(issue(report, 'referenceNotUnique')).toBeUndefined();
  });

  it('currencyMismatch: from a currency column, or from what the file says about itself', () => {
    const table = tableFromCsv(`
      Date,Description,Amount,Currency
      2026-09-01,A,-1.00,USD
      2026-09-02,B,-2.00,EUR
      2026-09-03,C,-3.00,eur
    `);
    expect(issue(analyse(table, { accountCurrency: 'USD' }), 'currencyMismatch')).toEqual({
      code: 'currencyMismatch',
      severity: 'warning',
      scope: 'column',
      column: 3,
      rows: [1, 2],
      params: { count: 2, fileCurrency: 'EUR', accountCurrency: 'USD' },
    });
    expect(issue(analyse(table), 'currencyMismatch')).toBeUndefined();

    const plain = tableFromCells(CLEAN);
    const hinted = { ...plain, meta: { ...plain.meta, accountHints: [{ kind: 'currency' as const, value: 'GBP', source: 'ofx' as const }] } };
    expect(issue(analyse(hinted, { accountCurrency: 'USD' }), 'currencyMismatch')?.params).toEqual({
      count: 5,
      fileCurrency: 'GBP',
      accountCurrency: 'USD',
    });
    expect(issue(analyse(hinted, { accountCurrency: 'GBP' }), 'currencyMismatch')).toBeUndefined();
  });

  it('accountTypeMismatch: the file says it is one kind of account and the rows go into another', () => {
    const plain = tableFromCells(CLEAN);
    const savingsFile = {
      ...plain,
      meta: { ...plain.meta, accountHints: [{ kind: 'accountType' as const, value: 'Savings', source: 'ofx' as const }] },
    };

    expect(issue(analyse(savingsFile, { accountType: 'credit' }), 'accountTypeMismatch')).toEqual({
      code: 'accountTypeMismatch',
      severity: 'warning',
      scope: 'account',
    });
    // The same kind, no account chosen yet, or a file that does not say: nothing to compare.
    expect(issue(analyse(savingsFile, { accountType: 'savings' }), 'accountTypeMismatch')).toBeUndefined();
    expect(issue(analyse(savingsFile), 'accountTypeMismatch')).toBeUndefined();
    expect(issue(analyse(plain, { accountType: 'credit' }), 'accountTypeMismatch')).toBeUndefined();
  });

  it('multipleAccountsInFile: a per-row account column with more than one value', () => {
    const table = tableFromCsv(`
      Account Number,Date,Description,Amount
      ****4821,2026-09-01,A,-1.00
      ****7730,2026-09-02,B,-2.00
      ****4821,2026-09-03,C,3.00
    `);
    const report = analyse(table);
    expect(issue(report, 'multipleAccountsInFile')).toMatchObject({ severity: 'info', scope: 'file', params: { count: 2 } });
    expect(report.rows.map((row) => row.accountValue)).toEqual(['****4821', '****7730', '****4821']);
  });
});

describe('analyzeStatement: coverage against what the account already has', () => {
  const coverage = (extra: Partial<NonNullable<AnalysisContext['coverage']>> = {}) => ({
    accountId: 1,
    firstDate: '2026-01-02',
    lastDate: '2026-07-31',
    lastImportThrough: '2026-07-31',
    transactionCount: 400,
    ...extra,
  });

  it('gapSinceLastImport: the file starts well after what is stored', () => {
    // Stored through 31 July; the file starts on 1 September.
    const report = analyse(tableFromCells(CLEAN), { coverage: coverage() });
    expect(issue(report, 'gapSinceLastImport')).toEqual({
      code: 'gapSinceLastImport',
      severity: 'warning',
      scope: 'coverage',
      params: { count: 31, from: '2026-08-01', to: '2026-08-31' },
    });
  });

  it('does not call a quiet week, or the usual spacing of a quiet account, a gap', () => {
    const table = tableFromCells(CLEAN);
    expect(issue(analyse(table, { coverage: coverage({ lastDate: '2026-08-27', lastImportThrough: '2026-08-27' }) }), 'gapSinceLastImport')).toBeUndefined();
    // A savings account with one transaction a month.
    const quiet = coverage({ firstDate: '2025-08-31', lastDate: '2026-07-31', transactionCount: 12 });
    expect(issue(analyse(table, { coverage: quiet }), 'gapSinceLastImport')).toBeUndefined();
  });

  it('overlapsExisting: the dates both the file and the account cover', () => {
    const report = analyse(tableFromCells(CLEAN), { coverage: coverage({ lastDate: '2026-09-05', lastImportThrough: '2026-09-05' }) });
    expect(issue(report, 'overlapsExisting')).toEqual({
      code: 'overlapsExisting',
      severity: 'info',
      scope: 'coverage',
      params: { from: '2026-09-01', to: '2026-09-05' },
    });
    expect(issue(report, 'gapSinceLastImport')).toBeUndefined();
  });

  it('says nothing for an account with no history', () => {
    const empty = { accountId: 1, firstDate: null, lastDate: null, lastImportThrough: null, transactionCount: 0 };
    expect(analyse(tableFromCells(CLEAN), { coverage: empty }).issues).toEqual([]);
  });
});
