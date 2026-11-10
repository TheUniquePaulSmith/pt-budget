/**
 * Calendar-date helpers for the app's `yyyy-MM-dd` strings.
 *
 * Transactions carry a calendar date with no time zone. Mixing `new Date()`
 * (local) with `toISOString()` (UTC) shifts a date by one day for anyone west
 * of Greenwich in the evening, so every "today" and every Date -> string
 * conversion in the app should go through these helpers instead.
 */

import { format, isValid, parse } from 'date-fns';

import { type CsvDateOrder, csvDateFormatsFor, csvDateFormatsStrict } from './dateOnly.csvFormats';

export type { CsvDateOrder };

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Formats a Date as `yyyy-MM-dd` using its LOCAL calendar fields. */
export function toLocalDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Today's LOCAL calendar date as `yyyy-MM-dd`. */
export function todayLocalISO(): string {
  return toLocalDateOnly(new Date());
}

function splitDateOnly(iso: string): [number, number, number] {
  const [year, month, day] = iso.split('-').map(Number);
  return [year, month, day];
}

function formatUtcDateOnly(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Shifts a `yyyy-MM-dd` string by whole days using pure calendar arithmetic. */
export function addDaysISO(iso: string, days: number): string {
  const [year, month, day] = splitDateOnly(iso);
  return formatUtcDateOnly(new Date(Date.UTC(year, month - 1, day + days)));
}

/**
 * Shifts a `yyyy-MM-dd` string by whole months, clamping the day to the target
 * month's length (Jan 31 + 1 month = Feb 28/29).
 */
export function addMonthsISO(iso: string, months: number): string {
  const [year, month, day] = splitDateOnly(iso);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return formatUtcDateOnly(target);
}

/** True when the string is already a well-formed `yyyy-MM-dd` calendar date. */
export function isDateOnly(value: string): boolean {
  if (!DATE_ONLY_RE.test(value)) return false;
  const [year, month, day] = splitDateOnly(value);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

/**
 * Parses a bank-export date cell into `yyyy-MM-dd`, or returns null when the
 * value matches none of the known formats. Ambiguous numeric dates follow
 * `order` (see dateOnly.csvFormats.ts). Never guesses: an unparseable cell
 * must be reported to the user, not silently replaced with today.
 */
export interface ParseCsvDateOptions {
  /**
   * Day/month convention for ambiguous numeric dates. Defaults to MDY (US);
   * the CSV importer passes `csvDateOrderFor(language)` from src/lib/i18n.ts.
   */
  order?: CsvDateOrder;
  /**
   * Read numeric dates with `order` only, never falling back to the other
   * day/month convention (the Import Wizard, which fixes one order per file).
   * Off by default: the legacy importer tries the other order per row.
   */
  strict?: boolean;
}

export function parseCsvDate(raw: unknown, { order = 'MDY', strict = false }: ParseCsvDateOptions = {}): string | null {
  if (raw == null) return null;
  const text = String(raw).trim().replace(/^["']|["']$/g, '').trim();
  if (!text) return null;

  // ISO timestamps ("2026-04-26T10:00:00Z", "2026-04-26T10:00:00.000-04:00"):
  // the calendar date the bank printed is the leading date component.
  const isoTimestamp = text.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoTimestamp && isDateOnly(isoTimestamp[1])) return isoTimestamp[1];

  if (isDateOnly(text)) return text;

  const reference = new Date(2000, 0, 1);
  for (const pattern of strict ? csvDateFormatsStrict(order) : csvDateFormatsFor(order)) {
    const parsed = parse(text, pattern, reference);
    if (isValid(parsed)) {
      const year = parsed.getFullYear();
      if (year < 1900 || year > 2200) continue;
      return format(parsed, 'yyyy-MM-dd');
    }
  }
  return null;
}
