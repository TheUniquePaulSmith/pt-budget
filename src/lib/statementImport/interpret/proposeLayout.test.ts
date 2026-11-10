import { describe, expect, it } from 'vitest';

import { tableFromCells, tableFromCsv } from '../testing/tableFromCsv';
import type { ImportLayout, LayoutProposal, StatementTable } from '../types';

import { proposeLayout } from './proposeLayout';

const codes = (proposal: LayoutProposal) => proposal.assumptions.map((assumption) => assumption.code);
const assumption = (proposal: LayoutProposal, code: string) => proposal.assumptions.find((candidate) => candidate.code === code);

/** The same rows under headers nobody knows, or under none at all ("Column 1"…). */
function withoutHeaders(table: StatementTable, synthetic = false): StatementTable {
  return {
    ...table,
    columns: table.columns.map((column) => ({
      index: column.index,
      name: synthetic ? `Column ${column.index + 1}` : `Field ${String.fromCharCode(65 + column.index)}`,
      ...(synthetic ? { synthetic: true } : {}),
    })),
  };
}

describe('proposeLayout: columns', () => {
  it('finds the three required parts by header and says so', () => {
    const table = tableFromCsv(`
      Date,Description,Amount
      2026-09-01,GROCERY MART,-54.20
      2026-09-03,PAYROLL DEPOSIT,2400.00
      2026-09-05,STREAMING SERVICE,-12.99
    `);
    const proposal = proposeLayout(table);

    expect(proposal.layout).toEqual({
      roles: { date: 0, description: [1], amount: 2 },
      dateOrder: 'YMD',
      decimal: '.',
      amountSign: 'asIs',
    });
    expect(proposal.missing).toEqual([]);
    expect(assumption(proposal, 'columnsByName')).toEqual({
      subject: 'columns',
      code: 'columnsByName',
      basis: 'file',
      confidence: 0.98,
      params: { date: 'Date', description: 'Description', amount: 'Amount' },
    });
  });

  it('tells the transaction date from the posted date by their headers', () => {
    const table = tableFromCsv(`
      Posted Date,Transaction Date,Description,Amount
      09/16/2026,09/14/2026,CORNER BAKERY,-8.45
      09/18/2026,09/17/2026,FUEL STOP,-41.10
    `);
    const proposal = proposeLayout(table);
    expect(proposal.layout.roles).toMatchObject({ date: 1, postedDate: 0 });
    expect(assumption(proposal, 'twoDateColumns')?.params).toEqual({ date: 'Transaction Date', postedDate: 'Posted Date' });
  });

  it('tells them apart by their contents when the headers do not help: the earlier one is when it happened', () => {
    const table = withoutHeaders(
      tableFromCsv(`
        a,b,c,d
        09/16/2026,09/14/2026,CORNER BAKERY,-8.45
        09/18/2026,09/17/2026,FUEL STOP,-41.10
        09/20/2026,09/20/2026,BOOK NOOK,-23.99
      `)
    );
    expect(proposeLayout(table).layout.roles).toMatchObject({ date: 1, postedDate: 0 });
  });

  it('joins payee, description and memo in that order', () => {
    const table = tableFromCsv(`
      Date,Memo,Payee,Amount
      2026-09-01,Invoice 7,ACME,-12.00
      2026-09-02,,EMPLOYER,2000.00
    `);
    const proposal = proposeLayout(table);
    expect(proposal.layout.roles.description).toEqual([2, 1]);
    expect(assumption(proposal, 'descriptionJoined')?.params).toEqual({ columns: 'Payee + Memo' });
    expect(assumption(proposal, 'columnsByName')?.params).toMatchObject({ description: 'Payee + Memo' });
  });

  it('of two columns named like a description, takes the one that reads like one', () => {
    // A "Details" column that only says DEBIT / CREDIT, next to the real description.
    const table = tableFromCsv(`
      Details,Posting Date,Description,Amount,Type,Balance
      DEBIT,09/14/2026,CORNER BAKERY 0091,-8.45,DEBIT_CARD,991.55
      DEBIT,09/16/2026,FUEL STOP 2231,-41.10,DEBIT_CARD,950.45
      CREDIT,09/18/2026,PAYROLL DEPOSIT,2400.00,ACH_CREDIT,3350.45
      DEBIT,09/20/2026,GROCERY MART 0421,-96.37,DEBIT_CARD,3254.08
    `);
    const { roles } = proposeLayout(table).layout;
    expect(roles).toMatchObject({ date: 1, description: [2], amount: 3, balance: 5 });
    // The amounts are signed, so "Type" is not a money-in / money-out indicator.
    expect(roles.direction).toBeUndefined();
  });

  it('reads a debit / credit pair, and pairs "Charges" with "Payments"', () => {
    const pair = tableFromCsv(`
      Date,Description,Withdrawals,Deposits
      2026-09-01,RENT,950.00,
      2026-09-02,PAYROLL,,2400.00
    `);
    const proposal = proposeLayout(pair);
    expect(proposal.layout.roles).toMatchObject({ debit: 2, credit: 3 });
    expect(proposal.layout.roles.amount).toBeUndefined();
    expect(assumption(proposal, 'debitCreditColumns')?.params).toEqual({ debit: 'Withdrawals', credit: 'Deposits' });
    // No sign question with a pair.
    expect(codes(proposal).some((code) => code.startsWith('sign'))).toBe(false);

    const card = tableFromCsv(`
      Date,Description,Charges,Payment
      2026-09-01,SHOP,25.00,
      2026-09-02,THANK YOU,,500.00
    `);
    expect(proposeLayout(card).layout.roles).toMatchObject({ debit: 2, credit: 3 });

    // On its own, "Payment" is the amount (a loan servicer's history).
    const loan = tableFromCsv('Date,Description,Payment\n2026-09-01,MONTHLY,450.00');
    expect(proposeLayout(loan).layout.roles).toMatchObject({ amount: 2 });
  });

  it('keeps one side of a pair that is empty in this file', () => {
    const table = tableFromCsv(`
      Date,Description,Debit,Credit
      2026-09-01,RENT,950.00,
      2026-09-02,SHOP,25.00,
    `);
    expect(proposeLayout(table).layout.roles).toMatchObject({ debit: 2, credit: 3 });
  });

  it('reads an unsigned amount with a DR / CR indicator', () => {
    const table = tableFromCsv(`
      Date,Narration,Amount,Dr/Cr
      2026-09-14,GROCERY,1250.00,DR
      2026-09-15,SALARY,65000.00,CR
      2026-09-17,BILL,2140.50,Dr
    `);
    const proposal = proposeLayout(table);
    expect(proposal.layout.roles).toMatchObject({ amount: 2, direction: 3 });
    expect(proposal.layout.directionValues).toEqual({ out: ['dr'], in: ['cr'] });
    expect(assumption(proposal, 'directionColumn')?.params).toEqual({ amount: 'Amount', direction: 'Dr/Cr', out: 'DR', in: 'CR' });
    expect(codes(proposal).some((code) => code.startsWith('sign'))).toBe(false);
  });

  it('recognises a direction column by its contents, in any of the app languages', () => {
    const table = tableFromCsv(`
      Fecha,Concepto,Importe,Flag
      15/09/2026,COMPRA,25.00,Cargo
      16/09/2026,NOMINA,1950.00,Abono
      17/09/2026,RECIBO,61.45,Cargo
    `);
    const proposal = proposeLayout(table);
    expect(proposal.layout.roles).toMatchObject({ amount: 2, direction: 3 });
    expect(proposal.layout.directionValues).toEqual({ out: ['cargo'], in: ['abono'] });
  });

  it('uses a bank reference only when every row has its own', () => {
    const unique = tableFromCsv(`
      Date,Description,Amount,Transaction ID
      2026-09-01,A,-1.00,T1
      2026-09-02,B,-2.00,T2
    `);
    expect(proposeLayout(unique).layout.roles.reference).toBe(3);

    const repeated = tableFromCsv(`
      Date,Description,Amount,Reference
      2026-09-01,A,-1.00,0
      2026-09-02,B,-2.00,0
      2026-09-03,C,-3.00,R7
    `);
    expect(proposeLayout(repeated).layout.roles.reference).toBeUndefined();
  });

  it('finds a per-row account, a status and a currency column', () => {
    const table = tableFromCsv(`
      Account Number,Date,Description,Amount,Status,Currency
      ****4821,2026-09-01,A,-1.00,Posted,USD
      ****7730,2026-09-02,B,-2.00,Pending,USD
    `);
    const proposal = proposeLayout(table);
    expect(proposal.layout.roles).toMatchObject({ account: 0, status: 4, currency: 5 });
    expect(assumption(proposal, 'accountColumn')?.params).toEqual({ column: 'Account Number' });
  });

  it('resolves a word that means different things by what the column holds', () => {
    // German: "Valuta" is the value date. Italian: "Valuta" is the currency.
    const german = tableFromCells([
      ['Buchungstag', 'Valuta', 'Verwendungszweck', 'Betrag'],
      ['14.09.2026', '15.09.2026', 'Miete', '-980,00'],
      ['16.09.2026', '16.09.2026', 'Gehalt', '2.850,00'],
    ]);
    expect(proposeLayout(german).layout.roles).toMatchObject({ date: 0, postedDate: 1 });
    expect(proposeLayout(german).layout.roles.currency).toBeUndefined();

    const italian = tableFromCells([
      ['Data', 'Descrizione', 'Importo', 'Valuta'],
      ['14/09/2026', 'AFFITTO', '-800,00', 'EUR'],
      ['16/09/2026', 'STIPENDIO', '1.720,00', 'EUR'],
    ]);
    const { roles } = proposeLayout(italian).layout;
    expect(roles.currency).toBe(3);
    expect(roles.postedDate).toBeUndefined();
  });

  it('trusts a header that is exactly "Date" or "Amount" even when its cells are bad', () => {
    const table = tableFromCsv(`
      Date,Amount,Description
      someday,lots,A
      never,many,B
    `);
    const proposal = proposeLayout(table);
    expect(proposal.missing).toEqual([]);
    expect(proposal.layout.roles).toMatchObject({ date: 0, amount: 1, description: [2] });
  });
});

