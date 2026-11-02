"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import type { LoanPaymentUpdate } from '../lib/databaseServiceLoans';
import type {
  Loan,
  LoanInput,
  LoanManualPaymentInput,
  LoanMatchRule,
  LoanMatchRuleInput,
  LoanPayment,
  LoanStatus,
  MerchantRuleMatchType,
} from '../types/database';
import type { LoanLinkCandidate, LoanRuleScanSummary, LoanSummary } from '../types/loans';

export type { LoanPaymentUpdate };

/**
 * Provider-domain slice for loans (schema v5). Mutations refresh the cached
 * `loans` collection; payment changes also bump transactionVersion because
 * the Subscriptions page's unmatched clusters depend on which transactions
 * are loan payments.
 */
export interface DatabaseLoansSlice {
  getLoans: () => Promise<Loan[]>;
  getLoanById: (id: number) => Promise<Loan | null>;
  addLoan: (input: LoanInput) => Promise<number>;
  updateLoan: (id: number, input: Partial<LoanInput>) => Promise<void>;
  setLoanStatus: (id: number, status: LoanStatus) => Promise<void>;
  deleteLoan: (id: number) => Promise<void>;
  getLoanRules: (loanId?: number) => Promise<LoanMatchRule[]>;
  addLoanRule: (input: LoanMatchRuleInput) => Promise<number>;
  updateLoanRule: (id: number, input: Omit<LoanMatchRuleInput, 'loan_id'>) => Promise<void>;
  deleteLoanRule: (id: number) => Promise<void>;
  previewLoanRuleMatches: (rule: { pattern: string; match_type: MerchantRuleMatchType; account_id?: number | null }) => Promise<LoanLinkCandidate[]>;
  /** Links every unlinked outflow that matches an enabled rule; refreshes loans and transactions. */
  applyLoanRules: () => Promise<LoanRuleScanSummary>;
  getLoanPayments: (loanId: number) => Promise<LoanPayment[]>;
  searchLoanLinkCandidates: (search: string) => Promise<LoanLinkCandidate[]>;
  linkTransactionToLoan: (loanId: number, transactionId: number) => Promise<number>;
  addLoanManualPayment: (input: LoanManualPaymentInput) => Promise<number>;
  updateLoanPayment: (id: number, update: LoanPaymentUpdate) => Promise<void>;
  deleteLoanPayment: (id: number) => Promise<void>;
  getLoanSummary: (loanId: number, asOf?: string) => Promise<LoanSummary | null>;
}

type LoansDatabaseService = Pick<DatabaseService, 'loans'>;

interface UseDatabaseLoansSliceOptions {
  databaseService: LoansDatabaseService | null;
  refreshLoans: () => Promise<void>;
  refreshTransactions: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
}

