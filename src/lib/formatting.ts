/**
 * Locale-aware formatting for money, numbers and dates. Pure functions over
 * Intl with cached formatter instances; components reach them through
 * `useFormatters()` (src/contexts/useFormatters.ts), which supplies the
 * active locale and the household's default currency.
 */

import { DEFAULT_CURRENCY } from './currencies';

export const DEFAULT_LOCALE = 'en-US';

export interface MoneyFormatOptions {
  locale?: string;
  currency?: string;
  /** Omit the minor units ("$1,234" instead of "$1,234.00"). */
  whole?: boolean;
  /** Always prefix a sign ("+$12.00" / "-$12.00"). */
  signed?: boolean;
  /** Drop the currency symbol but keep the currency's digit rules. */
  symbolless?: boolean;
  /**
   * The household's default currency. Amounts in it keep the short symbol
   * ("$12.00"); an amount in any other currency gets a symbol that cannot be
   * mistaken for it ("CA$12.00", "A$12.00", "CN¥12.00", or the ISO code when
   * even the standard symbol would collide).
   */
  referenceCurrency?: string;
}

type SymbolDisplay = 'narrowSymbol' | 'symbol' | 'code';

const numberFormatCache = new Map<string, Intl.NumberFormat | null>();
const dateFormatCache = new Map<string, Intl.DateTimeFormat>();

function getNumberFormat(locale: string, options: Intl.NumberFormatOptions): Intl.NumberFormat | null {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = numberFormatCache.get(key);
  if (formatter === undefined) {
    try {
      formatter = new Intl.NumberFormat(locale, options);
    } catch {
      formatter = null;
    }
    numberFormatCache.set(key, formatter);
  }
  return formatter;
}

function getDateFormat(locale: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = dateFormatCache.get(key);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(locale, options);
    } catch {
      formatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, options);
    }
    dateFormatCache.set(key, formatter);
  }
  return formatter;
}

/** The symbol Intl renders for `currency` with the given display style, or null for an unknown code. */
function symbolPart(currency: string, locale: string, display: SymbolDisplay): string | null {
  const formatter = getNumberFormat(locale, { style: 'currency', currency, currencyDisplay: display });
  return formatter?.formatToParts(1).find((item) => item.type === 'currency')?.value ?? null;
}

/**
 * Narrow symbols are ambiguous across currencies (every dollar is "$", the yen
 * and the yuan are both "¥", the Nordic crowns are all "kr"). The household's
 * default currency keeps its narrow symbol; any other currency uses the locale's
 * standard symbol ("CA$", "CN¥", "R$"), and the ISO code when that standard
 * symbol is identical to the default currency's.
 */
function symbolDisplayFor(currency: string, locale: string, referenceCurrency?: string): SymbolDisplay {
  if (!referenceCurrency || referenceCurrency === currency) return 'narrowSymbol';
  const own = symbolPart(currency, locale, 'symbol');
  const reference = symbolPart(referenceCurrency, locale, 'narrowSymbol');
  return own !== null && own === reference ? 'code' : 'symbol';
}

/** "$1,234.56", "1.234,56 €", "￥1,235" … Non-finite input renders as the zero amount. */
export function formatMoney(amount: number | null | undefined, options: MoneyFormatOptions = {}): string {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const currency = options.currency ?? DEFAULT_CURRENCY;
  const value = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
  const intlOptions: Intl.NumberFormatOptions = {
    style: 'currency',
    currency,
    currencyDisplay: symbolDisplayFor(currency, locale, options.referenceCurrency),
  };
  if (options.whole) {
    intlOptions.minimumFractionDigits = 0;
    intlOptions.maximumFractionDigits = 0;
  }
  if (options.signed) {
    intlOptions.signDisplay = 'exceptZero';
  }
  let formatter = getNumberFormat(locale, intlOptions);
  if (!formatter) {
    // Unknown currency code: fall back to a plain decimal with the code appended.
    formatter = getNumberFormat(locale, {
      minimumFractionDigits: options.whole ? 0 : 2,
      maximumFractionDigits: options.whole ? 0 : 2,
      signDisplay: options.signed ? 'exceptZero' : 'auto',
    });
    return `${formatter?.format(value) ?? String(value)} ${currency}`;
  }
  if (options.symbolless) {
    return formatter
      .formatToParts(value)
      .filter((part) => part.type !== 'currency' && part.type !== 'literal')
      .map((part) => part.value)
      .join('')
      .trim();
  }
  return formatter.format(value);
}

/**
 * The currency's symbol as rendered in the locale ("$", "€", "¥"). With a
 * `referenceCurrency` (the household default) a different currency gets its
 * distinguishable symbol, the same one `formatMoney` prints ("CA$").
 */
export function currencySymbol(currency: string, locale: string = DEFAULT_LOCALE, referenceCurrency?: string): string {
  return symbolPart(currency, locale, symbolDisplayFor(currency, locale, referenceCurrency)) ?? currency;
}

/**
 * The symbol to print beside a currency's name in a picker ("$", "CA$", "kr"),
 * or null when the currency has none beyond its ISO code (CHF).
 */
export function currencyPickerSymbol(currency: string, locale: string = DEFAULT_LOCALE): string | null {
  for (const display of ['symbol', 'narrowSymbol'] as const) {
    const value = symbolPart(currency, locale, display);
    if (value && value !== currency) return value;
  }
  return null;
}

