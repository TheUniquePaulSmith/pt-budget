// Pure budget carry-over math (no database access). getBudgetStatus feeds
// it one series per category and reads back the carried balances; the
// Budget page uses the month helpers and the status normalizer.

import type { BudgetCarryMode, BudgetCategoryStatus, BudgetPeriod, BudgetPlanWithCategories, BudgetStatus } from '@/types/database';
import type { BudgetCarryMonth, BudgetCategoryCarryStatus, BudgetStatusWithCarry } from '@/types/budgetCarry';

/** Longest look-back getBudgetStatus walks to seed a carried balance. */
export const MAX_CARRY_LOOKBACK_MONTHS = 36;

export const BUDGET_CARRY_MODES: ReadonlyArray<{ value: BudgetCarryMode; label: string; description: string }> = [
  { value: 'none', label: 'No carry-over', description: 'Each month starts from the plan amount.' },
  { value: 'surplus', label: 'Carry surplus', description: 'Unspent budget rolls into the next month; overspend is forgiven.' },
  { value: 'deficit', label: 'Carry deficit', description: 'Overspend is deducted from the next month; unspent budget is dropped.' },
  { value: 'both', label: 'Carry both', description: 'The net balance, positive or negative, rolls into the next month.' },
];

export function isBudgetCarryMode(value: unknown): value is BudgetCarryMode {
  return value === 'none' || value === 'surplus' || value === 'deficit' || value === 'both';
}

// ---------------------------------------------------------------------------
// Month arithmetic on 'YYYY-MM' keys (UTC, no time zones involved)
// ---------------------------------------------------------------------------

export function addMonths(month: string, delta: number): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Signed number of months from `from` to `to` (0 when equal). */
export function monthDiff(from: string, to: string): number {
  const [fromYear, fromMonth] = from.split('-').map(Number);
  const [toYear, toMonth] = to.split('-').map(Number);
  return (toYear - fromYear) * 12 + (toMonth - fromMonth);
}

/** Inclusive list of months from `start` to `end`; empty when start is after end. */
export function monthRange(start: string, end: string): string[] {
  const count = monthDiff(start, end) + 1;
  if (count <= 0) return [];
  return Array.from({ length: count }, (_, index) => addMonths(start, index));
}

/** 'YYYY-MM' of a date string, or null for an empty value. */
export function monthOf(date: string | null | undefined): string | null {
  if (!date || date.length < 7) return null;
  return date.slice(0, 7);
}

export function currentMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** First and last month of a budget period. */
export function periodMonthBounds(period: BudgetPeriod): { start: string; end: string } {
  if (period.type === 'month') return { start: period.key, end: period.key };
  if (period.type === 'quarter') {
    const match = period.key.match(/^(\d{4})-Q([1-4])$/);
    if (!match) throw new Error(`Invalid budget quarter key: ${period.key}`);
    const startMonth = (Number(match[2]) - 1) * 3 + 1;
    const start = `${match[1]}-${String(startMonth).padStart(2, '0')}`;
    return { start, end: addMonths(start, 2) };
  }
  if (!/^\d{4}$/.test(period.key)) throw new Error(`Invalid budget year key: ${period.key}`);
  return { start: `${period.key}-01`, end: `${period.key}-12` };
}

// ---------------------------------------------------------------------------
// Carry math
// ---------------------------------------------------------------------------

/** The part of a month's leftover that the carry mode hands to the next month. */
export function carryOut(leftover: number, mode: BudgetCarryMode): number {
  switch (mode) {
    case 'surplus':
      return leftover > 0 ? leftover : 0;
    case 'deficit':
      return leftover < 0 ? leftover : 0;
    case 'both':
      return leftover;
    default:
      return 0;
  }
}

export interface CarryMonthInput {
  month: string;
  /** Plan amount for the month; null when the category is not budgeted that month. */
  budgeted: number | null;
  /** Spend committed against the category that month. */
  actual: number;
  /** Carry mode of the plan effective that month; decides what leaves the month. */
  carryMode: BudgetCarryMode;
  /** True when a plan effective this month carries the reset marker for the category. */
  reset?: boolean;
}

