import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  addDaysISO,
  addMonthsISO,
  isDateOnly,
  parseCsvDate,
  toLocalDateOnly,
  todayLocalISO,
} from './dateOnly';

describe('dateOnly', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats a Date by its local calendar fields, not UTC', () => {
    // 8pm local on the 14th: toISOString() would roll to the 15th anywhere west of UTC.
    const evening = new Date(2026, 8, 14, 20, 30, 0);
    expect(toLocalDateOnly(evening)).toBe('2026-09-14');
  });

  it('reports today using the local clock', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 31, 23, 59, 0));
    expect(todayLocalISO()).toBe('2026-01-31');
  });

  it('adds days across month and year boundaries', () => {
    expect(addDaysISO('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysISO('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('adds months and clamps the day to the target month', () => {
    expect(addMonthsISO('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsISO('2026-08-31', -6)).toBe('2026-02-28');
    expect(addMonthsISO('2026-03-15', -6)).toBe('2025-09-15');
    expect(addMonthsISO('2026-11-30', 3)).toBe('2027-02-28');
  });

  it('validates well-formed calendar dates only', () => {
    expect(isDateOnly('2026-02-29')).toBe(false);
    expect(isDateOnly('2024-02-29')).toBe(true);
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('04/26/2026')).toBe(false);
  });

  it.each([
    ['2026-04-26', '2026-04-26'],
    ['2026-04-26T14:05:00Z', '2026-04-26'],
    ['2026-04-26T23:30:00.000-04:00', '2026-04-26'],
    ['04/26/2026', '2026-04-26'],
    ['4/6/2026', '2026-04-06'],
    ['04/26/26', '2026-04-26'],
    ['04-26-2026', '2026-04-26'],
    ['26-Apr-2026', '2026-04-26'],
    ['Apr 26, 2026', '2026-04-26'],
    ['April 26, 2026', '2026-04-26'],
    ['20260426', '2026-04-26'],
    ['2026/04/26', '2026-04-26'],
    ['  "04/26/2026 08:15:00"  ', '2026-04-26'],
  ])('parses bank export date %s as %s', (input, expected) => {
    expect(parseCsvDate(input)).toBe(expected);
  });

  it.each(['', '   ', 'Pending', 'N/A', '2026-02-30', '99/99/2026', null, undefined])(
    'refuses to guess a date for %s',
    (input) => {
      expect(parseCsvDate(input)).toBeNull();
    }
  );

  it('resolves ambiguous numeric dates by the requested day/month order', () => {
    expect(parseCsvDate('04/06/2026')).toBe('2026-04-06');
    expect(parseCsvDate('04/06/2026', { order: 'MDY' })).toBe('2026-04-06');
    expect(parseCsvDate('04/06/2026', { order: 'DMY' })).toBe('2026-06-04');
    expect(parseCsvDate('04/06/2026', { order: 'YMD' })).toBe('2026-06-04');
    expect(parseCsvDate('04.06.2026', { order: 'DMY' })).toBe('2026-06-04');
    expect(parseCsvDate('4.6.26', { order: 'DMY' })).toBe('2026-06-04');
  });

  it('falls through to the other order when the first reading is impossible', () => {
    // 26 cannot be a month, so a US reader still gets 26 April.
    expect(parseCsvDate('26/04/2026', { order: 'MDY' })).toBe('2026-04-26');
    // 13 cannot be a month either, so a European reader still gets 13 November.
    expect(parseCsvDate('11/13/2026', { order: 'DMY' })).toBe('2026-11-13');
  });

  it('strict mode reads one order only, so a file is never read with two', () => {
    // The Import Wizard fixes the order per file: a value that only works the
    // other way round is unreadable, not silently reinterpreted.
    expect(parseCsvDate('26/04/2026', { order: 'MDY', strict: true })).toBeNull();
    expect(parseCsvDate('11/13/2026', { order: 'DMY', strict: true })).toBeNull();
    expect(parseCsvDate('04/06/2026', { order: 'MDY', strict: true })).toBe('2026-04-06');
    expect(parseCsvDate('04/06/2026', { order: 'DMY', strict: true })).toBe('2026-06-04');
    // Unambiguous shapes still parse in every order.
    expect(parseCsvDate('2026-04-26', { order: 'MDY', strict: true })).toBe('2026-04-26');
    expect(parseCsvDate('Apr 26, 2026', { order: 'DMY', strict: true })).toBe('2026-04-26');
    expect(parseCsvDate('2026年4月6日', { order: 'YMD', strict: true })).toBe('2026-04-06');
  });

  it.each([
    ['2026/04/06', '2026-04-06'],
    ['2026年4月6日', '2026-04-06'],
    ['2026.04.06', '2026-04-06'],
    ['20260406', '2026-04-06'],
  ])('parses year-first date %s as %s regardless of order', (input, expected) => {
    expect(parseCsvDate(input, { order: 'YMD' })).toBe(expected);
    expect(parseCsvDate(input, { order: 'DMY' })).toBe(expected);
    expect(parseCsvDate(input, { order: 'MDY' })).toBe(expected);
  });
});
