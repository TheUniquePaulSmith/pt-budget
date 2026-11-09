'use client';

/**
 * `useFormatters()`: the one way components format money, numbers and dates.
 * Combines the active locale (LocaleProvider) with the household's default
 * currency (DatabaseProvider). Works outside both providers too, falling back
 * to en-US / USD, so bare component tests keep rendering.
 */

import { useMemo } from 'react';

import {
  type DateStyle,
  DEFAULT_LOCALE,
  type MoneyFormatOptions,
  currencySymbol,
  formatDateOnly,
  formatDateTime,
  formatMoney,
  formatMonthKey,
  formatNumber,
  formatPercent,
  formatShortMonth,
  formatTime,
} from '@/lib/formatting';

import { useOptionalCurrencyPreferences } from './CurrencyPreferencesContext';
import { useOptionalLocale } from './LocaleContext';

export interface Formatters {
  locale: string;
  defaultCurrency: string;
  /**
   * Money in `currency` (an account's currency) or the default currency. The
   * default currency keeps its short symbol; any other currency is printed
   * with a symbol that cannot be confused with it ("CA$12.00", not "$12.00").
   */
  money: (amount: number | null | undefined, currency?: string | null, options?: Omit<MoneyFormatOptions, 'locale' | 'currency' | 'referenceCurrency'>) => string;
  /** The symbol for `currency` (or the default currency) in the active locale; distinguishable from the default's when it differs. */
  symbol: (currency?: string | null) => string;
  number: (value: number | null | undefined, options?: { minimumFractionDigits?: number; maximumFractionDigits?: number }) => string;
  /** Ratio in, percentage out (0.125 → "12.5%"); `fromPercent` for values already ×100. */
  percent: (value: number | null | undefined, options?: { minimumFractionDigits?: number; maximumFractionDigits?: number; fromPercent?: boolean }) => string;
  /** A `yyyy-MM-dd` date (or Date) for display. */
  date: (value: string | Date | null | undefined, style?: DateStyle) => string;
  /** A `yyyy-MM` month key ("April 2026" / "Apr 2026"). */
  month: (monthKey: string | null | undefined, short?: boolean) => string;
  /** Short month name for a 1-based month number or Date. */
  shortMonth: (month: number | Date) => string;
  /** Timestamp (ISO string / epoch / Date) with date and time. */
  dateTime: (value: string | number | Date | null | undefined, seconds?: boolean) => string;
  time: (value: string | number | Date | null | undefined, seconds?: boolean) => string;
}

export function useFormatters(): Formatters {
  const locale = useOptionalLocale()?.locale ?? DEFAULT_LOCALE;
  const { defaultCurrency } = useOptionalCurrencyPreferences();

  return useMemo<Formatters>(
    () => ({
      locale,
      defaultCurrency,
      money: (amount, currency, options) =>
        formatMoney(amount, { ...options, locale, currency: currency || defaultCurrency, referenceCurrency: defaultCurrency }),
      symbol: (currency) => currencySymbol(currency || defaultCurrency, locale, defaultCurrency),
      number: (value, options) => formatNumber(value, { ...options, locale }),
      percent: (value, options) => formatPercent(value, { ...options, locale }),
      date: (value, style) => formatDateOnly(value, { locale, style }),
      month: (monthKey, short) => formatMonthKey(monthKey, { locale, short }),
      shortMonth: (month) => formatShortMonth(month, locale),
      dateTime: (value, seconds) => formatDateTime(value, { locale, seconds }),
      time: (value, seconds) => formatTime(value, { locale, seconds }),
    }),
    [locale, defaultCurrency]
  );
}
