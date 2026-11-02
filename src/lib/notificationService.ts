/**
 * Notification logic: occurrence math, due/upcoming classification, the
 * system-alert scan and its re-entrancy guard. Everything here is pure (or
 * takes its I/O through `NotificationScanContext`) so it is unit-testable
 * without a worker; `NotificationsRuntime` wires it to the database.
 *
 * Vocabulary:
 *   occurrence  the calendar date a row currently points at (for recurring
 *               reminders: the first occurrence on/after today minus a grace
 *               window, so a birthday that was never marked done rolls on to
 *               next year a week after it passed instead of staying overdue
 *               for eleven months)
 *   lead        days before the occurrence a row becomes "due"
 *               (`lead_days` on the row, else `notification_settings[type]`)
 *   due         today >= occurrence - lead (includes overdue)
 *   upcoming    not yet due, or snoozed into the future
 *   history     dismissed / done
 */

import type { TFunction } from 'i18next';

import { DEFAULT_CURRENCY } from './currencies';
import { addDaysISO, todayLocalISO } from './dateOnly';
import { DEFAULT_LOCALE, formatMoney } from './formatting';
import { i18n, intlLocaleFor, isLanguageCode } from './i18n';
import { logger } from './logging';
import { DEFAULT_NOTIFICATION_SETTINGS } from './databaseServiceNotifications';
import type {
  AppNotification,
  AppNotificationInput,
  BudgetStatus,
  Loan,
  NotificationRecurrence,
  NotificationSetting,
  NotificationStatus,
  RecurringSeries,
} from '@/types/database';
import type { LoanSummary } from '@/types/loans';
import type {
  BudgetOverspendPayload,
  ClassifiedNotification,
  LoanPromoPayload,
  NotificationBucket,
  NotificationScanContext,
  NotificationScanSummary,
  OverduePaymentPayload,
  ReminderPayload,
  SeriesPaymentRow,
} from '@/types/notifications';

const log = logger.child({ component: 'NotificationService' });

/** app_metadata keys owned by this feature. */
export const NOTIFICATIONS_ENABLED_KEY = 'notifications.enabled';
export const NOTIFICATIONS_OS_ENABLED_KEY = 'notifications.os_enabled';
export const NOTIFICATIONS_LAST_SCAN_KEY = 'notifications.last_scan_at';

/** Days a passed recurring occurrence stays "the current one" before rolling forward. */
export const RECURRING_GRACE_DAYS = 7;
/** Days the dashboard card looks ahead for upcoming rows. */
export const DASHBOARD_LOOKAHEAD_DAYS = 7;
/** Lead time used when neither the row nor settings carry one (should not happen). */
const FALLBACK_LEAD_DAYS = 7;

// ---------------------------------------------------------------------------
// Calendar helpers
// ---------------------------------------------------------------------------

