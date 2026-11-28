/**
 * Labels and formatting shared by the notification surfaces. Every label is
 * resolved through a `t` bound to the `notifications` namespace at render
 * time, so the language can change while the app is open.
 */

import type { ChipProps } from '@mui/material';
import type { TFunction } from 'i18next';

import { addDaysISO, todayLocalISO } from '@/lib/dateOnly';
import {
  budgetOverspendText,
  daysBetween,
  isUnconfirmedOverdue,
  overdueConfirmation,
  loanPromoBody,
  loanPromoTitle,
  overduePaymentText,
  parsePayload,
  staleAccountText,
  type StoredBudgetOverspendPayload,
  type StoredLoanPromoPayload,
} from '@/lib/notificationService';
import type { AppNotification, NotificationRecurrence, NotificationStatus } from '@/types/database';
import { ALERT_TYPES, REMINDER_TYPES, type ClassifiedNotification, type NotificationType, type OverduePaymentPayload, type StaleAccountPayload } from '@/types/notifications';

export type NotificationsT = TFunction<'notifications'>;

const NOTIFICATION_TYPES: readonly string[] = [...REMINDER_TYPES, ...ALERT_TYPES];
const RECURRENCES: readonly NotificationRecurrence[] = ['once', 'monthly', 'yearly'];
const STATUSES: readonly NotificationStatus[] = ['active', 'snoozed', 'dismissed', 'done'];

/** Recurrence values in display order (the editor's "Repeats" options). */
export const RECURRENCE_VALUES = RECURRENCES;

function isNotificationType(type: string): type is NotificationType {
  return NOTIFICATION_TYPES.includes(type);
}

/** "Birthday", "Payment due", … (unknown types fall back to the raw value). */
export function typeLabel(type: string, t: NotificationsT): string {
  return isNotificationType(type) ? t(`type.${type}`) : type;
}

export function typeDescription(type: NotificationType, t: NotificationsT): string {
  return t(`typeDescription.${type}`);
}

export function recurrenceLabel(recurrence: string, t: NotificationsT): string {
  return (RECURRENCES as readonly string[]).includes(recurrence) ? t(`recurrence.${recurrence as NotificationRecurrence}`) : recurrence;
}

export function statusLabel(status: string, t: NotificationsT): string {
  return (STATUSES as readonly string[]).includes(status) ? t(`status.${status as NotificationStatus}`) : status;
}

/** The day a classified row was classified against (`daysUntil` counts from it). */
function classifiedToday(entry: ClassifiedNotification): string {
  return entry.occurrence && entry.daysUntil !== null ? addDaysISO(entry.occurrence, -entry.daysUntil) : todayLocalISO();
}

/** Schema v8: a passed payment due date the account's imports do not cover yet. */
export function isUnconfirmedEntry(entry: ClassifiedNotification): boolean {
  return isUnconfirmedOverdue(entry.notification, classifiedToday(entry));
}

export function typeChipColor(
  notification: Pick<AppNotification, 'kind' | 'type'> & Partial<Pick<AppNotification, 'payload_json'>>,
  today: string = todayLocalISO()
): ChipProps['color'] {
  if (notification.kind === 'alert') {
    if (isUnconfirmedOverdue({ type: notification.type, payload_json: notification.payload_json ?? null }, today)) return 'warning';
    return notification.type === 'budget_overspend' || notification.type === 'loan_promo_ending' || notification.type === 'stale_account'
      ? 'warning'
      : 'error';
  }
  return 'primary';
}

