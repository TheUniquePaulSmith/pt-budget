import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseService, type DatabaseWorkerTransport } from './databaseService';
import {
  ACCOUNT_CARD_QUERIES,
  ACCOUNT_QUERIES,
  ANALYTICS_QUERIES,
  BUDGET_PLAN_QUERIES,
  CATEGORY_QUERIES,
  COMPANY_QUERIES,
  INCOME_SOURCE_QUERIES,
  SUBSCRIPTION_QUERIES,
  TRANSACTION_QUERIES,
  USER_QUERIES,
} from './sqlQueries';
import type { IncomeSource } from '../types/database';

type QuerySpy = ReturnType<typeof vi.fn>;

function createService(query: QuerySpy): DatabaseService {
  return new DatabaseService({ query } as unknown as DatabaseWorkerTransport);
}

/** Collects the SQL strings issued so call order can be asserted. */
function issuedSql(query: QuerySpy): string[] {
  return query.mock.calls.map((call) => String(call[0]));
}

const planRowJuly = {
  id: 1,
  effective_month: '2026-07',
  total_amount: 2500,
  notes: null,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

const planRowMarch = {
  id: 2,
  effective_month: '2026-03',
  total_amount: 2000,
  notes: 'spring plan',
  created_at: '2026-03-01T00:00:00.000Z',
  updated_at: '2026-03-01T00:00:00.000Z',
};

const planCategoryRows = [
  {
    id: 11,
    plan_id: 1,
    category_id: 4,
    amount: 400,
    category_name: 'Groceries',
    category_color: '#4caf50',
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
  },
  {
    id: 12,
    plan_id: 2,
    category_id: 6,
    amount: 150,
    category_name: 'Dining Out',
    category_color: '#ff5722',
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
  },
];

const salaryInput: Omit<IncomeSource, 'id' | 'created_at' | 'updated_at' | 'account_name'> = {
  name: 'Payroll',
  kind: 'recurring_salary',
  user_id: 1,
  account_id: null,
  amount: 2400,
  frequency: 'monthly',
  start_date: '2026-01-01',
  end_date: null,
  is_active: 1,
  notes: null,
};

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('DatabaseService budget plans', () => {
  it('stitches plans with their category thresholds', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === BUDGET_PLAN_QUERIES.GET_ALL_PLANS) return [planRowJuly, planRowMarch];
      if (sql === BUDGET_PLAN_QUERIES.GET_ALL_PLAN_CATEGORIES) return planCategoryRows;
      throw new Error(`Unexpected query: ${sql}`);
    });
    const service = createService(query);

    const plans = await service.getBudgetPlans();

    expect(plans).toHaveLength(2);
    const july = plans.find((plan) => plan.effective_month === '2026-07');
    const march = plans.find((plan) => plan.effective_month === '2026-03');
    expect(july?.categories).toEqual([
      expect.objectContaining({ category_id: 4, amount: 400, category_name: 'Groceries' }),
    ]);
    expect(march?.categories).toEqual([
      expect.objectContaining({ category_id: 6, amount: 150 }),
    ]);
  });

  it('saves a plan inside a transaction, replacing its category rows', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === BUDGET_PLAN_QUERIES.UPSERT_PLAN) return [{ id: 9 }];
      return [];
    });
    const service = createService(query);

    const planId = await service.saveBudgetPlan({
      effectiveMonth: '2026-08',
      totalAmount: 3000,
      notes: 'raise month',
      categories: [
        { category_id: 4, amount: 500 },
        { category_id: 6, amount: 200 },
      ],
    });

    expect(planId).toBe(9);
    const sql = issuedSql(query);
    expect(sql[0]).toBe('BEGIN TRANSACTION');
    expect(sql[sql.length - 1]).toBe('COMMIT');
    expect(query).toHaveBeenCalledWith(BUDGET_PLAN_QUERIES.UPSERT_PLAN, ['2026-08', 3000, 'raise month']);
    expect(query).toHaveBeenCalledWith(BUDGET_PLAN_QUERIES.DELETE_PLAN_CATEGORIES, [9]);
    expect(query).toHaveBeenCalledWith(BUDGET_PLAN_QUERIES.INSERT_PLAN_CATEGORY, [9, 4, 500]);
    expect(query).toHaveBeenCalledWith(BUDGET_PLAN_QUERIES.INSERT_PLAN_CATEGORY, [9, 6, 200]);
    expect(sql).not.toContain('ROLLBACK');
  });

  it('rolls back when a category insert fails mid-save', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === BUDGET_PLAN_QUERIES.UPSERT_PLAN) return [{ id: 9 }];
      if (sql === BUDGET_PLAN_QUERIES.INSERT_PLAN_CATEGORY) throw new Error('insert failed');
      return [];
    });
    const service = createService(query);

    await expect(
      service.saveBudgetPlan({
        effectiveMonth: '2026-08',
        totalAmount: null,
        categories: [{ category_id: 4, amount: 500 }],
      })
    ).rejects.toThrow('insert failed');

    const sql = issuedSql(query);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
  });

  it('deletes a plan by id', async () => {
    const query = vi.fn(async () => []);
    const service = createService(query);

    await service.deleteBudgetPlan(9);

    expect(query).toHaveBeenCalledWith(BUDGET_PLAN_QUERIES.DELETE_PLAN, [9]);
  });

  it('resolves the carry-forward plan for a month and returns only its categories', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === BUDGET_PLAN_QUERIES.GET_EFFECTIVE_PLAN_FOR_MONTH) return [planRowMarch];
      if (sql === BUDGET_PLAN_QUERIES.GET_ALL_PLAN_CATEGORIES) return planCategoryRows;
      throw new Error(`Unexpected query: ${sql}`);
    });
    const service = createService(query);

    const plan = await service.getEffectiveBudgetPlan('2026-05');

    expect(query).toHaveBeenCalledWith(BUDGET_PLAN_QUERIES.GET_EFFECTIVE_PLAN_FOR_MONTH, ['2026-05']);
    expect(plan?.effective_month).toBe('2026-03');
    expect(plan?.categories).toEqual([
      expect.objectContaining({ category_id: 6, amount: 150 }),
    ]);
  });

  it('returns null for months before the first plan without loading categories', async () => {
    const query = vi.fn(async () => []);
    const service = createService(query);

    const plan = await service.getEffectiveBudgetPlan('2025-01');

    expect(plan).toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});

