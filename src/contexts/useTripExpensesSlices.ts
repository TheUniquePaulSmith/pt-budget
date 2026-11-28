'use client';

// Page-facing slices for trip business expenses (schema v9): the trip detail
// view (Overview, Transactions, Insights) and the Transactions page's
// "assign to trip" actions. Re-exported from useDatabaseSlices.ts (the hub).

import { useDatabaseCollections, useDatabaseTripExpenses, useDatabaseTrips } from './DatabaseContext';

/** The trip detail view: its rows, figures, splits and reimbursements. */
export function useTripDetailSlice() {
  const collections = useDatabaseCollections();
  const tripExpenses = useDatabaseTripExpenses();
  const trips = useDatabaseTrips();

  return {
    trips: collections.trips,
    accounts: collections.accounts,
    users: collections.users,
    transactionVersion: collections.transactionVersion,
    updateTrip: trips.updateTrip,
    getTripExpenseDetail: tripExpenses.getTripExpenseDetail,
    findTripCandidates: tripExpenses.findTripCandidates,
    findTripDepositCandidates: tripExpenses.findTripDepositCandidates,
    assignTransactionsToTrip: tripExpenses.assignTransactionsToTrip,
    setTripAllocations: tripExpenses.setTripAllocations,
    setTripReimbursementStatus: tripExpenses.setTripReimbursementStatus,
    addTripReimbursement: tripExpenses.addTripReimbursement,
    updateTripReimbursement: tripExpenses.updateTripReimbursement,
    deleteTripReimbursement: tripExpenses.deleteTripReimbursement,
  };
}

/** Putting transactions on a trip from anywhere (Transactions page bulk action, label dialog). */
export function useTripAssignSlice() {
  const collections = useDatabaseCollections();
  const tripExpenses = useDatabaseTripExpenses();

  return {
    trips: collections.trips,
    assignTransactionsToTrip: tripExpenses.assignTransactionsToTrip,
  };
}

/** Per-trip totals for the Trips list. */
export function useTripSummariesSlice() {
  const collections = useDatabaseCollections();
  const tripExpenses = useDatabaseTripExpenses();

  return {
    transactionVersion: collections.transactionVersion,
    getTripExpenseSummaries: tripExpenses.getTripExpenseSummaries,
  };
}
