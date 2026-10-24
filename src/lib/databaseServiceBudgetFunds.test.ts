import { describe, expect, it, vi } from 'vitest';

import { DatabaseService, type DatabaseWorkerTransport } from './databaseService';
import { BudgetFundsService } from './databaseServiceBudgetFunds';
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
