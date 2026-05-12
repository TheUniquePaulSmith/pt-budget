"use client";

import { useCallback, useMemo } from 'react';

import { DatabaseService } from '../lib/databaseService';
import type {
  Transaction,
  TransactionQueryParams,
  TransactionsPaginatedResult,
  DashboardSummary,
  ChartData,
} from '../types/database';

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
  getRecentTransactions: (limit: number) => Promise<Transaction[]>;
  getDashboardSummary: (startDate: string, endDate: string) => Promise<DashboardSummary>;
  getChartData: (startDate: string, endDate: string) => Promise<ChartData>;
  getTransactionsPaginated: (params: TransactionQueryParams) => Promise<TransactionsPaginatedResult>;
  getTransactionsForExport: (params: Omit<TransactionQueryParams, 'page' | 'pageSize'>) => Promise<Transaction[]>;
  getAllProjectCosts: () => Promise<import('../types/database').ProjectCosts[]>;
  getTransactionsByProjectPaginated: (projectId: number, page: number, pageSize: number) => Promise<{ data: Transaction[]; total: number }>;
  getTransactionsByTripPaginated: (tripId: number, page: number, pageSize: number) => Promise<{ data: Transaction[]; total: number }>;
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
  | 'getRecentTransactions'
  | 'getDashboardSummary'
  | 'getChartData'
  | 'getTransactionsPaginated'
  | 'getTransactionsForExport'
  | 'getAllProjectCosts'
  | 'getTransactionsByProjectPaginated'
  | 'getTransactionsByTripPaginated'
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
    async (transaction: Omit<Transaction, "id" | "created_at" | "updated_at">) => {
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
    async (transactions: Array<Omit<Transaction, "id" | "created_at" | "updated_at">>): Promise<number[]> => {
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
    async (updates: Array<{ tempId: number; newHash: string; variationSeed: number }>): Promise<void> => {
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
    async (id: number, projectId: number | null, tripId: number | null): Promise<void> => {
      await requireService().updateTransactionLabels(id, projectId, tripId);
      await refreshTransactions();
    },
    [refreshTransactions, requireService]
  );

  const generateTransactionHash = useCallback(
    (accountId: string, date: string, amount: number, description: string, uniqueIdentifier?: string): string => {
      return DatabaseService.generateTransactionHashFromFields(accountId, date, amount, description, uniqueIdentifier);
    },
    []
  );

  const getRecentTransactions = useCallback(
    async (limit: number): Promise<Transaction[]> => {
      return requireService().getRecentTransactions(limit);
    },
    [requireService]
  );

  const getDashboardSummary = useCallback(
    async (startDate: string, endDate: string): Promise<DashboardSummary> => {
      return requireService().getDashboardSummary(startDate, endDate);
    },
    [requireService]
  );

  const getChartData = useCallback(
    async (startDate: string, endDate: string): Promise<ChartData> => {
      return requireService().getChartData(startDate, endDate);
    },
    [requireService]
  );

  const getTransactionsPaginated = useCallback(
    async (params: TransactionQueryParams): Promise<TransactionsPaginatedResult> => {
      return requireService().getTransactionsPaginated(params);
    },
    [requireService]
  );

  const getTransactionsForExport = useCallback(
    async (params: Omit<TransactionQueryParams, 'page' | 'pageSize'>): Promise<Transaction[]> => {
      return requireService().getTransactionsForExport(params);
    },
    [requireService]
  );

  const getAllProjectCosts = useCallback(
    async (): Promise<import('../types/database').ProjectCosts[]> => {
      return requireService().getAllProjectCosts();
    },
    [requireService]
  );

  const getTransactionsByProjectPaginated = useCallback(
    async (projectId: number, page: number, pageSize: number): Promise<{ data: Transaction[]; total: number }> => {
      return requireService().getTransactionsByProjectPaginated(projectId, page, pageSize);
    },
    [requireService]
  );

  const getTransactionsByTripPaginated = useCallback(
    async (tripId: number, page: number, pageSize: number): Promise<{ data: Transaction[]; total: number }> => {
      return requireService().getTransactionsByTripPaginated(tripId, page, pageSize);
    },
    [requireService]
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
      getRecentTransactions,
      getDashboardSummary,
      getChartData,
      getTransactionsPaginated,
      getTransactionsForExport,
      getAllProjectCosts,
      getTransactionsByProjectPaginated,
      getTransactionsByTripPaginated,
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
      getRecentTransactions,
      getDashboardSummary,
      getChartData,
      getTransactionsPaginated,
      getTransactionsForExport,
      getAllProjectCosts,
      getTransactionsByProjectPaginated,
      getTransactionsByTripPaginated,
    ]
  );
}