/** "Due today", "Due in 3 days", "4 days overdue", "No date", or the snooze date. */
export function describeTiming(entry: ClassifiedNotification, t: NotificationsT, formatDate: (iso: string) => string = (iso) => iso): string {
  const { notification, daysUntil } = entry;
  if (notification.status === 'snoozed' && notification.snoozed_until && entry.bucket === 'upcoming') {
    return t('timing.snoozedUntil', { date: formatDate(notification.snoozed_until) });
  }
  if (daysUntil === null) return t('timing.noDate');
  if (isUnconfirmedEntry(entry)) return t('timing.notConfirmed');
  if (daysUntil === 0) return t('timing.dueToday');
  if (daysUntil === 1) return t('timing.dueTomorrow');
  if (daysUntil > 1) return t('timing.dueInDays', { count: daysUntil });
  return t('timing.overdue', { count: -daysUntil });
}

export function timingColor(entry: ClassifiedNotification): 'error' | 'warning' | 'default' {
  if (entry.daysUntil === null) return 'default';
  if (isUnconfirmedEntry(entry)) return 'warning';
  if (entry.daysUntil < 0) return 'error';
  if (entry.daysUntil === 0) return 'warning';
  return 'default';
}

export interface DescribeNotificationOptions {
  /** Formats a `yyyy-MM-dd` date for display; the ISO date is shown when omitted. */
  date?: (iso: string) => string;
  /** Formats a `yyyy-MM` month key for display; the key is shown when omitted. */
  month?: (monthKey: string) => string;
  /** The day "due in N days" counts from (defaults to the local date). */
  today?: string;
  /** The label of an account (an unconfirmed payment names the account to import). */
  accountName?: (accountId: number) => string | null;
}

export interface NotificationText {
  title: string;
  body: string | null;
}

/**
 * The title and body to show for a notification. System alerts are rebuilt
 * from their type and payload in the current language and the household's
 * default currency; when the payload is missing (or lacks a figure the body
 * needs) the stored text is used. User reminders show their stored text.
 */
export function describeNotification(
  notification: Pick<AppNotification, 'kind' | 'source' | 'type' | 'title' | 'body' | 'payload_json'>,
  t: NotificationsT,
  money: (amount: number) => string,
  options: DescribeNotificationOptions = {}
): NotificationText {
  const stored: NotificationText = { title: notification.title, body: notification.body ?? null };
  if (notification.kind !== 'alert' || notification.source !== 'system') return stored;
  const absMoney = (amount: number) => money(Math.abs(amount));
  const today = options.today ?? todayLocalISO();

  switch (notification.type) {
    case 'overdue_payment': {
      const payload = parsePayload<OverduePaymentPayload>(notification.payload_json);
      if (!payload?.series_name || !payload.due_date) return stored;
      return overduePaymentText(
        {
          name: payload.series_name,
          daysUntil: daysBetween(today, payload.due_date),
          dueDate: payload.due_date,
          expectedAmount: payload.expected_amount ?? null,
          confirmation: overdueConfirmation(payload, today),
          dataThrough: payload.data_through ?? null,
          accountName: payload.account_id == null ? null : (options.accountName?.(payload.account_id) ?? null),
        },
        t,
        absMoney,
        options.date
      );
    }
    case 'stale_account': {
      const payload = parsePayload<StaleAccountPayload>(notification.payload_json);
      if (!payload?.account_name || !payload.data_through) return stored;
      return staleAccountText(payload, t, options.date, options.accountName?.(payload.account_id) ?? null);
    }
    case 'loan_promo_ending': {
      const payload = parsePayload<StoredLoanPromoPayload>(notification.payload_json);
      if (!payload?.loan_name || !payload.promo_end_date) return stored;
      const daysUntil = daysBetween(today, payload.promo_end_date);
      return {
        title: loanPromoTitle(payload, t, options.date),
        body: loanPromoBody(payload, daysUntil, t, absMoney, options.date) ?? stored.body,
      };
    }
    case 'budget_overspend': {
      const payload = parsePayload<StoredBudgetOverspendPayload>(notification.payload_json);
      if (!payload?.category_name || !payload.month || typeof payload.budgeted !== 'number' || typeof payload.actual !== 'number') return stored;
      return budgetOverspendText(payload, t, absMoney, options.month);
    }
    default:
      return stored;
  }
}
