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
});