describe('proposeLayout: unknown headers', () => {
  const statement = tableFromCsv(`
    a,b,c,d
    2026-09-01,GROCERY MART 0421,-54.20,945.80
    2026-09-03,PAYROLL DEPOSIT,2400.00,3345.80
    2026-09-05,STREAMING SERVICE,-12.99,3332.81
    2026-09-09,HARDWARE DEPOT 77,-31.75,3301.06
    2026-09-12,COFFEE HOUSE 22,-6.75,3294.31
  `);

  it('goes by the contents: dates, text, and the number that the running total follows', () => {
    const proposal = proposeLayout(withoutHeaders(statement));
    expect(proposal.layout.roles).toEqual({ date: 0, description: [1], amount: 2, balance: 3 });
    expect(proposal.missing).toEqual([]);
    expect(assumption(proposal, 'columnsByContent')?.params).toEqual({ date: 'Field A', description: 'Field B', amount: 'Field C' });
    // Less sure than a header match, and the proposal as a whole is only as sure as its weakest part.
    expect(proposal.confidence).toBe(0.7);
    expect(assumption(proposal, 'signAsPrintedByBalance')).toBeDefined();
  });

  it('works for a file with no header row at all', () => {
    const proposal = proposeLayout(withoutHeaders(statement, true));
    expect(proposal.layout.roles).toEqual({ date: 0, description: [1], amount: 2, balance: 3 });
  });

  it('never mistakes ids, account numbers or counts for the amount', () => {
    const table = withoutHeaders(
      tableFromCsv(`
        a,b,c,d,e
        2026-09-01,400000000004821,GROCERY MART,-54.20,1
        2026-09-03,400000000004821,PAYROLL DEPOSIT,2400.00,1
        2026-09-05,400000000004821,STREAMING,-12.99,1
        2026-09-06,400000000004821,COFFEE,-4.50,1
      `)
    );
    expect(proposeLayout(table).layout.roles).toMatchObject({ date: 0, description: [2], amount: 3 });
  });

  it('recognises money out / money in columns where every row fills exactly one', () => {
    const table = withoutHeaders(
      tableFromCsv(`
        a,b,c,d,e
        2026-09-01,OPENING,,1500.00,1500.00
        2026-09-03,RENT,950.00,,550.00
        2026-09-05,GROCERY,84.15,,465.85
        2026-09-08,ELECTRIC,61.40,,404.45
        2026-09-15,PAYROLL,,2400.00,2804.45
      `)
    );
    // The running balance goes down by column c: that is the money-out side.
    expect(proposeLayout(table).layout.roles).toMatchObject({ date: 0, description: [1], debit: 2, credit: 3, balance: 4 });

    const noBalance = withoutHeaders(
      tableFromCsv(`
        a,b,c,d
        2026-09-01,PAYROLL,2400.00,
        2026-09-03,RENT,,950.00
        2026-09-05,GROCERY,,84.15
        2026-09-08,ELECTRIC,,61.40
      `)
    );
    // No balance to settle it: the fuller column is taken as money out (most rows are spending), with less confidence.
    const proposal = proposeLayout(noBalance);
    expect(proposal.layout.roles).toMatchObject({ debit: 3, credit: 2 });
    expect(proposal.confidence).toBe(0.6);
  });

  it('recognises a masked account number, a status and a currency by their contents', () => {
    const table = withoutHeaders(
      tableFromCsv(`
        a,b,c,d,e,f
        ****4821,2026-09-01,GROCERY MART,-54.20,Posted,EUR
        ****4821,2026-09-03,PAYROLL DEPOSIT,2400.00,Posted,EUR
        ****4821,2026-09-05,STREAMING,-12.99,Pending,EUR
      `)
    );
    expect(proposeLayout(table).layout.roles).toMatchObject({ account: 0, date: 1, description: [2], amount: 3, status: 4, currency: 5 });
  });

  it('says which required parts it could not find instead of guessing', () => {
    const table = tableFromCsv(`
      Code,Flag
      A1,x
      B2,y
    `);
    const proposal = proposeLayout(table);
    expect(proposal.missing).toEqual(['date', 'description', 'amount']);
    expect(proposal.confidence).toBe(0);
    expect(proposal.layout.roles).toEqual({ date: null, description: [] });
    // Nothing to say about columns that were not found.
    expect(codes(proposal)).toEqual([]);

    const noAmount = tableFromCsv('Date,Description\n2026-09-01,GROCERY MART\n2026-09-02,COFFEE HOUSE');
    expect(proposeLayout(noAmount).missing).toEqual(['amount']);
  });
});