/**
 * Walks a category's months in order and returns the carry ledger. The
 * balance starts at zero, is zeroed again on a reset month or whenever the
 * category drops out of the plan, and otherwise is whatever the previous
 * month's carry mode let through.
 */
export function computeCarry(months: CarryMonthInput[]): BudgetCarryMonth[] {
  const ledger: BudgetCarryMonth[] = [];
  let balance = 0;
  let previousMonth: string | null = null;
  for (const input of months) {
    if (previousMonth != null && monthDiff(previousMonth, input.month) !== 1) {
      throw new Error(`computeCarry expects consecutive months, got ${previousMonth} then ${input.month}`);
    }
    previousMonth = input.month;

    const reset = Boolean(input.reset);
    if (reset || input.budgeted == null) balance = 0;
    const carriedIn = balance;
    const budgeted = input.budgeted ?? 0;
    const effectiveBudget = budgeted + carriedIn;
    const carriedOut = input.budgeted == null ? 0 : carryOut(effectiveBudget - input.actual, input.carryMode);

    ledger.push({
      month: input.month,
      budgeted: input.budgeted,
      actual: input.actual,
      carryMode: input.carryMode,
      carriedIn,
      effectiveBudget,
      carriedOut,
      reset,
    });
    balance = carriedOut;
  }
  return ledger;
}

export interface CarryRangeStartInput {
  /** First month of the period being reported. */
  periodStart: string;
  /** Effective month of the earliest plan, or null when no plan exists. */
  firstPlanMonth: string | null;
  /** Effective months of plans that reset every carrying category at once. */
  fullResetMonths?: string[];
  /** True when at least one plan category carries; otherwise no look-back is needed. */
  carryActive: boolean;
  maxLookbackMonths?: number;
}

/**
 * First month getBudgetStatus must load so the balance carried into the
 * period is correct: the later of the first plan month and the last full
 * reset at or before the period, never more than the cap before the period.
 */
export function resolveCarryRangeStart({
  periodStart,
  firstPlanMonth,
  fullResetMonths = [],
  carryActive,
  maxLookbackMonths = MAX_CARRY_LOOKBACK_MONTHS,
}: CarryRangeStartInput): string {
  if (!carryActive || firstPlanMonth == null || firstPlanMonth >= periodStart) return periodStart;
  let start = firstPlanMonth;
  for (const resetMonth of fullResetMonths) {
    if (resetMonth <= periodStart && resetMonth > start) start = resetMonth;
  }
  const cap = addMonths(periodStart, -maxLookbackMonths);
  return start < cap ? cap : start;
}

// ---------------------------------------------------------------------------
// Status normalizer for consumers typed against the frozen BudgetStatus
// ---------------------------------------------------------------------------

function asCarryCategory(category: BudgetCategoryStatus | BudgetCategoryCarryStatus): BudgetCategoryCarryStatus {
  const partial = category as Partial<BudgetCategoryCarryStatus>;
  const carriedIn = partial.carriedIn ?? 0;
  const fundContributions = partial.fundContributions ?? 0;
  const fundSpend = partial.fundSpend ?? 0;
  const effectiveBudget = partial.effectiveBudget ?? category.budgetedAmount + carriedIn;
  const committedSpend = partial.committedSpend ?? category.actualExpenses - fundSpend + fundContributions;
  return {
    ...category,
    carryMode: partial.carryMode ?? 'none',
    carriedIn,
    carriedOut: partial.carriedOut ?? 0,
    effectiveBudget,
    fundContributions,
    fundSpend,
    committedSpend,
    effectiveRemaining: partial.effectiveRemaining ?? effectiveBudget - committedSpend,
    carryResetMonth: partial.carryResetMonth ?? null,
  };
}

/**
 * Fills carry and fund fields with neutral defaults so a status produced by
 * an older caller still renders through the carry-aware UI.
 */
