// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DatabaseService } from '../lib/databaseService';
import type { Transaction } from '../types/database';
import { useDatabaseTransactionSlice } from './useDatabaseTransactionSlice';

type TransactionInput = Omit<Transaction, 'id' | 'created_at' | 'updated_at'>;

function createServiceMock() {
  return {
    addTransaction: vi.fn().mockResolvedValue(undefined),
    getAllTransactionHashes: vi.fn().mockResolvedValue(['hash-1']),
    truncateImportTable: vi.fn().mockResolvedValue(undefined),
    insertIntoTempTable: vi.fn().mockResolvedValue([11, 12]),
    deleteFromTempTable: vi.fn().mockResolvedValue(undefined),
    updateTempTransactionHashes: vi.fn().mockResolvedValue(undefined),
    checkDuplicateTransactions: vi.fn().mockResolvedValue(['duplicate-hash']),
    bulkInsertFromTempTable: vi.fn().mockResolvedValue(3),
    updateTransactionLabels: vi.fn().mockResolvedValue(undefined),
    applyTransactionClassifications: vi.fn().mockResolvedValue({ appliedCount: 1, transactionIds: [8] }),
    setTransactionCategory: vi.fn().mockResolvedValue(undefined),
    setTransactionCompany: vi.fn().mockResolvedValue(undefined),
    setTransactionComment: vi.fn().mockResolvedValue(undefined),
    linkTransactionToSeries: vi.fn().mockResolvedValue(undefined),
    unlinkTransactionFromSeries: vi.fn().mockResolvedValue(undefined),
    bulkLinkTransactionsToSeries: vi.fn().mockResolvedValue({ appliedCount: 2 }),
    getRecentTransactions: vi.fn().mockResolvedValue([]),
    getDashboardSummary: vi.fn().mockResolvedValue({ totalIncome: 0, totalExpenses: 0, netIncome: 0, transactionCount: 0 }),
    getChartData: vi.fn().mockResolvedValue({
      spendingByCategory: [],
      spendingByCompany: [],
      spendingByRecurring: [],
      incomeBySource: [],
      trends: { months: [], income: [], expenses: [] },
      accountAnalysis: { accountNames: [], income: [], expenses: [] },
      categoryTrends: { months: [], series: [] },
      committedSplit: { months: [], committed: [], discretionary: [] },
      upcomingCommitments: { months: [], amounts: [] },
      categoryDeltas: [],
      comparisonPeriodLabel: 'previous period',
    }),
    getTransactionsPaginated: vi.fn().mockResolvedValue({ data: [], total: 0, totalIncome: 0, totalExpenses: 0 }),
    getTransactionsForExport: vi.fn().mockResolvedValue([]),
    getAllProjectCosts: vi.fn().mockResolvedValue([]),
    getTransactionsByProjectPaginated: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getTransactionsByTripPaginated: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  };
}