describe('DatabaseService budget status expected income', () => {
  function statusQueryStub(incomeSourceRows: any[]): QuerySpy {
    return vi.fn(async (sql: string) => {
      if (sql === INCOME_SOURCE_QUERIES.GET_ALL) return incomeSourceRows;
      return [];
    });
  }

  it('normalizes semi-monthly salaries to two occurrences per month', async () => {
    const query = statusQueryStub([
      {
        id: 1,
        name: 'Payroll',
        kind: 'recurring_salary',
        user_id: null,
        account_id: null,
        amount: 1000,
        frequency: 'semi_monthly',
        start_date: '2026-01-01',
        end_date: null,
        is_active: 1,
        notes: null,
        account_name: null,
      },
    ]);
    const service = createService(query);

    const status = await service.getBudgetStatus({ type: 'month', key: '2026-07' });

    expect(status.expectedIncome).toBe(2000);
    expect(status.budgetedTotal).toBeNull();
    expect(status.monthsWithPlan).toEqual([]);
  });

  it('windows expected income by the source start and end dates', async () => {
    const query = statusQueryStub([
      {
        id: 1,
        name: 'Old job',
        kind: 'recurring_salary',
        user_id: null,
        account_id: null,
        amount: 3000,
        frequency: 'monthly',
        start_date: '2025-01-01',
        end_date: '2026-06-30',
        is_active: 1,
        notes: null,
        account_name: null,
      },
    ]);
    const service = createService(query);

    const status = await service.getBudgetStatus({ type: 'month', key: '2026-07' });

    expect(status.expectedIncome).toBe(0);
  });
});

