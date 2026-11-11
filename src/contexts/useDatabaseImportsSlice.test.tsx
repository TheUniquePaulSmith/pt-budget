// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { CommitInput, ImportBatchImpact } from '../lib/statementImport/types';
import { useDatabaseImportsSlice } from './useDatabaseImportsSlice';

const impact = (overrides: Partial<ImportBatchImpact> = {}): ImportBatchImpact => ({
  batchId: 7,
  transactions: 12,
  editedSinceImport: 0,
  loanPayments: 0,
  transferPairs: 0,
  ...overrides,
});

const commitInput: CommitInput = {
  fileName: 'export.csv',
  format: 'delimited',
  profileId: null,
  accountIds: [1],
  totalRows: 3,
  skippedRows: 0,
  rejectedRows: 0,
  issues: { counts: {}, assumptions: [], fixedRows: 0 },
  excludedTempIds: [],
  stagedDecisions: [],
  existingDecisions: [],
};

function setup({ loanIds = [] as number[] } = {}) {
  // One log across the service and the refreshes, so the order can be asserted.
  const calls: string[] = [];
  const step = <T,>(name: string, value: T) =>
    vi.fn(async (..._args: unknown[]) => {
      calls.push(name);
      return value;
    });
  const imports = {
    listProfiles: step('listProfiles', []),
    findProfilesByFingerprint: step('findProfilesByFingerprint', []),
    saveProfile: step('saveProfile', 4),
    recordProfileUse: step('recordProfileUse', undefined),
    deleteProfile: step('deleteProfile', undefined),
    listAccountIdentifiers: step('listAccountIdentifiers', []),
    addAccountIdentifier: step('addAccountIdentifier', 9),
    removeAccountIdentifier: step('removeAccountIdentifier', undefined),
    resolveAccounts: step('resolveAccounts', []),
    getAccountCoverage: step('getAccountCoverage', []),
    stageRows: step('stageRows', { tempIds: [], alreadyImported: [], duplicateGroups: [] }),
    discardStaged: step('discardStaged', undefined),
    commitStaged: step('commitStaged', { batchId: 7, inserted: 3, duplicates: 0 }),
    listImportBatches: step('listImportBatches', []),
    getBatchImpact: step('getBatchImpact', impact()),
    getBatchLoanIds: step('getBatchLoanIds', loanIds),
    undoBatch: step('undoBatch', impact({ loanPayments: loanIds.length })),
  };
  const loans = { syncAccountSnapshot: step('syncAccountSnapshot', undefined) };
  const refreshTransactions = step('refreshTransactions', undefined);
  const refreshAccounts = step('refreshAccounts', undefined);
  const refreshLoans = step('refreshLoans', undefined);

  const { result } = renderHook(() =>
    useDatabaseImportsSlice({
      databaseService: { imports, loans } as never,
      refreshTransactions,
      refreshAccounts,
      refreshLoans,
    })
  );
  return { slice: result, calls, imports, loans, refreshTransactions, refreshAccounts, refreshLoans };
}

