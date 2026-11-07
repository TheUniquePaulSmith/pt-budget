/**
 * Report periods shared by the Dashboard and Subscriptions filters.
 * "This" periods are the calendar week, month or year containing today
 * (running to the period's end). "Past" periods are rolling windows ending
 * today. `all` (no date limit) is offered only where a page supports it.
 */

import {
  addDays,
  endOfMonth,
  endOfWeek,
  endOfYear,
  format,
  startOfMonth,
  startOfWeek,
  startOfYear,
  subDays,
  subMonths,
} from 'date-fns';

export type BoundedPeriod =
  | 'thisWeek'
  | 'thisMonth'
  | 'thisYear'
  | 'pastWeek'
  | 'pastMonth'
  | 'pastYear'
  | 'custom';

export type Period = BoundedPeriod | 'all';

export const THIS_PERIODS = ['thisWeek', 'thisMonth', 'thisYear'] as const;
export const PAST_PERIODS = ['pastWeek', 'pastMonth', 'pastYear'] as const;

type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * First day of the week for a language tag (0 = Sunday), from the browser's
 * locale week data where available; Sunday otherwise.
 */
export function weekStartsOnFor(locale: string): WeekStart {
  try {
    const intlLocale = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const firstDay = intlLocale.getWeekInfo?.().firstDay ?? intlLocale.weekInfo?.firstDay;
    // Intl uses 1 = Monday … 7 = Sunday; date-fns uses 0 = Sunday … 6 = Saturday.
    if (typeof firstDay === 'number' && firstDay >= 1 && firstDay <= 7) return (firstDay % 7) as WeekStart;
  } catch {
    // Unknown tag: fall through to Sunday.
  }
  return 0;
}

const iso = (value: Date) => format(value, 'yyyy-MM-dd');

export function periodDateRange(
  period: BoundedPeriod,
  now: Date,
  options: { weekStartsOn?: WeekStart; customStart?: string; customEnd?: string } = {}
): { start: string; end: string } {
  const weekStartsOn = options.weekStartsOn ?? 0;
  switch (period) {
    case 'thisWeek':
      return { start: iso(startOfWeek(now, { weekStartsOn })), end: iso(endOfWeek(now, { weekStartsOn })) };
    case 'thisYear':
      return { start: iso(startOfYear(now)), end: iso(endOfYear(now)) };
    case 'pastWeek':
      return { start: iso(subDays(now, 6)), end: iso(now) };
    case 'pastMonth':
      return { start: iso(addDays(subMonths(now, 1), 1)), end: iso(now) };
    case 'pastYear':
      return { start: iso(addDays(subMonths(now, 12), 1)), end: iso(now) };
    case 'custom':
      return {
        start: options.customStart || iso(startOfMonth(now)),
        end: options.customEnd || iso(now),
      };
    case 'thisMonth':
    default:
      return { start: iso(startOfMonth(now)), end: iso(endOfMonth(now)) };
  }
}