describe('DatabaseService income sources', () => {
  it('maps income source rows including the joined account name', async () => {
    const query = vi.fn(async () => [
      {
        id: 5,
        name: 'Household deposits',
        kind: 'linked_account',
        user_id: 2,
        account_id: 1,
        amount: null,
        frequency: null,
        start_date: null,
        end_date: null,
        is_active: 1,
        notes: null,
        account_name: 'Household Checking',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
      },
    ]);
    const service = createService(query);

    const sources = await service.getIncomeSources();

    expect(query).toHaveBeenCalledWith(INCOME_SOURCE_QUERIES.GET_ALL);
    expect(sources).toEqual([
      expect.objectContaining({
        id: 5,
        kind: 'linked_account',
        account_id: 1,
        account_name: 'Household Checking',
        is_active: 1,
      }),
    ]);
  });

  it('creates a recurring salary source and returns the new id', async () => {
    const query = vi.fn(async () => [{ id: 21 }]);
    const service = createService(query);

    const id = await service.addIncomeSource(salaryInput);

    expect(id).toBe(21);
    expect(query).toHaveBeenCalledWith(INCOME_SOURCE_QUERIES.CREATE, [
      'Payroll',
      'recurring_salary',
      1,
      null,
      2400,
      'monthly',
      '2026-01-01',
      null,
      1,
      null,
    ]);
  });

  it('rejects a linked-account source without an account before querying', async () => {
    const query = vi.fn();
    const service = createService(query);

    await expect(
      service.addIncomeSource({ ...salaryInput, kind: 'linked_account', account_id: null })
    ).rejects.toThrow('Linked account income sources require an account');
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a recurring salary without an amount or frequency', async () => {
    const query = vi.fn();
    const service = createService(query);

    await expect(
      service.updateIncomeSource(5, { ...salaryInput, amount: null })
    ).rejects.toThrow('Recurring salary income sources require an amount and frequency');
    await expect(
      service.updateIncomeSource(5, { ...salaryInput, frequency: null })
    ).rejects.toThrow('Recurring salary income sources require an amount and frequency');
    expect(query).not.toHaveBeenCalled();
  });

  it('updates and deletes income sources through the worker transport', async () => {
    const query = vi.fn(async () => []);
    const service = createService(query);

    await service.updateIncomeSource(5, salaryInput);
    await service.deleteIncomeSource(5);

    expect(query).toHaveBeenCalledWith(INCOME_SOURCE_QUERIES.UPDATE, [
      'Payroll',
      'recurring_salary',
      1,
      null,
      2400,
      'monthly',
      '2026-01-01',
      null,
      1,
      null,
      5,
    ]);
    expect(query).toHaveBeenCalledWith(INCOME_SOURCE_QUERIES.DELETE, [5]);
  });
});

describe('DatabaseService primary user', () => {
  it('creates the primary user when none exists', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === USER_QUERIES.GET_PRIMARY) return [];
      if (sql === USER_QUERIES.CREATE) return [{ id: 1 }];
      return [];
    });
    const service = createService(query);

    const id = await service.ensurePrimaryUser('Paul');

    expect(id).toBe(1);
    expect(query).toHaveBeenCalledWith(USER_QUERIES.CREATE, ['Paul', 1]);
    const sql = issuedSql(query);
    expect(sql[0]).toBe('BEGIN TRANSACTION');
    expect(sql[sql.length - 1]).toBe('COMMIT');
  });

  it('renames the existing primary user instead of creating a second one', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === USER_QUERIES.GET_PRIMARY) return [{ id: 3, display_name: 'Avery Parker', is_primary: 1 }];
      return [];
    });
    const service = createService(query);

    const id = await service.ensurePrimaryUser('Paul');

    expect(id).toBe(3);
    expect(query).toHaveBeenCalledWith(USER_QUERIES.RENAME_PRIMARY, ['Paul']);
    expect(issuedSql(query)).not.toContain(USER_QUERIES.CREATE);
  });

  it('falls back to a default name when given blank input', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === USER_QUERIES.GET_PRIMARY) return [];
      if (sql === USER_QUERIES.CREATE) return [{ id: 1 }];
      return [];
    });
    const service = createService(query);

    await service.ensurePrimaryUser('   ');

    expect(query).toHaveBeenCalledWith(USER_QUERIES.CREATE, ['Primary User', 1]);
  });

  it('refuses to delete the primary user', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === USER_QUERIES.GET_BY_ID) return [{ id: 3, display_name: 'Paul', is_primary: 1 }];
      return [];
    });
    const service = createService(query);

    await expect(service.deleteUser(3)).rejects.toThrow('The primary user cannot be deleted');
    expect(issuedSql(query)).not.toContain(USER_QUERIES.DELETE);
  });

  it('deletes non-primary users normally', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === USER_QUERIES.GET_BY_ID) return [{ id: 4, display_name: 'Guest', is_primary: 0 }];
      return [];
    });
    const service = createService(query);

    await service.deleteUser(4);

    expect(query).toHaveBeenCalledWith(USER_QUERIES.DELETE, [4]);
  });
});

