"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import type { TripExpenseDetail } from '../lib/databaseServiceTripExpenses';
import type {
  TripAllocationInput,
  TripCandidateTransaction,
  TripDepositCandidate,
  TripExpenseSummary,
  TripReimbursementInput,
  TripReimbursementStatus,
} from '../types/tripExpenses';

export type { TripExpenseDetail };

/**
 * Provider-domain slice for trip business expenses (schema v8). Trip figures
 * are read per page (not a cached collection); every mutation bumps
 * transactionVersion, which is what the trip pages, the Transactions page and
 * the dashboard re-read on.
 */
export interface DatabaseTripExpensesSlice {
  getTripExpenseDetail: (tripId: number) => Promise<TripExpenseDetail>;
  getTripExpenseSummaries: () => Promise<Record<number, TripExpenseSummary>>;
  findTripCandidates: (startDate: string, endDate: string) => Promise<TripCandidateTransaction[]>;
  findTripDepositCandidates: (startDate: string, endDate: string) => Promise<TripDepositCandidate[]>;
  /** Puts rows on a trip (null: takes them off theirs). */
  assignTransactionsToTrip: (transactionIds: number[], tripId: number | null) => Promise<void>;
  setTripAllocations: (items: TripAllocationInput[]) => Promise<void>;
  setTripReimbursementStatus: (transactionIds: number[], status: TripReimbursementStatus) => Promise<void>;
  addTripReimbursement: (input: TripReimbursementInput) => Promise<number>;
  updateTripReimbursement: (id: number, input: Omit<TripReimbursementInput, 'tripId'>) => Promise<void>;
  deleteTripReimbursement: (id: number) => Promise<void>;
}

interface UseDatabaseTripExpensesSliceOptions {
  databaseService: Pick<DatabaseService, 'tripExpenses'> | null;
  refreshTransactions: () => Promise<void>;
}

export function useDatabaseTripExpensesSlice({
  databaseService,
  refreshTransactions,
}: UseDatabaseTripExpensesSliceOptions): DatabaseTripExpensesSlice {
  const requireService = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }
    return databaseService.tripExpenses;
  }, [databaseService]);

  const getTripExpenseDetail = useCallback(async (tripId: number) => requireService().getDetail(tripId), [requireService]);
  const getTripExpenseSummaries = useCallback(async () => requireService().getAllSummaries(), [requireService]);
  const findTripCandidates = useCallback(
    async (startDate: string, endDate: string) => requireService().findCandidates(startDate, endDate),
    [requireService]
  );
  const findTripDepositCandidates = useCallback(
    async (startDate: string, endDate: string) => requireService().findDepositCandidates(startDate, endDate),
    [requireService]
  );

  const assignTransactionsToTrip = useCallback(
    async (transactionIds: number[], tripId: number | null) => {
      await requireService().assignTransactions(transactionIds, tripId);
      await refreshTransactions();
    },
    [refreshTransactions, requireService]
  );

  const setTripAllocations = useCallback(
    async (items: TripAllocationInput[]) => {
      await requireService().setAllocations(items);
      await refreshTransactions();
    },
    [refreshTransactions, requireService]
  );

  const setTripReimbursementStatus = useCallback(
    async (transactionIds: number[], status: TripReimbursementStatus) => {
      await requireService().setStatus(transactionIds, status);
      await refreshTransactions();
    },
    [refreshTransactions, requireService]
  );

  const addTripReimbursement = useCallback(
    async (input: TripReimbursementInput) => {
      const id = await requireService().addReimbursement(input);
      await refreshTransactions();
      return id;
    },
    [refreshTransactions, requireService]
  );

  const updateTripReimbursement = useCallback(
    async (id: number, input: Omit<TripReimbursementInput, 'tripId'>) => {
      await requireService().updateReimbursement(id, input);
      await refreshTransactions();
    },
    [refreshTransactions, requireService]
  );

  const deleteTripReimbursement = useCallback(
    async (id: number) => {
      await requireService().deleteReimbursement(id);
      await refreshTransactions();
    },
    [refreshTransactions, requireService]
  );

  return useMemo(
    () => ({
      getTripExpenseDetail,
      getTripExpenseSummaries,
      findTripCandidates,
      findTripDepositCandidates,
      assignTransactionsToTrip,
      setTripAllocations,
      setTripReimbursementStatus,
      addTripReimbursement,
      updateTripReimbursement,
      deleteTripReimbursement,
    }),
    [
      getTripExpenseDetail,
      getTripExpenseSummaries,
      findTripCandidates,
      findTripDepositCandidates,
      assignTransactionsToTrip,
      setTripAllocations,
      setTripReimbursementStatus,
      addTripReimbursement,
      updateTripReimbursement,
      deleteTripReimbursement,
    ]
  );
}