export function asCarryStatus(status: BudgetStatus | BudgetStatusWithCarry): BudgetStatusWithCarry {
  const partial = status as Partial<BudgetStatusWithCarry>;
  const categories = status.categories.map(asCarryCategory);
  const carriedInTotal = partial.carriedInTotal ?? categories.reduce((sum, category) => sum + category.carriedIn, 0);
  const fundContributionsTotal = partial.fundContributionsTotal ?? categories.reduce((sum, category) => sum + category.fundContributions, 0);
  const fundSpendTotal = partial.fundSpendTotal ?? categories.reduce((sum, category) => sum + category.fundSpend, 0);
  const effectiveBudgetTotal = partial.effectiveBudgetTotal !== undefined
    ? partial.effectiveBudgetTotal
    : status.budgetedTotal == null ? null : status.budgetedTotal + carriedInTotal;
  const effectiveRemaining = partial.effectiveRemaining !== undefined
    ? partial.effectiveRemaining
    : effectiveBudgetTotal == null ? null : effectiveBudgetTotal - (status.actualExpenses - fundSpendTotal + fundContributionsTotal);
  return {
    ...status,
    categories,
    carryRangeStart: partial.carryRangeStart ?? status.months[0],
    carriedInTotal,
    effectiveBudgetTotal,
    fundContributionsTotal,
    fundSpendTotal,
    effectiveRemaining,
  };
}

// ---------------------------------------------------------------------------
// Period status assembly (pure): what getBudgetStatus reports per category
// ---------------------------------------------------------------------------

/** `${month}:${categoryId}` keys shared by the expense, contribution and fund-spend maps. */
export const monthCategoryKey = (month: string, categoryId: number | null | undefined) =>
  `${month}:${categoryId == null ? 'uncategorized' : Number(categoryId)}`;

export interface BudgetCarryStatusInput {
  /** Months of the reported period, in order. */
  periodMonths: string[];
  /** First month loaded (at or before the period start); the ledger starts here with a zero balance. */
  rangeStart: string;
  plans: BudgetPlanWithCategories[];
  /** Raw category spend by monthCategoryKey. */
  expensesByMonthCategory: ReadonlyMap<string, number>;
  /** Linked-fund contributions by monthCategoryKey. */
  fundContributionsByMonthCategory: ReadonlyMap<string, number>;
  /** Spend paid by linked funds by monthCategoryKey. */
  fundSpendByMonthCategory: ReadonlyMap<string, number>;
}

export interface BudgetCarryStatusResult {
  categories: BudgetCategoryCarryStatus[];
  carriedInTotal: number;
  fundContributionsTotal: number;
  fundSpendTotal: number;
}

/** Plans sorted by effective month, and a lookup of the plan effective in a month. */
export function planLookup(plans: BudgetPlanWithCategories[]) {
  const sorted = [...plans].sort((a, b) => a.effective_month.localeCompare(b.effective_month));
  const planFor = (month: string): BudgetPlanWithCategories | undefined => {
    let match: BudgetPlanWithCategories | undefined;
    for (const plan of sorted) {
      if (plan.effective_month <= month) match = plan;
      else break;
    }
    return match;
  };
  return { sorted, planFor };
}

/** True when any plan row carries, so a look-back is worth loading. */
export function plansCarry(plans: BudgetPlanWithCategories[]): boolean {
  return plans.some((plan) => plan.categories.some((category) => category.carry_mode !== 'none'));
}

/** Effective months of plans whose every category row resets the carried balance. */
export function fullResetMonths(plans: BudgetPlanWithCategories[]): string[] {
  return plans
    .filter((plan) => plan.categories.length > 0 && plan.categories.every((category) => Number(category.carry_reset) === 1))
    .map((plan) => plan.effective_month);
}

/**
 * Runs the carry ledger for every category budgeted inside the period and
 * folds it into the per-category status. Spend committed against a
 * category is raw spend minus what a linked fund paid plus the fund's
 * contributions, so the category view and the fund view agree.
 */
