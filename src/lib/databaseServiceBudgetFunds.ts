import type { DatabaseWorkerTransport } from './databaseService';
import { BUDGET_FUND_QUERIES } from './sqlQueriesBudgetFunds';
import {
  buildBudgetCarryStatus,
  fullResetMonths,
  monthCategoryKey,
  monthDiff,
  monthOf,
  plansCarry,
  resolveCarryRangeStart,
  type BudgetCarryStatusInput,
  type BudgetCarryStatusResult,
} from './budgetCarry';
import type { BudgetFundLink, BudgetPlanWithCategories } from '../types/database';
import type { BudgetFundStatus } from '../types/budgetCarry';

type BudgetFundsTransport = Pick<DatabaseWorkerTransport, 'query'>;

/** Spend paid by linked funds, keyed `month:categoryId` ('uncategorized' when null). */
export type FundSpendByMonthCategory = Map<string, number>;

export const fundSpendKey = (month: string, categoryId: number | null | undefined) =>
  `${month}:${categoryId == null ? 'uncategorized' : Number(categoryId)}`;

// ---------------------------------------------------------------------------
// Pure fund math (exported for tests and for getBudgetStatus)
// ---------------------------------------------------------------------------

/** First month a fund accrues a contribution: contribution_start_month, else the month of start_date. */
export function fundStartMonth(fund: Pick<BudgetFundLink, 'contribution_start_month' | 'start_date'>): string | null {
  return monthOf(fund.contribution_start_month) ?? monthOf(fund.start_date);
}

/** Last month a fund accrues a contribution: the month of end_date, or null when open-ended. */
export function fundEndMonth(fund: Pick<BudgetFundLink, 'end_date'>): string | null {
  return monthOf(fund.end_date);
}

/** True when `month` lies inside the fund's contribution window. */
export function fundContributesIn(
  fund: Pick<BudgetFundLink, 'contribution_start_month' | 'start_date' | 'end_date' | 'monthly_contribution'>,
  month: string
): boolean {
  const start = fundStartMonth(fund);
  if (start == null || month < start) return false;
  if (!fund.monthly_contribution || fund.monthly_contribution <= 0) return false;
  const end = fundEndMonth(fund);
  return end == null || month <= end;
}

/**
 * Whole months that accrue a contribution from the fund's start through
 * `asOfMonth` (inclusive, capped at the end month). A start_date in the
 * middle of a month counts that month in full: funds work at month
 * granularity, matching the budget.
 */
export function fundMonthsContributed(
  fund: Pick<BudgetFundLink, 'contribution_start_month' | 'start_date' | 'end_date'>,
  asOfMonth: string
): number {
  const start = fundStartMonth(fund);
  if (start == null) return 0;
  const end = fundEndMonth(fund);
  const last = end != null && end < asOfMonth ? end : asOfMonth;
  return Math.max(0, monthDiff(start, last) + 1);
}

/** Monthly contribution the fund adds to its linked category in `month`, else 0. */
export function fundContributionFor(fund: BudgetFundLink, month: string): number {
  return fundContributesIn(fund, month) ? Number(fund.monthly_contribution) : 0;
}

/** Contributions of every fund by monthCategoryKey over the given months. */
export function fundContributionsByMonthCategory(funds: BudgetFundLink[], months: string[]): Map<string, number> {
  const contributions = new Map<string, number>();
  for (const fund of funds) {
    for (const month of months) {
      const amount = fundContributionFor(fund, month);
      if (amount === 0) continue;
      const key = monthCategoryKey(month, fund.budget_category_id);
      contributions.set(key, (contributions.get(key) ?? 0) + amount);
    }
  }
  return contributions;
}

