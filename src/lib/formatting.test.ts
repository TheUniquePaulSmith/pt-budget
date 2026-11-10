import { describe, expect, it } from 'vitest';

import {
  currencyPickerSymbol,
  currencySymbol,
  dateOnlyToLocalDate,
  formatDateOnly,
  formatDateTime,
  formatMoney,
  formatMonthKey,
  formatNumber,
  formatPercent,
  formatShortMonth,
  formatTime,
  storedTimestampToDate,
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

  it('keeps the default currency’s short symbol and tells every other currency apart from it', () => {
    const base = { referenceCurrency: 'USD' };
    // The default currency is unchanged.
    expect(formatMoney(12, { ...base, currency: 'USD' })).toBe('$12.00');
    // Dollar-sign currencies no longer pass for USD…
    expect(formatMoney(12, { ...base, currency: 'CAD' })).toBe('CA$12.00');
    expect(formatMoney(12, { ...base, currency: 'AUD' })).toBe('A$12.00');
    expect(formatMoney(12, { ...base, currency: 'MXN' })).toBe('MX$12.00');
    expect(formatMoney(12, { ...base, currency: 'NZD' })).toBe('NZ$12.00');
    // …nor do yuan for yen, or the Nordic crowns for each other.
    expect(formatMoney(1200, { ...base, currency: 'CNY' })).toBe('CN¥1,200.00');
    expect(formatMoney(1200, { ...base, currency: 'JPY' })).toBe('¥1,200');
    expect(formatMoney(12, { ...base, currency: 'SEK' })).toMatch(/^SEK\s12\.00$/);
    // Unambiguous symbols are unchanged.
    expect(formatMoney(12, { ...base, currency: 'EUR' })).toBe('€12.00');
    expect(formatMoney(12, { ...base, currency: 'GBP' })).toBe('£12.00');
    // Signs and whole amounts still apply.
    expect(formatMoney(-12, { ...base, currency: 'CAD' })).toBe('-CA$12.00');
    expect(formatMoney(12, { ...base, currency: 'CAD', signed: true })).toBe('+CA$12.00');
    expect(formatMoney(1234.5, { ...base, currency: 'CAD', whole: true })).toBe('CA$1,235');
    expect(formatMoney(1234.5, { ...base, currency: 'CAD', symbolless: true })).toBe('1,234.50');
  });

  it('uses the ISO code when a foreign currency’s symbol would match the default’s', () => {
    // A US dollar account in a Canadian-dollar household: both would be "$".
    expect(formatMoney(12, { referenceCurrency: 'CAD', currency: 'CAD' })).toBe('$12.00');
    expect(formatMoney(12, { referenceCurrency: 'CAD', currency: 'USD' })).toMatch(/^USD\s12\.00$/);
    // A yuan household with a yen account.
    expect(formatMoney(12, { referenceCurrency: 'CNY', currency: 'JPY' })).toMatch(/^JPY\s12$/);
    // A euro household with a US dollar account keeps "$".
    expect(formatMoney(12, { referenceCurrency: 'EUR', currency: 'USD' })).toBe('$12.00');
  });

  it('localises the distinguishing symbol and leaves amounts without a reference unchanged', () => {
    expect(formatMoney(12, { currency: 'CAD' })).toBe('$12.00');
    expect(formatMoney(12, { currency: 'CAD', locale: 'pt-BR', referenceCurrency: 'BRL' })).toMatch(/^CA\$\s?12,00$/);
    expect(formatMoney(12, { currency: 'USD', locale: 'pt-BR', referenceCurrency: 'BRL' })).toMatch(/^US\$\s?12,00$/);
    expect(formatMoney(12, { currency: 'CAD', locale: 'de-DE', referenceCurrency: 'EUR' })).toMatch(/^12,00\sCA\$$/);
  });

  it('gives currencySymbol the same distinguishable symbol as formatMoney', () => {
    expect(currencySymbol('CAD')).toBe('$');
    expect(currencySymbol('CAD', 'en-US', 'USD')).toBe('CA$');
    expect(currencySymbol('USD', 'en-US', 'USD')).toBe('$');
    expect(currencySymbol('USD', 'en-US', 'CAD')).toBe('USD');
    expect(currencySymbol('NOTACODE', 'en-US', 'USD')).toBe('NOTACODE');
  });

  it('picks the symbol shown beside a currency in a picker', () => {
    expect(currencyPickerSymbol('USD')).toBe('$');
    expect(currencyPickerSymbol('CAD')).toBe('CA$');
    expect(currencyPickerSymbol('EUR')).toBe('€');
    expect(currencyPickerSymbol('CNY')).toBe('CN¥');
    // Only the code as a standard symbol: fall back to the narrow one.
    expect(currencyPickerSymbol('SEK')).toBe('kr');
    expect(currencyPickerSymbol('PLN')).toBe('zł');
    // Nothing but the code to show.
    expect(currencyPickerSymbol('CHF')).toBeNull();
    expect(currencyPickerSymbol('NOTACODE')).toBeNull();
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

  // SQLite's CURRENT_TIMESTAMP writes UTC with no zone marker ("2026-11-10 22:12:32").
  // These tests never assert a wall-clock text for such a value: that text depends on
  // the zone of the machine running the suite. They compare with the same instant
  // written as ISO "…Z" (formatted in the same zone, so equal on every machine) or
  // check the instant itself. On a UTC machine the comparisons pass even with the bug,
  // which is why the instant is also asserted directly.
  describe('timestamps stored by SQLite (UTC, no zone marker)', () => {
    const SQLITE = '2026-11-10 22:12:32';
    const SAME_INSTANT_ISO = '2026-11-10T22:12:32Z';
    const INSTANT_MS = Date.UTC(2026, 10, 10, 22, 12, 32);

    it('formats a zone-less SQLite timestamp as the same instant as its ISO "Z" form', () => {
      expect(formatDateTime(SQLITE)).toBe(formatDateTime(SAME_INSTANT_ISO));
      expect(formatDateTime(SQLITE, { seconds: true })).toBe(formatDateTime(SAME_INSTANT_ISO, { seconds: true }));
      expect(formatDateTime(SQLITE, { locale: 'de-DE' })).toBe(formatDateTime(SAME_INSTANT_ISO, { locale: 'de-DE' }));
      expect(formatTime(SQLITE)).toBe(formatTime(SAME_INSTANT_ISO));
      expect(formatTime(SQLITE, { seconds: true })).toBe(formatTime(SAME_INSTANT_ISO, { seconds: true }));
    });

    it('reads a zone-less SQLite timestamp as UTC, with or without seconds and fractions', () => {
      expect(storedTimestampToDate(SQLITE)?.getTime()).toBe(INSTANT_MS);
      expect(storedTimestampToDate('2026-11-10 22:12')?.getTime()).toBe(Date.UTC(2026, 10, 10, 22, 12));
      expect(storedTimestampToDate('2026-11-10 22:12:32.5')?.getTime()).toBe(INSTANT_MS + 500);
      expect(storedTimestampToDate('2026-11-10 22:12:32.123')?.getTime()).toBe(INSTANT_MS + 123);
      expect(storedTimestampToDate('2026-11-10 22:12:32.123456')?.getTime()).toBe(INSTANT_MS + 123);
      expect(storedTimestampToDate(' 2026-11-10 22:12:32 ')?.getTime()).toBe(INSTANT_MS);
    });

    it('leaves values that already say which instant they are untouched', () => {
      expect(storedTimestampToDate(SAME_INSTANT_ISO)?.getTime()).toBe(INSTANT_MS);
      expect(storedTimestampToDate('2026-11-10T22:12:32.000Z')?.getTime()).toBe(INSTANT_MS);
      expect(storedTimestampToDate('2026-11-10T17:12:32-05:00')?.getTime()).toBe(INSTANT_MS);
      expect(storedTimestampToDate('2026-11-11T07:12:32+09:00')?.getTime()).toBe(INSTANT_MS);
      expect(storedTimestampToDate(INSTANT_MS)?.getTime()).toBe(INSTANT_MS);
      const date = new Date(INSTANT_MS);
      expect(storedTimestampToDate(date)).toBe(date);
    });

    it('keeps calendar dates and zone-less ISO "T" strings in local time', () => {
      // A yyyy-MM-dd value is a calendar date: local midnight, as dateOnlyToLocalDate builds it.
      const day = storedTimestampToDate('2026-04-06');
      expect(day?.getTime()).toBe(new Date(2026, 3, 6).getTime());
      expect(day?.getTime()).toBe(dateOnlyToLocalDate('2026-04-06')?.getTime());
      // ECMAScript reads "yyyy-MM-ddTHH:mm:ss" without a zone as local time; SQLite never writes that shape.
      expect(storedTimestampToDate('2026-04-06T15:04:00')?.getTime()).toBe(new Date(2026, 3, 6, 15, 4, 0).getTime());
    });

    it('returns null for missing or unreadable values, which the formatters print as they are', () => {
      expect(storedTimestampToDate(null)).toBeNull();
      expect(storedTimestampToDate(undefined)).toBeNull();
      expect(storedTimestampToDate('')).toBeNull();
      expect(storedTimestampToDate('not a timestamp')).toBeNull();
      expect(storedTimestampToDate('2026-13-45 99:99:99')).toBeNull();
      expect(storedTimestampToDate(Number.NaN)).toBeNull();
      expect(storedTimestampToDate(new Date(Number.NaN))).toBeNull();
      expect(formatDateTime('not a timestamp')).toBe('not a timestamp');
      expect(formatTime('not a timestamp')).toBe('not a timestamp');
      expect(formatTime(null)).toBe('');
    });
  });
});
