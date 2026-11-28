// How trip business expenses look: status colours and the error codes the
// service throws, mapped to `trips:` keys. No React.

import type { ChipProps } from '@mui/material';

import type { TripReimbursementStatus } from '@/types/tripExpenses';

export function reimbursementStatusColor(status: TripReimbursementStatus): ChipProps['color'] {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'submitted':
      return 'info';
    case 'reimbursed':
      return 'success';
    case 'denied':
      return 'error';
  }
}

const ERROR_CODES = [
  'TRIP_ALLOCATION_NOT_TRIP_EXPENSE',
  'TRIP_ALLOCATION_AMOUNT_INVALID',
  'TRIP_STATUS_INVALID',
  'TRIP_REIMBURSEMENT_AMOUNT_INVALID',
  'TRIP_REIMBURSEMENT_NOT_FOUND',
  'TRIP_DEPOSIT_INVALID',
] as const;

/** The `trips:errors.*` key for an error the service threw, or the generic one. */
export function tripExpenseErrorKey(error: unknown): `errors.${(typeof ERROR_CODES)[number]}` | 'errors.generic' {
  const message = error instanceof Error ? error.message : '';
  return (ERROR_CODES as readonly string[]).includes(message)
    ? (`errors.${message}` as `errors.${(typeof ERROR_CODES)[number]}`)
    : 'errors.generic';
}

/** `yyyy-MM-dd` shifted by whole days (UTC, so no DST surprises). */
export function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, (month || 1) - 1, day || 1) + days * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

export function todayIsoDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * The window to look for a trip's charges in: its dates widened by three days
 * (a flight booked ahead, a late hotel bill), or the last 30 days without dates.
 */
export function tripSearchWindow(trip: { start_date?: string | null; end_date?: string | null }): { start: string; end: string } {
  const start = trip.start_date || trip.end_date;
  const end = trip.end_date || trip.start_date;
  if (start && end) return { start: shiftIsoDate(start, -3), end: shiftIsoDate(end, 3) };
  const today = todayIsoDate();
  return { start: shiftIsoDate(today, -30), end: today };
}
