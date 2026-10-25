import { describe, expect, it } from 'vitest';

import {
  MAX_CARRY_LOOKBACK_MONTHS,
  addMonths,
  asCarryStatus,
  carryOut,
  computeCarry,
  isBudgetCarryMode,
  monthDiff,
  monthOf,
  monthRange,
  periodMonthBounds,
  resolveCarryRangeStart,
  type CarryMonthInput,
} from './budgetCarry';
import type { BudgetCarryMode, BudgetStatus } from '../types/database';

/** Three months: under-spend, over-spend, then exact spend. */
function threeMonths(carryMode: BudgetCarryMode): CarryMonthInput[] {
  return [
    { month: '2026-01', budgeted: 100, actual: 60, carryMode },
    { month: '2026-02', budgeted: 100, actual: 150, carryMode },
    { month: '2026-03', budgeted: 100, actual: 100, carryMode },
  ];
}

describe('month helpers', () => {
  it('adds months across year boundaries', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-06', 0)).toBe('2026-06');
  });

  it('measures signed month distances and builds inclusive ranges', () => {
    expect(monthDiff('2026-01', '2026-04')).toBe(3);
    expect(monthDiff('2026-04', '2026-01')).toBe(-3);
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(monthRange('2026-03', '2026-03')).toEqual(['2026-03']);
    expect(monthRange('2026-04', '2026-03')).toEqual([]);
  });

  it('extracts the month of a date and tolerates blanks', () => {
    expect(monthOf('2026-06-15')).toBe('2026-06');
    expect(monthOf('2026-06')).toBe('2026-06');
    expect(monthOf('')).toBeNull();
    expect(monthOf(null)).toBeNull();
    expect(monthOf(undefined)).toBeNull();
  });

  it('expands periods to their first and last month', () => {
    expect(periodMonthBounds({ type: 'month', key: '2026-07' })).toEqual({ start: '2026-07', end: '2026-07' });
    expect(periodMonthBounds({ type: 'quarter', key: '2026-Q3' })).toEqual({ start: '2026-07', end: '2026-09' });
    expect(periodMonthBounds({ type: 'year', key: '2026' })).toEqual({ start: '2026-01', end: '2026-12' });
    expect(() => periodMonthBounds({ type: 'quarter', key: '2026-Q5' })).toThrow('Invalid budget quarter key');
    expect(() => periodMonthBounds({ type: 'year', key: 'abc' })).toThrow('Invalid budget year key');
  });

  it('recognises carry modes', () => {
    expect(isBudgetCarryMode('surplus')).toBe(true);
    expect(isBudgetCarryMode('both')).toBe(true);
    expect(isBudgetCarryMode('rollover')).toBe(false);
    expect(isBudgetCarryMode(null)).toBe(false);
  });
});

describe('carryOut', () => {
  it('keeps only the part of the leftover the mode allows', () => {
    expect(carryOut(40, 'none')).toBe(0);
    expect(carryOut(-40, 'none')).toBe(0);
    expect(carryOut(40, 'surplus')).toBe(40);
    expect(carryOut(-40, 'surplus')).toBe(0);
    expect(carryOut(40, 'deficit')).toBe(0);
    expect(carryOut(-40, 'deficit')).toBe(-40);
    expect(carryOut(40, 'both')).toBe(40);
    expect(carryOut(-40, 'both')).toBe(-40);
    expect(carryOut(0, 'both')).toBe(0);
  });
});

