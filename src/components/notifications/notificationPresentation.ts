/**
 * Labels and formatting shared by the notification surfaces.
 */

import type { ChipProps } from '@mui/material';

import { formatDueLabel } from '@/lib/notificationService';
import type { AppNotification, NotificationRecurrence, NotificationStatus } from '@/types/database';
import type { ClassifiedNotification, NotificationType } from '@/types/notifications';

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  birthday: 'Birthday',
  anniversary: 'Anniversary',
  seasonal: 'Seasonal',
  custom: 'Custom reminder',
  overdue_payment: 'Payment due',
  budget_overspend: 'Budget overspend',
};

export const NOTIFICATION_TYPE_DESCRIPTIONS: Record<NotificationType, string> = {
  birthday: 'Birthdays you want to remember, repeating every year.',
  anniversary: 'Anniversaries and other yearly dates.',
  seasonal: 'Seasonal chores and renewals (taxes, insurance, winterizing).',
  custom: 'Anything else, one-off or repeating.',
  overdue_payment: 'Subscriptions and bills you pay by hand that are due or overdue (series not marked autopay).',
  budget_overspend: 'A budget category that has gone over its monthly amount.',
};

export const RECURRENCE_LABELS: Record<NotificationRecurrence, string> = {
  once: 'Once',
  monthly: 'Monthly',
  yearly: 'Yearly',
};

export const STATUS_LABELS: Record<NotificationStatus, string> = {
  active: 'Active',
  snoozed: 'Snoozed',
  dismissed: 'Dismissed',
  done: 'Done',
};

export function typeLabel(type: string): string {
  return NOTIFICATION_TYPE_LABELS[type as NotificationType] ?? type;
}

export function typeChipColor(notification: Pick<AppNotification, 'kind' | 'type'>): ChipProps['color'] {
  if (notification.kind === 'alert') return notification.type === 'budget_overspend' ? 'warning' : 'error';
  return 'primary';
}

/** "Due today", "Due in 3 days", "4 days overdue", "No date", or the snooze date. */
export function describeTiming(entry: ClassifiedNotification): string {
  const { notification, daysUntil } = entry;
  if (notification.status === 'snoozed' && notification.snoozed_until && entry.bucket === 'upcoming') {
    return `Snoozed until ${notification.snoozed_until}`;
  }
  if (daysUntil === null) return 'No date';
  const label = formatDueLabel(daysUntil);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function timingColor(entry: ClassifiedNotification): 'error' | 'warning' | 'default' {
  if (entry.daysUntil === null) return 'default';
  if (entry.daysUntil < 0) return 'error';
  if (entry.daysUntil === 0) return 'warning';
  return 'default';
}
