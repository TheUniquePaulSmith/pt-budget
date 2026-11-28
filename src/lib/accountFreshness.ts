/**
 * Whether a missed payment is known to be missed (schema v8). Transactions
 * only arrive through imports, so "the due date has passed" is not enough:
 * the account's data has to cover the due date too. Pure: no React, no database.
 *
 *   not_due      the due date is today or later; nothing to confirm yet
 *   confirmed    the account's imported data runs at least `graceDays` past the
 *                due date and the payment is not in it, or the account was
 *                never imported (its data is entered by hand, so the device's
 *                date is all there is)
 *   unconfirmed  the due date passed, but the account has not been imported far
 *                enough since: the payment may well be there in the next import
 */

import { addDaysISO } from './dateOnly';
import type { NotificationSetting } from '@/types/database';

export type DueConfirmation = 'not_due' | 'confirmed' | 'unconfirmed';

/** Days a payment may take to appear in a bank export after its due date. */
export const DEFAULT_POSTING_GRACE_DAYS = 3;
export const MAX_POSTING_GRACE_DAYS = 30;

/** Just what the rule needs from an account's freshness (`AccountFreshness.dataThrough`). */
export interface FreshnessPoint {
  dataThrough: string | null;
}

export function dueConfirmation(
  dueDate: string,
  freshness: FreshnessPoint | null | undefined,
  today: string,
  graceDays: number = DEFAULT_POSTING_GRACE_DAYS
): DueConfirmation {
  if (dueDate >= today) return 'not_due';
  const through = freshness?.dataThrough;
  if (!through) return 'confirmed';
  return through >= addDaysISO(dueDate, Math.max(0, graceDays)) ? 'confirmed' : 'unconfirmed';
}

/** The `overdue_payment` grace: the stored value kept within 0…30, else the default. */
export function resolveGraceDays(settings: ReadonlyArray<NotificationSetting>): number {
  const stored = settings.find((setting) => setting.type === 'overdue_payment')?.grace_days;
  if (stored == null || !Number.isFinite(stored)) return DEFAULT_POSTING_GRACE_DAYS;
  return Math.min(MAX_POSTING_GRACE_DAYS, Math.max(0, Math.round(stored)));
}
