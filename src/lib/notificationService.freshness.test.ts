/**
 * Schema v8: a payment is overdue only once the account's imports cover its
 * due date (plus the posting grace) and do not show it.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_NOTIFICATION_SETTINGS } from './databaseServiceNotifications';
import {
  classifyNotification,
  isUnconfirmedOverdue,
  addMonthsISO,
  overdueConfirmation,
  overduePaymentText,
  notificationsT,
  planPaymentAlerts,
  planStaleAccountAlerts,
  resolveStaleAccountMonths,
  scanNotifications,
  selectOsNotifiable,
} from './notificationService';
import type { AccountFreshness, AppNotification, NotificationSetting, RecurringSeries } from '@/types/database';
import type { OverduePaymentPayload } from '@/types/notifications';

const TODAY = '2026-10-24';
const ACCOUNT = 1;

function series(overrides: Partial<RecurringSeries> = {}): RecurringSeries {
  return {
    id: 12,
    name: 'Electric bill',
    company_id: null,
    rule_id: null,
    kind: 'bill',
    cadence: 'monthly',
    expected_amount: 120,
    amount_is_variable: 0,
    status: 'active',
    match_key: 'desc:electric',
    last_seen_date: '2026-09-20',
    next_expected_date: '2026-10-20',
    notes: null,
    is_autopay: 0,
    due_day: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    latest_account_id: ACCOUNT,
    ...overrides,
  };
}

function settings(overrides: Partial<NotificationSetting> = {}): NotificationSetting[] {
  return DEFAULT_NOTIFICATION_SETTINGS.map((setting) =>
    setting.type === 'overdue_payment' ? { ...setting, lead_days: 3, ...overrides } : setting
  );
}

function fresh(dataThrough: string | null, accountId = ACCOUNT): AccountFreshness {
  return {
    accountId,
    lastImportAt: dataThrough ? `${dataThrough} 12:00:00` : null,
    dataThrough,
    throughSource: dataThrough ? 'import_date' : null,
    latestTransactionDate: dataThrough,
  };
}

function alertRow(overrides: Partial<AppNotification> & { payload?: OverduePaymentPayload }): AppNotification {
  const { payload, ...rest } = overrides;
  const dueDate = rest.due_date ?? '2026-10-20';
  return {
    id: 50,
    kind: 'alert',
    type: 'overdue_payment',
    title: 'Electric bill',
    body: null,
    due_date: dueDate,
    recurrence: 'once',
    lead_days: 3,
    status: 'active',
    snoozed_until: null,
    source: 'system',
    dedupe_key: `overdue:series:12:${dueDate}`,
    entity_table: 'recurring_series',
    entity_id: 12,
    payload_json: JSON.stringify(
      payload ?? { series_id: 12, series_name: 'Electric bill', due_date: dueDate, expected_amount: 120 }
    ),
    last_notified_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...rest,
  };
}

const payloadOf = (input: { payload_json?: string | null }) => JSON.parse(input.payload_json ?? 'null') as OverduePaymentPayload;

describe('payment alerts and account freshness', () => {
  it('reads a passed due date as not confirmed while the account is not imported past it', () => {
    const plan = planPaymentAlerts([series()], [], [], settings(), TODAY, {}, [fresh('2026-10-18')]);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0].title).toBe('Electric bill was due 2026-10-20, not confirmed yet');
    expect(plan.upserts[0].body).toBe('The account is imported through 2026-10-18. Import a newer statement to see whether it was paid.');
    expect(payloadOf(plan.upserts[0])).toMatchObject({ account_id: ACCOUNT, data_through: '2026-10-18', grace_days: 3 });
    expect(overdueConfirmation(payloadOf(plan.upserts[0]), TODAY)).toBe('unconfirmed');
  });

  it('waits out the posting grace before calling it overdue', () => {
    const withinGrace = planPaymentAlerts([series()], [], [], settings(), TODAY, {}, [fresh('2026-10-22')]);
    expect(overdueConfirmation(payloadOf(withinGrace.upserts[0]), TODAY)).toBe('unconfirmed');

    const pastGrace = planPaymentAlerts([series()], [], [], settings(), TODAY, {}, [fresh('2026-10-23')]);
    expect(pastGrace.upserts[0].title).toBe('Electric bill 4 days overdue');
    expect(overdueConfirmation(payloadOf(pastGrace.upserts[0]), TODAY)).toBe('confirmed');
  });

  it('takes the grace from the payment alert setting', () => {
    const plan = planPaymentAlerts([series()], [], [], settings({ grace_days: 0 }), TODAY, {}, [fresh('2026-10-20')]);
    expect(payloadOf(plan.upserts[0]).grace_days).toBe(0);
    expect(plan.upserts[0].title).toBe('Electric bill 4 days overdue');
  });

  it('keeps the device-date rule for a never-imported account or a series without one', () => {
    const neverImported = planPaymentAlerts([series()], [], [], settings(), TODAY, {}, [fresh(null)]);
    expect(neverImported.upserts[0].title).toBe('Electric bill 4 days overdue');
    const noAccount = planPaymentAlerts([series({ latest_account_id: null })], [], [], settings(), TODAY, {}, [fresh('2026-10-01')]);
    expect(noAccount.upserts[0].title).toBe('Electric bill 4 days overdue');
    expect(payloadOf(noAccount.upserts[0])).toMatchObject({ account_id: null, data_through: null });
    // Callers that pass no freshness at all behave as before v8.
    expect(planPaymentAlerts([series()], [], [], settings(), TODAY).upserts[0].title).toBe('Electric bill 4 days overdue');
  });

  it('leaves alerts that are not due yet as they were, with the freshness recorded for later', () => {
    const plan = planPaymentAlerts([series({ next_expected_date: '2026-10-25' })], [], [], settings(), TODAY, {}, [fresh('2026-10-18')]);
    expect(plan.upserts[0].title).toBe('Electric bill due tomorrow');
    const payload = payloadOf(plan.upserts[0]);
    expect(payload.data_through).toBe('2026-10-18');
    // Once the day passes without a newer import, the same row reads as not confirmed.
    expect(overdueConfirmation(payload, '2026-10-26')).toBe('unconfirmed');
  });

  describe('when the cycle moves on before an import settles it', () => {
    // due_day 10: on Nov 12 the scan watches Nov 10, so the Oct 10 alert is from the previous cycle.
    const NOV_12 = '2026-11-12';
    const dueDay = series({ due_day: 10, next_expected_date: null });
    const october = (payload: Partial<OverduePaymentPayload> = {}) =>
      alertRow({
        id: 60,
        due_date: '2026-10-10',
        payload: {
          series_id: 12,
          series_name: 'Electric bill',
          due_date: '2026-10-10',
          expected_amount: 120,
          account_id: ACCOUNT,
          data_through: '2026-10-08',
          grace_days: 3,
          ...payload,
        },
      });

    it('keeps the alert while the data still does not reach its due date', () => {
      const plan = planPaymentAlerts([dueDay], [], [october()], settings(), NOV_12, {}, [fresh('2026-10-08')]);
      const kept = plan.upserts.find((upsert) => upsert.dedupe_key === 'overdue:series:12:2026-10-10');
      expect(kept).toBeDefined();
      expect(payloadOf(kept!)).toMatchObject({ carried: true, data_through: '2026-10-08' });
      expect(plan.staleIds).toEqual([]);
      // The current cycle's alert is raised as well.
      expect(plan.upserts.some((upsert) => upsert.dedupe_key === 'overdue:series:12:2026-11-10')).toBe(true);
    });

    it('turns it into a confirmed miss when an import covers the date without the payment, and keeps it', () => {
      const confirmed = planPaymentAlerts([dueDay], [], [october()], settings(), NOV_12, {}, [fresh('2026-11-11')]);
      const kept = confirmed.upserts.find((upsert) => upsert.dedupe_key === 'overdue:series:12:2026-10-10');
      expect(kept?.title).toBe('Electric bill 33 days overdue');
      expect(payloadOf(kept!).carried).toBe(true);

      // On the next scan it is still carried (it was an open question when the cycle moved on).
      const next = planPaymentAlerts([dueDay], [], [october({ carried: true, data_through: '2026-11-11' })], settings(), NOV_12, {}, [fresh('2026-11-11')]);
      expect(next.upserts.some((upsert) => upsert.dedupe_key === 'overdue:series:12:2026-10-10')).toBe(true);
      expect(next.staleIds).toEqual([]);
    });

    it('marks it paid when the import brings the payment', () => {
      const plan = planPaymentAlerts([dueDay], [{ series_id: 12, date: '2026-10-12' }], [october()], settings(), NOV_12, {}, [fresh('2026-11-11')]);
      expect(plan.paidIds).toEqual([60]);
    });

    it("does not let the next cycle's payment close a missed one, but counts a late payment of its own cycle", () => {
      const carried = october({ carried: true, data_through: '2026-11-11' });
      const nextCycle = planPaymentAlerts([dueDay], [{ series_id: 12, date: '2026-11-10' }], [carried], settings(), NOV_12, {}, [fresh('2026-11-11')]);
      expect(nextCycle.paidIds).toEqual([]);
      expect(nextCycle.upserts.some((upsert) => upsert.dedupe_key === 'overdue:series:12:2026-10-10')).toBe(true);

      // An early payment for November (its window opens Oct 26) is November's, not October's.
      const early = planPaymentAlerts([dueDay], [{ series_id: 12, date: '2026-10-28' }], [carried], settings(), NOV_12, {}, [fresh('2026-11-11')]);
      expect(early.paidIds).toEqual([]);

      const late = planPaymentAlerts([dueDay], [{ series_id: 12, date: '2026-10-22' }], [carried], settings(), NOV_12, {}, [fresh('2026-11-11')]);
      expect(late.paidIds).toEqual([60]);
    });

    it('still retires an alert that was already confirmed when its cycle moved on', () => {
      const plan = planPaymentAlerts([dueDay], [], [october({ data_through: '2026-10-20' })], settings(), NOV_12, {}, [fresh('2026-11-11')]);
      expect(plan.staleIds).toEqual([60]);
    });

    it('retires it when the series stops being paid by hand', () => {
      const plan = planPaymentAlerts([{ ...dueDay, is_autopay: 1 }], [], [october()], settings(), NOV_12, {}, [fresh('2026-10-08')]);
      expect(plan.staleIds).toEqual([60]);
      expect(plan.upserts).toEqual([]);
    });
  });
});

describe('unconfirmed alerts on the surfaces', () => {
  const unconfirmed = alertRow({
    id: 70,
    payload: { series_id: 12, series_name: 'Electric bill', due_date: '2026-10-20', expected_amount: 120, account_id: ACCOUNT, data_through: '2026-10-18', grace_days: 3 },
  });
  const confirmed = alertRow({
    id: 71,
    dedupe_key: 'overdue:series:13:2026-10-20',
    payload: { series_id: 13, series_name: 'Water', due_date: '2026-10-20', expected_amount: 40, account_id: ACCOUNT, data_through: '2026-10-23', grace_days: 3 },
  });

  it('tells unconfirmed rows apart from their payload, including rows written before v8', () => {
    expect(isUnconfirmedOverdue(unconfirmed, TODAY)).toBe(true);
    expect(isUnconfirmedOverdue(confirmed, TODAY)).toBe(false);
    expect(isUnconfirmedOverdue(alertRow({ id: 72 }), TODAY)).toBe(false);
    expect(isUnconfirmedOverdue({ ...unconfirmed, type: 'budget_overspend' }, TODAY)).toBe(false);
  });

  it('fires no browser notification for a payment that is not confirmed', () => {
    const all = DEFAULT_NOTIFICATION_SETTINGS.map((setting) => (setting.type === 'overdue_payment' ? { ...setting, os_notify: 1 } : setting));
    const classified = [unconfirmed, confirmed].map((row) => classifyNotification(row, all, TODAY));
    expect(selectOsNotifiable(classified, all, new Set(), TODAY).map((entry) => entry.notification.id)).toEqual([71]);
  });

  it('names the account when the caller can', () => {
    const text = overduePaymentText(
      { name: 'Electric bill', daysUntil: -4, dueDate: '2026-10-20', expectedAmount: 120, confirmation: 'unconfirmed', dataThrough: '2026-10-18', accountName: 'Checking' },
      notificationsT(),
      (amount) => `$${amount}`
    );
    expect(text.body).toBe('Checking is imported through 2026-10-18. Import a newer statement to see whether it was paid.');
  });
});

describe('stale-account alerts', () => {
  const accounts = [
    { id: 1, name: 'Everyday Checking', is_active: 1 },
    { id: 2, name: 'Rainy Day', is_active: 1 },
    { id: 3, name: 'Old Card', is_active: 0 },
    { id: 4, name: 'Cash Jar', is_active: 1 },
  ];
  const freshness = [fresh('2026-04-24', 1), fresh('2026-06-01', 2), fresh('2026-01-01', 3), fresh(null, 4)];
  const staleRow = (overrides: Partial<AppNotification> = {}) =>
    alertRow({
      id: 80,
      type: 'stale_account',
      due_date: '2026-10-24',
      dedupe_key: 'stale-account:1:2026-04-24',
      entity_table: 'accounts',
      entity_id: 1,
      payload_json: JSON.stringify({ account_id: 1, account_name: 'Everyday Checking', data_through: '2026-04-24', last_import_at: null, months: 6 }),
      ...overrides,
    });

  it('adds calendar months, keeping the day within the month', () => {
    expect(addMonthsISO('2026-04-24', 6)).toBe('2026-10-24');
    expect(addMonthsISO('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonthsISO('2026-11-15', 2)).toBe('2027-01-15');
  });

  it('reads the months setting within 1 to 60, else 6', () => {
    expect(resolveStaleAccountMonths(null)).toBe(6);
    expect(resolveStaleAccountMonths('')).toBe(6);
    expect(resolveStaleAccountMonths('3')).toBe(3);
    expect(resolveStaleAccountMonths('2.5')).toBe(6);
    expect(resolveStaleAccountMonths(0)).toBe(1);
    expect(resolveStaleAccountMonths(120)).toBe(60);
  });

  it('raises one alert per open, once-imported account whose data is the set number of months old', () => {
    const plan = planStaleAccountAlerts(accounts, freshness, [], settings(), 6, TODAY);
    // Checking turns stale today; Rainy Day only in December; the closed card and the never-imported jar get none.
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]).toMatchObject({
      type: 'stale_account',
      kind: 'alert',
      due_date: '2026-10-24',
      dedupe_key: 'stale-account:1:2026-04-24',
      entity_table: 'accounts',
      entity_id: 1,
      title: 'Everyday Checking needs a new import',
      body: 'Its imported transactions end 2026-04-24. Import a recent statement so its payment alerts stay accurate.',
    });
    expect(JSON.parse(plan.upserts[0].payload_json!)).toMatchObject({ account_id: 1, data_through: '2026-04-24', months: 6 });

    // A shorter setting reaches the savings account too.
    expect(planStaleAccountAlerts(accounts, freshness, [], settings(), 4, TODAY).upserts.map((upsert) => upsert.entity_id)).toEqual([1, 2]);
  });

  it('shows it early by the type lead time, and not at all when the type is off', () => {
    const withLead = DEFAULT_NOTIFICATION_SETTINGS.map((setting) => (setting.type === 'stale_account' ? { ...setting, lead_days: 40 } : setting));
    expect(planStaleAccountAlerts(accounts, freshness, [], withLead, 6, TODAY).upserts.map((upsert) => upsert.entity_id)).toEqual([1, 2]);

    const off = DEFAULT_NOTIFICATION_SETTINGS.map((setting) => (setting.type === 'stale_account' ? { ...setting, enabled: 0 } : setting));
    const plan = planStaleAccountAlerts(accounts, freshness, [staleRow()], off, 6, TODAY);
    expect(plan.upserts).toEqual([]);
    expect(plan.resolvedIds).toEqual([80]);
  });

  it('resolves the alert once a newer import moves the data forward', () => {
    const plan = planStaleAccountAlerts(accounts, [fresh('2026-10-20', 1)], [staleRow()], settings(), 6, TODAY);
    expect(plan.upserts).toEqual([]);
    expect(plan.resolvedIds).toEqual([80]);
    // A dismissed alert stays dismissed.
    expect(planStaleAccountAlerts(accounts, freshness, [staleRow({ status: 'dismissed' })], settings(), 6, TODAY).resolvedIds).toEqual([]);
  });

  it('runs in the scan with the stored months', async () => {
    const upserts: string[] = [];
    await scanNotifications(
      {
        notifications: [],
        settings: settings(),
        recurringSeries: [],
        listSeriesPaymentsSince: async () => [],
        getBudgetStatus: async () => ({ month: '2026-10', categories: [] }) as never,
        accounts,
        accountFreshness: freshness,
        staleAccountMonths: '4',
        upsertByDedupeKey: async (input) => {
          upserts.push(input.dedupe_key);
          return 1;
        },
        setStatus: async () => undefined,
        update: async () => undefined,
      },
      TODAY
    );
    expect(upserts).toEqual(['stale-account:1:2026-04-24', 'stale-account:2:2026-06-01']);
  });
});
