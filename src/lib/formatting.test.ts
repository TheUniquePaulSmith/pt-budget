import { describe, expect, it } from 'vitest';

import {
  currencySymbol,
  dateOnlyToLocalDate,
  formatDateOnly,
  formatDateTime,
  formatMoney,
  formatMonthKey,
  formatNumber,
  formatPercent,
  formatShortMonth,
} from './formatting';

describe('formatting', () => {
  it('formats money in the default locale and currency', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50');
    expect(formatMoney(-12)).toBe('-$12.00');
    expect(formatMoney(null)).toBe('$0.00');
    expect(formatMoney(Number.NaN)).toBe('$0.00');
  });

  it('follows the currency’s own digit rules and the locale’s separators', () => {
    expect(formatMoney(1234.5, { currency: 'JPY' })).toBe('¥1,235');
    expect(formatMoney(1234.5, { currency: 'EUR', locale: 'de-DE' })).toBe('1.234,50 €');
    expect(formatMoney(1234.5, { currency: 'EUR', locale: 'fr-FR' })).toMatch(/1\s?234,50\s€/);
    expect(formatMoney(1234.5, { currency: 'BRL', locale: 'pt-BR' })).toBe('R$ 1.234,50');
  });

  it('supports whole, signed and symbolless variants', () => {
    expect(formatMoney(1234.5, { whole: true })).toBe('$1,235');
    expect(formatMoney(12, { signed: true })).toBe('+$12.00');
    expect(formatMoney(0, { signed: true })).toBe('$0.00');
    expect(formatMoney(1234.5, { symbolless: true })).toBe('1,234.50');
  });

  it('falls back to a plain decimal plus the code for an unknown currency', () => {
    expect(formatMoney(5, { currency: 'XXX' })).toMatch(/5/);
    expect(formatMoney(5, { currency: 'NOTACODE' })).toBe('5.00 NOTACODE');
  });

  it('returns the narrow symbol for a currency in a locale', () => {
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('EUR', 'de-DE')).toBe('€');
    expect(currencySymbol('GBP')).toBe('£');
    expect(currencySymbol('NOTACODE')).toBe('NOTACODE');
  });

  it('formats numbers and percentages', () => {
    expect(formatNumber(1234567.891, { maximumFractionDigits: 1 })).toBe('1,234,567.9');
    expect(formatNumber(1234.5, { locale: 'de-DE' })).toBe('1.234,5');
    expect(formatPercent(0.125)).toBe('12.5%');
    expect(formatPercent(6.49, { fromPercent: true, maximumFractionDigits: 2 })).toBe('6.49%');
  });

  it('builds local dates from yyyy-MM-dd without a UTC shift', () => {
    const date = dateOnlyToLocalDate('2026-04-06');
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(3);
    expect(date?.getDate()).toBe(6);
    expect(dateOnlyToLocalDate('nonsense')).toBeNull();
  });

  it('formats date-only values, month keys and timestamps per locale', () => {
    expect(formatDateOnly('2026-04-06')).toBe('Apr 6, 2026');
    expect(formatDateOnly('2026-04-06', { style: 'short' })).toBe('4/6/2026');
    expect(formatDateOnly('2026-04-06', { locale: 'de-DE' })).toBe('6. Apr. 2026');
    expect(formatDateOnly('2026-04-06', { locale: 'ja-JP', style: 'long' })).toBe('2026年4月6日');
    expect(formatDateOnly('not a date')).toBe('not a date');
    expect(formatDateOnly(null)).toBe('');
    expect(formatMonthKey('2026-04')).toBe('April 2026');
    expect(formatMonthKey('2026-04', { short: true })).toBe('Apr 2026');
    expect(formatMonthKey('2026-04', { locale: 'es-ES' })).toBe('abril de 2026');
    expect(formatShortMonth(4)).toBe('Apr');
    expect(formatDateTime('2026-04-06T15:04:00')).toMatch(/Apr 6, 2026, 3:04\s?PM/);
    expect(formatDateTime(null)).toBe('');
  });
});
