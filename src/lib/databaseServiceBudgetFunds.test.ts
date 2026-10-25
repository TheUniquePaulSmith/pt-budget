import { describe, expect, it, vi } from 'vitest';

import { DatabaseService, type DatabaseWorkerTransport } from './databaseService';
import {
  BudgetFundsService,
  computeFundStatus,
  fundContributesIn,
  fundContributionFor,
  fundContributionsByMonthCategory,
  fundEndMonth,
  fundMonthsContributed,
  fundStartMonth,
  mapToBudgetFundLink,
} from './databaseServiceBudgetFunds';
import { BUDGET_FUND_QUERIES } from './sqlQueriesBudgetFunds';

const projectRow = {
  id: 3,
  name: 'Kitchen remodel',
  status: 'planning',
  start_date: '2026-09-01',
  end_date: null,
  estimated_cost: '12000',
  budget_category_id: 8,
  monthly_contribution: '500',
  contribution_start_month: '2026-06',
  category_name: 'Home',
  category_color: '#123456',
};

const tripRow = {
  id: 5,
  name: 'Japan 2027',
  status: 'planning',
  start_date: null,
  end_date: null,
  estimated_cost: null,
  budget_category_id: 9,
  monthly_contribution: 250,
  contribution_start_month: null,
  category_name: 'Travel',
  category_color: '#abcdef',
};

function createQuerySpy(rowsBySql: Record<string, unknown[]> = {}) {
  return vi.fn(async (sql: string) => rowsBySql[sql] ?? []);
}