describe('useDatabaseTransactionSlice', () => {
  it('throws when called without an initialized service', async () => {
    const refreshTransactions = vi.fn().mockResolvedValue(undefined);
    const transaction: TransactionInput = {
      account_id: 1,
      date: '2026-01-02',
      amount: -45.5,
      description: 'Lunch',
      card_id: null,
      type: 'expense',
      category_id: null,
      company_id: null,
      project_id: null,
      trip_id: null,
      hash: 'hash-1',
    } as TransactionInput;

    const { result } = renderHook(() =>
      useDatabaseTransactionSlice({
        databaseService: null,
        refreshTransactions,
      })
    );

    await expect(result.current.addTransaction(transaction)).rejects.toThrow(
      'Database service not initialized'
    );
    expect(refreshTransactions).not.toHaveBeenCalled();
  });

  it('adds a transaction and refreshes cached transactions', async () => {
    const refreshTransactions = vi.fn().mockResolvedValue(undefined);
    const service = createServiceMock();
    const transaction: TransactionInput = {
      account_id: 2,
      date: '2026-01-15',
      amount: -99,
      description: 'Groceries',
      card_id: null,
      type: 'expense',
      category_id: 4,
      company_id: 7,
      project_id: null,
      trip_id: null,
      hash: 'hash-2',
    } as TransactionInput;

    const { result } = renderHook(() =>
      useDatabaseTransactionSlice({
        databaseService: service,
        refreshTransactions,
      })
    );

    await act(async () => {
      await result.current.addTransaction(transaction);
    });

    expect(service.addTransaction).toHaveBeenCalledWith(transaction);
    expect(refreshTransactions).toHaveBeenCalledTimes(1);
  });

  it('bulk inserts temp-table rows and refreshes cached transactions', async () => {
    const refreshTransactions = vi.fn().mockResolvedValue(undefined);
    const service = createServiceMock();

    const { result } = renderHook(() =>
      useDatabaseTransactionSlice({
        databaseService: service,
        refreshTransactions,
      })
    );

    let insertedCount = 0;
    await act(async () => {
      insertedCount = await result.current.bulkInsertFromTempTable();
    });

    expect(service.bulkInsertFromTempTable).toHaveBeenCalledTimes(1);
    expect(refreshTransactions).toHaveBeenCalledTimes(1);
    expect(insertedCount).toBe(3);
  });

  it('uses the shared transaction hash generator', () => {
    const refreshTransactions = vi.fn().mockResolvedValue(undefined);
    const service = createServiceMock();

    const { result } = renderHook(() =>
      useDatabaseTransactionSlice({
        databaseService: service,
        refreshTransactions,
      })
    );

    expect(
      result.current.generateTransactionHash(
        '5',
        '2026-02-01',
        -18.25,
        'Coffee beans',
        'row-1'
      )
    ).toBe(
      DatabaseService.generateTransactionHashFromFields(
        '5',
        '2026-02-01',
        -18.25,
        'Coffee beans',
        'row-1'
      )
    );
  });

  it('applies transaction classifications and refreshes affected cached collections', async () => {
    const refreshTransactions = vi.fn().mockResolvedValue(undefined);
    const refreshCategories = vi.fn().mockResolvedValue(undefined);
    const refreshCompanies = vi.fn().mockResolvedValue(undefined);
    const service = createServiceMock();

    const { result } = renderHook(() =>
      useDatabaseTransactionSlice({
        databaseService: service,
        refreshTransactions,
        refreshCategories,
        refreshCompanies,
      })
    );

    const classifications = [
      {
        transactionId: 8,
        categoryName: 'Utilities',
        categoryType: 'expense' as const,
        companyName: 'Power Co',
      },
    ];

    await act(async () => {
      await expect(
        result.current.applyTransactionClassifications(classifications)
      ).resolves.toEqual({ appliedCount: 1, transactionIds: [8] });
    });

    expect(service.applyTransactionClassifications).toHaveBeenCalledWith(classifications);
    expect(refreshTransactions).toHaveBeenCalledTimes(1);
    expect(refreshCategories).toHaveBeenCalledTimes(1);
    expect(refreshCompanies).toHaveBeenCalledTimes(1);
  });

  it('bulk links transactions to a series and refreshes transactions and series', async () => {
    const refreshTransactions = vi.fn().mockResolvedValue(undefined);
    const refreshRecurringSeries = vi.fn().mockResolvedValue(undefined);
    const service = createServiceMock();

    const { result } = renderHook(() =>
      useDatabaseTransactionSlice({
        databaseService: service,
        refreshTransactions,
        refreshRecurringSeries,
      })
    );

    await act(async () => {
      await expect(
        result.current.bulkLinkTransactionsToSeries([8, 9], 3)
      ).resolves.toEqual({ appliedCount: 2 });
    });

    expect(service.bulkLinkTransactionsToSeries).toHaveBeenCalledWith([8, 9], 3);
    expect(refreshTransactions).toHaveBeenCalledTimes(1);
    expect(refreshRecurringSeries).toHaveBeenCalledTimes(1);
  });

  it('sets a transaction comment and refreshes transactions', async () => {
    const refreshTransactions = vi.fn().mockResolvedValue(undefined);
    const service = createServiceMock();

    const { result } = renderHook(() =>
      useDatabaseTransactionSlice({
        databaseService: service,
        refreshTransactions,
      })
    );

    await act(async () => {
      await result.current.setTransactionComment(8, 'Updated memo');
    });

    expect(service.setTransactionComment).toHaveBeenCalledWith(8, 'Updated memo');
    expect(refreshTransactions).toHaveBeenCalledTimes(1);
  });
});