describe('DatabaseService account and card invariants', () => {
  it('creates an account with its first card atomically', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === ACCOUNT_QUERIES.CREATE) return [{ id: 10 }];
      if (sql === ACCOUNT_CARD_QUERIES.CREATE) return [{ id: 20 }];
      return [];
    });
    const service = createService(query);

    const result = await service.addAccountWithCard(
      { name: 'Everyday Checking', type: 'checking' },
      7,
      { last_four: '4242', nickname: 'Debit', user_id: 7 }
    );

    expect(result).toEqual({ accountId: 10, cardId: 20 });
    expect(query).toHaveBeenCalledWith(ACCOUNT_QUERIES.CREATE, ['Everyday Checking', 'checking', 'individual', 7, null, 0, null, null, 1]);
    expect(query).toHaveBeenCalledWith(ACCOUNT_CARD_QUERIES.CREATE, [10, '4242', null, 'Debit', 7]);
    const sql = issuedSql(query);
    expect(sql[0]).toBe('BEGIN TRANSACTION');
    expect(sql[sql.length - 1]).toBe('COMMIT');
  });

  it('rolls back and reports a friendly duplicate-card error', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === ACCOUNT_QUERIES.CREATE) return [{ id: 10 }];
      if (sql === ACCOUNT_CARD_QUERIES.CREATE) {
        throw new Error('UNIQUE constraint failed: account_cards.account_id, account_cards.last_four');
      }
      return [];
    });
    const service = createService(query);

    await expect(
      service.addAccountWithCard(
        { name: 'Everyday Checking', type: 'checking' },
        7,
        { last_four: '4242', nickname: null, user_id: null }
      )
    ).rejects.toThrow('This account already has a card with that last four.');
    expect(issuedSql(query)).toContain('ROLLBACK');
  });

  it("blocks deleting an account's last card", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT account_id FROM account_cards')) return [{ account_id: 3 }];
      if (sql.includes('SELECT COUNT(*) as count FROM account_cards')) return [{ count: 1 }];
      return [];
    });
    const service = createService(query);

    await expect(service.deleteAccountCard(22)).rejects.toThrow(
      'An account must keep at least one card'
    );
    const sql = issuedSql(query);
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain(ACCOUNT_CARD_QUERIES.DELETE);
  });

  it('deletes a card when the account keeps at least one other card', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT account_id FROM account_cards')) return [{ account_id: 3 }];
      if (sql.includes('SELECT COUNT(*) as count FROM account_cards')) return [{ count: 2 }];
      return [];
    });
    const service = createService(query);

    await service.deleteAccountCard(22);

    expect(query).toHaveBeenCalledWith(ACCOUNT_CARD_QUERIES.DELETE, [22]);
    expect(issuedSql(query)).toContain('COMMIT');
  });
});

