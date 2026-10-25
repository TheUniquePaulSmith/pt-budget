// Budget carry-over and savings-fund view types (schema v3, budgets feature).
// Row shapes stay in ./database.ts; these are the derived shapes that
// getBudgetStatus and BudgetFundsService.getFundStatus report.

import type {
  BudgetCarryMode,
  BudgetCategoryStatus,
  BudgetFundLink,
  BudgetStatus,
} from './database';

/** One month of a category's carry ledger, as the pure module computes it. */
export interface BudgetCarryMonth {
  month: string; // 'YYYY-MM'
  /** Plan amount for the month, or null when the effective plan has no row for the category. */
  budgeted: number | null;
  /** Spend committed against the category that month (actual spend plus fund contributions). */
  actual: number;
  carryMode: BudgetCarryMode;
  /** Balance brought in from the previous month (zero after a reset or when unbudgeted). */
  carriedIn: number;
  effectiveBudget: number;
  /** Balance handed to the next month after applying the carry mode. */
  carriedOut: number;
  /** True when a plan effective this month resets the carried balance. */
  reset: boolean;
}

/** Category status extended with carry-over and fund figures. */
export interface BudgetCategoryCarryStatus extends BudgetCategoryStatus {
  /** Carry mode of the plan effective in the period's last month. */
  carryMode: BudgetCarryMode;
  /** Balance carried into the period's first month. */
  carriedIn: number;
  /** Balance carried out of the period's last month. */
  carriedOut: number;
  /** budgetedAmount + carriedIn */
  effectiveBudget: number;
  /** Monthly contributions of funds linked to this category over the period. */
  fundContributions: number;
  /** Spend in this category paid by a linked fund (excluded from committed spend). */
  fundSpend: number;
  /** actualExpenses - fundSpend + fundContributions */
  committedSpend: number;
  /** effectiveBudget - committedSpend */
  effectiveRemaining: number;
  /** Month inside the period at which a reset applied, if any. */
  carryResetMonth: string | null;
}

export interface BudgetStatusWithCarry extends BudgetStatus {
  categories: BudgetCategoryCarryStatus[];
  /** First month the status computation looked at (period start or earlier when carry is on). */
  carryRangeStart: string;
  carriedInTotal: number;
  /** budgetedTotal + carriedInTotal, null without a plan. */
  effectiveBudgetTotal: number | null;
  fundContributionsTotal: number;
  fundSpendTotal: number;
  /** effectiveBudgetTotal - (actualExpenses - fundSpendTotal + fundContributionsTotal), null without a plan. */
  effectiveRemaining: number | null;
}

/** A linked project or trip with its savings-fund balance as of a month. */
export interface BudgetFundStatus extends BudgetFundLink {
  /** Month the figures are as of ('YYYY-MM'). */
  asOfMonth: string;
  /** First month that accrues a contribution, or null when the fund has no start. */
  startMonth: string | null;
  /** Last month that accrues a contribution (the entity's end_date month), or null for open-ended. */
  endMonth: string | null;
  /** Number of months counted toward contributed (partial months count in full). */
  monthsContributed: number;
  contributed: number;
  /** Spend linked to the entity between startMonth and asOfMonth. */
  spent: number;
  /** contributed - spent */
  balance: number;
  /** estimated_cost - contributed, null without an estimate. */
  remainingToGoal: number | null;
  /** contributed / estimated_cost clamped to 0..1, null without an estimate. */
  progress: number | null;
  /** Whole months still needed to reach the estimate at the current contribution, null when unknown. */
  monthsToGoal: number | null;
  /** True when asOfMonth falls inside the contribution window. */
  isContributing: boolean;
}