describe('BudgetFundsService', () => {
  it('lists linked projects and trips as one fund list', async () => {
    const query = createQuerySpy({
      [BUDGET_FUND_QUERIES.LINKED_PROJECTS]: [projectRow],
      [BUDGET_FUND_QUERIES.LINKED_TRIPS]: [tripRow],
    });
    const service = new BudgetFundsService({ query });

    const funds = await service.listLinkedFunds();

    expect(funds).toEqual([
      {
        entity_type: 'project',
        entity_id: 3,
        name: 'Kitchen remodel',
        status: 'planning',
        start_date: '2026-09-01',
        end_date: null,
        estimated_cost: 12000,
        budget_category_id: 8,
        category_name: 'Home',
        category_color: '#123456',
        monthly_contribution: 500,
        contribution_start_month: '2026-06',
      },
      {
        entity_type: 'trip',
        entity_id: 5,
        name: 'Japan 2027',
        status: 'planning',
        start_date: null,
        end_date: null,
        estimated_cost: null,
        budget_category_id: 9,
        category_name: 'Travel',
        category_color: '#abcdef',
        monthly_contribution: 250,
        contribution_start_month: null,
      },
    ]);
  });

  it('reads spend since a month for either entity type, defaulting to zero', async () => {
    const query = createQuerySpy({
      [BUDGET_FUND_QUERIES.PROJECT_SPEND_SINCE]: [{ total: '340.5' }],
      [BUDGET_FUND_QUERIES.TRIP_SPEND_SINCE]: [],
    });
    const service = new BudgetFundsService({ query });

    await expect(service.getSpendSince('project', 3, '2026-06')).resolves.toBe(340.5);
    expect(query).toHaveBeenCalledWith(BUDGET_FUND_QUERIES.PROJECT_SPEND_SINCE, [3, '2026-06-01']);

    await expect(service.getSpendSince('trip', 5, '2026-01')).resolves.toBe(0);
    expect(query).toHaveBeenCalledWith(BUDGET_FUND_QUERIES.TRIP_SPEND_SINCE, [5, '2026-01-01']);
  });

  it('never aggregates with ABS(amount)', () => {
    expect(BUDGET_FUND_QUERIES.PROJECT_SPEND_SINCE).not.toMatch(/ABS\(/i);
    expect(BUDGET_FUND_QUERIES.TRIP_SPEND_SINCE).not.toMatch(/ABS\(/i);
  });

  it('is composed into DatabaseService', async () => {
    const query = createQuerySpy();
    const service = new DatabaseService({ query } as unknown as DatabaseWorkerTransport);

    await expect(service.budgetFunds.listLinkedFunds()).resolves.toEqual([]);
  });
});

describe('fund math', () => {
  it('derives the start month from contribution_start_month, else the start_date month', () => {
    expect(fundStartMonth({ contribution_start_month: '2026-06', start_date: '2026-09-01' })).toBe('2026-06');
    expect(fundStartMonth({ contribution_start_month: null, start_date: '2026-09-15' })).toBe('2026-09');
    expect(fundStartMonth({ contribution_start_month: null, start_date: null })).toBeNull();
    expect(fundEndMonth({ end_date: '2027-03-20' })).toBe('2027-03');
    expect(fundEndMonth({ end_date: null })).toBeNull();
  });

  it('counts whole months inclusively, treating a mid-month start as a full month', () => {
    const fund = { contribution_start_month: null, start_date: '2026-06-15', end_date: null };
    expect(fundMonthsContributed(fund, '2026-06')).toBe(1);
    expect(fundMonthsContributed(fund, '2026-08')).toBe(3);
    expect(fundMonthsContributed(fund, '2026-05')).toBe(0);
    expect(fundMonthsContributed({ ...fund, end_date: '2026-07-10' }, '2026-12')).toBe(2);
    expect(fundMonthsContributed({ contribution_start_month: null, start_date: null, end_date: null }, '2026-12')).toBe(0);
  });

  it('contributes only inside the window and only with a positive monthly amount', () => {
    const base = mapToBudgetFundLink(projectRow, 'project');
    expect(fundContributesIn(base, '2026-05')).toBe(false);
    expect(fundContributesIn(base, '2026-06')).toBe(true);
    expect(fundContributesIn({ ...base, end_date: '2026-08-31' }, '2026-09')).toBe(false);
    expect(fundContributesIn({ ...base, monthly_contribution: 0 }, '2026-07')).toBe(false);
    expect(fundContributesIn({ ...base, monthly_contribution: null }, '2026-07')).toBe(false);
    expect(fundContributionFor(base, '2026-07')).toBe(500);
    expect(fundContributionFor(base, '2026-01')).toBe(0);
  });

  it('computes contributed, balance, goal remainder and months to goal', () => {
    const fund = mapToBudgetFundLink(projectRow, 'project'); // 500/month from 2026-06, goal 12000

    const status = computeFundStatus(fund, '2026-09', 340.5);

    expect(status).toMatchObject({
      asOfMonth: '2026-09',
      startMonth: '2026-06',
      endMonth: null,
      monthsContributed: 4,
      contributed: 2000,
      spent: 340.5,
      balance: 1659.5,
      remainingToGoal: 10000,
      monthsToGoal: 20,
      isContributing: true,
    });
    expect(status.progress).toBeCloseTo(2000 / 12000, 6);
  });

  it('handles a partial-cent monthly amount, a reached goal and a fund without an estimate', () => {
    const partial = mapToBudgetFundLink({ ...projectRow, monthly_contribution: '33.33', estimated_cost: '100' }, 'project');
    const reached = computeFundStatus(partial, '2026-09', 0);
    expect(reached.contributed).toBe(133.32);
    expect(reached.remainingToGoal).toBe(-33.32);
    expect(reached.monthsToGoal).toBe(0);
    expect(reached.progress).toBe(1);

    const noGoal = computeFundStatus(mapToBudgetFundLink(tripRow, 'trip'), '2026-09', 80);
    expect(noGoal.startMonth).toBeNull();
    expect(noGoal.monthsContributed).toBe(0);
    expect(noGoal.contributed).toBe(0);
    expect(noGoal.balance).toBe(-80);
    expect(noGoal.remainingToGoal).toBeNull();
    expect(noGoal.progress).toBeNull();
    expect(noGoal.monthsToGoal).toBeNull();
    expect(noGoal.isContributing).toBe(false);

    const noContribution = computeFundStatus({ ...partial, monthly_contribution: null }, '2026-09', 0);
    expect(noContribution.contributed).toBe(0);
    expect(noContribution.monthsToGoal).toBeNull();
  });

  it('sums contributions by month and linked category across funds', () => {
    const funds = [
      mapToBudgetFundLink(projectRow, 'project'), // 500/month from 2026-06 into category 8
      mapToBudgetFundLink({ ...tripRow, budget_category_id: 8, contribution_start_month: '2026-07' }, 'trip'), // 250/month
      mapToBudgetFundLink({ ...tripRow, id: 6, budget_category_id: 9, contribution_start_month: '2026-07' }, 'trip'),
    ];
    const contributions = fundContributionsByMonthCategory(funds, ['2026-05', '2026-06', '2026-07']);
    expect(Array.from(contributions.entries())).toEqual([
      ['2026-06:8', 500],
      ['2026-07:8', 750],
      ['2026-07:9', 250],
    ]);
  });
});

describe('BudgetFundsService.getFundStatus', () => {
  it('reads linked spend between the start month and the as-of month for every fund', async () => {
    const query = createQuerySpy({
      [BUDGET_FUND_QUERIES.LINKED_PROJECTS]: [projectRow],
      [BUDGET_FUND_QUERIES.LINKED_TRIPS]: [{ ...tripRow, contribution_start_month: '2026-08' }],
      [BUDGET_FUND_QUERIES.PROJECT_SPEND_BETWEEN]: [{ total: '1200' }],
      [BUDGET_FUND_QUERIES.TRIP_SPEND_BETWEEN]: [{ total: 100 }],
    });
    const service = new BudgetFundsService({ query });

    const statuses = await service.getFundStatus('2026-09');

    expect(query).toHaveBeenCalledWith(BUDGET_FUND_QUERIES.PROJECT_SPEND_BETWEEN, [3, '2026-06-01', '2026-09-30']);
    expect(query).toHaveBeenCalledWith(BUDGET_FUND_QUERIES.TRIP_SPEND_BETWEEN, [5, '2026-08-01', '2026-09-30']);
    expect(statuses.map((s) => [s.entity_type, s.contributed, s.spent, s.balance])).toEqual([
      ['project', 2000, 1200, 800],
      ['trip', 500, 100, 400],
    ]);
  });

  it('skips the spend query for a fund that has not started or has no start', async () => {
    const query = createQuerySpy({
      [BUDGET_FUND_QUERIES.LINKED_PROJECTS]: [{ ...projectRow, contribution_start_month: '2027-01' }],
      [BUDGET_FUND_QUERIES.LINKED_TRIPS]: [tripRow],
    });
    const service = new BudgetFundsService({ query });

    const statuses = await service.getFundStatus('2026-09');

    expect(statuses.map((s) => [s.contributed, s.spent, s.balance])).toEqual([[0, 0, 0], [0, 0, 0]]);
    expect(query).not.toHaveBeenCalledWith(BUDGET_FUND_QUERIES.PROJECT_SPEND_BETWEEN, expect.anything());
    expect(query).not.toHaveBeenCalledWith(BUDGET_FUND_QUERIES.TRIP_SPEND_BETWEEN, expect.anything());
  });

  it('maps fund-linked spend rows into month:category keys', async () => {
    const query = createQuerySpy({
      [BUDGET_FUND_QUERIES.FUND_LINKED_SPEND_BY_MONTH_CATEGORY]: [
        { month: '2026-07', category_id: 9, total: '120.5' },
        { month: '2026-07', category_id: null, total: 10 },
      ],
    });
    const service = new BudgetFundsService({ query });

    const spend = await service.getFundLinkedSpendByMonthCategory('2026-07-01', '2026-07-31');

    expect(query).toHaveBeenCalledWith(BUDGET_FUND_QUERIES.FUND_LINKED_SPEND_BY_MONTH_CATEGORY, ['2026-07-01', '2026-07-31']);
    expect(Array.from(spend.entries())).toEqual([
      ['2026-07:9', 120.5],
      ['2026-07:uncategorized', 10],
    ]);
  });

  it('keeps every spend query free of ABS(amount) and scoped to spending rows', () => {
    for (const sql of [
      BUDGET_FUND_QUERIES.PROJECT_SPEND_BETWEEN,
      BUDGET_FUND_QUERIES.TRIP_SPEND_BETWEEN,
      BUDGET_FUND_QUERIES.FUND_LINKED_SPEND_BY_MONTH_CATEGORY,
    ]) {
      expect(sql).not.toMatch(/ABS\(/i);
      expect(sql).toContain("t.type IN ('expense', 'refund') AND t.is_excluded = 0");
    }
  });
});
