/**
 * Currencies the app knows how to offer. Every account carries an ISO 4217
 * code; the household's default currency (app_metadata
 * `preferences.defaultCurrency`) is what every cross-account total is
 * expressed in. Pure module: no React, no database.
 */

import type { Account, ExchangeRate } from '@/types/database';

export const DEFAULT_CURRENCY = 'USD';

/** Common currencies, in the order they are offered. USD first (the default). */
export const SUPPORTED_CURRENCIES: readonly string[] = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CNY',
  'KRW',
  'CAD',
  'AUD',
  'CHF',
  'INR',
  'BRL',
  'MXN',
  'HKD',
  'SGD',
  'SEK',
  'NOK',
  'DKK',
  'NZD',
  'ZAR',
  'TWD',
  'PLN',
];

const ISO_4217_PATTERN = /^[A-Z]{3}$/;

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && ISO_4217_PATTERN.test(value);
}

/** Normalises user / database input to an upper-case ISO code, else the default. */
export function normalizeCurrencyCode(value: unknown, fallback = DEFAULT_CURRENCY): string {
  if (typeof value !== 'string') return fallback;
  const upper = value.trim().toUpperCase();
  return ISO_4217_PATTERN.test(upper) ? upper : fallback;
}

/** The currencies to offer in a picker: the supported list plus any extra codes already in use. */
export function currencyOptions(extra: Iterable<string> = []): string[] {
  const seen = new Set(SUPPORTED_CURRENCIES);
  const result = [...SUPPORTED_CURRENCIES];
  for (const code of extra) {
    if (isCurrencyCode(code) && !seen.has(code)) {
      seen.add(code);
      result.push(code);
    }
  }
  return result;
}

const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

/** "US Dollar", "Euro", … in the given locale; falls back to the code. */
export function currencyDisplayName(code: string, locale: string): string {
  if (typeof Intl.DisplayNames !== 'function') return code;
  let names = displayNamesCache.get(locale);
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames([locale], { type: 'currency' });
    } catch {
      names = null;
    }
    displayNamesCache.set(locale, names);
  }
  if (!names) return code;
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

const minorDigitsCache = new Map<string, number>();

/** Number of minor-unit digits (2 for USD, 0 for JPY / KRW). */
export function currencyMinorDigits(code: string): number {
  const cached = minorDigitsCache.get(code);
  if (cached !== undefined) return cached;
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat('en-US', { style: 'currency', currency: code }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    digits = 2;
  }
  minorDigitsCache.set(code, digits);
  return digits;
}

/** Rate lookup: units of the default currency per 1 unit of `currency`; null = unknown. */
export function rateFor(
  currency: string,
  defaultCurrency: string,
  rates: ReadonlyArray<Pick<ExchangeRate, 'currency' | 'rate'>>
): number | null {
  if (currency === defaultCurrency) return 1;
  const row = rates.find((rate) => rate.currency === currency);
  return row && row.rate != null && Number.isFinite(row.rate) && row.rate > 0 ? row.rate : null;
}

/** Converts into the default currency, or null when the rate is unknown. */
export function convertToDefault(
  amount: number,
  currency: string,
  defaultCurrency: string,
  rates: ReadonlyArray<Pick<ExchangeRate, 'currency' | 'rate'>>
): number | null {
  const rate = rateFor(currency, defaultCurrency, rates);
  return rate === null ? null : amount * rate;
}

/** Distinct currencies of the given accounts (active ones unless `includeInactive`). */
export function accountCurrencies(
  accounts: ReadonlyArray<Pick<Account, 'currency' | 'is_active'>>,
  { includeInactive = false }: { includeInactive?: boolean } = {}
): string[] {
  const set = new Set<string>();
  for (const account of accounts) {
    if (!includeInactive && (account.is_active ?? 1) !== 1) continue;
    set.add(normalizeCurrencyCode(account.currency));
  }
  return [...set].sort();
}

/** Currencies used by accounts that have no usable rate into the default currency. */
export function missingRateCurrencies(
  accounts: ReadonlyArray<Pick<Account, 'currency' | 'is_active'>>,
  defaultCurrency: string,
  rates: ReadonlyArray<Pick<ExchangeRate, 'currency' | 'rate'>>
): string[] {
  return accountCurrencies(accounts).filter(
    (currency) => rateFor(currency, defaultCurrency, rates) === null
  );
}
