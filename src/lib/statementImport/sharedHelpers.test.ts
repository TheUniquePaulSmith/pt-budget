/**
 * The parsing helpers in ./shared (amounts, reference columns, account text).
 * These cases lived in csvImportService.test.ts, which went away with the old
 * CSV dialog; the helpers are still what the readers, the analysis and the
 * imports service use, so their tests moved here unchanged.
 */

import { describe, expect, it } from 'vitest';

import type { Account } from '@/types/database';

import { deriveInstitutionHint, extractDigitsValue, extractLastFourValue, findTextHintedAccounts } from './shared/accountText';
import { parseCsvAmount } from './shared/amounts';
import { detectUniqueIdentifierColumn, isPlaceholderReference } from './shared/references';

describe('parseCsvAmount', () => {
  it.each([
    ['-$12.50', -12.5],
    ['$1,234.56', 1234.56],
    ['(12.34)', -12.34],
    ['12.34-', -12.34],
    ['1,234.56 CR', 1234.56],
    ['12.34 DR', -12.34],
    ['CR 40', 40],
    [' 0 ', 0],
  ])('parses amount %s as %s', (input, expected) => {
    expect(parseCsvAmount(input)).toBe(expected);
  });

  it.each(['', 'n/a', 'abc', '12.34.56', null, undefined])('returns null for unparseable amount %s', (input) => {
    expect(parseCsvAmount(input)).toBeNull();
  });

  it.each([
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['12,34', 12.34],
    ['1,234', 1234],
    ['€ 1.234.567,89', 1234567.89],
    ['(1.234,56)', -1234.56],
  ])('auto-detects the decimal separator for %s', (input, expected) => {
    expect(parseCsvAmount(input)).toBe(expected);
  });

  it('honours an explicit decimal-comma convention', () => {
    expect(parseCsvAmount('1.234', { decimal: ',' })).toBe(1234);
    expect(parseCsvAmount('1,5', { decimal: ',' })).toBe(1.5);
    expect(parseCsvAmount('1.5', { decimal: ',' })).toBe(1.5);
    expect(parseCsvAmount('1,234', { decimal: '.' })).toBe(1234);
    expect(parseCsvAmount('12,34', { decimal: '.' })).toBe(1234);
  });
});

describe('detectUniqueIdentifierColumn', () => {
  it('picks a bank reference column as the unique identifier and ignores headers that merely contain "id"', () => {
    expect(detectUniqueIdentifierColumn(['Date', 'Amount', 'Transaction ID'])).toBe('Transaction ID');
    expect(detectUniqueIdentifierColumn(['Date', 'Reference Number', 'Card Holder ID'])).toBe('Reference Number');
    expect(detectUniqueIdentifierColumn(['Date', 'ID', 'Description'])).toBe('ID');
    expect(detectUniqueIdentifierColumn(['Paid', 'Valid', 'Card Holder ID', 'Member ID'])).toBe('');
  });

  it('skips a reference column whose values are placeholders or repeat', () => {
    const headers = ['Date', 'Reference Number', 'Transaction ID', 'Amount'];
    // Huntington: "Reference Number" is "0" on most rows.
    const huntington = [
      { 'Reference Number': '0', 'Transaction ID': 'T-1' },
      { 'Reference Number': '0', 'Transaction ID': 'T-2' },
      { 'Reference Number': '400681', 'Transaction ID': 'T-3' },
    ];
    expect(detectUniqueIdentifierColumn(headers, huntington)).toBe('Transaction ID');

    const repeating = [
      { 'Reference Number': 'R-1', 'Transaction ID': '' },
      { 'Reference Number': 'R-1', 'Transaction ID': 'N/A' },
    ];
    expect(detectUniqueIdentifierColumn(headers, repeating)).toBe('');

    const unique = [{ 'Reference Number': 'R-1' }, { 'Reference Number': 'R-2' }];
    expect(detectUniqueIdentifierColumn(headers, unique)).toBe('Reference Number');
  });

  it('treats the placeholder values above as no reference at all', () => {
    expect(isPlaceholderReference('0')).toBe(true);
    expect(isPlaceholderReference('N/A')).toBe(true);
    expect(isPlaceholderReference('T-1')).toBe(false);
  });
});

describe('account text', () => {
  const account: Account = {
    id: 7,
    name: 'Primary Checking',
    type: 'checking',
    owner_user_id: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
  const huntingtonChecking: Account = { ...account, id: 11, name: 'Huntington Checking', institution: 'Huntington' };
  const brokerage: Account = { ...account, id: 12, name: 'Brokerage', institution: 'Fidelity' };

  it('flags accounts whose name or institution shares a meaningful word with the file text', () => {
    expect(findTextHintedAccounts('Huntington Checking 8801', [account, huntingtonChecking, brokerage])).toEqual([huntingtonChecking]);
    expect(findTextHintedAccounts('Account ending 1234', [huntingtonChecking])).toEqual([]);
    expect(findTextHintedAccounts('fidelity brokerage', [huntingtonChecking, brokerage])).toEqual([brokerage]);
  });

  it('guesses the institution from an export file name', () => {
    expect(deriveInstitutionHint('HuntingtonExport-2026.csv')).toBe('Huntington');
    expect(deriveInstitutionHint('chase_activity_2026.csv')).toBe('Chase');
    expect(deriveInstitutionHint('transactions.csv')).toBe('');
    expect(deriveInstitutionHint(undefined)).toBe('');
  });

  it('reads the digits and the last four of an account value', () => {
    expect(extractDigitsValue('XXXX-XXXX-1234')).toBe('1234');
    expect(extractLastFourValue('Card ending 9034')).toBe('9034');
    expect(extractLastFourValue('Joint Checking')).toBe('');
  });
});
