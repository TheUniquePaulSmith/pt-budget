"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
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
 * page, not cached. A commit refreshes transactions; an undo also refreshes
 * accounts and loans, because removing rows changes balances and loan ledgers.
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
  /** Removes a batch and what it imported; refreshes transactions, accounts and loans. */
  undoImportBatch: (batchId: number) => Promise<ImportBatchImpact>;
}

type ImportsDatabaseService = Pick<DatabaseService, 'imports'>;

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
  const requireService = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }
    return databaseService.imports;
  }, [databaseService]);

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
      const impact = await requireService().undoBatch(batchId);
      await Promise.all([refreshTransactions(), refreshAccounts(), refreshLoans()]);
      return impact;
    },
    [refreshAccounts, refreshLoans, refreshTransactions, requireService]
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
