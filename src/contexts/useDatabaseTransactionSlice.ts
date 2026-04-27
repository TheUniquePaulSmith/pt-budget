"use client";

import { useCallback, useMemo } from 'react';

import { DatabaseService } from '../lib/databaseService';
import type { Transaction } from '../types/database';

export interface DatabaseTransactionSlice {
  addTransaction: (
    transaction: Omit<Transaction, "id" | "created_at" | "updated_at">
  ) => Promise<void>;
  getAllTransactionHashes: () => Promise<string[]>;
  truncateImportTable: () => Promise<void>;
  insertIntoTempTable: (
    transactions: Array<Omit<Transaction, "id" | "created_at" | "updated_at">>
  ) => Promise<number[]>;
  deleteFromTempTable: (tempIds: number[]) => Promise<void>;
  updateTempTransactionHashes: (
    updates: Array<{ tempId: number; newHash: string; variationSeed: number }>
  ) => Promise<void>;
  checkDuplicateTransactions: () => Promise<string[]>;
  bulkInsertFromTempTable: () => Promise<number>;
  updateTransactionLabels: (
    id: number,
    projectId: number | null,
    tripId: number | null
  ) => Promise<void>;
  generateTransactionHash: (
    accountId: string,
    date: string,
    amount: number,
    description: string,
    uniqueIdentifier?: string
  ) => string;
}

type TransactionService = Pick<
  DatabaseService,
  | 'addTransaction'
  | 'getAllTransactionHashes'
  | 'truncateImportTable'
  | 'insertIntoTempTable'
  | 'deleteFromTempTable'
  | 'updateTempTransactionHashes'
  | 'checkDuplicateTransactions'
  | 'bulkInsertFromTempTable'
  | 'updateTransactionLabels'
>;

interface UseDatabaseTransactionSliceOptions {
  databaseService: TransactionService | null;
  refreshTransactions: () => Promise<void>;
}

export function useDatabaseTransactionSlice({
  databaseService,
  refreshTransactions,
}: UseDatabaseTransactionSliceOptions): DatabaseTransactionSlice {
  const requireService = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    return databaseService;
  }, [databaseService]);

  const addTransaction = useCallback(
    async (
      transaction: Omit<Transaction, "id" | "created_at" | "updated_at">
    ) => {
      await requireService().addTransaction(transaction);
      await refreshTransactions();
    },
    [refreshTransactions, requireService]
  );

  const getAllTransactionHashes = useCallback(async (): Promise<string[]> => {
    return requireService().getAllTransactionHashes();
  }, [requireService]);

  const truncateImportTable = useCallback(async (): Promise<void> => {
    await requireService().truncateImportTable();
  }, [requireService]);

  const insertIntoTempTable = useCallback(
    async (
      transactions: Array<Omit<Transaction, "id" | "created_at" | "updated_at">>
    ): Promise<number[]> => {
      return requireService().insertIntoTempTable(transactions);
    },
    [requireService]
  );

  const deleteFromTempTable = useCallback(
    async (tempIds: number[]): Promise<void> => {
      await requireService().deleteFromTempTable(tempIds);
    },
    [requireService]
  );

  const updateTempTransactionHashes = useCallback(
    async (
      updates: Array<{ tempId: number; newHash: string; variationSeed: number }>
    ): Promise<void> => {
      await requireService().updateTempTransactionHashes(updates);
    },
    [requireService]
  );

  const checkDuplicateTransactions = useCallback(async (): Promise<string[]> => {
    return requireService().checkDuplicateTransactions();
  }, [requireService]);

  const bulkInsertFromTempTable = useCallback(async (): Promise<number> => {
    const count = await requireService().bulkInsertFromTempTable();
    await refreshTransactions();
    return count;
  }, [refreshTransactions, requireService]);

  const updateTransactionLabels = useCallback(
    async (
      id: number,
      projectId: number | null,
      tripId: number | null
    ): Promise<void> => {
      await requireService().updateTransactionLabels(id, projectId, tripId);
      await refreshTransactions();
    },
    [refreshTransactions, requireService]
  );

  const generateTransactionHash = useCallback(
    (
      accountId: string,
      date: string,
      amount: number,
      description: string,
      uniqueIdentifier?: string
    ): string => {
      return DatabaseService.generateTransactionHashFromFields(
        accountId,
        date,
        amount,
        description,
        uniqueIdentifier
      );
    },
    []
  );

  return useMemo(
    () => ({
      addTransaction,
      getAllTransactionHashes,
      truncateImportTable,
      insertIntoTempTable,
      deleteFromTempTable,
      updateTempTransactionHashes,
      checkDuplicateTransactions,
      bulkInsertFromTempTable,
      updateTransactionLabels,
      generateTransactionHash,
    }),
    [
      addTransaction,
      getAllTransactionHashes,
      truncateImportTable,
      insertIntoTempTable,
      deleteFromTempTable,
      updateTempTransactionHashes,
      checkDuplicateTransactions,
      bulkInsertFromTempTable,
      updateTransactionLabels,
      generateTransactionHash,
    ]
  );
}