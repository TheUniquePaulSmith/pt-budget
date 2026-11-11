"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import { logger } from '../lib/logging';
import type {
  AccountCoverage,
  AccountResolution,
  CommitInput,
  CommitResult,
  ImportBatchImpact,
  ImportProfileInput,
  SavedImportProfile,
  StageResult,
  StagedRowInput,
} from '../lib/statementImport/types';
import type { AccountIdentifier, AccountIdentifierInput, ImportBatch } from '../types/database';

/**
 * Provider-domain slice for statement import (schema v7). Saved layouts,
 * account identifiers and import history are read on demand by the Import
 * page, not cached. A commit refreshes transactions (nothing else changes
 * until the wizard runs the loan rules and the subscription scan, which
 * refresh their own collections). An undo refreshes transactions too; when it
 * took loan payments with it, the loans' linked account balances are
 * recomputed and loans and accounts are refreshed as well.
 */
export interface DatabaseImportsSlice {
  listImportProfiles: () => Promise<SavedImportProfile[]>;
  findImportProfiles: (fingerprint: string) => Promise<SavedImportProfile[]>;
  saveImportProfile: (input: ImportProfileInput, id?: number) => Promise<number>;
  recordImportProfileUse: (id: number, accountId: number | null) => Promise<void>;
  deleteImportProfile: (id: number) => Promise<void>;
  listAccountIdentifiers: (accountId?: number) => Promise<AccountIdentifier[]>;
  addAccountIdentifier: (input: AccountIdentifierInput) => Promise<number>;
  removeAccountIdentifier: (id: number) => Promise<void>;
  resolveImportAccounts: (values: string[], options?: { profileAccountId?: number | null }) => Promise<AccountResolution[]>;
  getAccountImportCoverage: (accountIds: number[]) => Promise<AccountCoverage[]>;
  stageImportRows: (rows: StagedRowInput[]) => Promise<StageResult>;
  discardStagedImport: () => Promise<void>;
  /** Moves the staged rows into transactions as one batch; refreshes transactions. */
  commitStagedImport: (input: CommitInput) => Promise<CommitResult>;
  listImportBatches: (limit?: number) => Promise<ImportBatch[]>;
  getImportBatchImpact: (batchId: number) => Promise<ImportBatchImpact>;
  /**
   * Removes a batch and what it imported; refreshes transactions, plus loans
   * and accounts when loan payments went with it. The subscription scan is the
   * caller's to re-run.
   */
  undoImportBatch: (batchId: number) => Promise<ImportBatchImpact>;
}

// `loans` only for syncAccountSnapshot after an undo that removed loan payments.
type ImportsDatabaseService = Pick<DatabaseService, 'imports' | 'loans'>;

const log = logger.child({ component: 'useDatabaseImportsSlice' });

interface UseDatabaseImportsSliceOptions {
  databaseService: ImportsDatabaseService | null;
  refreshTransactions: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  refreshLoans: () => Promise<void>;
}

export function useDatabaseImportsSlice({
  databaseService,
  refreshTransactions,
  refreshAccounts,
  refreshLoans,
}: UseDatabaseImportsSliceOptions): DatabaseImportsSlice {
  const requireDatabase = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }
    return databaseService;
  }, [databaseService]);
  const requireService = useCallback(() => requireDatabase().imports, [requireDatabase]);

  const listImportProfiles = useCallback(async () => requireService().listProfiles(), [requireService]);
  const findImportProfiles = useCallback(
    async (fingerprint: string) => requireService().findProfilesByFingerprint(fingerprint),
    [requireService]
  );
  const saveImportProfile = useCallback(
    async (input: ImportProfileInput, id?: number) => requireService().saveProfile(input, id),
    [requireService]
  );
  const recordImportProfileUse = useCallback(
    async (id: number, accountId: number | null) => requireService().recordProfileUse(id, accountId),
    [requireService]
  );
  const deleteImportProfile = useCallback(async (id: number) => requireService().deleteProfile(id), [requireService]);

  const listAccountIdentifiers = useCallback(
    async (accountId?: number) => requireService().listAccountIdentifiers(accountId),
    [requireService]
  );
  const addAccountIdentifier = useCallback(
    async (input: AccountIdentifierInput) => requireService().addAccountIdentifier(input),
    [requireService]
  );
  const removeAccountIdentifier = useCallback(
    async (id: number) => requireService().removeAccountIdentifier(id),
    [requireService]
  );

  const resolveImportAccounts = useCallback(
    async (values: string[], options?: { profileAccountId?: number | null }) =>
      requireService().resolveAccounts(values, options),
    [requireService]
  );
  const getAccountImportCoverage = useCallback(
    async (accountIds: number[]) => requireService().getAccountCoverage(accountIds),
    [requireService]
  );

  const stageImportRows = useCallback(async (rows: StagedRowInput[]) => requireService().stageRows(rows), [requireService]);
  const discardStagedImport = useCallback(async () => requireService().discardStaged(), [requireService]);

  const commitStagedImport = useCallback(
    async (input: CommitInput) => {
      const result = await requireService().commitStaged(input);
      await refreshTransactions();
      return result;
    },
    [refreshTransactions, requireService]
  );

  const listImportBatches = useCallback(async (limit?: number) => requireService().listImportBatches(limit), [requireService]);
  const getImportBatchImpact = useCallback(
    async (batchId: number) => requireService().getBatchImpact(batchId),
    [requireService]
  );

  const undoImportBatch = useCallback(
    async (batchId: number) => {
      const { imports, loans } = requireDatabase();
      // Asked first: once the batch is gone, nothing says which loans it paid.
      const loanIds = await imports.getBatchLoanIds(batchId);
      const impact = await imports.undoBatch(batchId);
      // The batch is gone from here on. Nothing below may turn that into a
      // failed undo: the caller would offer to undo an import that no longer exists.
      try {
        // A linked loan / credit account shows the balance the ledger computes;
        // without this it would still count the payments that were just removed.
        for (const loanId of loanIds) {
          try {
            await loans.syncAccountSnapshot(loanId);
          } catch (error) {
            // The balance is written again by the next change to that loan.
            log.warn('Loan balance not recomputed after an undone import', {
              operation: 'undoImportBatch',
              batchId,
              loanId,
              error,
            });
          }
        }
      } finally {
        await Promise.all([
          refreshTransactions(),
          ...(loanIds.length > 0 ? [refreshLoans(), refreshAccounts()] : []),
        ]);
      }
      return impact;
    },
    [refreshAccounts, refreshLoans, refreshTransactions, requireDatabase]
  );

  return useMemo(
    () => ({
      listImportProfiles,
      findImportProfiles,
      saveImportProfile,
      recordImportProfileUse,
      deleteImportProfile,
      listAccountIdentifiers,
      addAccountIdentifier,
      removeAccountIdentifier,
      resolveImportAccounts,
      getAccountImportCoverage,
      stageImportRows,
      discardStagedImport,
      commitStagedImport,
      listImportBatches,
      getImportBatchImpact,
      undoImportBatch,
    }),
    [
      addAccountIdentifier,
      commitStagedImport,
      deleteImportProfile,
      discardStagedImport,
      findImportProfiles,
      getAccountImportCoverage,
      getImportBatchImpact,
      listAccountIdentifiers,
      listImportBatches,
      listImportProfiles,
      recordImportProfileUse,
      removeAccountIdentifier,
      resolveImportAccounts,
      saveImportProfile,
      stageImportRows,
      undoImportBatch,
    ]
  );
}
