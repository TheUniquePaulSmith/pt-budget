"use client";

import { useCallback, useMemo } from 'react';

import { DatabaseService } from '../lib/databaseService';
import type {
  ApplyTransactionClassificationInput,
  ApplyTransactionClassificationsResult,
} from '../types/ai';
import type {
  Transaction,
  TransactionQueryParams,
  TransactionScopeFilters,
  TransactionsPaginatedResult,
  DashboardSummary,
  ChartData,
} from '../types/database';

export interface DatabaseTransactionSlice {
  addTransaction: (
    transaction: Omit<Transaction, "id" | "created_at" | "updated_at" | "card_id"> & { card_id?: number | null }
  ) => Promise<void>;
  getAllTransactionHashes: () => Promise<string[]>;
  truncateImportTable: () => Promise<void>;
  insertIntoTempTable: (
    transactions: Array<Omit<Transaction, "id" | "created_at" | "updated_at" | "card_id"> & { card_id?: number | null }>
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
  applyTransactionClassifications: (
    classifications: ApplyTransactionClassificationInput[]
  ) => Promise<ApplyTransactionClassificationsResult>;
  setTransactionCategory: (txId: number, categoryId: number | null) => Promise<void>;
  setTransactionCompany: (txId: number, input: { companyId?: number | null; companyName?: string | null }) => Promise<void>;
  setTransactionComment: (txId: number, comment: string) => Promise<void>;
  linkTransactionToSeries: (txId: number, seriesId: number) => Promise<void>;
  unlinkTransactionFromSeries: (txId: number) => Promise<void>;
  generateTransactionHash: (
    accountId: string,
    date: string,
    amount: number,
    description: string,
    uniqueIdentifier?: string
  ) => string;
  getRecentTransactions: (limit: number, filters?: TransactionScopeFilters) => Promise<Transaction[]>;
  getDashboardSummary: (startDate: string, endDate: string, filters?: TransactionScopeFilters) => Promise<DashboardSummary>;
  getChartData: (startDate: string, endDate: string, filters?: TransactionScopeFilters) => Promise<ChartData>;
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
  | 'applyTransactionClassifications'
  | 'setTransactionCategory'
  | 'setTransactionCompany'
  | 'setTransactionComment'
  | 'linkTransactionToSeries'
  | 'unlinkTransactionFromSeries'
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
  refreshCategories?: () => Promise<void>;
  refreshCompanies?: () => Promise<void>;
  refreshRecurringSeries?: () => Promise<void>;
}

export function useDatabaseTransactionSlice({
  databaseService,
  refreshTransactions,
  refreshCategories,
  refreshCompanies,
  refreshRecurringSeries,
}: UseDatabaseTransactionSliceOptions): DatabaseTransactionSlice {
  const requireService = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }
    return databaseService;
  }, [databaseService]);

  const addTransaction = useCallback(
    async (transaction: Omit<Transaction, "id" | "created_at" | "updated_at" | "card_id"> & { card_id?: number | null }) => {
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
    async (transactions: Array<Omit<Transaction, "id" | "created_at" | "updated_at" | "card_id"> & { card_id?: number | null }>): Promise<number[]> => {
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

  const applyTransactionClassifications = useCallback(
    async (
      classifications: ApplyTransactionClassificationInput[]
    ): Promise<ApplyTransactionClassificationsResult> => {
      const result = await requireService().applyTransactionClassifications(classifications);
      await Promise.all([
        refreshTransactions(),
        refreshCategories?.() ?? Promise.resolve(),
        refreshCompanies?.() ?? Promise.resolve(),
      ]);
      return result;
    },
    [refreshCategories, refreshCompanies, refreshTransactions, requireService]
  );

  const setTransactionCategory = useCallback(
    async (txId: number, categoryId: number | null): Promise<void> => {
      await requireService().setTransactionCategory(txId, categoryId);
      await refreshTransactions();
    },
    [refreshTransactions, requireService]
  );

  const setTransactionCompany = useCallback(
    async (txId: number, input: { companyId?: number | null; companyName?: string | null }): Promise<void> => {
      await requireService().setTransactionCompany(txId, input);
      await Promise.all([
        refreshTransactions(),
        input.companyName ? (refreshCompanies?.() ?? Promise.resolve()) : Promise.resolve(),
      ]);
    },
    [refreshCompanies, refreshTransactions, requireService]
  );

  const setTransactionComment = useCallback(
    async (txId: number, comment: string): Promise<void> => {
      await requireService().setTransactionComment(txId, comment);
      await refreshTransactions();
    },
    [refreshTransactions, requireService]
  );

  const linkTransactionToSeries = useCallback(
    async (txId: number, seriesId: number): Promise<void> => {
      await requireService().linkTransactionToSeries(txId, seriesId);
      await Promise.all([refreshTransactions(), refreshRecurringSeries?.() ?? Promise.resolve()]);
    },
    [refreshRecurringSeries, refreshTransactions, requireService]
  );

  const unlinkTransactionFromSeries = useCallback(
    async (txId: number): Promise<void> => {
      await requireService().unlinkTransactionFromSeries(txId);
      await Promise.all([refreshTransactions(), refreshRecurringSeries?.() ?? Promise.resolve()]);
    },
    [refreshRecurringSeries, refreshTransactions, requireService]
  );

  const generateTransactionHash = useCallback(
    (accountId: string, date: string, amount: number, description: string, uniqueIdentifier?: string): string => {
      return DatabaseService.generateTransactionHashFromFields(accountId, date, amount, description, uniqueIdentifier);
    },
    []
  );

  const getRecentTransactions = useCallback(
    async (limit: number, filters?: TransactionScopeFilters): Promise<Transaction[]> => {
      return requireService().getRecentTransactions(limit, filters);
    },
    [requireService]
  );

  const getDashboardSummary = useCallback(
    async (startDate: string, endDate: string, filters?: TransactionScopeFilters): Promise<DashboardSummary> => {
      return requireService().getDashboardSummary(startDate, endDate, filters);
    },
    [requireService]
  );

  const getChartData = useCallback(
    async (startDate: string, endDate: string, filters?: TransactionScopeFilters): Promise<ChartData> => {
      return requireService().getChartData(startDate, endDate, filters);
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
      applyTransactionClassifications,
      setTransactionCategory,
      setTransactionCompany,
      setTransactionComment,
      linkTransactionToSeries,
      unlinkTransactionFromSeries,
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
      applyTransactionClassifications,
      setTransactionCategory,
      setTransactionCompany,
      setTransactionComment,
      linkTransactionToSeries,
      unlinkTransactionFromSeries,
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
