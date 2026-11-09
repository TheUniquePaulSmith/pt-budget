// Computed loan figures (schema v5). Row shapes live in ./database.ts; these
// are what loanMath.ts derives from a loan's terms and its payment ledger.

import type { LoanPaymentMatchSource, LoanPaymentSplitSource } from './database';

/** One line of the loan's history: a payment, or the deferred-interest charge assessed when a promo is missed. */
export interface LoanLedgerEntry {
  kind: 'payment' | 'deferred_interest_charge';
  /** loan_payments.id for payments; null for the charge event. */
  payment_id: number | null;
  transaction_id: number | null;
  date: string;
  /** Money paid (payments) or interest capitalized (charge). */
  amount: number;
  principal: number;
  interest: number;
  balance_after: number;
  split_source: LoanPaymentSplitSource;
  match_source: LoanPaymentMatchSource;
  description?: string | null;
  account_name?: string | null;
  notes?: string | null;
}

export interface LoanProjectionEntry {
  date: string;
  amount: number;
  principal: number;
  interest: number;
  balance_after: number;
  /** True for the row where missed-promo deferred interest is added to the balance. */
  deferred_charge?: boolean;
}

export interface LoanProjection {
  /** The monthly payment the projection assumes (expected_payment, else the amortizing payment from the term). */
  assumedPayment: number;
  /** True when assumedPayment was derived from term_months rather than entered. */
  paymentDerivedFromTerm: boolean;
  payoffDate: string | null;
  monthsRemaining: number | null;
  totalInterestRemaining: number;
  /** True when the assumed payment does not cover the interest, so the balance never falls. */
  neverPaysOff: boolean;
  schedule: LoanProjectionEntry[];
}

export interface DeferredInterestStatus {
  promoEndDate: string;
  /** Negative once the promo end has passed. */
  daysUntilPromoEnd: number;
  /** Interest accrued at the deferred rate since opening (what would be charged back today). */
  deferredInterestAccrued: number;
  /** Projected balance on the promo end date if payments continue at the assumed amount. */
  projectedBalanceAtPromoEnd: number;
  /** Projected deferred interest charged on the promo end date if payments continue at the assumed amount (0 when on track). */
  deferredInterestAtRisk: number;
  /** True when the projection clears the balance before the promo ends. */
  onTrack: boolean;
  /** Monthly payment that clears today's balance by the promo end (null once the promo passed). */
  requiredMonthlyToAvoid: number | null;
  /** Payments still possible before the promo end. */
  paymentsRemainingInPromo: number;
  /** True once the promo passed with a balance: deferred interest was added to the balance. */
  charged: boolean;
  chargedAmount: number;
}

export interface LoanSummary {
  loanId: number;
  asOf: string;
  originalPrincipal: number;
  /** Principal outstanding (including any capitalized deferred interest) after the last ledger event. */
  balance: number;
  /** Interest accrued since the last payment that the next payment will absorb. */
  accruedInterest: number;
  /** balance + accruedInterest: what paying the loan off today costs. */
  payoffAmount: number;
  totalPaid: number;
  totalPrincipalPaid: number;
  totalInterestPaid: number;
  paymentCount: number;
  lastPaymentDate: string | null;
  nextDueDate: string | null;
  isPaidOff: boolean;
  ledger: LoanLedgerEntry[];
  projection: LoanProjection | null;
  deferred: DeferredInterestStatus | null;
}

export interface LoanRuleScanSummary {
  scanned: number;
  linked: number;
  /** Payments linked per loan id. */
  byLoan: Record<number, number>;
}

/** A transaction the link dialog offers, or a rule preview counts. */
export interface LoanLinkCandidate {
  id: number;
  date: string;
  amount: number;
  description: string;
  account_id: number;
  account_name: string | null;
  /** The account's ISO 4217 currency; `amount` is stored in it. */
  account_currency?: string | null;
}