describe('DatabaseService transaction quick-apply', () => {
  it('rejects a category whose type does not match the transaction', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT type FROM transactions')) return [{ type: 'expense' }];
      if (sql === CATEGORY_QUERIES.GET_BY_ID) return [{ id: 11, type: 'income' }];
      return [];
    });
    const service = createService(query);

    await expect(service.setTransactionCategory(31, 11)).rejects.toThrow(
      'Category type income does not match transaction type expense'
    );
    expect(issuedSql(query)).not.toContain(TRANSACTION_QUERIES.SET_CATEGORY);
  });

  it('applies a matching category', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT type FROM transactions')) return [{ type: 'expense' }];
      if (sql === CATEGORY_QUERIES.GET_BY_ID) return [{ id: 4, type: 'expense' }];
      return [];
    });
    const service = createService(query);

    await service.setTransactionCategory(31, 4);

    expect(query).toHaveBeenCalledWith(TRANSACTION_QUERIES.SET_CATEGORY, [4, 31]);
  });

  it('clears a category without validation reads', async () => {
    const query = vi.fn(async () => []);
    const service = createService(query);

    await service.setTransactionCategory(31, null);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(TRANSACTION_QUERIES.SET_CATEGORY, [null, 31]);
  });

  it('find-or-creates a company by name when assigning it', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === COMPANY_QUERIES.FIND_BY_NAME) return [];
      if (sql === COMPANY_QUERIES.CREATE) return [{ id: 55 }];
      return [];
    });
    const service = createService(query);

    await service.setTransactionCompany(31, { companyName: ' Fresh Market ' });

    expect(query).toHaveBeenCalledWith(COMPANY_QUERIES.FIND_BY_NAME, ['Fresh Market']);
    expect(query).toHaveBeenCalledWith(TRANSACTION_QUERIES.SET_COMPANY, [55, 31]);
  });

  it('assigns an existing company id directly and clears with null', async () => {
    const query = vi.fn(async () => []);
    const service = createService(query);

    await service.setTransactionCompany(31, { companyId: 12 });
    await service.setTransactionCompany(31, { companyId: null });

    expect(query).toHaveBeenNthCalledWith(1, TRANSACTION_QUERIES.SET_COMPANY, [12, 31]);
    expect(query).toHaveBeenNthCalledWith(2, TRANSACTION_QUERIES.SET_COMPANY, [null, 31]);
  });

  it('links and unlinks a transaction to a recurring series', async () => {
    const query = vi.fn(async () => []);
    const service = createService(query);

    await service.linkTransactionToSeries(31, 6);
    await service.unlinkTransactionFromSeries(31);

    expect(query).toHaveBeenCalledWith(SUBSCRIPTION_QUERIES.LINK_TRANSACTION_MANUAL, [31, 6]);
    expect(query).toHaveBeenCalledWith(SUBSCRIPTION_QUERIES.DELETE_LINK_FOR_TRANSACTION, [31]);
  });

  it('renames a company', async () => {
    const query = vi.fn(async () => []);
    const service = createService(query);

    await service.updateCompany(12, 'Acme Holdings');

    expect(query).toHaveBeenCalledWith(COMPANY_QUERIES.UPDATE, ['Acme Holdings', 12]);
  });
});

describe('DatabaseService scope filters', () => {
  it('fetches recent transactions without a WHERE clause when unfiltered', async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => [] as any[]);
    const service = createService(query);

    await service.getRecentTransactions(10);

    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).not.toContain('WHERE');
    expect(params).toEqual([10]);
  });

  it('filters recent transactions by account and effective user', async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => [] as any[]);
    const service = createService(query);

    await service.getRecentTransactions(25, { accountIds: [3], userIds: [7, 8] });

    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('t.account_id IN (?)');
    expect(String(sql)).toContain('COALESCE(card.user_id, a.owner_user_id) IN (?,?)');
    expect(params).toEqual([3, 7, 8, 25]);
  });

  it('substitutes analytics filter markers in the dashboard summary query', async () => {
    expect(ANALYTICS_QUERIES.DASHBOARD_SUMMARY).toContain('/*__FILTERS__*/');

    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (sql === INCOME_SOURCE_QUERIES.GET_ALL) return [];
      return [{ total_income: 500, total_expenses: 200, transaction_count: 5 }];
    });
    const service = createService(query);

    const summary = await service.getDashboardSummary('2026-07-01', '2026-07-31', {
      accountIds: [3],
      userIds: [7],
    });

    const dashboardCall = query.mock.calls.find(
      (call) => String(call[0]) !== INCOME_SOURCE_QUERIES.GET_ALL
    );
    expect(dashboardCall).toBeDefined();
    const [sql, params] = dashboardCall!;
    expect(String(sql)).not.toContain('/*__FILTERS__*/');
    expect(String(sql)).not.toContain('/*__FILTER_JOINS__*/');
    expect(String(sql)).toContain('LEFT JOIN account_cards card ON t.card_id = card.id');
    expect(String(sql)).toContain('COALESCE(card.user_id, a.owner_user_id) IN (?)');
    expect(params).toEqual(['2026-07-01', '2026-07-31', 3, 7]);
    expect(summary.totalExpenses).toBe(200);
    expect(summary.transactionCount).toBe(5);
  });

  it('threads user filters into the export query', async () => {
    const query = vi.fn(async (_sql: string, _params?: unknown[]) => [] as any[]);
    const service = createService(query);

    await service.getTransactionsForExport({
      sortBy: 'date',
      sortOrder: 'desc',
      userIds: [7],
    });

    const [sql, params] = query.mock.calls[0];
    expect(String(sql)).toContain('COALESCE(card.user_id, a.owner_user_id) IN (?)');
    expect(params).toContain(7);
  });

  it('counts semi-monthly salary occurrences across a dashboard date range', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === INCOME_SOURCE_QUERIES.GET_ALL) {
        return [
          {
            id: 1,
            name: 'Payroll',
            kind: 'recurring_salary',
            user_id: null,
            account_id: null,
            amount: 1000,
            frequency: 'semi_monthly',
            start_date: '2026-01-01',
            end_date: null,
            is_active: 1,
            notes: null,
            account_name: null,
          },
        ];
      }
      return [{ total_income: 0, total_expenses: 200, transaction_count: 5 }];
    });
    const service = createService(query);

    const summary = await service.getDashboardSummary('2026-07-01', '2026-07-31');

    // Occurrences land on the 1st and the 16th → 2 × 1000
    expect(summary.totalIncome).toBe(2000);
  });
});