describe('useDatabaseImportsSlice', () => {
  it('throws when called without an initialized service', async () => {
    const { result } = renderHook(() =>
      useDatabaseImportsSlice({
        databaseService: null,
        refreshTransactions: vi.fn(),
        refreshAccounts: vi.fn(),
        refreshLoans: vi.fn(),
      })
    );

    await expect(result.current.listImportBatches()).rejects.toThrow('Database service not initialized');
    await expect(result.current.undoImportBatch(1)).rejects.toThrow('Database service not initialized');
  });

  it('passes reads and layout / identifier writes straight through, refreshing nothing', async () => {
    const { slice, imports, calls } = setup();

    await act(async () => {
      await slice.current.listImportProfiles();
      await slice.current.findImportProfiles('delimited:a|b');
      await slice.current.recordImportProfileUse(4, 2);
      await slice.current.deleteImportProfile(4);
      await slice.current.listAccountIdentifiers(2);
      await slice.current.addAccountIdentifier({ account_id: 2, kind: 'number', value: '9034' });
      await slice.current.removeAccountIdentifier(9);
      await slice.current.resolveImportAccounts(['9034'], { profileAccountId: 2 });
      await slice.current.getAccountImportCoverage([2]);
      await slice.current.stageImportRows([]);
      await slice.current.discardStagedImport();
      await slice.current.listImportBatches(20);
      await slice.current.getImportBatchImpact(7);
    });

    expect(imports.findProfilesByFingerprint).toHaveBeenCalledWith('delimited:a|b');
    expect(imports.recordProfileUse).toHaveBeenCalledWith(4, 2);
    expect(imports.listAccountIdentifiers).toHaveBeenCalledWith(2);
    expect(imports.resolveAccounts).toHaveBeenCalledWith(['9034'], { profileAccountId: 2 });
    expect(imports.getAccountCoverage).toHaveBeenCalledWith([2]);
    expect(imports.listImportBatches).toHaveBeenCalledWith(20);
    expect(imports.getBatchImpact).toHaveBeenCalledWith(7);
    expect(calls.filter((name) => name.startsWith('refresh'))).toEqual([]);
  });

  it('refreshes transactions, and only those, after a commit', async () => {
    const { slice, calls, imports } = setup();

    let result;
    await act(async () => {
      result = await slice.current.commitStagedImport(commitInput);
    });

    expect(result).toEqual({ batchId: 7, inserted: 3, duplicates: 0 });
    expect(imports.commitStaged).toHaveBeenCalledWith(commitInput);
    expect(calls).toEqual(['commitStaged', 'refreshTransactions']);
  });

  it('refreshes nothing when the commit fails', async () => {
    const { slice, imports, refreshTransactions } = setup();
    imports.commitStaged.mockRejectedValueOnce(new Error('disk full'));

    await expect(slice.current.commitStagedImport(commitInput)).rejects.toThrow('disk full');
    expect(refreshTransactions).not.toHaveBeenCalled();
  });

  it('after an undo with no loan payments, refreshes transactions only', async () => {
    const { slice, calls, loans } = setup();

    let result;
    await act(async () => {
      result = await slice.current.undoImportBatch(7);
    });

    expect(result).toEqual(impact());
    expect(calls).toEqual(['getBatchLoanIds', 'undoBatch', 'refreshTransactions']);
    expect(loans.syncAccountSnapshot).not.toHaveBeenCalled();
  });

  it('after an undo that removed loan payments, recomputes those loans account balances, then refreshes loans and accounts too', async () => {
    const { slice, calls, imports, loans } = setup({ loanIds: [2, 5] });

    await act(async () => {
      await slice.current.undoImportBatch(7);
    });

    // The loans are asked for while the batch still exists; the balances are written once it is gone.
    expect(calls.slice(0, 4)).toEqual(['getBatchLoanIds', 'undoBatch', 'syncAccountSnapshot', 'syncAccountSnapshot']);
    expect(imports.getBatchLoanIds).toHaveBeenCalledWith(7);
    expect(loans.syncAccountSnapshot.mock.calls).toEqual([[2], [5]]);
    expect(calls.slice(4).sort()).toEqual(['refreshAccounts', 'refreshLoans', 'refreshTransactions']);
  });

  it('still reports the undo and refreshes everything when a loan balance cannot be recomputed', async () => {
    const { slice, calls, loans } = setup({ loanIds: [2, 5] });
    loans.syncAccountSnapshot.mockRejectedValueOnce(new Error('database is locked'));

    let result;
    await act(async () => {
      result = await slice.current.undoImportBatch(7);
    });

    // The batch is gone: a failed balance write must not look like a failed undo.
    expect(result).toEqual(impact({ loanPayments: 2 }));
    // The second loan is still tried after the first one failed.
    expect(loans.syncAccountSnapshot.mock.calls).toEqual([[2], [5]]);
    expect(calls.filter((name) => name.startsWith('refresh')).sort()).toEqual([
      'refreshAccounts',
      'refreshLoans',
      'refreshTransactions',
    ]);
  });

  it('touches no loan balance and refreshes nothing when the undo fails', async () => {
    const { slice, calls, imports, loans } = setup({ loanIds: [2] });
    imports.undoBatch.mockRejectedValueOnce(new Error('IMPORT_BATCH_NOT_FOUND'));

    await expect(slice.current.undoImportBatch(7)).rejects.toThrow('IMPORT_BATCH_NOT_FOUND');
    expect(imports.undoBatch).toHaveBeenCalledWith(7);
    expect(loans.syncAccountSnapshot).not.toHaveBeenCalled();
    // Only the read that precedes the undo was logged: no balance write, no refresh.
    expect(calls).toEqual(['getBatchLoanIds']);
  });
});