function splitIso(iso: string): [number, number, number] {
  const [year, month, day] = iso.split('-').map(Number);
  return [year, month, day];
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function formatIso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = splitIso(from);
  const [ty, tm, td] = splitIso(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** `year-month` with `day` clamped to the month's length (Jan 31 → Feb 28/29). */
export function clampedDate(year: number, month: number, day: number): string {
  return formatIso(year, month, Math.min(day, daysInMonth(year, month)));
}

/** Monthly/yearly occurrence of `anchor` that is on or after `notBefore`; 'once' returns the anchor itself. */
export function nextOccurrence(anchor: string, recurrence: NotificationRecurrence, notBefore: string, anchorDay?: number): string {
  if (recurrence === 'once' || anchor >= notBefore) return anchor;
  const [, anchorMonth, anchorDayOfMonth] = splitIso(anchor);
  const day = anchorDay ?? anchorDayOfMonth;
  const [year, month] = splitIso(notBefore);

  if (recurrence === 'monthly') {
    let candidate = clampedDate(year, month, day);
    if (candidate < notBefore) {
      const next = month === 12 ? [year + 1, 1] : [year, month + 1];
      candidate = clampedDate(next[0], next[1], day);
    }
    return candidate;
  }

  // yearly
  const candidate = clampedDate(year, anchorMonth, day);
  return candidate < notBefore ? clampedDate(year + 1, anchorMonth, day) : candidate;
}

/** The occurrence strictly after `current` (used when a recurring reminder is completed). */
export function advanceOccurrence(current: string, recurrence: NotificationRecurrence, anchorDay?: number): string {
  if (recurrence === 'once') return current;
  return nextOccurrence(current, recurrence, addDaysISO(current, 1), anchorDay);
}

export function parsePayload<T>(payloadJson: string | null | undefined): T | null {
  if (!payloadJson) return null;
  try {
    return JSON.parse(payloadJson) as T;
  } catch {
    return null;
  }
}

function anchorDayOf(notification: Pick<AppNotification, 'due_date' | 'payload_json'>): number | undefined {
  const payload = parsePayload<ReminderPayload>(notification.payload_json);
  if (payload?.anchor_day && payload.anchor_day >= 1 && payload.anchor_day <= 31) return payload.anchor_day;
  return notification.due_date ? splitIso(notification.due_date)[2] : undefined;
}

// ---------------------------------------------------------------------------
// Settings / lead-time resolution
// ---------------------------------------------------------------------------

export function settingFor(settings: ReadonlyArray<NotificationSetting>, type: string): NotificationSetting | undefined {
  return settings.find((setting) => setting.type === type) ?? DEFAULT_NOTIFICATION_SETTINGS.find((setting) => setting.type === type);
}

export function resolveLeadDays(
  notification: Pick<AppNotification, 'type' | 'lead_days'>,
  settings: ReadonlyArray<NotificationSetting>
): number {
  if (notification.lead_days != null && Number.isFinite(notification.lead_days)) return Math.max(0, notification.lead_days);
  const setting = settingFor(settings, notification.type);
  return setting ? Math.max(0, setting.lead_days) : FALLBACK_LEAD_DAYS;
}

export function isTypeEnabled(settings: ReadonlyArray<NotificationSetting>, type: string): boolean {
  const setting = settingFor(settings, type);
  return setting ? Boolean(setting.enabled) : true;
}

// ---------------------------------------------------------------------------
// Classification (read-time)
// ---------------------------------------------------------------------------

/** The occurrence a row currently points at, given today. */
export function currentOccurrence(notification: AppNotification, today: string): string | null {
  if (!notification.due_date) return null;
  const recurring = notification.recurrence === 'monthly' || notification.recurrence === 'yearly';
  if (!recurring || notification.kind === 'alert') return notification.due_date;
  return nextOccurrence(notification.due_date, notification.recurrence, addDaysISO(today, -RECURRING_GRACE_DAYS), anchorDayOf(notification));
}

export function classifyNotification(
  notification: AppNotification,
  settings: ReadonlyArray<NotificationSetting>,
  today: string = todayLocalISO()
): ClassifiedNotification {
  const leadDays = resolveLeadDays(notification, settings);
  const occurrence = currentOccurrence(notification, today);
  const daysUntil = occurrence ? daysBetween(today, occurrence) : null;
  const typeEnabled = isTypeEnabled(settings, notification.type);

  let bucket: NotificationBucket;
  if (notification.status === 'dismissed' || notification.status === 'done') {
    bucket = 'history';
  } else if (notification.status === 'snoozed' && notification.snoozed_until && notification.snoozed_until > today) {
    bucket = 'upcoming';
  } else if (daysUntil === null || daysUntil <= leadDays) {
    bucket = 'due';
  } else {
    bucket = 'upcoming';
  }

  return { notification, bucket, occurrence, leadDays, daysUntil, typeEnabled };
}

export function classifyNotifications(
  notifications: ReadonlyArray<AppNotification>,
  settings: ReadonlyArray<NotificationSetting>,
  today: string = todayLocalISO()
): ClassifiedNotification[] {
  return notifications.map((notification) => classifyNotification(notification, settings, today));
}

/** Rows the badge / card count: due, with their type enabled. */
export function selectDue(classified: ReadonlyArray<ClassifiedNotification>): ClassifiedNotification[] {
  return classified
    .filter((entry) => entry.bucket === 'due' && entry.typeEnabled)
    .sort(compareByOccurrence);
}

/** Upcoming rows whose occurrence is within `days` of today (dashboard card). */
export function selectUpcomingWithin(classified: ReadonlyArray<ClassifiedNotification>, days: number): ClassifiedNotification[] {
  return classified
    .filter((entry) => entry.bucket === 'upcoming' && entry.typeEnabled && entry.daysUntil !== null && entry.daysUntil <= days)
    .sort(compareByOccurrence);
}

export function compareByOccurrence(a: ClassifiedNotification, b: ClassifiedNotification): number {
  const left = a.occurrence ?? '';
  const right = b.occurrence ?? '';
  if (left !== right) return left < right ? -1 : 1;
  return a.notification.id - b.notification.id;
}

// ---------------------------------------------------------------------------
// User actions
// ---------------------------------------------------------------------------

/**
 * What "Done" means for a row: recurring reminders advance to their next
 * occurrence and stay active; everything else closes with status 'done'.
 */
export function completeNotification(
  notification: AppNotification,
  today: string = todayLocalISO()
): { kind: 'advance'; input: AppNotificationInput } | { kind: 'close' } {
  if (notification.kind !== 'reminder' || notification.recurrence === 'once' || !notification.due_date) {
    return { kind: 'close' };
  }
  const anchorDay = anchorDayOf(notification);
  // currentOccurrence never points further back than the grace window, so
  // advancing it once always lands after today for monthly/yearly cadences.
  const current = currentOccurrence(notification, today) ?? notification.due_date;
  const next = advanceOccurrence(current, notification.recurrence, anchorDay);
  const payload: ReminderPayload = { ...(parsePayload<ReminderPayload>(notification.payload_json) ?? {}), anchor_day: anchorDay };
  return {
    kind: 'advance',
    input: {
      ...toInput(notification),
      due_date: next,
      status: 'active',
      snoozed_until: null,
      payload_json: JSON.stringify(payload),
    },
  };
}

export function toInput(notification: AppNotification): AppNotificationInput {
  return {
    kind: notification.kind,
    type: notification.type,
    title: notification.title,
    body: notification.body,
    due_date: notification.due_date,
    recurrence: notification.recurrence,
    lead_days: notification.lead_days,
    status: notification.status,
    snoozed_until: notification.snoozed_until,
    source: notification.source,
    dedupe_key: notification.dedupe_key,
    entity_table: notification.entity_table,
    entity_id: notification.entity_id,
    payload_json: notification.payload_json,
  };
}

export type SnoozePreset = 'day' | 'week';

export function snoozeUntil(preset: SnoozePreset, today: string = todayLocalISO()): string {
  return addDaysISO(today, preset === 'day' ? 1 : 7);
}

// ---------------------------------------------------------------------------
// System alerts: payments
// ---------------------------------------------------------------------------

const CADENCE_HALF_WINDOW_DAYS: Record<RecurringSeries['cadence'], number> = {
  weekly: 3,
  biweekly: 7,
  monthly: 15,
  quarterly: 45,
  yearly: 180,
  irregular: 15,
};

export function overdueDedupeKey(seriesId: number, dueDate: string): string {
  return `overdue:series:${seriesId}:${dueDate}`;
}

export function budgetDedupeKey(month: string, categoryId: number): string {
  return `budget:${month}:${categoryId}`;
}

export function loanPromoDedupeKey(loanId: number, promoEndDate: string): string {
  return `loan-promo:${loanId}:${promoEndDate}`;
}

/**
 * The due date the scan watches for a series: the `due_day` occurrence of the
 * current cycle (the latest one no further out than today + lead), else the
 * detector's `next_expected_date`.
 */
export function seriesDueDate(series: Pick<RecurringSeries, 'due_day' | 'next_expected_date'>, today: string, leadDays: number): string | null {
  if (series.due_day && series.due_day >= 1 && series.due_day <= 31) {
    const horizon = addDaysISO(today, leadDays);
    const [year, month] = splitIso(horizon);
    const thisCycle = clampedDate(year, month, series.due_day);
    if (thisCycle <= horizon) return thisCycle;
    const previous = month === 1 ? [year - 1, 12] : [year, month - 1];
    return clampedDate(previous[0], previous[1], series.due_day);
  }
  return series.next_expected_date ?? null;
}

/** Series the payment scan considers: active and paid by hand. */
export function selectManualPaySeries(series: ReadonlyArray<RecurringSeries>): RecurringSeries[] {
  return series.filter((entry) => entry.status === 'active' && !entry.is_autopay);
}

export function hasPaymentInWindow(
  payments: ReadonlyArray<SeriesPaymentRow>,
  seriesId: number,
  cadence: RecurringSeries['cadence'],
  dueDate: string,
  today: string
): boolean {
  const halfWindow = CADENCE_HALF_WINDOW_DAYS[cadence] ?? 15;
  const start = addDaysISO(dueDate, -halfWindow);
  const end = addDaysISO(dueDate, halfWindow) > today ? addDaysISO(dueDate, halfWindow) : today;
  return payments.some((payment) => payment.series_id === seriesId && payment.date >= start && payment.date <= end);
}

/** `t` bound to the `notifications` namespace in the current language (for text produced outside React). */
export function notificationsT(): TFunction<'notifications'> {
  return i18n.getFixedT(null, 'notifications');
}

/** "due today", "due tomorrow", "due in 3 days", "1 day overdue", "4 days overdue" (lower case, for alert titles). */
export function formatDueLabel(daysUntil: number, t: TFunction<'notifications'> = notificationsT()): string {
  if (daysUntil === 0) return t('dueLabel.today');
  if (daysUntil === 1) return t('dueLabel.tomorrow');
  if (daysUntil > 1) return t('dueLabel.inDays', { count: daysUntil });
  return t('dueLabel.overdue', { count: -daysUntil });
}

/**
 * Locale and currency the scan formats stored alert text in. Defaults to the
 * active i18n language (en-US until the user picks another) and USD; the
 * surfaces rebuild alert text from the payload in the current language and
 * default currency anyway (`describeNotification`), so the stored text is a
 * fallback and what OS notifications show.
 */
export interface AlertFormatOptions {
  locale?: string;
  currency?: string;
}

function resolveAlertLocale(): string {
  const language = i18n.language;
  return isLanguageCode(language) ? intlLocaleFor(language) : DEFAULT_LOCALE;
}

/** Money as the alert text shows it: absolute value, in the scan's locale / currency. */
export function formatCurrency(amount: number, format: AlertFormatOptions = {}): string {
  return formatMoney(Math.abs(amount), {
    locale: format.locale ?? resolveAlertLocale(),
    currency: format.currency ?? DEFAULT_CURRENCY,
  });
}

/** Stored `loan_promo_ending` payload: the typed contract plus the figures the body text needs. */
export type StoredLoanPromoPayload = LoanPromoPayload & {
  charged_amount?: number;
  deferred_interest_accrued?: number;
};

/** Stored `budget_overspend` payload: the typed contract plus the carried balance quoted in the body. */
export type StoredBudgetOverspendPayload = BudgetOverspendPayload & {
  carried_in?: number | null;
};

export interface OverduePaymentText {
  name: string;
  daysUntil: number;
  dueDate: string;
  expectedAmount: number | null;
}

export function overduePaymentText(
  input: OverduePaymentText,
  t: TFunction<'notifications'>,
  money: (amount: number) => string,
  date: (iso: string) => string = (iso) => iso
): { title: string; body: string } {
  const due = formatDueLabel(input.daysUntil, t);
  const title = t('alerts.overduePayment.title', { name: input.name, due });
  const body =
    input.expectedAmount != null
      ? t('alerts.overduePayment.bodyWithAmount', { amount: money(input.expectedAmount), date: date(input.dueDate) })
      : t('alerts.overduePayment.body', { date: date(input.dueDate) });
  return { title, body };
}

export function loanPromoTitle(
  payload: Pick<LoanPromoPayload, 'loan_name' | 'promo_end_date' | 'on_track' | 'charged'>,
  t: TFunction<'notifications'>,
  date: (iso: string) => string = (iso) => iso
): string {
  if (payload.charged) return t('alerts.loanPromo.chargedTitle', { name: payload.loan_name });
  if (payload.on_track) return t('alerts.loanPromo.onTrackTitle', { name: payload.loan_name, date: date(payload.promo_end_date) });
  return t('alerts.loanPromo.offTrackTitle', { name: payload.loan_name, date: date(payload.promo_end_date) });
}

/** Null when the payload lacks a figure the body quotes (older rows), so callers keep the stored text. */
export function loanPromoBody(
  payload: StoredLoanPromoPayload,
  daysUntil: number,
  t: TFunction<'notifications'>,
  money: (amount: number) => string,
  date: (iso: string) => string = (iso) => iso
): string | null {
  if (payload.charged) {
    if (payload.charged_amount == null) return null;
    return t('alerts.loanPromo.chargedBody', { date: date(payload.promo_end_date), amount: money(payload.charged_amount) });
  }
  const due = formatDueLabel(daysUntil, t);
  if (payload.on_track) {
    if (payload.deferred_interest_accrued == null) return null;
    return t('alerts.loanPromo.onTrackBody', {
      balance: money(payload.balance),
      due,
      interest: money(payload.deferred_interest_accrued),
    });
  }
  const values = { balance: money(payload.balance), due, interest: money(payload.deferred_interest_at_risk) };
  return payload.required_monthly != null
    ? t('alerts.loanPromo.offTrackBodyWithRequired', { ...values, amount: money(payload.required_monthly) })
    : t('alerts.loanPromo.offTrackBody', values);
}

export function budgetOverspendText(
  payload: StoredBudgetOverspendPayload,
  t: TFunction<'notifications'>,
  money: (amount: number) => string,
  month: (monthKey: string) => string = (key) => key
): { title: string; body: string } {
  const values = {
    spent: money(payload.actual),
    budgeted: money(payload.budgeted),
    month: month(payload.month),
    over: money(payload.actual - payload.budgeted),
  };
  const carried = payload.carried_in;
  const body = carried
    ? t(carried > 0 ? 'alerts.budgetOverspend.bodyCarriedIn' : 'alerts.budgetOverspend.bodyCarriedOver', {
        ...values,
        carried: money(carried),
      })
    : t('alerts.budgetOverspend.body', values);
  return { title: t('alerts.budgetOverspend.title', { name: payload.category_name }), body };
}

export interface PaymentAlertPlan {
  upserts: Array<AppNotificationInput & { dedupe_key: string }>;
  /** Existing alert ids to mark done (paid). */
  paidIds: number[];
  /** Existing alert ids to dismiss (series became autopay / inactive / superseded by a newer cycle). */
  staleIds: number[];
}

export function planPaymentAlerts(
  series: ReadonlyArray<RecurringSeries>,
  payments: ReadonlyArray<SeriesPaymentRow>,
  existing: ReadonlyArray<AppNotification>,
  settings: ReadonlyArray<NotificationSetting>,
  today: string,
  format: AlertFormatOptions = {}
): PaymentAlertPlan {
  const plan: PaymentAlertPlan = { upserts: [], paidIds: [], staleIds: [] };
  const enabled = isTypeEnabled(settings, 'overdue_payment');
  const leadDays = resolveLeadDays({ type: 'overdue_payment', lead_days: null }, settings);
  const wantedKeys = new Set<string>();
  const paidKeys = new Set<string>();
  const t = notificationsT();
  const money = (amount: number) => formatCurrency(amount, format);

  if (enabled) {
    for (const entry of selectManualPaySeries(series)) {
      const dueDate = seriesDueDate(entry, today, leadDays);
      if (!dueDate) continue;
      const daysUntil = daysBetween(today, dueDate);
      if (daysUntil > leadDays) continue;
      const key = overdueDedupeKey(entry.id, dueDate);
      if (hasPaymentInWindow(payments, entry.id, entry.cadence, dueDate, today)) {
        paidKeys.add(key);
        continue;
      }
      wantedKeys.add(key);
      const payload: OverduePaymentPayload = {
        series_id: entry.id,
        series_name: entry.name,
        due_date: dueDate,
        expected_amount: entry.expected_amount,
      };
      const text = overduePaymentText(
        { name: entry.name, daysUntil, dueDate, expectedAmount: entry.expected_amount },
        t,
        money
      );
      plan.upserts.push({
        kind: 'alert',
        type: 'overdue_payment',
        title: text.title,
        body: text.body,
        due_date: dueDate,
        recurrence: 'once',
        lead_days: leadDays,
        source: 'system',
        dedupe_key: key,
        entity_table: 'recurring_series',
        entity_id: entry.id,
        payload_json: JSON.stringify(payload),
      });
    }
  }

  for (const row of existing) {
    if (row.kind !== 'alert' || row.type !== 'overdue_payment' || !row.dedupe_key) continue;
    if (row.status === 'dismissed' || row.status === 'done') continue;
    if (wantedKeys.has(row.dedupe_key)) continue;
    if (paidKeys.has(row.dedupe_key)) {
      plan.paidIds.push(row.id);
      continue;
    }
    // Not wanted and not matched by a payment: the series is gone, autopay,
    // inactive, the type was disabled, or the cycle moved on. A payment that
    // arrived for the alert's own due date still counts as "paid".
    const payload = parsePayload<OverduePaymentPayload>(row.payload_json);
    const seriesRow = series.find((entry) => entry.id === (row.entity_id ?? payload?.series_id));
    if (seriesRow && row.due_date && hasPaymentInWindow(payments, seriesRow.id, seriesRow.cadence, row.due_date, today)) {
      plan.paidIds.push(row.id);
    } else {
      plan.staleIds.push(row.id);
    }
  }

  return plan;
}

// ---------------------------------------------------------------------------
// System alerts: deferred-interest loans (schema v5)
// ---------------------------------------------------------------------------

export interface LoanPromoAlertPlan {
  upserts: Array<AppNotificationInput & { dedupe_key: string }>;
  /** Existing alerts whose loan is paid off, closed, gone, or no longer deferred-interest. */
  resolvedIds: number[];
}

/**
 * One alert per active deferred-interest loan whose pay-by date is within
 * the type's lead time, or has passed with a balance. The alert says whether
 * the expected payment clears the balance in time and what it would take.
 */
export function planLoanPromoAlerts(
  loans: ReadonlyArray<Loan>,
  summaries: ReadonlyMap<number, LoanSummary>,
  existing: ReadonlyArray<AppNotification>,
  settings: ReadonlyArray<NotificationSetting>,
  today: string,
  format: AlertFormatOptions = {}
): LoanPromoAlertPlan {
  const plan: LoanPromoAlertPlan = { upserts: [], resolvedIds: [] };
  const enabled = isTypeEnabled(settings, 'loan_promo_ending');
  const leadDays = resolveLeadDays({ type: 'loan_promo_ending', lead_days: null }, settings);
  const wantedKeys = new Set<string>();
  const t = notificationsT();
  const money = (amount: number) => formatCurrency(amount, format);

  if (enabled) {
    for (const loan of loans) {
      if (loan.status !== 'active' || loan.loan_type !== 'deferred_interest' || !loan.promo_end_date) continue;
      const summary = summaries.get(loan.id);
      const deferred = summary?.deferred;
      if (!summary || !deferred || summary.isPaidOff) continue;
      const daysUntil = daysBetween(today, deferred.promoEndDate);
      if (daysUntil > leadDays) continue;

      const key = loanPromoDedupeKey(loan.id, deferred.promoEndDate);
      wantedKeys.add(key);
      const payload: StoredLoanPromoPayload = {
        loan_id: loan.id,
        loan_name: loan.name,
        promo_end_date: deferred.promoEndDate,
        balance: summary.payoffAmount,
        deferred_interest_at_risk: deferred.deferredInterestAtRisk,
        required_monthly: deferred.requiredMonthlyToAvoid,
        on_track: deferred.onTrack,
        charged: deferred.charged,
        charged_amount: deferred.chargedAmount,
        deferred_interest_accrued: deferred.deferredInterestAccrued,
      };
      plan.upserts.push({
        kind: 'alert',
        type: 'loan_promo_ending',
        title: loanPromoTitle(payload, t),
        body: loanPromoBody(payload, daysUntil, t, money) ?? '',
        due_date: deferred.promoEndDate,
        recurrence: 'once',
        lead_days: leadDays,
        source: 'system',
        dedupe_key: key,
        entity_table: 'loans',
        entity_id: loan.id,
        payload_json: JSON.stringify(payload),
      });
    }
  }

  for (const row of existing) {
    if (row.kind !== 'alert' || row.type !== 'loan_promo_ending' || !row.dedupe_key) continue;
    if (row.status === 'dismissed' || row.status === 'done') continue;
    if (!wantedKeys.has(row.dedupe_key)) plan.resolvedIds.push(row.id);
  }

  return plan;
}

// ---------------------------------------------------------------------------
// System alerts: budget
// ---------------------------------------------------------------------------

export interface BudgetAlertPlan {
  upserts: Array<AppNotificationInput & { dedupe_key: string }>;
  /** Existing alerts for this month whose category is no longer over budget. */
  resolvedIds: number[];
}

export function planBudgetAlerts(
  status: BudgetStatus | null,
  month: string,
  existing: ReadonlyArray<AppNotification>,
  settings: ReadonlyArray<NotificationSetting>,
  today: string,
  format: AlertFormatOptions = {}
): BudgetAlertPlan {
  const plan: BudgetAlertPlan = { upserts: [], resolvedIds: [] };
  const wantedKeys = new Set<string>();
  const t = notificationsT();
  const money = (amount: number) => formatCurrency(amount, format);

  if (status && isTypeEnabled(settings, 'budget_overspend')) {
    for (const category of status.categories) {
      if (!category.isOverBudget || category.budgetedAmount <= 0) continue;
      const key = budgetDedupeKey(month, category.category_id);
      wantedKeys.add(key);
      const name = category.category_name ?? t('alerts.budgetOverspend.categoryFallback', { id: category.category_id });
      // With budget carry-over (schema v3) the category row also carries the
      // effective budget (plan + carried balance) and committed spend; quote
      // those when present so the alert matches what the Budget page shows.
      const budgeted = carryField(category, 'effectiveBudget') ?? category.budgetedAmount;
      const spent = carryField(category, 'committedSpend') ?? category.actualExpenses;
      const payload: StoredBudgetOverspendPayload = {
        month,
        category_id: category.category_id,
        category_name: name,
        budgeted,
        actual: spent,
        carried_in: carryField(category, 'carriedIn'),
      };
      const text = budgetOverspendText(payload, t, money);
      plan.upserts.push({
        kind: 'alert',
        type: 'budget_overspend',
        title: text.title,
        body: text.body,
        due_date: today,
        recurrence: 'once',
        lead_days: 0,
        source: 'system',
        dedupe_key: key,
        entity_table: 'categories',
        entity_id: category.category_id,
        payload_json: JSON.stringify(payload),
      });
    }
  }

  const prefix = `budget:${month}:`;
  for (const row of existing) {
    if (row.kind !== 'alert' || row.type !== 'budget_overspend' || !row.dedupe_key?.startsWith(prefix)) continue;
    if (row.status === 'dismissed' || row.status === 'done') continue;
    if (!wantedKeys.has(row.dedupe_key)) plan.resolvedIds.push(row.id);
  }

  return plan;
}

/** Optional carry-over figure on a category status row (present once the budgets feature computes it). */
function carryField(category: BudgetStatus['categories'][number], field: 'effectiveBudget' | 'committedSpend' | 'carriedIn'): number | null {
  const value = (category as unknown as Record<string, unknown>)[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Reminders: expire snoozes, roll recurring anchors forward
// ---------------------------------------------------------------------------

export interface ReminderMaintenancePlan {
  /** Snoozed rows whose snooze has elapsed → back to active. */
  wakeIds: number[];
  /** Recurring reminders whose stored due_date is older than the grace window → advance. */
  advances: Array<{ id: number; input: AppNotificationInput }>;
}

export function planReminderMaintenance(existing: ReadonlyArray<AppNotification>, today: string): ReminderMaintenancePlan {
  const plan: ReminderMaintenancePlan = { wakeIds: [], advances: [] };
  for (const row of existing) {
    if (row.status === 'snoozed' && (!row.snoozed_until || row.snoozed_until <= today)) {
      plan.wakeIds.push(row.id);
    }
    if (row.kind === 'reminder' && row.recurrence !== 'once' && row.due_date && row.status !== 'dismissed' && row.status !== 'done') {
      const occurrence = currentOccurrence(row, today);
      if (occurrence && occurrence !== row.due_date) {
        const anchorDay = anchorDayOf(row);
        const payload: ReminderPayload = { ...(parsePayload<ReminderPayload>(row.payload_json) ?? {}), anchor_day: anchorDay };
        plan.advances.push({
          id: row.id,
          input: { ...toInput(row), due_date: occurrence, payload_json: JSON.stringify(payload) },
        });
      }
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------
// The scan
// ---------------------------------------------------------------------------

export function currentMonthKey(today: string): string {
  return today.slice(0, 7);
}

/** Linked payments earlier than this are irrelevant to any alert the scan can raise. */
export function paymentsWindowStart(today: string): string {
  return addDaysISO(today, -200);
}

export async function scanNotifications(
  ctx: NotificationScanContext,
  today: string = todayLocalISO(),
  format: AlertFormatOptions = {}
): Promise<NotificationScanSummary> {
  const summary: NotificationScanSummary = { today, alertsUpserted: 0, alertsResolved: 0, remindersAdvanced: 0, snoozesExpired: 0, writes: 0 };
  const month = currentMonthKey(today);

  // Reminder maintenance first so the rest of the scan sees current rows.
  const maintenance = planReminderMaintenance(ctx.notifications, today);
  for (const id of maintenance.wakeIds) {
    await ctx.setStatus(id, 'active', null);
    summary.snoozesExpired += 1;
  }
  for (const advance of maintenance.advances) {
    await ctx.update(advance.id, advance.input);
    summary.remindersAdvanced += 1;
  }

  const [payments, budgetStatus] = await Promise.all([
    ctx.listSeriesPaymentsSince(paymentsWindowStart(today)).catch((error) => {
      log.warn('Could not load series payments; payment alerts skipped', { operation: 'scanNotifications', error });
      return null;
    }),
    ctx.getBudgetStatus(month).catch((error) => {
      log.warn('Could not load budget status; budget alerts skipped', { operation: 'scanNotifications', error });
      return null;
    }),
  ]);

  if (payments) {
    const paymentPlan = planPaymentAlerts(ctx.recurringSeries, payments, ctx.notifications, ctx.settings, today, format);
    for (const upsert of paymentPlan.upserts) {
      await ctx.upsertByDedupeKey(upsert);
      summary.alertsUpserted += 1;
    }
    for (const id of paymentPlan.paidIds) {
      await ctx.setStatus(id, 'done', null);
      summary.alertsResolved += 1;
    }
    for (const id of paymentPlan.staleIds) {
      await ctx.setStatus(id, 'dismissed', null);
      summary.alertsResolved += 1;
    }
  }

  if (budgetStatus) {
    const budgetPlan = planBudgetAlerts(budgetStatus, month, ctx.notifications, ctx.settings, today, format);
    for (const upsert of budgetPlan.upserts) {
      await ctx.upsertByDedupeKey(upsert);
      summary.alertsUpserted += 1;
    }
    for (const id of budgetPlan.resolvedIds) {
      await ctx.setStatus(id, 'done', null);
      summary.alertsResolved += 1;
    }
  }

  if (ctx.loans && ctx.getLoanSummary) {
    const candidates = ctx.loans.filter((loan) => loan.status === 'active' && loan.loan_type === 'deferred_interest' && loan.promo_end_date);
    const summaries = new Map<number, LoanSummary>();
    try {
      for (const loan of candidates) {
        const loanSummary = await ctx.getLoanSummary(loan.id);
        if (loanSummary) summaries.set(loan.id, loanSummary);
      }
      const loanPlan = planLoanPromoAlerts(ctx.loans, summaries, ctx.notifications, ctx.settings, today, format);
      for (const upsert of loanPlan.upserts) {
        await ctx.upsertByDedupeKey(upsert);
        summary.alertsUpserted += 1;
      }
      for (const id of loanPlan.resolvedIds) {
        await ctx.setStatus(id, 'done', null);
        summary.alertsResolved += 1;
      }
    } catch (error) {
      log.warn('Could not evaluate loans; loan deadline alerts skipped', { operation: 'scanNotifications', error });
    }
  }

  summary.writes = summary.alertsUpserted + summary.alertsResolved + summary.remindersAdvanced + summary.snoozesExpired;
  log.debug('Notification scan complete', { operation: 'scanNotifications', ...summary });
  return summary;
}

// ---------------------------------------------------------------------------
// Re-entrancy guard for the runtime
// ---------------------------------------------------------------------------

export interface RescanControllerOptions {
  /** Runs one scan; resolves with the number of rows it wrote. */
  scan: () => Promise<number>;
  /** Change events are coalesced for this long before a scan starts. */
  debounceMs?: number;
  /** After a scan that wrote rows, change events inside this window are treated as our own echo. */
  quietMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  onError?: (error: unknown) => void;
}

export interface RescanController {
  /** Immediate scan (app open, Rescan button). Coalesces with an in-flight scan. */
  trigger: () => Promise<void>;
  /** A `database_changed` event: debounced, ignored while it is our own echo. */
  onDatabaseChanged: () => void;
  isRunning: () => boolean;
  dispose: () => void;
}

export function createRescanController({
  scan,
  debounceMs = 1500,
  quietMs = 2500,
  now = () => Date.now(),
  setTimer = (callback, ms) => setTimeout(callback, ms),
  clearTimer = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  onError = (error) => log.error('Notification rescan failed', { operation: 'rescan', error }),
}: RescanControllerOptions): RescanController {
  let running = false;
  let rerunRequested = false;
  let disposed = false;
  let quietUntil = 0;
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;

  const run = async (): Promise<void> => {
    if (running) {
      rerunRequested = true;
      return inFlight ?? Promise.resolve();
    }
    running = true;
    inFlight = (async () => {
      try {
        do {
          rerunRequested = false;
          let writes = 0;
          try {
            writes = await scan();
          } catch (error) {
            onError(error);
          }
          if (writes > 0) quietUntil = now() + quietMs;
        } while (rerunRequested && !disposed);
      } finally {
        running = false;
        inFlight = null;
      }
    })();
    return inFlight;
  };

  return {
    trigger: () => {
      if (disposed) return Promise.resolve();
      if (timer) {
        clearTimer(timer);
        timer = null;
      }
      return run();
    },
    onDatabaseChanged: () => {
      if (disposed) return;
      // Our own write burst echoes back as a change event; ignore it.
      if (running || now() < quietUntil) return;
      if (timer) clearTimer(timer);
      timer = setTimer(() => {
        timer = null;
        void run();
      }, debounceMs);
    },
    isRunning: () => running,
    dispose: () => {
      disposed = true;
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}

// ---------------------------------------------------------------------------
// OS notifications
// ---------------------------------------------------------------------------

export type OsNotificationPermission = 'unsupported' | 'default' | 'granted' | 'denied';

export function getOsNotificationPermission(): OsNotificationPermission {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

/**
 * Rows to fire an OS notification for: due, type enabled with os_notify, not
 * fired this session and not already fired today (a reload is a new session).
 */
export function selectOsNotifiable(
  due: ReadonlyArray<ClassifiedNotification>,
  settings: ReadonlyArray<NotificationSetting>,
  firedThisSession: ReadonlySet<number>,
  today: string
): ClassifiedNotification[] {
  return due.filter((entry) => {
    const setting = settingFor(settings, entry.notification.type);
    if (!setting?.os_notify) return false;
    if (firedThisSession.has(entry.notification.id)) return false;
    const last = entry.notification.last_notified_at;
    return !last || last.slice(0, 10) < today;
  });
}

export function isTerminalStatus(status: NotificationStatus): boolean {
  return status === 'dismissed' || status === 'done';
}
