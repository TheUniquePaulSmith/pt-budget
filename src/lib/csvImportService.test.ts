import { describe, expect, it, vi } from 'vitest';

import type { Account } from '../types/database';
import { DatabaseService } from './databaseService';
import {
  autoDetectColumnMapping,
  buildDuplicateGroups,
  calculateImportableTransactions,
  createAccountMatches,
  createHashUpdatesForSelectedDuplicates,
  detectUniqueIdentifierColumn,
  mapTransactionsFromCSV,
  parseCsvAmount,
  type CSVAccountMatch,
  type CSVImportColumnMapping,
} from './csvImportService';

const accountFixture: Account = {
  id: 7,
  name: 'Primary Checking',
  type: 'checking',
  owner_user_id: 1,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  owner_display_name: 'Pat Doe',
};

describe('csvImportService', () => {
  it('auto-detects common CSV column names', () => {
    const mapping = autoDetectColumnMapping([
      'Account Number',
      'Posting Date',
      'Billing Amount',
      'Merchant Description',
      'Reference ID',
    ]);

    expect(mapping).toEqual({
      accountColumn: 'Account Number',
      dateColumn: 'Posting Date',
      amountColumn: 'Billing Amount',
      descriptionColumn: 'Merchant Description',
      uniqueIdentifierColumn: 'Reference ID',
    });
  });

  it('creates account matches and auto-selects a unique match', async () => {
    const findAccountsByLastFour = vi.fn(async (lastFour: string) => {
      return lastFour === '1682' ? [accountFixture] : [];
    });
    const findAccountsByFullNumber = vi.fn().mockResolvedValue([]);

    const matches = await createAccountMatches(
      [
        { account: 'Visa ending 1682' },
        { account: 'Visa ending 1682' },
        { account: 'Unknown 9999' },
      ],
      'account',
      findAccountsByLastFour,
      findAccountsByFullNumber
    );

    expect(matches).toEqual([
      {
        csvAccountValue: 'Visa ending 1682',
        lastFourValue: '1682',
        matchingAccounts: [accountFixture],
        selectedAccountId: accountFixture.id,
        selectedCardId: null,
      },
      {
        csvAccountValue: 'Unknown 9999',
        lastFourValue: '9999',
        matchingAccounts: [],
        selectedAccountId: null,
        selectedCardId: null,
      },
    ]);
  });

  it('disambiguates matching last-four values using the full number when provided', async () => {
    const accountA = { ...accountFixture, id: 7 };
    const accountB = { ...accountFixture, id: 8, name: 'Joint Checking' };

    const findAccountsByLastFour = vi.fn(async (lastFour: string) =>
      lastFour === '1682' ? [accountA, accountB] : []
    );
    const findAccountsByFullNumber = vi.fn(async (fullNumber: string) =>
      fullNumber === '4111111111111682' ? [accountA] : []
    );

    const matches = await createAccountMatches(
      [{ account: '4111111111111682' }],
      'account',
      findAccountsByLastFour,
      findAccountsByFullNumber
    );

    expect(findAccountsByFullNumber).toHaveBeenCalledWith('4111111111111682');
    expect(findAccountsByLastFour).not.toHaveBeenCalled();
    expect(matches).toEqual([
      {
        csvAccountValue: '4111111111111682',
        lastFourValue: '1682',
        matchingAccounts: [accountA],
        selectedAccountId: accountA.id,
        selectedCardId: null,
      },
    ]);
  });

  it('falls back to last-four matching (which may be ambiguous) when no full-number match is found', async () => {
    const accountA = { ...accountFixture, id: 7 };
    const accountB = { ...accountFixture, id: 8, name: 'Joint Checking' };

    const findAccountsByLastFour = vi.fn(async (lastFour: string) =>
      lastFour === '1682' ? [accountA, accountB] : []
    );
    const findAccountsByFullNumber = vi.fn().mockResolvedValue([]);

    const matches = await createAccountMatches(
      [{ account: '4111111111111682' }],
      'account',
      findAccountsByLastFour,
      findAccountsByFullNumber
    );

    expect(findAccountsByFullNumber).toHaveBeenCalledWith('4111111111111682');
    expect(findAccountsByLastFour).toHaveBeenCalledWith('1682');
    expect(matches).toEqual([
      {
        csvAccountValue: '4111111111111682',
        lastFourValue: '1682',
        matchingAccounts: [accountA, accountB],
        selectedAccountId: null,
        selectedCardId: null,
      },
    ]);
  });

  it('maps transactions from CSV rows using a direct account selection', () => {
    const generateTransactionHash = vi.fn().mockReturnValue('hash-1');
    const mapping: CSVImportColumnMapping = {
      accountColumn: 'DIRECT_ACCOUNT:7',
      dateColumn: 'date',
      amountColumn: 'amount',
      descriptionColumn: 'description',
      uniqueIdentifierColumn: 'reference',
    };
    const accountMatches: CSVAccountMatch[] = [
      {
        csvAccountValue: 'ALL_TRANSACTIONS',
        lastFourValue: '',
        matchingAccounts: [accountFixture],
        selectedAccountId: accountFixture.id,
      },
    ];

    const { mapped: mappedTransactions, rejected } = mapTransactionsFromCSV(
      [
        {
          date: '2026-04-26',
          amount: '-$12.50',
          description: 'Coffee shop',
          reference: 'ABC-1',
        },
      ],
      mapping,
      accountMatches,
      generateTransactionHash
    );

    expect(rejected).toEqual([]);
    expect(mappedTransactions).toEqual([
      {
        transaction: {
          date: '2026-04-26',
          amount: -12.5,
          description: 'Coffee shop',
          comment: null,
          account_id: 7,
          card_id: null,
          category_id: null,
          company_id: null,
          project_id: null,
          trip_id: null,
          type: 'expense',
          transaction_hash: 'hash-1',
        },
        csvAccountValue: 'ALL_TRANSACTIONS',
        lastFourValue: '',
        hash: 'hash-1',
        uniqueIdentifier: 'ABC-1',
      },
    ]);
    expect(generateTransactionHash).toHaveBeenCalledWith(
      'ALL_TRANSACTIONS',
      '2026-04-26',
      -12.5,
      'Coffee shop',
      'ABC-1'
    );
  });

  it('groups internal duplicates and creates variation hash updates', () => {
    const mappedTransactions = [
      {
        transaction: {
          date: '2026-04-26',
          amount: -12.5,
          description: 'Coffee shop',
          account_id: 7,
          card_id: null,
          category_id: null,
          company_id: null,
          project_id: null,
          trip_id: null,
          type: 'expense' as const,
          transaction_hash: 'hash-a',
        },
        csvAccountValue: 'Visa ending 1682',
        lastFourValue: '1682',
        hash: 'hash-a',
        uniqueIdentifier: 'ABC-1',
      },
      {
        transaction: {
          date: '2026-04-26',
          amount: -12.5,
          description: 'Coffee shop',
          account_id: 7,
          card_id: null,
          category_id: null,
          company_id: null,
          project_id: null,
          trip_id: null,
          type: 'expense' as const,
          transaction_hash: 'hash-a',
        },
        csvAccountValue: 'Visa ending 1682',
        lastFourValue: '1682',
        hash: 'hash-a',
        uniqueIdentifier: 'ABC-1',
      },
    ];

    const { duplicateGroups, internalDuplicateCount } = buildDuplicateGroups(
      mappedTransactions,
      [101, 102]
    );

    expect(internalDuplicateCount).toBe(1);
    expect(duplicateGroups).toHaveLength(1);

    const { hashUpdates, tempIdsToDelete } = createHashUpdatesForSelectedDuplicates(
      duplicateGroups,
      new Set([0, 1])
    );

    const expectedVariationHash = DatabaseService.generateTransactionHashFromFields(
      'Visa ending 1682',
      '2026-04-26',
      -12.5,
      'Coffee shop',
      'ABC-1',
      1
    );

    expect(tempIdsToDelete).toEqual([]);
    expect(hashUpdates).toEqual([
      {
        tempId: 102,
        newHash: expectedVariationHash,
        variationSeed: 1,
      },
    ]);
  });

  it('calculates how many rows are importable from current mappings', () => {
    const mapping: CSVImportColumnMapping = {
      accountColumn: 'account',
      dateColumn: 'date',
      amountColumn: 'amount',
      descriptionColumn: 'description',
      uniqueIdentifierColumn: '',
    };
    const accountMatches: CSVAccountMatch[] = [
      {
        csvAccountValue: 'Visa ending 1682',
        lastFourValue: '1682',
        matchingAccounts: [accountFixture],
        selectedAccountId: accountFixture.id,
      },
      {
        csvAccountValue: 'Unknown 9999',
        lastFourValue: '9999',
        matchingAccounts: [],
        selectedAccountId: null,
      },
    ];

    const importableCount = calculateImportableTransactions(
      [
        { account: 'Visa ending 1682' },
        { account: 'Unknown 9999' },
      ],
      mapping,
      accountMatches
    );

    expect(importableCount).toBe(1);
  });
});
describe('csvImportService row parsing', () => {
  const mapping: CSVImportColumnMapping = {
    accountColumn: 'DIRECT_ACCOUNT:7',
    dateColumn: 'date',
    amountColumn: 'amount',
    descriptionColumn: 'description',
    uniqueIdentifierColumn: '',
  };
  const accountMatches: CSVAccountMatch[] = [
    {
      csvAccountValue: 'ALL_TRANSACTIONS',
      lastFourValue: '',
      matchingAccounts: [accountFixture],
      selectedAccountId: accountFixture.id,
    },
  ];
  const hash = () => 'h';

  it('rejects rows with an unreadable date instead of defaulting them to today', () => {
    const { mapped, rejected } = mapTransactionsFromCSV(
      [
        { date: 'Pending', amount: '-5.00', description: 'Card hold' },
        { date: '04/26/2026', amount: '-5.00', description: 'Coffee' },
      ],
      mapping,
      accountMatches,
      hash
    );

    expect(mapped).toHaveLength(1);
    expect(mapped[0].transaction.date).toBe('2026-04-26');
    expect(rejected).toEqual([
      { rowNumber: 1, reason: 'Unrecognized date "Pending" in column "date"' },
    ]);
  });

  it('rejects rows with a non-numeric amount instead of importing $0', () => {
    const { mapped, rejected } = mapTransactionsFromCSV(
      [{ date: '2026-04-26', amount: 'n/a', description: 'Fee waived' }],
      mapping,
      accountMatches,
      hash
    );

    expect(mapped).toEqual([]);
    expect(rejected).toEqual([
      { rowNumber: 1, reason: 'Unrecognized amount "n/a" in column "amount"' },
    ]);
  });

  it('skips unmapped-account rows silently and numbers rejected rows by CSV position', () => {
    const byAccountMapping: CSVImportColumnMapping = { ...mapping, accountColumn: 'account' };
    const matches: CSVAccountMatch[] = [
      { csvAccountValue: '1682', lastFourValue: '1682', matchingAccounts: [accountFixture], selectedAccountId: 7 },
      { csvAccountValue: '9999', lastFourValue: '9999', matchingAccounts: [], selectedAccountId: null },
    ];

    const { mapped, rejected } = mapTransactionsFromCSV(
      [
        { account: '9999', date: '2026-04-26', amount: '-1.00', description: 'Other card' },
        { account: '1682', date: 'garbage', amount: '-1.00', description: 'Bad date' },
        { account: '1682', date: '2026-04-27', amount: '-2.00', description: 'Good' },
      ],
      byAccountMapping,
      matches,
      hash
    );

    expect(mapped.map((m) => m.transaction.description)).toEqual(['Good']);
    expect(rejected.map((r) => r.rowNumber)).toEqual([2]);
  });

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

  it('picks a bank reference column as the unique identifier and ignores headers that merely contain "id"', () => {
    expect(detectUniqueIdentifierColumn(['Date', 'Amount', 'Transaction ID'])).toBe('Transaction ID');
    expect(detectUniqueIdentifierColumn(['Date', 'Reference Number', 'Card Holder ID'])).toBe('Reference Number');
    expect(detectUniqueIdentifierColumn(['Date', 'ID', 'Description'])).toBe('ID');
    expect(detectUniqueIdentifierColumn(['Paid', 'Valid', 'Card Holder ID', 'Member ID'])).toBe('');
  });
});
