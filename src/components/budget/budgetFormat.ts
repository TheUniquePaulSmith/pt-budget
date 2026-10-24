import type { BudgetCarryMode } from '@/types/database';

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const wholeCurrency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export const formatBudgetCurrency = (value: number | null | undefined, { whole = false } = {}) =>
  value == null ? 'Not set' : (whole ? wholeCurrency : currency).format(value);

/** '+$120.00' / '-$40.00' / '$0.00' for carried balances. */
export const formatSignedCurrency = (value: number) =>
  value > 0 ? `+${currency.format(value)}` : value < 0 ? `-${currency.format(Math.abs(value))}` : currency.format(0);

/** 'June 2026' for a 'YYYY-MM' key. */
export const formatMonthKey = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!year || !monthNumber) return month;
  return new Date(Date.UTC(year, monthNumber - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

export const CARRY_MODE_LABELS: Record<BudgetCarryMode, string> = {
  none: 'No carry-over',
  surplus: 'Carries surplus',
  deficit: 'Carries deficit',
  both: 'Carries both',
};

export const CARRY_MODE_CHIP_COLORS: Record<BudgetCarryMode, 'default' | 'success' | 'warning' | 'info'> = {
  none: 'default',
  surplus: 'success',
  deficit: 'warning',
  both: 'info',
};
