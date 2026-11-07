import { describe, expect, it } from 'vitest';

import { periodDateRange, weekStartsOnFor } from './periodRange';

// Saturday 2026-11-07, local time.
const now = new Date(2026, 10, 7, 15, 30);

describe('periodDateRange', () => {
  it('"This" periods are the calendar week, month and year containing today', () => {
    expect(periodDateRange('thisWeek', now)).toEqual({ start: '2026-11-01', end: '2026-11-07' });
    expect(periodDateRange('thisWeek', now, { weekStartsOn: 1 })).toEqual({ start: '2026-11-02', end: '2026-11-08' });
    expect(periodDateRange('thisMonth', now)).toEqual({ start: '2026-11-01', end: '2026-11-30' });
    expect(periodDateRange('thisYear', now)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });

  it('"Past" periods are rolling windows ending today', () => {
    expect(periodDateRange('pastWeek', now)).toEqual({ start: '2026-11-01', end: '2026-11-07' });
    expect(periodDateRange('pastMonth', now)).toEqual({ start: '2026-10-08', end: '2026-11-07' });
    expect(periodDateRange('pastYear', now)).toEqual({ start: '2025-11-08', end: '2026-11-07' });
  });

  it('a custom range uses the chosen dates, falling back to month-to-date', () => {
    expect(periodDateRange('custom', now, { customStart: '2026-01-15', customEnd: '2026-02-15' })).toEqual({
      start: '2026-01-15',
      end: '2026-02-15',
    });
    expect(periodDateRange('custom', now)).toEqual({ start: '2026-11-01', end: '2026-11-07' });
  });
});

describe('weekStartsOnFor', () => {
  it('reads the locale week start and falls back to Sunday', () => {
    expect(weekStartsOnFor('en-US')).toBe(0);
    // Node's ICU knows Germany starts on Monday; older runtimes fall back to Sunday.
    expect([0, 1]).toContain(weekStartsOnFor('de'));
    expect(weekStartsOnFor('not a locale!')).toBe(0);
  });
});
