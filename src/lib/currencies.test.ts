import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CURRENCY,
  SUPPORTED_CURRENCIES,
  accountCurrencies,
  convertToDefault,
  currencyDisplayName,
  currencyMinorDigits,
  currencyOptions,
  isCurrencyCode,
  missingRateCurrencies,
  normalizeCurrencyCode,
  rateFor,
} from './currencies';

const rates = [
  { currency: 'EUR', rate: 1.1 },
  { currency: 'JPY', rate: null },
];

describe('currencies', () => {
  it('offers USD first and only well-formed ISO codes', () => {
    expect(DEFAULT_CURRENCY).toBe('USD');
    expect(SUPPORTED_CURRENCIES[0]).toBe('USD');
    expect(new Set(SUPPORTED_CURRENCIES).size).toBe(SUPPORTED_CURRENCIES.length);
    for (const code of SUPPORTED_CURRENCIES) expect(isCurrencyCode(code)).toBe(true);
    expect(isCurrencyCode('usd')).toBe(false);
    expect(isCurrencyCode('US')).toBe(false);
  });

  it('normalises codes and falls back to the default', () => {
    expect(normalizeCurrencyCode(' eur ')).toBe('EUR');
    expect(normalizeCurrencyCode('nope')).toBe('USD');
    expect(normalizeCurrencyCode(null, 'GBP')).toBe('GBP');
    expect(normalizeCurrencyCode(42)).toBe('USD');
  });

  it('appends extra codes to the picker list without duplicates', () => {
    const options = currencyOptions(['EUR', 'XAF', 'bad', 'XAF']);
    expect(options.filter((code) => code === 'EUR')).toHaveLength(1);
    expect(options.at(-1)).toBe('XAF');
    expect(options).not.toContain('bad');
  });

  it('knows display names and minor digits', () => {
    expect(currencyDisplayName('USD', 'en-US')).toBe('US Dollar');
    expect(currencyDisplayName('EUR', 'de-DE')).toBe('Euro');
    expect(currencyDisplayName('NOTACODE', 'en-US')).toBe('NOTACODE');
    expect(currencyMinorDigits('USD')).toBe(2);
    expect(currencyMinorDigits('JPY')).toBe(0);
    expect(currencyMinorDigits('KRW')).toBe(0);
  });

  it('rates the default currency at 1 and unknown rates as null', () => {
    expect(rateFor('USD', 'USD', rates)).toBe(1);
    expect(rateFor('EUR', 'USD', rates)).toBe(1.1);
    expect(rateFor('JPY', 'USD', rates)).toBeNull();
    expect(rateFor('GBP', 'USD', rates)).toBeNull();
    expect(convertToDefault(10, 'EUR', 'USD', rates)).toBeCloseTo(11);
    expect(convertToDefault(10, 'JPY', 'USD', rates)).toBeNull();
    expect(convertToDefault(10, 'USD', 'USD', [])).toBe(10);
  });

  it('lists active account currencies and the ones without a rate', () => {
    const accounts = [
      { currency: 'USD', is_active: 1 },
      { currency: 'EUR', is_active: 1 },
      { currency: 'JPY', is_active: 1 },
      { currency: 'GBP', is_active: 0 },
      { currency: 'eur', is_active: 1 },
    ];
    expect(accountCurrencies(accounts)).toEqual(['EUR', 'JPY', 'USD']);
    expect(accountCurrencies(accounts, { includeInactive: true })).toEqual(['EUR', 'GBP', 'JPY', 'USD']);
    expect(missingRateCurrencies(accounts, 'USD', rates)).toEqual(['JPY']);
    expect(missingRateCurrencies(accounts, 'EUR', [{ currency: 'USD', rate: 0.9 }])).toEqual(['JPY']);
  });
});
