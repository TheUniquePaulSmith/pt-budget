'use client';

// Page-facing slices for the loans feature (schema v5). Re-exported from
// useDatabaseSlices.ts (the hub).

import { useDatabaseCollections, useDatabaseLoans } from './DatabaseContext';

/** Everything the Loans page and its dialogs need. */
export function useLoansPageSlice() {
  const collections = useDatabaseCollections();
  const loans = useDatabaseLoans();

  return {
    loans: collections.loans,
    users: collections.users,
    projects: collections.projects,
    accounts: collections.accounts,
    transactionVersion: collections.transactionVersion,
    addLoan: loans.addLoan,
    updateLoan: loans.updateLoan,
    setLoanStatus: loans.setLoanStatus,
    deleteLoan: loans.deleteLoan,
    getLoanRules: loans.getLoanRules,
    addLoanRule: loans.addLoanRule,
    updateLoanRule: loans.updateLoanRule,
    deleteLoanRule: loans.deleteLoanRule,
    previewLoanRuleMatches: loans.previewLoanRuleMatches,
    applyLoanRules: loans.applyLoanRules,
    getLoanPayments: loans.getLoanPayments,
    searchLoanLinkCandidates: loans.searchLoanLinkCandidates,
    linkTransactionToLoan: loans.linkTransactionToLoan,
    addLoanManualPayment: loans.addLoanManualPayment,
    updateLoanPayment: loans.updateLoanPayment,
    deleteLoanPayment: loans.deleteLoanPayment,
    getLoanSummary: loans.getLoanSummary,
  };
}

/** Subscriptions page "Loans" section: loans, their rules, and rule creation from an unmatched cluster. */
export function useSubscriptionsLoansSlice() {
  const collections = useDatabaseCollections();
  const loans = useDatabaseLoans();

  return {
    loans: collections.loans,
    accounts: collections.accounts,
    getLoanRules: loans.getLoanRules,
    addLoanRule: loans.addLoanRule,
    updateLoanRule: loans.updateLoanRule,
    deleteLoanRule: loans.deleteLoanRule,
    previewLoanRuleMatches: loans.previewLoanRuleMatches,
    applyLoanRules: loans.applyLoanRules,
  };
}
