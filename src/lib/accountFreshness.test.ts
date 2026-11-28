import { describe, expect, it } from 'vitest';

import { DEFAULT_NOTIFICATION_SETTINGS } from './databaseServiceNotifications';
import { DEFAULT_POSTING_GRACE_DAYS, dueConfirmation, resolveGraceDays } from './accountFreshness';
import type { NotificationSetting } from '@/types/database';

const TODAY = '2026-10-24';

describe('dueConfirmation', () => {
  it('has nothing to confirm while the due date is today or later', () => {
    expect(dueConfirmation('2026-10-24', { dataThrough: '2026-09-01' }, TODAY)).toBe('not_due');
    expect(dueConfirmation('2026-10-30', { dataThrough: null }, TODAY)).toBe('not_due');
  });

  it('keeps the device-date rule for an account that was never imported or is unknown', () => {
    expect(dueConfirmation('2026-10-20', undefined, TODAY)).toBe('confirmed');
    expect(dueConfirmation('2026-10-20', null, TODAY)).toBe('confirmed');
    expect(dueConfirmation('2026-10-20', { dataThrough: null }, TODAY)).toBe('confirmed');
  });

  it('confirms a missed payment only once the imported data runs past the due date plus the grace', () => {
    expect(dueConfirmation('2026-10-20', { dataThrough: '2026-10-18' }, TODAY, 3)).toBe('unconfirmed');
    expect(dueConfirmation('2026-10-20', { dataThrough: '2026-10-22' }, TODAY, 3)).toBe('unconfirmed');
    expect(dueConfirmation('2026-10-20', { dataThrough: '2026-10-23' }, TODAY, 3)).toBe('confirmed');
  });

  it('confirms as soon as the data reaches the due date when there is no grace', () => {
    expect(dueConfirmation('2026-10-20', { dataThrough: '2026-10-19' }, TODAY, 0)).toBe('unconfirmed');
    expect(dueConfirmation('2026-10-20', { dataThrough: '2026-10-20' }, TODAY, 0)).toBe('confirmed');
    // A negative grace is treated as none.
    expect(dueConfirmation('2026-10-20', { dataThrough: '2026-10-20' }, TODAY, -4)).toBe('confirmed');
  });

  it('uses the default grace when none is given', () => {
    expect(DEFAULT_POSTING_GRACE_DAYS).toBe(3);
    expect(dueConfirmation('2026-10-20', { dataThrough: '2026-10-22' }, TODAY)).toBe('unconfirmed');
    expect(dueConfirmation('2026-10-20', { dataThrough: '2026-10-23' }, TODAY)).toBe('confirmed');
  });
});

describe('resolveGraceDays', () => {
  const withGrace = (grace: number | null | undefined): NotificationSetting[] =>
    DEFAULT_NOTIFICATION_SETTINGS.map((setting) => (setting.type === 'overdue_payment' ? { ...setting, grace_days: grace } : setting));

  it('reads the payment alert setting, else the default', () => {
    expect(resolveGraceDays(DEFAULT_NOTIFICATION_SETTINGS)).toBe(3);
    expect(resolveGraceDays([])).toBe(3);
    expect(resolveGraceDays(withGrace(null))).toBe(3);
    expect(resolveGraceDays(withGrace(0))).toBe(0);
    expect(resolveGraceDays(withGrace(7))).toBe(7);
  });

  it('keeps a stored value within 0 to 30 days', () => {
    expect(resolveGraceDays(withGrace(-2))).toBe(0);
    expect(resolveGraceDays(withGrace(90))).toBe(30);
    expect(resolveGraceDays(withGrace(Number.NaN))).toBe(3);
  });
});
