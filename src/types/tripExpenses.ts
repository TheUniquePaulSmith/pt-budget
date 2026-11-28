// Trip business expenses (schema v8): the business part of each linked
// expense, the reimbursements received, and the per-trip figures built from
// them. Row shapes live here rather than in the database.ts hub because only
// the trips feature reads them.

export type TripReimbursementStatus = 'pending' | 'submitted' | 'reimbursed' | 'denied';

export const TRIP_REIMBURSEMENT_STATUSES: readonly TripReimbursementStatus[] = [
  'pending',
  'submitted',
  'reimbursed',
  'denied',
];

/** The business part of one trip expense (`trip_expense_allocations`). */
export interface TripExpenseAllocation {
  transaction_id: number;
  trip_id: number;
  /** Positive magnitude in the transaction's account currency. */
  business_amount: number;
  status: TripReimbursementStatus;
  note: string | null;
}

export interface TripAllocationInput {
  transactionId: number;
  /** 0 = all personal; at most the charge (larger values are capped). */
  businessAmount: number;
  status?: TripReimbursementStatus;
  note?: string | null;
}

/** Money received back for a trip (`trip_reimbursements`). */
export interface TripReimbursement {
  id: number;
  trip_id: number;
  /** Default currency. */
  amount: number;
  received_date: string | null;
  transaction_id: number | null;
  note: string | null;
  created_at: string;
  /** The linked deposit, when there is one. */
  transaction_description: string | null;
  transaction_date: string | null;
  transaction_amount: number | null;
  transaction_account_id: number | null;
  transaction_account_currency: string | null;
  transaction_type: string | null;
}

export interface TripReimbursementInput {
  tripId: number;
  amount: number;
  receivedDate?: string | null;
  transactionId?: number | null;
  note?: string | null;
  /** Business items to mark reimbursed together with this receipt. */
  markReimbursedIds?: number[];
  /**
   * The linked deposit is only this reimbursement: store it as a manually
   * typed refund so it nets the spending everywhere instead of counting as
   * income. Never offered for a deposit that is also salary.
   */
  countDepositAsRefund?: boolean;
}

/** Per-trip figures, all in the default currency. */
export interface TripExpenseSummary {
  trip_id: number;
  /** Rows linked to the trip (any type). */
  transaction_count: number;
  /** SUM(spendExpr): expenses less refunds. */
  gross_spend: number;
  /** Non-denied business parts, each capped at its charge. */
  business_share: number;
  /** gross_spend - business_share. */
  personal_share: number;
  denied_share: number;
  received: number;
  /** business_share - received; negative = received more than claimed. */
  outstanding: number;
  /** gross_spend - received. */
  net_cost: number;
  status_counts: Record<TripReimbursementStatus, number>;
  status_amounts: Record<TripReimbursementStatus, number>;
  /** Linked rows skipped because their currency has no exchange rate. */
  missing_rate_count: number;
}

/** One trip row as the Transactions tab and the Insights tab read it. */
export interface TripInsightRow {
  transaction_id: number;
  trip_id: number;
  date: string;
  description: string;
  type: string;
  is_excluded: boolean;
  /** Signed amount in the account currency. */
  amount: number;
  account_id: number;
  account_currency: string;
  user_id: number | null;
  user_name: string | null;
  category_id: number | null;
  category_name: string | null;
  category_color: string | null;
  company_id: number | null;
  company_name: string | null;
  /** Spend in the default currency (expenses positive, refunds negative); null = no rate. */
  gross_spend: number | null;
  /** Units of the default currency per unit of the account currency; null = no rate. */
  rate: number | null;
  /** Business part in the default currency (non-denied, capped); 0 when none, null = no rate. */
  business_share: number | null;
  /** Denied business part in the default currency; 0 when none, null = no rate. */
  denied_share: number | null;
  /** Business part in the account currency as stored (capped), denied included. */
  business_amount: number | null;
  status: TripReimbursementStatus | null;
  note: string | null;
}

/** An expense near the trip's dates that is on no trip yet. */
export interface TripCandidateTransaction {
  transaction_id: number;
  date: string;
  description: string;
  amount: number;
  account_id: number;
  account_currency: string;
  user_name: string | null;
  category_name: string | null;
  company_name: string | null;
  project_id: number | null;
}

/** A deposit that a reimbursement may have arrived in. */
export interface TripDepositCandidate {
  transaction_id: number;
  date: string;
  description: string;
  amount: number;
  type: string;
  account_id: number;
  account_currency: string;
}