describe('computeCarry over three months', () => {
  it('none: every month starts from the plan amount', () => {
    const ledger = computeCarry(threeMonths('none'));
    expect(ledger.map((m) => [m.carriedIn, m.effectiveBudget, m.carriedOut])).toEqual([
      [0, 100, 0],
      [0, 100, 0],
      [0, 100, 0],
    ]);
  });

  it('surplus: carries the leftover forward and forgives overspend', () => {
    const ledger = computeCarry(threeMonths('surplus'));
    // Jan leaves 40; Feb has 140 and spends 150 (-10 is dropped); Mar starts clean.
    expect(ledger.map((m) => [m.carriedIn, m.effectiveBudget, m.carriedOut])).toEqual([
      [0, 100, 40],
      [40, 140, 0],
      [0, 100, 0],
    ]);
  });

  it('deficit: drops the surplus and deducts overspend from the next month', () => {
    const ledger = computeCarry(threeMonths('deficit'));
    // Jan's 40 surplus is dropped; Feb overspends by 50; Mar has 50 and spends 100 → -50 carries on.
    expect(ledger.map((m) => [m.carriedIn, m.effectiveBudget, m.carriedOut])).toEqual([
      [0, 100, 0],
      [0, 100, -50],
      [-50, 50, -50],
    ]);
  });

  it('both: carries the net balance in either direction', () => {
    const ledger = computeCarry(threeMonths('both'));
    // Jan +40; Feb 140 - 150 = -10; Mar 90 - 100 = -10.
    expect(ledger.map((m) => [m.carriedIn, m.effectiveBudget, m.carriedOut])).toEqual([
      [0, 100, 40],
      [40, 140, -10],
      [-10, 90, -10],
    ]);
  });

  it('uses the mode effective in the month that produces the leftover', () => {
    const ledger = computeCarry([
      { month: '2026-01', budgeted: 100, actual: 20, carryMode: 'none' },
      { month: '2026-02', budgeted: 100, actual: 20, carryMode: 'surplus' },
      { month: '2026-03', budgeted: 100, actual: 20, carryMode: 'surplus' },
    ]);
    expect(ledger.map((m) => m.carriedIn)).toEqual([0, 0, 80]);
  });

  it('zeroes the balance from a reset month and keeps carrying afterwards', () => {
    const ledger = computeCarry([
      { month: '2026-01', budgeted: 100, actual: 10, carryMode: 'surplus' },
      { month: '2026-02', budgeted: 100, actual: 10, carryMode: 'surplus' },
      { month: '2026-03', budgeted: 100, actual: 10, carryMode: 'surplus', reset: true },
      { month: '2026-04', budgeted: 100, actual: 10, carryMode: 'surplus' },
    ]);
    expect(ledger.map((m) => [m.carriedIn, m.reset])).toEqual([
      [0, false],
      [90, false],
      [0, true],
      [90, false],
    ]);
  });

  it('drops the balance when the category leaves the plan', () => {
    const ledger = computeCarry([
      { month: '2026-01', budgeted: 100, actual: 10, carryMode: 'both' },
      { month: '2026-02', budgeted: null, actual: 30, carryMode: 'none' },
      { month: '2026-03', budgeted: 100, actual: 10, carryMode: 'both' },
    ]);
    expect(ledger.map((m) => [m.budgeted, m.carriedIn, m.effectiveBudget, m.carriedOut])).toEqual([
      [100, 0, 100, 90],
      [null, 0, 0, 0],
      [100, 0, 100, 90],
    ]);
  });

  it('returns an empty ledger for no months and rejects gaps', () => {
    expect(computeCarry([])).toEqual([]);
    expect(() => computeCarry([
      { month: '2026-01', budgeted: 1, actual: 0, carryMode: 'both' },
      { month: '2026-03', budgeted: 1, actual: 0, carryMode: 'both' },
    ])).toThrow('consecutive months');
  });
});