export function buildBudgetCarryStatus(input: BudgetCarryStatusInput): BudgetCarryStatusResult {
  const { periodMonths, rangeStart, expensesByMonthCategory, fundContributionsByMonthCategory, fundSpendByMonthCategory } = input;
  if (periodMonths.length === 0) {
    return { categories: [], carriedInTotal: 0, fundContributionsTotal: 0, fundSpendTotal: 0 };
  }
  const { planFor } = planLookup(input.plans);
  const lastPeriodMonth = periodMonths[periodMonths.length - 1];
  const rangeMonths = monthRange(rangeStart < periodMonths[0] ? rangeStart : periodMonths[0], lastPeriodMonth);
  const periodSet = new Set(periodMonths);

  // Categories budgeted in any period month, in first-seen order.
  const categoryOrder: number[] = [];
  const categoryMeta = new Map<number, { name?: string; color?: string }>();
  for (const month of periodMonths) {
    for (const row of planFor(month)?.categories ?? []) {
      if (!categoryMeta.has(row.category_id)) {
        categoryOrder.push(row.category_id);
        categoryMeta.set(row.category_id, { name: row.category_name, color: row.category_color });
      }
    }
  }

  const categories: BudgetCategoryCarryStatus[] = [];
  let carriedInTotal = 0;
  let fundContributionsTotal = 0;
  let fundSpendTotal = 0;

  for (const categoryId of categoryOrder) {
    const inputs: CarryMonthInput[] = rangeMonths.map((month) => {
      const plan = planFor(month);
      const row = plan?.categories.find((category) => category.category_id === categoryId);
      const key = monthCategoryKey(month, categoryId);
      const raw = expensesByMonthCategory.get(key) ?? 0;
      const fundSpend = fundSpendByMonthCategory.get(key) ?? 0;
      const contributions = fundContributionsByMonthCategory.get(key) ?? 0;
      return {
        month,
        budgeted: row ? Number(row.amount || 0) : null,
        actual: raw - fundSpend + contributions,
        carryMode: row?.carry_mode ?? 'none',
        reset: Boolean(row && plan && plan.effective_month === month && Number(row.carry_reset) === 1),
      };
    });
    const ledger = computeCarry(inputs);

    let budgetedAmount = 0;
    let actualExpenses = 0;
    let fundContributions = 0;
    let fundSpend = 0;
    let carriedIn: number | null = null;
    let carriedOut = 0;
    let carryMode: BudgetCarryMode = 'none';
    let carryResetMonth: string | null = null;
    for (const entry of ledger) {
      if (!periodSet.has(entry.month) || entry.budgeted == null) continue;
      const key = monthCategoryKey(entry.month, categoryId);
      budgetedAmount += entry.budgeted;
      actualExpenses += expensesByMonthCategory.get(key) ?? 0;
      fundContributions += fundContributionsByMonthCategory.get(key) ?? 0;
      fundSpend += fundSpendByMonthCategory.get(key) ?? 0;
      if (carriedIn == null) carriedIn = entry.carriedIn;
      if (entry.reset && carryResetMonth == null) carryResetMonth = entry.month;
      carriedOut = entry.carriedOut;
      carryMode = entry.carryMode;
    }
    const carried = carriedIn ?? 0;
    const effectiveBudget = budgetedAmount + carried;
    const committedSpend = actualExpenses - fundSpend + fundContributions;
    const effectiveRemaining = effectiveBudget - committedSpend;
    const meta = categoryMeta.get(categoryId) ?? {};
    categories.push({
      category_id: categoryId,
      category_name: meta.name,
      category_color: meta.color,
      budgetedAmount,
      actualExpenses,
      remaining: budgetedAmount - actualExpenses,
      isOverBudget: effectiveRemaining < 0,
      carryMode,
      carriedIn: carried,
      carriedOut,
      effectiveBudget,
      fundContributions,
      fundSpend,
      committedSpend,
      effectiveRemaining,
      carryResetMonth,
    });
    carriedInTotal += carried;
    fundContributionsTotal += fundContributions;
    fundSpendTotal += fundSpend;
  }

  return { categories, carriedInTotal, fundContributionsTotal, fundSpendTotal };
}
