/**
 * Derived types for the notifications feature. Row contracts (AppNotification,
 * NotificationSetting) live in `database.ts`; everything here is computed from
 * them at read time or used by the scan.
 */

import type {
  AppNotification,
  AppNotificationInput,
  BudgetStatus,
  NotificationRecurrence,
  NotificationSetting,
  RecurringSeries,
} from './database';

export type ReminderType = 'birthday' | 'anniversary' | 'seasonal' | 'custom';
export type AlertType = 'overdue_payment' | 'budget_overspend';
export type NotificationType = ReminderType | AlertType;

export const REMINDER_TYPES: readonly ReminderType[] = ['birthday', 'anniversary', 'seasonal', 'custom'];
export const ALERT_TYPES: readonly AlertType[] = ['overdue_payment', 'budget_overspend'];

/** Which page tab / surface a row belongs to, computed from status + dates + lead time. */
export type NotificationBucket = 'due' | 'upcoming' | 'history';

export interface ClassifiedNotification {
  notification: AppNotification;
  bucket: NotificationBucket;
  /** The occurrence the row currently points at ('YYYY-MM-DD'), null when undated. */
  occurrence: string | null;
  /** Resolved lead time (row override, else the per-type setting). */
  leadDays: number;
  /** Days from today to the occurrence: negative = overdue, 0 = today. Null when undated. */
  daysUntil: number | null;
  /** False when the row's type is disabled in settings (kept out of badge / card counts). */
  typeEnabled: boolean;
}

/** Form model for the reminder editor (user-created rows only). */
export interface ReminderDraft {
  type: ReminderType;
  title: string;
  body: string | null;
  due_date: string; // 'YYYY-MM-DD'
  recurrence: NotificationRecurrence;
  /** null = use the per-type default lead time. */
  lead_days: number | null;
  entity_table: 'recurring_series' | 'categories' | null;
  entity_id: number | null;
}

/** A linked payment the scan uses to decide whether a series was paid this cycle. */
export interface SeriesPaymentRow {
  series_id: number;
  date: string; // 'YYYY-MM-DD'
}

/** Everything `scanNotifications` reads and writes; the runtime supplies the real implementations. */
export interface NotificationScanContext {
  notifications: AppNotification[];
  settings: NotificationSetting[];
  recurringSeries: RecurringSeries[];
  listSeriesPaymentsSince: (sinceDate: string) => Promise<SeriesPaymentRow[]>;
  getBudgetStatus: (month: string) => Promise<BudgetStatus>;
  upsertByDedupeKey: (input: AppNotificationInput & { dedupe_key: string }) => Promise<number>;
  setStatus: (id: number, status: AppNotification['status'], snoozedUntil?: string | null) => Promise<void>;
  /** Advances a recurring reminder's due_date (and payload) in place. */
  update: (id: number, input: AppNotificationInput) => Promise<void>;
}

export interface NotificationScanSummary {
  today: string;
  alertsUpserted: number;
  alertsResolved: number;
  remindersAdvanced: number;
  snoozesExpired: number;
  /** Total rows written; zero means the collection did not need a refresh. */
  writes: number;
}

/** Payload stored on recurring user reminders so month-end anchors do not drift. */
export interface ReminderPayload {
  anchor_day?: number;
}

/** Payload stored on overdue_payment alerts. */
export interface OverduePaymentPayload {
  series_id: number;
  series_name: string;
  due_date: string;
  expected_amount: number | null;
}

/** Payload stored on budget_overspend alerts. */
export interface BudgetOverspendPayload {
  month: string;
  category_id: number;
  category_name: string;
  budgeted: number;
  actual: number;
}
