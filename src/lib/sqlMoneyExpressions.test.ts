import { describe, expect, it } from 'vitest';

import { DEFAULT_CURRENCY_KEY, DEFAULT_CURRENCY_SQL, incomeExpr, rateExpr, spendExpr, spendingRowsPredicate } from './sqlMoneyExpressions';
import { ANALYTICS_QUERIES, BUDGET_PLAN_QUERIES, PROJECT_QUERIES, SUBSCRIPTION_QUERIES, TRIP_QUERIES } from './sqlQueries';
import { BUDGET_FUND_QUERIES } from './sqlQueriesBudgetFunds';

describe('sqlMoneyExpressions (schema v6 currency conversion)', () => {
  it('resolves the default currency from app_metadata with a USD fallback', () => {
    expect(DEFAULT_CURRENCY_KEY).toBe('preferences.defaultCurrency');
    expect(DEFAULT_CURRENCY_SQL).toBe(
      "COALESCE((SELECT value FROM app_metadata WHERE key = 'preferences.defaultCurrency'), 'USD')"
    );
  });

  it('rates the default currency at 1 and every other currency from exchange_rates (NULL when unknown)', () => {
    const rate = rateExpr('t');
    expect(rate).toContain(`CASE WHEN xa.currency = ${DEFAULT_CURRENCY_SQL} THEN 1.0 ELSE xr.rate END`);
    expect(rate).toContain('LEFT JOIN exchange_rates xr ON xr.currency = xa.currency');
    expect(rate).toContain('WHERE xa.id = t.account_id');
    expect(rateExpr('tr')).toContain('WHERE xa.id = tr.account_id');
  });

  it('multiplies money rows by the rate and leaves non-money rows at 0 (never NULL)', () => {
    expect(spendExpr()).toBe(
      `CASE WHEN t.type IN ('expense', 'refund') AND t.is_excluded = 0 THEN -t.amount * ${rateExpr('t')} ELSE 0 END`
    );
    expect(incomeExpr('x')).toBe(
      `CASE WHEN x.type = 'income' AND x.is_excluded = 0 THEN x.amount * ${rateExpr('x')} ELSE 0 END`
    );
    expect(spendingRowsPredicate()).toBe("t.type IN ('expense', 'refund') AND t.is_excluded = 0");
  });

  it('is what every cross-account aggregate sums, so totals are always in the default currency', () => {
    const aggregates = [
      ...Object.values(ANALYTICS_QUERIES),
      BUDGET_PLAN_QUERIES.ACTUAL_EXPENSES_BY_MONTH_CATEGORY,
      BUDGET_PLAN_QUERIES.ACTUAL_INCOME_LINKED_BY_MONTH,
      PROJECT_QUERIES.GET_COSTS,
      TRIP_QUERIES.GET_COSTS,
      SUBSCRIPTION_QUERIES.GET_SERIES_WITH_STATS,
      ...Object.values(BUDGET_FUND_QUERIES),
    ].filter((sql): sql is string => typeof sql === 'string' && /SUM\(/.test(sql));
    expect(aggregates.length).toBeGreaterThan(10);
    for (const sql of aggregates) {
      if (!/\.amount/.test(sql)) continue;
      expect(sql).toContain('LEFT JOIN exchange_rates xr');
    }
  });
});