export interface NumberFormatOptions {
  locale?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

export function formatNumber(value: number | null | undefined, options: NumberFormatOptions = {}): string {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const safe = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const formatter = getNumberFormat(locale, {
    minimumFractionDigits: options.minimumFractionDigits,
    maximumFractionDigits: options.maximumFractionDigits,
  });
  return formatter?.format(safe) ?? String(safe);
}

/** `value` is a ratio (0.125 → "12.5%"); pass `fromPercent` when it is already a percentage. */
export function formatPercent(
  value: number | null | undefined,
  options: NumberFormatOptions & { fromPercent?: boolean } = {}
): string {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const raw = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  const ratio = options.fromPercent ? raw / 100 : raw;
  const formatter = getNumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    maximumFractionDigits: options.maximumFractionDigits ?? 1,
  });
  return formatter?.format(ratio) ?? `${ratio * 100}%`;
}

export type DateStyle = 'short' | 'medium' | 'long' | 'monthDay' | 'monthYear' | 'weekday';

const DATE_STYLE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  short: { year: 'numeric', month: 'numeric', day: 'numeric' },
  medium: { year: 'numeric', month: 'short', day: 'numeric' },
  long: { year: 'numeric', month: 'long', day: 'numeric' },
  monthDay: { month: 'short', day: 'numeric' },
  monthYear: { year: 'numeric', month: 'long' },
  weekday: { weekday: 'short', month: 'short', day: 'numeric' },
};

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

/** Builds a local-time Date from a `yyyy-MM-dd` string (never `new Date(iso)`, which parses as UTC). */
export function dateOnlyToLocalDate(value: string | Date | null | undefined): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Formats a `yyyy-MM-dd` (or Date) for display; empty string when unparsable. */
export function formatDateOnly(
  value: string | Date | null | undefined,
  { locale = DEFAULT_LOCALE, style = 'medium' }: { locale?: string; style?: DateStyle } = {}
): string {
  const date = dateOnlyToLocalDate(value);
  if (!date) return typeof value === 'string' ? value : '';
  return getDateFormat(locale, DATE_STYLE_OPTIONS[style]).format(date);
}

/** "2026-04" → "April 2026" (or "Apr 2026" with `short`). */
export function formatMonthKey(
  monthKey: string | null | undefined,
  { locale = DEFAULT_LOCALE, short = false }: { locale?: string; short?: boolean } = {}
): string {
  if (!monthKey) return '';
  const match = MONTH_KEY_PATTERN.exec(monthKey);
  if (!match) return formatDateOnly(monthKey, { locale, style: 'monthYear' });
  const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
  return getDateFormat(locale, { year: 'numeric', month: short ? 'short' : 'long' }).format(date);
}

/** Short month name for a 1-based month number or a Date ("Apr"). */
export function formatShortMonth(month: number | Date, locale: string = DEFAULT_LOCALE): string {
  const date = month instanceof Date ? month : new Date(2000, month - 1, 1);
  return getDateFormat(locale, { month: 'short' }).format(date);
}

const DATE_ONLY_EXACT_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/** `yyyy-MM-dd HH:mm[:ss[.fff…]]` with no zone marker: what SQLite's CURRENT_TIMESTAMP and datetime('now') write. */
const SQLITE_UTC_TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2})(?:\.(\d+))?)?$/;

/**
 * The instant a stored timestamp stands for, or null when it cannot be read.
 *
 * SQLite writes `CURRENT_TIMESTAMP` columns (`created_at`, `updated_at`, …) as
 * UTC text without a zone marker ("2026-11-10 22:12:32"). `new Date(text)` reads
 * that shape as local time, which moves it by the device's UTC offset, so it is
 * read as UTC here. Everything that already says which instant it is passes
 * through unchanged: a Date, epoch millis, an ISO string with `Z` or an offset.
 * A bare `yyyy-MM-dd` is a calendar date and stays local (`dateOnlyToLocalDate`);
 * a zone-less ISO string with a `T` keeps its ECMAScript meaning (local time).
 */
export function storedTimestampToDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const text = value.trim();
    if (DATE_ONLY_EXACT_PATTERN.test(text)) return dateOnlyToLocalDate(text);
    const sqlite = SQLITE_UTC_TIMESTAMP_PATTERN.exec(text);
    if (sqlite) {
      const [, day, hourMinute, second = '00', fraction = ''] = sqlite;
      const millis = fraction.slice(0, 3).padEnd(3, '0');
      const utc = new Date(`${day}T${hourMinute}:${second}.${millis}Z`);
      return Number.isNaN(utc.getTime()) ? null : utc;
    }
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Timestamps (SQLite UTC text, ISO strings, epoch millis or a Date) with date and time, in the device's time zone. */
export function formatDateTime(
  value: string | number | Date | null | undefined,
  { locale = DEFAULT_LOCALE, seconds = false }: { locale?: string; seconds?: boolean } = {}
): string {
  if (value === null || value === undefined || value === '') return '';
  const date = storedTimestampToDate(value);
  if (!date) return String(value);
  return getDateFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  }).format(date);
}

/** Time of day only ("3:04 PM" / "15:04"). */
export function formatTime(
  value: string | number | Date | null | undefined,
  { locale = DEFAULT_LOCALE, seconds = false }: { locale?: string; seconds?: boolean } = {}
): string {
  if (value === null || value === undefined || value === '') return '';
  const date = storedTimestampToDate(value);
  if (!date) return String(value);
  return getDateFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  }).format(date);
}

/** Resets the formatter caches (tests). */
export function clearFormatterCaches(): void {
  numberFormatCache.clear();
  dateFormatCache.clear();
}
