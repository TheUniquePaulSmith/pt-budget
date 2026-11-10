import { describe, expect, it } from 'vitest';

import { sourceFileFromText } from '../testing/tableFromCsv';

import { accountTypeFromText, collectAccountHints, isValidIban } from './accountHints';
import { readStatement } from './index';

/** Hints from preamble lines given as text, one cell per line unless a line is an array of cells. */
const fromPreamble = (...preamble: Array<string | string[]>) =>
  collectAccountHints(
    preamble.map((line) => (Array.isArray(line) ? line : [line])),
    ''
  );

// An invented account with correct ISO 13616 check digits.
const IBAN = 'DE51 1234 5678 0000 0048 21';

describe('account hints from the lines above the header', () => {
  it('reads an account number after its label, as printed', () => {
    expect(fromPreamble('Account Number: 000123456789')).toEqual([{ kind: 'number', value: '000123456789', source: 'preamble' }]);
    expect(fromPreamble('Account No.: XXXX-XXXX-4821')).toEqual([{ kind: 'number', value: 'XXXX-XXXX-4821', source: 'preamble' }]);
    expect(fromPreamble('Account #: ****4821')).toEqual([{ kind: 'number', value: '****4821', source: 'preamble' }]);
    expect(fromPreamble('Card Number = 4000 0000 0000 4821')).toEqual([
      { kind: 'number', value: '4000 0000 0000 4821', source: 'preamble' },
    ]);
  });

  it('reads a label in one cell and its value in the next', () => {
    expect(fromPreamble(['Account Number:', '000123456789', '', ''])).toEqual([
      { kind: 'number', value: '000123456789', source: 'preamble' },
    ]);
    expect(fromPreamble(['Account', 'Joint Checking'])).toEqual([{ kind: 'label', value: 'Joint Checking', source: 'preamble' }]);
  });

  it('calls a value with four digits or more a number and anything else a label', () => {
    expect(fromPreamble('Account: Joint Checking')).toEqual([{ kind: 'label', value: 'Joint Checking', source: 'preamble' }]);
    expect(fromPreamble('Account: Everyday Checking ...4821')).toEqual([
      { kind: 'number', value: 'Everyday Checking ...4821', source: 'preamble' },
    ]);
    expect(fromPreamble('Account Name: Holiday Fund 22')).toEqual([{ kind: 'label', value: 'Holiday Fund 22', source: 'preamble' }]);
  });

  it('reads a number that follows a specific label with no separator', () => {
    expect(fromPreamble('Account Number 000123456789')).toEqual([{ kind: 'number', value: '000123456789', source: 'preamble' }]);
    expect(fromPreamble('Card ending in 4821')).toEqual([{ kind: 'number', value: '4821', source: 'preamble' }]);
  });

  it('recognises an IBAN wherever it is printed, and only a valid one', () => {
    expect(fromPreamble(`IBAN: ${IBAN}`)).toEqual([{ kind: 'number', value: IBAN, source: 'preamble' }]);
    expect(fromPreamble(`Kontoauszug für ${IBAN} vom 30.09.2026`)).toEqual([{ kind: 'number', value: IBAN, source: 'preamble' }]);
    // As printed: lower case and unspaced stay as they are.
    expect(fromPreamble('statement for de51123456780000004821')).toEqual([
      { kind: 'number', value: 'de51123456780000004821', source: 'preamble' },
    ]);
    // Same shape, wrong check digits.
    expect(fromPreamble('Kontoauszug für DE52 1234 5678 0000 0048 21')).toEqual([]);
    expect(isValidIban(IBAN)).toBe(true);
    expect(isValidIban(IBAN.replace(/ /g, '').toLowerCase())).toBe(true);
    expect(isValidIban('DE52 1234 5678 0000 0048 21')).toBe(false);
    expect(isValidIban('DE51')).toBe(false);
  });

  it('knows the labels of the languages the app ships', () => {
    const number = (value: string) => [{ kind: 'number', value, source: 'preamble' }];
    expect(fromPreamble('Kontonummer: 0000004821')).toEqual(number('0000004821'));
    expect(fromPreamble('Numéro de compte : 00012345678')).toEqual(number('00012345678'));
    expect(fromPreamble('Número de cuenta: 0123456789')).toEqual(number('0123456789'));
    expect(fromPreamble('Número da conta: 12345-6')).toEqual(number('12345-6'));
    expect(fromPreamble('Numero conto: 000012345678')).toEqual(number('000012345678'));
    expect(fromPreamble('口座番号：1234567')).toEqual(number('1234567'));
    expect(fromPreamble('账号: 6222000000004821')).toEqual(number('6222000000004821'));
    expect(fromPreamble('계좌번호: 110-123-456789')).toEqual(number('110-123-456789'));
  });

  it('reads the institution, the currency and the account type when the file labels them', () => {
    expect(fromPreamble('Bank: Northwind Community Bank', 'Currency: EUR (Euro)', 'Account Type: Savings account')).toEqual([
      { kind: 'institution', value: 'Northwind Community Bank', source: 'preamble' },
      { kind: 'currency', value: 'EUR', source: 'preamble' },
      { kind: 'accountType', value: 'savings', source: 'preamble' },
    ]);
    expect(fromPreamble('Währung: chf', 'Kontoart: Girokonto')).toEqual([
      { kind: 'currency', value: 'CHF', source: 'preamble' },
      { kind: 'accountType', value: 'checking', source: 'preamble' },
    ]);
    // A currency or type it cannot place is not a hint.
    expect(fromPreamble('Currency: dollars', 'Account Type: Premier')).toEqual([]);
  });

  it('takes nothing from lines that are not about the account', () => {
    expect(
      fromPreamble(
        'Northwind Community Bank',
        'Statement Period: 09/01/2026 - 09/30/2026',
        'Account activity for September',
        'Downloaded on 2026-10-01 at 08:15',
        ['Opening balance', '1,000.00']
      )
    ).toEqual([]);
  });

  it('reports the same number once, however often and however spaced it is printed', () => {
    expect(fromPreamble(`IBAN: ${IBAN}`, `Account Number: ${IBAN.replace(/ /g, '')}`, `Konto: ${IBAN}`)).toEqual([
      { kind: 'number', value: IBAN, source: 'preamble' },
    ]);
  });
});