describe('proposeLayout: formats, sign and precedence', () => {
  it('reads the date order and decimal mark from the file, never from the fallback', () => {
    const table = tableFromCells([
      ['Datum', 'Text', 'Betrag'],
      ['23.09.2026', 'Miete', '-980,00'],
      ['24.09.2026', 'Gehalt', '2.850,00'],
    ]);
    const proposal = proposeLayout(table, { fallbackDateOrder: 'MDY', fallbackDecimal: '.' });
    expect(proposal.layout).toMatchObject({ dateOrder: 'DMY', decimal: ',' });
    expect(codes(proposal)).toEqual(expect.arrayContaining(['dayFirstFromFile', 'decimalFromFile']));
  });

  it('uses the fallback only when the file is silent, and lowers the confidence', () => {
    const table = tableFromCsv(`
      Date,Description,Amount
      01/02/2026,GROCERY MART,-54.20
      03/04/2026,PAYROLL DEPOSIT,2400.00
      05/06/2026,STREAMING SERVICE,-12.99
    `);
    const dayFirst = proposeLayout(table, { fallbackDateOrder: 'DMY' });
    expect(dayFirst.layout.dateOrder).toBe('DMY');
    expect(assumption(dayFirst, 'dayFirstAssumed')).toMatchObject({ basis: 'language', confidence: 0.5 });
    expect(dayFirst.confidence).toBe(0.5);

    const noFallback = proposeLayout(table);
    expect(noFallback.layout.dateOrder).toBe('MDY');
    expect(assumption(noFallback, 'monthFirstAssumed')).toMatchObject({ basis: 'default', confidence: 0.4 });
  });

  it('flips the sign of a card export with positive purchases', () => {
    const table = tableFromCsv(`
      Date,Description,Amount
      09/14/2026,CORNER BAKERY,8.45
      09/16/2026,FUEL STOP,41.10
      09/18/2026,BOOK NOOK,23.99
      09/22/2026,PAYMENT THANK YOU,-500.00
    `);
    expect(proposeLayout(table, { accountType: 'credit' }).layout.amountSign).toBe('inverted');
    // The account type can also come from the file itself (an OFX ACCTTYPE, a preamble line).
    const hinted = { ...table, meta: { ...table.meta, accountHints: [{ kind: 'accountType' as const, value: 'credit', source: 'preamble' as const }] } };
    const allPositive = { ...hinted, rows: hinted.rows.slice(0, 3), sourceLines: hinted.sourceLines.slice(0, 3) };
    expect(proposeLayout(allPositive).assumptions.at(-1)).toMatchObject({ code: 'signFlippedForCard' });
  });

  it('the confidence is the lowest among the required parts and formats', () => {
    const table = tableFromCsv(`
      Date,Description,Amount
      2026-09-01,A,10.00
      2026-09-02,B,20.00
    `);
    // Everything is certain except the sign: only positive numbers, account unknown.
    const proposal = proposeLayout(table);
    expect(proposal.assumptions.map((item) => [item.subject, item.confidence])).toEqual([
      ['columns', 0.98],
      ['dateOrder', 1],
      ['decimal', 0.98],
      ['amountSign', 0.5],
    ]);
    expect(proposal.confidence).toBe(0.5);
  });

  it('a saved layout wins over detection, and a reader preset over detection too', () => {
    const table = tableFromCsv('Date,Amount,Description\n2026-10-01,1.00,X');
    const saved: ImportLayout = { roles: { date: 0, description: [2], amount: 1 }, dateOrder: 'DMY', decimal: ',', amountSign: 'inverted' };

    const fromProfile = proposeLayout(table, { profile: { version: 1, layout: saved } });
    expect(fromProfile.layout).toBe(saved);
    expect(fromProfile.assumptions).toEqual([{ subject: 'columns', code: 'savedLayout', basis: 'profile', confidence: 1 }]);
    expect(fromProfile).toMatchObject({ confidence: 1, missing: [] });

    const preset = proposeLayout({ ...table, meta: { ...table.meta, presetLayout: saved } });
    expect(preset).toEqual({ layout: saved, confidence: 1, assumptions: [], missing: [] });

    // Both at once: the user's saved choice beats the reader's.
    const other: ImportLayout = { ...saved, amountSign: 'asIs' };
    const both = proposeLayout({ ...table, meta: { ...table.meta, presetLayout: other } }, { profile: { version: 1, layout: saved } });
    expect(both.layout).toBe(saved);
  });
});
