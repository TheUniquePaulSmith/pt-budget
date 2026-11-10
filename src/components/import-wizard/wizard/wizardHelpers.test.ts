import { describe, expect, it } from 'vitest';

import { accountPrefillFrom } from './accountPrefill';
import { dateExample, decimalExample, rawAmountCell, signExamples } from './layoutExamples';
import { fakeAnalyze, fakePropose, makeTable } from './testing/fakePipeline';
import { accountDisplayName, fileSizeParts, sharedCurrency } from './wizardFormat';

function read(rows: string[][], columns?: string[]) {
  const table = makeTable(rows, columns);
  const { layout } = fakePropose(table, {});
  return { table, layout, report: fakeAnalyze(table, layout, { today: '2030-03-01' }) };
}

describe('worded examples', () => {
  it('prefers a date whose day could also be a month, because that one shows the order', () => {
    const statement = read([
      ['2030-02-25', 'Late', '-1.00'],
      ['2030-03-04', 'Ambiguous', '-2.00'],
    ]);
    expect(dateExample(statement)).toEqual({ raw: '2030-03-04', date: '2030-03-04' });
    expect(dateExample(read([['2030-02-25', 'Late', '-1.00']]))).toEqual({ raw: '2030-02-25', date: '2030-02-25' });
    expect(dateExample(read([['nonsense', 'Bad', '-1.00']]))).toBeNull();
  });

  it('shows an amount whose cell carries a separator, else the first readable one', () => {
    const statement = read([
      ['2030-02-01', 'Whole', '12'],
      ['2030-02-02', 'Cents', '-4.50'],
    ]);
    expect(decimalExample(statement)).toMatchObject({ raw: '-4.50', amount: -4.5 });
    expect(decimalExample(read([['2030-02-01', 'Whole', '12']]))).toMatchObject({ raw: '12', amount: 12 });
    expect(decimalExample(read([['2030-02-01', 'Bad', 'twelve']]))).toBeNull();
  });

  it('gives one example of money out and one of money in, as the rows are read', () => {
    const statement = read([
      ['2030-02-01', 'Zero', '0'],
      ['2030-02-02', 'Paycheck', '1200.00'],
      ['2030-02-03', 'Coffee', '-4.50'],
      ['2030-02-04', 'More coffee', '-5.00'],
    ]);
    expect(signExamples(statement)).toEqual({
      out: { raw: '-4.50', amount: -4.5, description: 'Coffee' },
      in: { raw: '1200.00', amount: 1200, description: 'Paycheck' },
    });
  });

  it('reads the printed amount from whichever of the debit / credit cells is filled', () => {
    const statement = read(
      [
        ['2030-02-01', 'Coffee', '4.50', ''],
        ['2030-02-02', 'Paycheck', '', '1200'],
      ],
      ['Date', 'Description', 'Debit', 'Credit']
    );
    expect([rawAmountCell(statement, 0), rawAmountCell(statement, 1)]).toEqual(['4.50', '1200']);
    expect(signExamples(statement).out).toMatchObject({ raw: '4.50', amount: -4.5 });
  });
});

describe('account prefill', () => {
  it('takes the number and the name from what the file calls the account', () => {
    expect(accountPrefillFrom('Huntington Checking ending 8801', [])).toEqual({
      name: 'Huntington Checking',
      institution: '',
      cardNumberInput: '8801',
    });
    expect(accountPrefillFrom('XXXX-XXXX-1234', [])).toEqual({ name: '', institution: '', cardNumberInput: '1234' });
    // Fewer than four digits is not an account number.
    expect(accountPrefillFrom('123', [])).toEqual({ name: '', institution: '', cardNumberInput: '' });
    expect(accountPrefillFrom('Compte chèques 400000000004821', []).name).toBe('Compte chèques');
  });

  it('fills the bank, the account type and the currency from the reader hints', () => {
    expect(
      accountPrefillFrom('', [
        { kind: 'institution', value: 'Cedar Valley CU', source: 'ofx' },
        { kind: 'accountType', value: 'savings', source: 'ofx' },
        { kind: 'currency', value: 'cad', source: 'ofx' },
        { kind: 'label', value: 'Rainy Day', source: 'preamble' },
      ])
    ).toEqual({ name: 'Rainy Day', institution: 'Cedar Valley CU', cardNumberInput: '', type: 'savings', currency: 'CAD' });
    // A hint that is not an account type or a currency code is ignored.
    expect(
      accountPrefillFrom('', [
        { kind: 'accountType', value: 'moneymarket', source: 'ofx' },
        { kind: 'currency', value: 'dollars', source: 'column' },
      ])
    ).toEqual({ name: '', institution: '', cardNumberInput: '' });
  });
});

describe('display helpers', () => {
  const accounts = [
    { id: 1, name: 'Checking', owner_display_name: 'Alex', currency: 'USD' },
    { id: 2, name: 'Compte', currency: 'EUR' },
    { id: 3, name: 'Savings', currency: 'USD' },
  ] as never;

  it('names an account with its owner', () => {
    expect(accountDisplayName({ name: 'Checking', owner_display_name: 'Alex' })).toBe('Alex - Checking');
    expect(accountDisplayName({ name: 'Checking' })).toBe('Checking');
  });

  it('gives a currency for a total only when every account shares it', () => {
    expect(sharedCurrency(accounts, [1, 3])).toBe('USD');
    expect(sharedCurrency(accounts, [1, 2])).toBeNull();
    expect(sharedCurrency(accounts, [])).toBeNull();
  });

  it('sizes a file in a readable unit', () => {
    expect(fileSizeParts(512)).toEqual({ value: 512, unit: 'B' });
    expect(fileSizeParts(20_480)).toEqual({ value: 20, unit: 'KB' });
    expect(fileSizeParts(3_250_000)).toEqual({ value: 3.1, unit: 'MB' });
  });
});
