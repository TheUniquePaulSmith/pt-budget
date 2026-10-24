'use client';

// Page-facing slice for savings funds on the Budget page and project/trip
// cards. Re-exported from useDatabaseSlices.ts (the hub); owned by the
// budgets agent.

import { useDatabaseBudgetFunds, useDatabaseCollections } from './DatabaseContext';

export function useBudgetFundsSlice() {
  const collections = useDatabaseCollections();
  const budgetFunds = useDatabaseBudgetFunds();

  return {
    projects: collections.projects,
    trips: collections.trips,
    categories: collections.categories,
    budgetVersion: collections.budgetVersion,
    transactionVersion: collections.transactionVersion,
    listLinkedFunds: budgetFunds.listLinkedFunds,
    getFundSpendSince: budgetFunds.getFundSpendSince,
  };
}