export function useDatabaseLoansSlice({
  databaseService,
  refreshLoans,
  refreshTransactions,
  refreshAccounts,
}: UseDatabaseLoansSliceOptions): DatabaseLoansSlice {
  const requireService = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }
    return databaseService.loans;
  }, [databaseService]);

  const getLoans = useCallback(async () => requireService().list(), [requireService]);
  const getLoanById = useCallback(async (id: number) => requireService().getById(id), [requireService]);

  const addLoan = useCallback(
    async (input: LoanInput) => {
      const id = await requireService().create(input);
      await refreshLoans();
      if (input.account_id != null) await refreshAccounts();
      return id;
    },
    [refreshAccounts, refreshLoans, requireService]
  );

  const updateLoan = useCallback(
    async (id: number, input: Partial<LoanInput>) => {
      await requireService().update(id, input);
      await refreshLoans();
      if (input.account_id !== undefined) await refreshAccounts();
    },
    [refreshAccounts, refreshLoans, requireService]
  );

  const setLoanStatus = useCallback(
    async (id: number, status: LoanStatus) => {
      await requireService().setStatus(id, status);
      await refreshLoans();
    },
    [refreshLoans, requireService]
  );

  const deleteLoan = useCallback(
    async (id: number) => {
      await requireService().remove(id);
      await Promise.all([refreshLoans(), refreshTransactions()]);
    },
    [refreshLoans, refreshTransactions, requireService]
  );

  const getLoanRules = useCallback(async (loanId?: number) => requireService().listRules(loanId), [requireService]);

  const addLoanRule = useCallback(
    async (input: LoanMatchRuleInput) => {
      const id = await requireService().addRule(input);
      await refreshLoans();
      return id;
    },
    [refreshLoans, requireService]
  );

  const updateLoanRule = useCallback(
    async (id: number, input: Omit<LoanMatchRuleInput, 'loan_id'>) => {
      await requireService().updateRule(id, input);
      await refreshLoans();
    },
    [refreshLoans, requireService]
  );

  const deleteLoanRule = useCallback(
    async (id: number) => {
      await requireService().deleteRule(id);
      await refreshLoans();
    },
    [refreshLoans, requireService]
  );

  const previewLoanRuleMatches = useCallback(
    async (rule: { pattern: string; match_type: MerchantRuleMatchType; account_id?: number | null }) =>
      requireService().previewRuleMatches(rule),
    [requireService]
  );

  const applyLoanRules = useCallback(async () => {
    const summary = await requireService().applyRules();
    if (summary.linked > 0) {
      await Promise.all([refreshLoans(), refreshTransactions()]);
    }
    return summary;
  }, [refreshLoans, refreshTransactions, requireService]);

  const getLoanPayments = useCallback(async (loanId: number) => requireService().listPayments(loanId), [requireService]);

  const searchLoanLinkCandidates = useCallback(
    async (search: string) => requireService().searchLinkCandidates(search),
    [requireService]
  );

  const linkTransactionToLoan = useCallback(
    async (loanId: number, transactionId: number) => {
      const id = await requireService().linkTransaction(loanId, transactionId);
      await Promise.all([refreshLoans(), refreshTransactions()]);
      return id;
    },
    [refreshLoans, refreshTransactions, requireService]
  );

  const addLoanManualPayment = useCallback(
    async (input: LoanManualPaymentInput) => {
      const id = await requireService().addManualPayment(input);
      await refreshLoans();
      return id;
    },
    [refreshLoans, requireService]
  );

  const updateLoanPayment = useCallback(
    async (id: number, update: LoanPaymentUpdate) => {
      await requireService().updatePayment(id, update);
      await refreshLoans();
    },
    [refreshLoans, requireService]
  );

  const deleteLoanPayment = useCallback(
    async (id: number) => {
      await requireService().deletePayment(id);
      await Promise.all([refreshLoans(), refreshTransactions()]);
    },
    [refreshLoans, refreshTransactions, requireService]
  );

  const getLoanSummary = useCallback(
    async (loanId: number, asOf?: string) => requireService().getSummary(loanId, asOf),
    [requireService]
  );

  return useMemo(
    () => ({
      getLoans,
      getLoanById,
      addLoan,
      updateLoan,
      setLoanStatus,
      deleteLoan,
      getLoanRules,
      addLoanRule,
      updateLoanRule,
      deleteLoanRule,
      previewLoanRuleMatches,
      applyLoanRules,
      getLoanPayments,
      searchLoanLinkCandidates,
      linkTransactionToLoan,
      addLoanManualPayment,
      updateLoanPayment,
      deleteLoanPayment,
      getLoanSummary,
    }),
    [
      addLoan,
      addLoanManualPayment,
      addLoanRule,
      applyLoanRules,
      deleteLoan,
      deleteLoanPayment,
      deleteLoanRule,
      getLoanById,
      getLoanPayments,
      getLoanRules,
      getLoanSummary,
      getLoans,
      linkTransactionToLoan,
      previewLoanRuleMatches,
      searchLoanLinkCandidates,
      setLoanStatus,
      updateLoan,
      updateLoanPayment,
      updateLoanRule,
    ]
  );
}