describe('DatabaseService delegate wrappers', () => {
  it('delegates database create/unlock/lock to the worker transport', async () => {
    const transport = {
      initialize: vi.fn().mockResolvedValue(undefined),
      createNewDatabase: vi.fn().mockResolvedValue(undefined),
      unlockDatabase: vi.fn().mockResolvedValue(undefined),
      lockDatabase: vi.fn().mockResolvedValue(undefined),
      isEncryptionReady: vi.fn().mockResolvedValue(true),
    } as unknown as DatabaseWorkerTransport;
    const service = new DatabaseService(transport);

    await service.createNewDatabase('hunter22!', { deferIndexes: true });
    await service.unlockDatabase('hunter22!');
    await service.lockDatabase();

    expect(transport.createNewDatabase).toHaveBeenCalledWith('hunter22!', undefined, { deferIndexes: true });
    expect(transport.unlockDatabase).toHaveBeenCalledWith('hunter22!');
    expect(transport.lockDatabase).toHaveBeenCalled();
    await expect(service.isEncryptionReady()).resolves.toBe(true);
  });

  it('reports encryption as not ready when the worker check fails', async () => {
    const transport = {
      isEncryptionReady: vi.fn().mockRejectedValue(new Error('worker gone')),
    } as unknown as DatabaseWorkerTransport;
    const service = new DatabaseService(transport);

    await expect(service.isEncryptionReady()).resolves.toBe(false);
  });

  it('returns null for archive timestamps of non-encrypted bytes', () => {
    const service = createService(vi.fn());

    expect(service.getEncryptedArchiveTimestamp(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it('exposes the injected worker transport', () => {
    const query = vi.fn();
    const service = createService(query);

    expect(service.getWorkerService()).toMatchObject({ query });
  });

  it('runs custom queries with a timeout through the worker transport', async () => {
    const transport = {
      queryWithTimeout: vi.fn().mockResolvedValue([{ answer: 42 }]),
    } as unknown as DatabaseWorkerTransport;
    const service = new DatabaseService(transport);

    const rows = await service.executeCustomQueryWithTimeout('SELECT 42 AS answer', 5000);

    expect(transport.queryWithTimeout).toHaveBeenCalledWith('SELECT 42 AS answer', [], 5000);
    expect(rows).toEqual([{ answer: 42 }]);
  });

  it('maps project cost rollups to numbers', async () => {
    const query = vi.fn(async () => [
      { project_id: 9, estimated: '5000', actual: null, transactions_total: '123.45' },
    ]);
    const service = createService(query);

    const costs = await service.getAllProjectCosts();

    expect(costs).toEqual([
      { project_id: 9, estimated: 5000, actual: 0, transactions_total: 123.45 },
    ]);
  });

  it('pages project-linked transactions with a total count', async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (String(sql).includes('COUNT')) return [{ total: 12 }];
      return [];
    });
    const service = createService(query);

    const result = await service.getTransactionsByProjectPaginated(9, 2, 5);

    expect(result.total).toBe(12);
    const dataCall = query.mock.calls.find((call) => !String(call[0]).includes('COUNT'));
    expect(dataCall?.[1]).toEqual([9, 5, 10]);
  });

  it('pages trip-linked transactions with a total count', async () => {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
      if (String(sql).includes('COUNT')) return [{ total: 3 }];
      return [];
    });
    const service = createService(query);

    const result = await service.getTransactionsByTripPaginated(12, 0, 25);

    expect(result.total).toBe(3);
    const dataCall = query.mock.calls.find((call) => !String(call[0]).includes('COUNT'));
    expect(dataCall?.[1]).toEqual([12, 25, 0]);
  });
});
