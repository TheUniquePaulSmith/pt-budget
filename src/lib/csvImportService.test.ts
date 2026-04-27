import { describe, expect, it, vi } from 'vitest';

import type { Account } from '../types/database';
import { DatabaseService } from './databaseService';
import {
  autoDetectColumnMapping,
  buildDuplicateGroups,
  calculateImportableTransactions,
  createAccountMatches,
  createHashUpdatesForSelectedDuplicates,
  mapTransactionsFromCSV,
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

    const matches = await createAccountMatches(
      [
        { account: 'Visa ending 1682' },
        { account: 'Visa ending 1682' },
        { account: 'Unknown 9999' },
      ],
      'account',
      findAccountsByLastFour
    );

    expect(matches).toEqual([
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

    const mappedTransactions = mapTransactionsFromCSV(
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

    expect(mappedTransactions).toEqual([
      {
        transaction: {
          date: '2026-04-26',
          amount: -12.5,
          description: 'Coffee shop',
          account_id: 7,
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