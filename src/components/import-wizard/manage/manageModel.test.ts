import { describe, expect, it } from 'vitest';

import { IMPORT_BATCH_NOT_FOUND } from '@/lib/databaseServiceImports';
import type { Account, AccountIdentifier } from '@/types/database';

import {
  BATCH_NOT_FOUND_CODE,
  batchAccounts,
  errorCodeOf,
  groupIdentifiersByAccount,
  hasFindings,
  identifierDisplay,
  isDatabaseNotReady,
  maskDigitRuns,
  parseAccountIds,
  parseIssuesSummary,
} from './manageModel';

const account = (id: number, name: string): Account => ({
  id,
  name,
  type: 'checking',
  owner_user_id: 1,
  created_at: '',
  updated_at: '',
});

const identifier = (overrides: Partial<AccountIdentifier> & Pick<AccountIdentifier, 'id' | 'account_id'>): AccountIdentifier => ({
  kind: 'number',
  value: '400012344821',
  last_four: '4821',
  source: 'import',
  created_at: '2026-11-01 08:00:00',
  ...overrides,
});

describe('parseAccountIds / batchAccounts', () => {
  it('reads the stored id list, dropping repeats and anything that is not an id', () => {
    expect(parseAccountIds('[3, 1, 3, "2", 0, -4, 1.5, null]')).toEqual([3, 1, 2]);
    expect(parseAccountIds('{"a":1}')).toEqual([]);
    expect(parseAccountIds('not json')).toEqual([]);
    expect(parseAccountIds(null)).toEqual([]);
  });

  it('names each account, and marks one that no longer exists', () => {
    const accounts = [account(1, 'Household Checking'), account(2, 'Rewards Visa')];
    expect(batchAccounts({ account_ids_json: '[2, 9]' }, accounts)).toEqual([
      { id: 2, name: 'Rewards Visa' },
      { id: 9, name: null },
    ]);
  });
});

describe('parseIssuesSummary', () => {
  it('orders findings by how serious they are, then by how often they occurred', () => {
    const findings = parseIssuesSummary(
      JSON.stringify({
        counts: { alreadyImported: 12, signAssumed: 1, unreadableDate: 2, blankDescription: 4, zeroAmount: 0 },
        assumptions: ['dateOrder:dateOrderAmbiguous', 'account:accountAssumedByProfile'],
        fixedRows: 2,
      })
    );
    expect(findings).toEqual({
      issues: [
        { code: 'unreadableDate', count: 2, severity: 'blocker' },
        { code: 'blankDescription', count: 4, severity: 'warning' },
        { code: 'signAssumed', count: 1, severity: 'warning' },
        { code: 'alreadyImported', count: 12, severity: 'info' },
      ],
      assumptions: 2,
      fixedRows: 2,
    });
    expect(hasFindings(findings!)).toBe(true);
  });

  it('keeps a code the catalog does not know, as a note', () => {
    expect(parseIssuesSummary('{"counts":{"somethingNew":3}}')?.issues).toEqual([
      { code: 'somethingNew', count: 3, severity: 'info' },
    ]);
  });

  it('tells "nothing found" from "nothing recorded"', () => {
    const clean = parseIssuesSummary('{"counts":{},"assumptions":[],"fixedRows":0}');
    expect(clean).toEqual({ issues: [], assumptions: 0, fixedRows: 0 });
    expect(hasFindings(clean!)).toBe(false);

    expect(parseIssuesSummary(null)).toBeNull();
    expect(parseIssuesSummary('')).toBeNull();
    expect(parseIssuesSummary('oops')).toBeNull();
    expect(parseIssuesSummary('[1,2]')).toBeNull();
  });
});

describe('identifierDisplay', () => {
  it('shows a number as its last four only', () => {
    expect(identifierDisplay(identifier({ id: 1, account_id: 1 }))).toEqual({ kind: 'number', lastFour: '4821' });
  });

  it('shows nothing of a number that has no last four', () => {
    expect(identifierDisplay(identifier({ id: 1, account_id: 1, value: '123', last_four: null }))).toEqual({
      kind: 'number',
      lastFour: null,
    });
    // A last_four that is not four digits is not trusted either.
    expect(identifierDisplay(identifier({ id: 1, account_id: 1, last_four: '400012344821' }))).toEqual({
      kind: 'number',
      lastFour: null,
    });
  });

  it('shows a label as text, with any long digit run masked', () => {
    expect(identifierDisplay(identifier({ id: 1, account_id: 1, kind: 'label', value: 'joint checking', last_four: null }))).toEqual({
      kind: 'label',
      text: 'joint checking',
    });
    expect(maskDigitRuns('acct 400012344821 (2026)')).toBe('acct ••••4821 (2026)');
  });
});

describe('groupIdentifiersByAccount', () => {
  it('groups by account, accounts by name, identifiers in the order they were added', () => {
    const accounts = [account(1, 'household Checking'), account(2, 'Rewards Visa'), account(3, 'Auto Loan')];
    const groups = groupIdentifiersByAccount(
      [
        identifier({ id: 7, account_id: 2 }),
        identifier({ id: 5, account_id: 1, kind: 'label', value: 'joint checking', last_four: null }),
        identifier({ id: 2, account_id: 1 }),
        identifier({ id: 9, account_id: 3 }),
      ],
      accounts
    );
    expect(groups.map((group) => [group.accountName, group.identifiers.map((entry) => entry.id)])).toEqual([
      ['Auto Loan', [9]],
      ['household Checking', [2, 5]],
      ['Rewards Visa', [7]],
    ]);
  });

  it('falls back to the joined account name when the collection does not have the account', () => {
    const groups = groupIdentifiersByAccount([identifier({ id: 1, account_id: 42, account_name: 'Old Savings' })], []);
    expect(groups[0].accountName).toBe('Old Savings');
  });
});

describe('errorCodeOf / isDatabaseNotReady', () => {
  it('knows the code the imports service uses for a batch that is gone', () => {
    expect(BATCH_NOT_FOUND_CODE).toBe(IMPORT_BATCH_NOT_FOUND);
    expect(errorCodeOf(new Error(IMPORT_BATCH_NOT_FOUND))).toBe(BATCH_NOT_FOUND_CODE);
  });

  it('recognises a code-like service message and nothing else', () => {
    expect(errorCodeOf(new Error('IMPORT_PROFILE_NAME_REQUIRED'))).toBe('IMPORT_PROFILE_NAME_REQUIRED');
    expect(errorCodeOf('IMPORT_BATCH_NOT_FOUND')).toBe('IMPORT_BATCH_NOT_FOUND');
    expect(errorCodeOf(new Error('SQLITE_CONSTRAINT: FOREIGN KEY constraint failed'))).toBeNull();
    expect(errorCodeOf(new Error('Request timed out'))).toBeNull();
    expect(errorCodeOf(undefined)).toBeNull();
  });

  it("recognises the provider's not-ready message", () => {
    expect(isDatabaseNotReady(new Error('Database service not initialized'))).toBe(true);
    expect(isDatabaseNotReady(new Error('IMPORT_BATCH_NOT_FOUND'))).toBe(false);
  });
});