describe('resolveCarryRangeStart', () => {
  it('stays on the period when nothing carries or no plan precedes it', () => {
    expect(resolveCarryRangeStart({ periodStart: '2026-07', firstPlanMonth: '2025-01', carryActive: false })).toBe('2026-07');
    expect(resolveCarryRangeStart({ periodStart: '2026-07', firstPlanMonth: null, carryActive: true })).toBe('2026-07');
    expect(resolveCarryRangeStart({ periodStart: '2026-07', firstPlanMonth: '2026-07', carryActive: true })).toBe('2026-07');
    expect(resolveCarryRangeStart({ periodStart: '2026-07', firstPlanMonth: '2026-09', carryActive: true })).toBe('2026-07');
  });

  it('walks back to the first plan month or the last full reset before the period', () => {
    expect(resolveCarryRangeStart({ periodStart: '2026-07', firstPlanMonth: '2026-01', carryActive: true })).toBe('2026-01');
    expect(resolveCarryRangeStart({
      periodStart: '2026-07',
      firstPlanMonth: '2026-01',
      fullResetMonths: ['2026-03', '2026-05', '2026-09'],
      carryActive: true,
    })).toBe('2026-05');
    expect(resolveCarryRangeStart({
      periodStart: '2026-07',
      firstPlanMonth: '2026-01',
      fullResetMonths: ['2026-07'],
      carryActive: true,
    })).toBe('2026-07');
  });

  it('caps the look-back at 36 months', () => {
    expect(MAX_CARRY_LOOKBACK_MONTHS).toBe(36);
    expect(resolveCarryRangeStart({ periodStart: '2026-07', firstPlanMonth: '2020-01', carryActive: true })).toBe('2023-07');
    expect(resolveCarryRangeStart({ periodStart: '2026-07', firstPlanMonth: '2020-01', carryActive: true, maxLookbackMonths: 6 })).toBe('2026-01');
  });
});

describe('asCarryStatus', () => {
  const legacy: BudgetStatus = {
    period: { type: 'month', key: '2026-07' },
    months: ['2026-07'],
    budgetedTotal: 500,
    actualExpenses: 320,
    remaining: 180,
    isOverBudget: false,
    categories: [
      { category_id: 1, category_name: 'Groceries', budgetedAmount: 300, actualExpenses: 320, remaining: -20, isOverBudget: true },
      { category_id: 2, category_name: 'Fun', budgetedAmount: 200, actualExpenses: 0, remaining: 200, isOverBudget: false },
    ],
    unbudgetedSpend: 0,
    expectedIncome: 0,
    actualLinkedIncome: 0,
    monthsWithPlan: ['2026-07'],
  };

  it('fills neutral carry and fund defaults for a legacy status', () => {
    const status = asCarryStatus(legacy);
    expect(status.carryRangeStart).toBe('2026-07');
    expect(status.carriedInTotal).toBe(0);
    expect(status.effectiveBudgetTotal).toBe(500);
    expect(status.effectiveRemaining).toBe(180);
    expect(status.categories[0]).toMatchObject({
      carryMode: 'none',
      carriedIn: 0,
      carriedOut: 0,
      effectiveBudget: 300,
      committedSpend: 320,
      effectiveRemaining: -20,
      carryResetMonth: null,
    });
  });

  it('keeps carry fields that are already present and sums totals from them', () => {
    const status = asCarryStatus({
      ...legacy,
      categories: [
        { ...legacy.categories[0], carryMode: 'surplus', carriedIn: 50, effectiveBudget: 350, fundContributions: 25, fundSpend: 10 },
        legacy.categories[1],
      ],
    } as BudgetStatus);
    expect(status.carriedInTotal).toBe(50);
    expect(status.fundContributionsTotal).toBe(25);
    expect(status.fundSpendTotal).toBe(10);
    expect(status.effectiveBudgetTotal).toBe(550);
    // 550 - (320 - 10 + 25)
    expect(status.effectiveRemaining).toBe(215);
    expect(status.categories[0].committedSpend).toBe(335);
    expect(status.categories[0].effectiveRemaining).toBe(15);
  });

  it('leaves totals null when there is no plan', () => {
    const status = asCarryStatus({ ...legacy, budgetedTotal: null, remaining: null, categories: [] });
    expect(status.effectiveBudgetTotal).toBeNull();
    expect(status.effectiveRemaining).toBeNull();
  });
});