describe('account hints from the file name', () => {
  const fromName = (name: string) => collectAccountHints([], name);

  it('takes a run of four or more digits as a number and the first word as the institution', () => {
    expect(fromName('Chase4821_Activity.CSV')).toEqual([
      { kind: 'number', value: '4821', source: 'fileName' },
      { kind: 'institution', value: 'Chase', source: 'fileName' },
    ]);
    expect(fromName('HuntingtonExport.csv')).toEqual([{ kind: 'institution', value: 'Huntington', source: 'fileName' }]);
    expect(fromName('acct-000123456789.txt')).toEqual([{ kind: 'number', value: '000123456789', source: 'fileName' }]);
  });

  it('does not mistake a date stamp for an account number', () => {
    expect(fromName('export_2026-09-30.csv')).toEqual([]);
    expect(fromName('transactions_20260930.csv')).toEqual([]);
    expect(fromName('transactions_09302026.csv')).toEqual([]);
    expect(fromName('statement-202609.csv')).toEqual([]);
    expect(fromName('download_20260930143059.csv')).toEqual([]);
    expect(fromName('Chase4821_Activity_20260930.csv')).toEqual([
      { kind: 'number', value: '4821', source: 'fileName' },
      { kind: 'institution', value: 'Chase', source: 'fileName' },
    ]);
  });

  it('ignores short digit runs and the extension', () => {
    expect(fromName('export (3).csv')).toEqual([]);
    expect(fromName('list.1234')).toEqual([]);
  });
});

describe('accountTypeFromText', () => {
  it('maps the words banks use to an app account type', () => {
    expect(accountTypeFromText('Everyday Checking')).toBe('checking');
    expect(accountTypeFromText('Chequing')).toBe('checking');
    expect(accountTypeFromText('Compte courant')).toBe('checking');
    expect(accountTypeFromText('High-Yield Savings')).toBe('savings');
    expect(accountTypeFromText('Sparkonto')).toBe('savings');
    expect(accountTypeFromText('Platinum Credit Card')).toBe('credit');
    expect(accountTypeFromText('Tarjeta de crédito')).toBe('credit');
    expect(accountTypeFromText('Home Mortgage')).toBe('loan');
    expect(accountTypeFromText('Premier')).toBeNull();
  });
});

describe('readStatement: account hints on a delimited table', () => {
  it('puts what the preamble says first and what the file name says after it', async () => {
    const text = [
      'Bank: Lakeside Credit Union',
      'Account Number: 5550001111',
      'Currency: USD',
      '',
      'Date,Description,Amount',
      '2026-09-01,COFFEE,-4.50',
      '',
    ].join('\r\n');
    const { tables } = await readStatement(sourceFileFromText(text, 'Lakeside_1111_2026-09.csv'));
    expect(tables[0].meta.accountHints).toEqual([
      { kind: 'institution', value: 'Lakeside Credit Union', source: 'preamble' },
      { kind: 'number', value: '5550001111', source: 'preamble' },
      { kind: 'currency', value: 'USD', source: 'preamble' },
      { kind: 'number', value: '1111', source: 'fileName' },
      { kind: 'institution', value: 'Lakeside', source: 'fileName' },
    ]);
  });

  it('does not read hints out of the rows or the lines below them', async () => {
    const text = 'Date,Description,Amount\n2026-09-01,Account Number: 999988887777,-4.50\nAccount Number: 111122223333\n';
    const { tables } = await readStatement(sourceFileFromText(text, 'export.csv'));
    expect(tables[0].meta.accountHints).toEqual([]);
  });
});