export function computeFundStatus(fund: BudgetFundLink, asOfMonth: string, spent: number): BudgetFundStatus {
  const startMonth = fundStartMonth(fund);
  const endMonth = fundEndMonth(fund);
  const monthly = fund.monthly_contribution != null && fund.monthly_contribution > 0 ? Number(fund.monthly_contribution) : 0;
  const monthsContributed = monthly > 0 ? fundMonthsContributed(fund, asOfMonth) : 0;
  const contributed = roundMoney(monthly * monthsContributed);
  const balance = roundMoney(contributed - spent);
  const estimate = fund.estimated_cost != null && fund.estimated_cost > 0 ? Number(fund.estimated_cost) : null;
  const remainingToGoal = estimate == null ? null : roundMoney(estimate - contributed);
  const progress = estimate == null ? null : Math.min(1, Math.max(0, contributed / estimate));
  let monthsToGoal: number | null = null;
  if (remainingToGoal != null) {
    monthsToGoal = remainingToGoal <= 0 ? 0 : monthly > 0 ? Math.ceil(remainingToGoal / monthly) : null;
  }
  return {
    ...fund,
    asOfMonth,
    startMonth,
    endMonth,
    monthsContributed,
    contributed,
    spent: roundMoney(spent),
    balance,
    remainingToGoal,
    progress,
    monthsToGoal,
    isContributing: fundContributesIn(fund, asOfMonth),
  };
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function endOfMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber, 0));
  return `${month}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Savings funds: projects and trips linked to a budget category with a
 * monthly contribution (schema v3). Contributions accrue per calendar month
 * from the fund's start; spend linked to the entity draws the balance down.
 */
export class BudgetFundsService {
  constructor(private readonly worker: BudgetFundsTransport) {}

  /** Every project and trip that has a linked budget category, in one list. */
  async listLinkedFunds(): Promise<BudgetFundLink[]> {
    const [projectRows, tripRows] = await Promise.all([
      this.worker.query(BUDGET_FUND_QUERIES.LINKED_PROJECTS),
      this.worker.query(BUDGET_FUND_QUERIES.LINKED_TRIPS),
    ]);
    return [
      ...projectRows.map((row: any) => mapToBudgetFundLink(row, 'project')),
      ...tripRows.map((row: any) => mapToBudgetFundLink(row, 'trip')),
    ];
  }

  /** Spend attributed to one fund's entity since a month ('YYYY-MM'). Refunds net out. */
  async getSpendSince(entityType: BudgetFundLink['entity_type'], entityId: number, month: string): Promise<number> {
    const sql = entityType === 'project' ? BUDGET_FUND_QUERIES.PROJECT_SPEND_SINCE : BUDGET_FUND_QUERIES.TRIP_SPEND_SINCE;
    const rows = await this.worker.query(sql, [entityId, `${month}-01`]);
    return rows.length > 0 ? Number(rows[0].total) || 0 : 0;
  }

  /** Spend attributed to one fund's entity between two months ('YYYY-MM', inclusive). */
  async getSpendBetween(
    entityType: BudgetFundLink['entity_type'],
    entityId: number,
    fromMonth: string,
    toMonth: string
  ): Promise<number> {
    const sql = entityType === 'project' ? BUDGET_FUND_QUERIES.PROJECT_SPEND_BETWEEN : BUDGET_FUND_QUERIES.TRIP_SPEND_BETWEEN;
    const rows = await this.worker.query(sql, [entityId, `${fromMonth}-01`, endOfMonth(toMonth)]);
    return rows.length > 0 ? Number(rows[0].total) || 0 : 0;
  }

  /**
   * Spend paid by any linked fund inside a date range, by month and
   * transaction category. getBudgetStatus subtracts it from category spend.
   */
  async getFundLinkedSpendByMonthCategory(startDate: string, endDate: string): Promise<FundSpendByMonthCategory> {
    const rows = await this.worker.query(BUDGET_FUND_QUERIES.FUND_LINKED_SPEND_BY_MONTH_CATEGORY, [startDate, endDate]);
    const spend: FundSpendByMonthCategory = new Map();
    for (const row of rows) {
      spend.set(fundSpendKey(String(row.month), row.category_id), Number(row.total || 0));
    }
    return spend;
  }

  // -------------------------------------------------------------------------
  // Carry-over helpers used by getBudgetStatus. They live here (not imported
  // into databaseService.ts directly) because the budgets feature may only
  // edit the #region budget-carry block of that file, not its imports.
  // -------------------------------------------------------------------------

  /** First month getBudgetStatus must load so carried balances are right for a period starting at `periodStart`. */
  resolveCarryRangeStart(plans: BudgetPlanWithCategories[], periodStart: string): string {
    const firstPlanMonth = plans.reduce<string | null>(
      (earliest, plan) => (earliest == null || plan.effective_month < earliest ? plan.effective_month : earliest),
      null
    );
    return resolveCarryRangeStart({
      periodStart,
      firstPlanMonth,
      fullResetMonths: fullResetMonths(plans),
      carryActive: plansCarry(plans),
    });
  }

  /** Per-category carry and fund figures for a period; see buildBudgetCarryStatus. */
  computeCarryStatus(
    input: Omit<BudgetCarryStatusInput, 'fundContributionsByMonthCategory'> & { funds: BudgetFundLink[]; rangeMonths: string[] }
  ): BudgetCarryStatusResult {
    const { funds, rangeMonths, ...rest } = input;
    return buildBudgetCarryStatus({
      ...rest,
      fundContributionsByMonthCategory: fundContributionsByMonthCategory(funds, rangeMonths),
    });
  }

  /**
   * Every linked fund with its balance as of `month`:
   *   contributed      = monthly_contribution × months(start .. month)
   *   spent            = linked spend from the start month through `month`
   *   balance          = contributed − spent
   *   remainingToGoal  = estimated_cost − contributed
   */
  async getFundStatus(month: string): Promise<BudgetFundStatus[]> {
    const funds = await this.listLinkedFunds();
    return Promise.all(funds.map(async (fund) => {
      const startMonth = fundStartMonth(fund);
      const spent = startMonth == null || startMonth > month
        ? 0
        : await this.getSpendBetween(fund.entity_type, fund.entity_id, startMonth, month);
      return computeFundStatus(fund, month, spent);
    }));
  }
}

export function mapToBudgetFundLink(row: any, entityType: BudgetFundLink['entity_type']): BudgetFundLink {
  return {
    entity_type: entityType,
    entity_id: Number(row.id),
    name: String(row.name),
    status: String(row.status),
    start_date: row.start_date ?? null,
    end_date: row.end_date ?? null,
    estimated_cost: row.estimated_cost != null ? Number(row.estimated_cost) : null,
    budget_category_id: Number(row.budget_category_id),
    category_name: row.category_name ?? undefined,
    category_color: row.category_color ?? undefined,
    monthly_contribution: row.monthly_contribution != null ? Number(row.monthly_contribution) : null,
    contribution_start_month: row.contribution_start_month ?? null,
  };
}
