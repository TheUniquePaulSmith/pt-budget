import type { RecurringSeries } from '@/types/database';

type Cadence = RecurringSeries['cadence'];

/**
 * Normalizes an expected amount to a per-month figure.
 * `irregular` has no dependable period, so it contributes nothing to estimates.
 */
export function monthlyEquivalentAmount(cadence: Cadence, amount: number | null | undefined): number {
  const value = amount ?? 0;
  switch (cadence) {
    case 'weekly':
      return (value * 52) / 12;
    case 'biweekly':
      return (value * 26) / 12;
    case 'monthly':
      return value;
    case 'quarterly':
      return value / 3;
    case 'yearly':
      return value / 12;
    default:
      return 0;
  }
}

export function monthlyEquivalent(series: Pick<RecurringSeries, 'cadence' | 'expected_amount'>): number {
  return monthlyEquivalentAmount(series.cadence, series.expected_amount);
}

/** Adds months to a UTC date, clamping the day so Jan 31 + 1 month lands on Feb 28/29. */
export function addMonthsClamped(date: Date, months: number): Date {
  const day = date.getUTCDate();
  const shifted = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const daysInMonth = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, 0)).getUTCDate();
  shifted.setUTCDate(Math.min(day, daysInMonth));
  return shifted;
}

/** Advances a date by exactly one cadence period. Returns null for cadences that don't repeat predictably. */
export function advanceByCadence(date: Date, cadence: Cadence): Date | null {
  switch (cadence) {
    case 'weekly':
      return new Date(date.getTime() + 7 * 86400000);
    case 'biweekly':
      return new Date(date.getTime() + 14 * 86400000);
    case 'monthly':
      return addMonthsClamped(date, 1);
    case 'quarterly':
      return addMonthsClamped(date, 3);
    case 'yearly':
      return addMonthsClamped(date, 12);
    default:
      return null;
  }
}
