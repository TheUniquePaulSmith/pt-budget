import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_NOTIFICATION_SETTINGS } from './databaseServiceNotifications';
import {
  advanceOccurrence,
  classifyNotification,
  completeNotification,
  createRescanController,
  daysBetween,
  nextOccurrence,
  planBudgetAlerts,
  planPaymentAlerts,
  planReminderMaintenance,
  resolveLeadDays,
  scanNotifications,
  selectDue,
  selectManualPaySeries,
  selectOsNotifiable,
  selectUpcomingWithin,
  seriesDueDate,
  snoozeUntil,
} from './notificationService';
import type { AppNotification, BudgetStatus, NotificationSetting, RecurringSeries } from '@/types/database';
import type { NotificationScanContext } from '@/types/notifications';

const TODAY = '2026-10-24';

function notification(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: 1,
    kind: 'reminder',
    type: 'custom',
    title: 'Reminder',
    body: null,
    due_date: '2026-10-30',
    recurrence: 'once',
    lead_days: null,
    status: 'active',
    snoozed_until: null,
    source: 'user',
    dedupe_key: null,
    entity_table: null,
    entity_id: null,
    payload_json: null,
    last_notified_at: null,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

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
    last_seen_date: '2026-09-25',
    next_expected_date: '2026-10-25',
    notes: null,
    is_autopay: 0,
    due_day: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function settings(overrides: Partial<Record<string, Partial<NotificationSetting>>> = {}): NotificationSetting[] {
  return DEFAULT_NOTIFICATION_SETTINGS.map((setting) => ({ ...setting, ...(overrides[setting.type] ?? {}) }));
}

describe('occurrence math', () => {
  it('returns the anchor for one-off reminders and future anchors', () => {
    expect(nextOccurrence('2026-12-25', 'once', TODAY)).toBe('2026-12-25');
    expect(nextOccurrence('2026-11-02', 'yearly', TODAY)).toBe('2026-11-02');
    expect(nextOccurrence('2026-11-02', 'monthly', TODAY)).toBe('2026-11-02');
  });

  it('rolls monthly anchors forward and clamps to month ends', () => {
    expect(nextOccurrence('2026-01-31', 'monthly', '2026-02-10')).toBe('2026-02-28');
    expect(nextOccurrence('2026-01-31', 'monthly', '2026-04-10')).toBe('2026-04-30');
    expect(nextOccurrence('2026-01-31', 'monthly', '2026-12-31')).toBe('2026-12-31');
    // Anchor day kept via anchorDay even when the stored date was clamped.
    expect(nextOccurrence('2026-02-28', 'monthly', '2026-03-01', 31)).toBe('2026-03-31');
    // Same-day boundary: notBefore equal to the occurrence returns it, one day later moves on.
    expect(nextOccurrence('2026-01-15', 'monthly', '2026-03-15')).toBe('2026-03-15');
    expect(nextOccurrence('2026-01-15', 'monthly', '2026-03-16')).toBe('2026-04-15');
    expect(nextOccurrence('2026-01-15', 'monthly', '2026-12-16')).toBe('2027-01-15');
  });

  it('handles leap days for yearly anchors', () => {
    expect(nextOccurrence('2024-02-29', 'yearly', '2025-01-01')).toBe('2025-02-28');
    expect(nextOccurrence('2024-02-29', 'yearly', '2028-01-01')).toBe('2028-02-29');
    expect(nextOccurrence('1980-05-02', 'yearly', TODAY)).toBe('2027-05-02');
    expect(nextOccurrence('1980-12-25', 'yearly', TODAY)).toBe('2026-12-25');
  });

  it('advances strictly past the current occurrence', () => {
    expect(advanceOccurrence('2026-10-31', 'monthly')).toBe('2026-11-30');
    expect(advanceOccurrence('2026-11-30', 'monthly', 31)).toBe('2026-12-31');
    expect(advanceOccurrence('2024-02-29', 'yearly')).toBe('2025-02-28');
    expect(advanceOccurrence('2026-05-01', 'once')).toBe('2026-05-01');
  });

  it('counts days between calendar dates across DST and year boundaries', () => {
    expect(daysBetween('2026-10-24', '2026-10-27')).toBe(3);
    expect(daysBetween('2026-12-30', '2027-01-02')).toBe(3);
    expect(daysBetween('2026-11-05', '2026-10-31')).toBe(-5);
    expect(snoozeUntil('day', TODAY)).toBe('2026-10-25');
    expect(snoozeUntil('week', TODAY)).toBe('2026-10-31');
  });
});

describe('lead-time resolution and classification', () => {
  it('prefers the row override, then the per-type setting, clamped at zero', () => {
    const all = settings({ birthday: { lead_days: 21 } });
    expect(resolveLeadDays({ type: 'birthday', lead_days: null }, all)).toBe(21);
    expect(resolveLeadDays({ type: 'birthday', lead_days: 3 }, all)).toBe(3);
    expect(resolveLeadDays({ type: 'birthday', lead_days: -4 }, all)).toBe(0);
    expect(resolveLeadDays({ type: 'unknown_type', lead_days: null }, all)).toBe(7);
    // Settings rows from the DB may omit a type: fall back to the built-in default.
    expect(resolveLeadDays({ type: 'seasonal', lead_days: null }, [])).toBe(30);
  });

  it('marks rows due when today is inside the lead window, including overdue and undated rows', () => {
    const all = settings();
    expect(classifyNotification(notification({ due_date: '2026-10-27', lead_days: 7 }), all, TODAY)).toMatchObject({
      bucket: 'due',
      daysUntil: 3,
      leadDays: 7,
    });
    expect(classifyNotification(notification({ due_date: '2026-10-27', lead_days: 2 }), all, TODAY).bucket).toBe('upcoming');
    expect(classifyNotification(notification({ due_date: '2026-10-01' }), all, TODAY)).toMatchObject({ bucket: 'due', daysUntil: -23 });
    expect(classifyNotification(notification({ due_date: null }), all, TODAY)).toMatchObject({ bucket: 'due', daysUntil: null });
  });

  it('treats snoozed rows as upcoming until the snooze lapses and closed rows as history', () => {
    const all = settings();
    expect(classifyNotification(notification({ status: 'snoozed', snoozed_until: '2026-10-30', due_date: '2026-10-20' }), all, TODAY).bucket).toBe('upcoming');
    expect(classifyNotification(notification({ status: 'snoozed', snoozed_until: '2026-10-24', due_date: '2026-10-20' }), all, TODAY).bucket).toBe('due');
    expect(classifyNotification(notification({ status: 'done' }), all, TODAY).bucket).toBe('history');
    expect(classifyNotification(notification({ status: 'dismissed' }), all, TODAY).bucket).toBe('history');
  });

  it('rolls recurring reminders to their next occurrence after the grace window', () => {
    const all = settings();
    const birthday = notification({ type: 'birthday', recurrence: 'yearly', due_date: '1980-10-20' });
    // Four days ago: still the current occurrence (overdue), inside the 7-day grace.
    expect(classifyNotification(birthday, all, TODAY)).toMatchObject({ bucket: 'due', occurrence: '2026-10-20', daysUntil: -4 });
    // Twelve days later it has rolled on to next year (lead is 14 days, so upcoming).
    expect(classifyNotification(birthday, all, '2026-11-05')).toMatchObject({ bucket: 'upcoming', occurrence: '2027-10-20' });
  });

  it('keeps disabled types out of badge and card selections', () => {
    const all = settings({ seasonal: { enabled: 0 } });
    const classified = [
      classifyNotification(notification({ id: 1, type: 'seasonal', due_date: TODAY }), all, TODAY),
      classifyNotification(notification({ id: 2, type: 'custom', due_date: '2026-10-29', lead_days: 7 }), all, TODAY),
      classifyNotification(notification({ id: 3, type: 'custom', due_date: '2026-10-29', lead_days: 1 }), all, TODAY),
      classifyNotification(notification({ id: 4, type: 'custom', due_date: '2026-11-20', lead_days: 1 }), all, TODAY),
    ];
    expect(selectDue(classified).map((entry) => entry.notification.id)).toEqual([2]);
    expect(selectUpcomingWithin(classified, 7).map((entry) => entry.notification.id)).toEqual([3]);
  });
});

describe('completing reminders', () => {
  it('closes one-off reminders and alerts', () => {
    expect(completeNotification(notification(), TODAY)).toEqual({ kind: 'close' });
    expect(completeNotification(notification({ kind: 'alert', type: 'overdue_payment', recurrence: 'once' }), TODAY)).toEqual({ kind: 'close' });
  });

  it('advances recurring reminders and remembers the anchor day so month ends do not drift', () => {
    const monthly = notification({ recurrence: 'monthly', due_date: '2026-10-31' });
    const first = completeNotification(monthly, '2026-10-31');
    expect(first).toMatchObject({ kind: 'advance', input: { due_date: '2026-11-30', status: 'active', snoozed_until: null } });
    const payload = JSON.parse((first as { input: { payload_json: string } }).input.payload_json);
    expect(payload).toEqual({ anchor_day: 31 });

    const second = completeNotification(
      notification({ recurrence: 'monthly', due_date: '2026-11-30', payload_json: JSON.stringify(payload) }),
      '2026-11-30'
    );
    expect(second).toMatchObject({ kind: 'advance', input: { due_date: '2026-12-31' } });
  });

  it('completing early moves past the upcoming occurrence, and a yearly leap-day anchor lands on Feb 28', () => {
    const early = completeNotification(notification({ recurrence: 'monthly', due_date: '2026-11-05' }), TODAY);
    expect(early).toMatchObject({ kind: 'advance', input: { due_date: '2026-12-05' } });
    const leap = completeNotification(notification({ recurrence: 'yearly', due_date: '2024-02-29' }), '2025-02-20');
    // The occurrence had already rolled to 2025-02-28; done → 2026-02-28.
    expect(leap).toMatchObject({ kind: 'advance', input: { due_date: '2026-02-28' } });
  });
});

describe('payment alerts', () => {
  const PAYMENT_SETTINGS = settings({ overdue_payment: { lead_days: 3 } });

  it('only considers active, manually paid series', () => {
    const rows = [
      series({ id: 1 }),
      series({ id: 2, is_autopay: 1 }),
      series({ id: 3, status: 'candidate' }),
      series({ id: 4, status: 'inactive' }),
    ];
    expect(selectManualPaySeries(rows).map((row) => row.id)).toEqual([1]);
  });

  it('derives the due date from due_day for the current cycle, else next_expected_date', () => {
    expect(seriesDueDate(series({ due_day: 26 }), TODAY, 3)).toBe('2026-10-26');
    expect(seriesDueDate(series({ due_day: 28 }), TODAY, 3)).toBe('2026-09-28'); // beyond lead: previous cycle
    expect(seriesDueDate(series({ due_day: 31 }), '2026-02-27', 3)).toBe('2026-02-28'); // clamped
    expect(seriesDueDate(series({ due_day: 30 }), '2027-01-02', 3)).toBe('2026-12-30'); // year boundary
    expect(seriesDueDate(series({ due_day: null, next_expected_date: '2026-11-01' }), TODAY, 3)).toBe('2026-11-01');
    expect(seriesDueDate(series({ due_day: null, next_expected_date: null }), TODAY, 3)).toBeNull();
  });

  it('upserts an alert inside the lead window and skips series paid this cycle', () => {
    const plan = planPaymentAlerts(
      [series({ id: 12, next_expected_date: '2026-10-25' }), series({ id: 13, name: 'Water', next_expected_date: '2026-11-15' }), series({ id: 14, name: 'Gym', next_expected_date: '2026-10-20' })],
      [{ series_id: 14, date: '2026-10-19' }],
      [],
      PAYMENT_SETTINGS,
      TODAY
    );
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]).toMatchObject({
      kind: 'alert',
      type: 'overdue_payment',
      title: 'Electric bill due tomorrow',
      due_date: '2026-10-25',
      dedupe_key: 'overdue:series:12:2026-10-25',
      entity_table: 'recurring_series',
      entity_id: 12,
      source: 'system',
    });
    expect(JSON.parse(plan.upserts[0].payload_json!)).toMatchObject({ series_id: 12, due_date: '2026-10-25', expected_amount: 120 });
    expect(plan.paidIds).toEqual([]);
    expect(plan.staleIds).toEqual([]);
  });

  it('words overdue alerts by days late', () => {
    const plan = planPaymentAlerts([series({ next_expected_date: '2026-10-20' })], [], [], PAYMENT_SETTINGS, TODAY);
    expect(plan.upserts[0].title).toBe('Electric bill 4 days overdue');
  });

  it('marks an existing alert done once a linked payment lands in the window, and dismisses stale ones', () => {
    const existing = [
      notification({ id: 50, kind: 'alert', type: 'overdue_payment', due_date: '2026-10-25', dedupe_key: 'overdue:series:12:2026-10-25', entity_table: 'recurring_series', entity_id: 12, source: 'system' }),
      notification({ id: 51, kind: 'alert', type: 'overdue_payment', due_date: '2026-10-10', dedupe_key: 'overdue:series:77:2026-10-10', entity_table: 'recurring_series', entity_id: 77, source: 'system' }),
      notification({ id: 52, kind: 'alert', type: 'overdue_payment', due_date: '2026-10-10', dedupe_key: 'overdue:series:78:2026-10-10', entity_table: 'recurring_series', entity_id: 78, source: 'system', status: 'done' }),
    ];
    const plan = planPaymentAlerts(
      [series({ id: 12 }), series({ id: 77, is_autopay: 1, next_expected_date: '2026-10-10' })],
      [{ series_id: 12, date: '2026-10-24' }],
      existing,
      PAYMENT_SETTINGS,
      TODAY
    );
    expect(plan.upserts).toEqual([]);
    expect(plan.paidIds).toEqual([50]);
    expect(plan.staleIds).toEqual([51]);
  });

  it('creates nothing when the overdue_payment type is disabled and retires open alerts', () => {
    const existing = [notification({ id: 50, kind: 'alert', type: 'overdue_payment', due_date: '2026-10-25', dedupe_key: 'overdue:series:12:2026-10-25', entity_id: 12, source: 'system' })];
    const plan = planPaymentAlerts([series()], [], existing, settings({ overdue_payment: { enabled: 0 } }), TODAY);
    expect(plan.upserts).toEqual([]);
    expect(plan.staleIds).toEqual([50]);
  });
});

describe('budget alerts', () => {
  const status: BudgetStatus = {
    period: { type: 'month', key: '2026-10' },
    months: ['2026-10'],
    budgetedTotal: 1000,
    actualExpenses: 1200,
    remaining: -200,
    isOverBudget: true,
    categories: [
      { category_id: 3, category_name: 'Dining', budgetedAmount: 200, actualExpenses: 260.5, remaining: -60.5, isOverBudget: true },
      { category_id: 4, category_name: 'Fuel', budgetedAmount: 150, actualExpenses: 90, remaining: 60, isOverBudget: false },
      { category_id: 5, category_name: 'Unplanned', budgetedAmount: 0, actualExpenses: 20, remaining: -20, isOverBudget: true },
    ],
    unbudgetedSpend: 0,
    expectedIncome: 0,
    actualLinkedIncome: 0,
    monthsWithPlan: ['2026-10'],
  };

  it('raises one keyed alert per over-budget category with a real budget', () => {
    const plan = planBudgetAlerts(status, '2026-10', [], settings(), TODAY);
    expect(plan.upserts).toHaveLength(1);
    expect(plan.upserts[0]).toMatchObject({
      type: 'budget_overspend',
      title: 'Dining is over budget',
      dedupe_key: 'budget:2026-10:3',
      entity_table: 'categories',
      entity_id: 3,
      due_date: TODAY,
    });
    expect(plan.upserts[0].body).toContain('$260.50 of $200.00');
  });

  it('resolves this month’s alerts whose category is back under budget, leaving other months alone', () => {
    const existing = [
      notification({ id: 60, kind: 'alert', type: 'budget_overspend', dedupe_key: 'budget:2026-10:4', source: 'system' }),
      notification({ id: 61, kind: 'alert', type: 'budget_overspend', dedupe_key: 'budget:2026-09:4', source: 'system' }),
      notification({ id: 62, kind: 'alert', type: 'budget_overspend', dedupe_key: 'budget:2026-10:3', source: 'system' }),
    ];
    const plan = planBudgetAlerts(status, '2026-10', existing, settings(), TODAY);
    expect(plan.resolvedIds).toEqual([60]);
    expect(plan.upserts.map((row) => row.dedupe_key)).toEqual(['budget:2026-10:3']);
  });

  it('skips budget alerts when disabled or when status is unavailable', () => {
    expect(planBudgetAlerts(status, '2026-10', [], settings({ budget_overspend: { enabled: 0 } }), TODAY).upserts).toEqual([]);
    expect(planBudgetAlerts(null, '2026-10', [], settings(), TODAY).upserts).toEqual([]);
  });
});

describe('reminder maintenance', () => {
  it('wakes lapsed snoozes and advances stale recurring anchors', () => {
    const plan = planReminderMaintenance(
      [
        notification({ id: 1, status: 'snoozed', snoozed_until: '2026-10-24' }),
        notification({ id: 2, status: 'snoozed', snoozed_until: '2026-10-25' }),
        notification({ id: 3, type: 'birthday', recurrence: 'yearly', due_date: '1980-05-02' }),
        notification({ id: 4, type: 'birthday', recurrence: 'yearly', due_date: '2026-10-20' }),
        notification({ id: 5, recurrence: 'monthly', due_date: '2026-08-31', status: 'done' }),
      ],
      TODAY
    );
    expect(plan.wakeIds).toEqual([1]);
    expect(plan.advances).toHaveLength(1);
    expect(plan.advances[0]).toMatchObject({ id: 3, input: { due_date: '2027-05-02' } });
    expect(JSON.parse(plan.advances[0].input.payload_json!)).toEqual({ anchor_day: 2 });
  });
});

describe('scanNotifications', () => {
  type MockedContext = NotificationScanContext & {
    upsertByDedupeKey: ReturnType<typeof vi.fn>;
    setStatus: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };

  function createContext(overrides: Partial<NotificationScanContext> = {}): MockedContext {
    const context: NotificationScanContext = {
      notifications: [],
      settings: settings({ overdue_payment: { lead_days: 3 } }),
      recurringSeries: [series()],
      listSeriesPaymentsSince: vi.fn().mockResolvedValue([]),
      getBudgetStatus: vi.fn().mockResolvedValue(null),
      upsertByDedupeKey: vi.fn().mockResolvedValue(1),
      setStatus: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
    return context as MockedContext;
  }

  it('upserts payment alerts idempotently on their dedupe key and reports writes', async () => {
    const ctx = createContext();
    const summary = await scanNotifications(ctx, TODAY);
    expect(ctx.upsertByDedupeKey).toHaveBeenCalledTimes(1);
    expect(ctx.upsertByDedupeKey.mock.calls[0][0]).toMatchObject({ dedupe_key: 'overdue:series:12:2026-10-25' });
    expect(summary).toMatchObject({ alertsUpserted: 1, writes: 1 });

    // Second run with the row now present: same key again (the DB upsert keeps user state).
    const again = createContext({
      notifications: [notification({ id: 9, kind: 'alert', type: 'overdue_payment', due_date: '2026-10-25', dedupe_key: 'overdue:series:12:2026-10-25', entity_id: 12, source: 'system', status: 'snoozed', snoozed_until: '2026-10-30' })],
    });
    await scanNotifications(again, TODAY);
    expect(again.upsertByDedupeKey.mock.calls[0][0]).toMatchObject({ dedupe_key: 'overdue:series:12:2026-10-25' });
    expect(again.setStatus).not.toHaveBeenCalled();
  });

  it('marks the alert done when a linked payment appears and keeps going when budget status fails', async () => {
    const ctx = createContext({
      notifications: [notification({ id: 9, kind: 'alert', type: 'overdue_payment', due_date: '2026-10-25', dedupe_key: 'overdue:series:12:2026-10-25', entity_id: 12, source: 'system' })],
      listSeriesPaymentsSince: vi.fn().mockResolvedValue([{ series_id: 12, date: '2026-10-23' }]),
      getBudgetStatus: vi.fn().mockRejectedValue(new Error('no plan')),
    });
    const summary = await scanNotifications(ctx, TODAY);
    expect(ctx.listSeriesPaymentsSince).toHaveBeenCalledWith('2026-04-07');
    expect(ctx.upsertByDedupeKey).not.toHaveBeenCalled();
    expect(ctx.setStatus).toHaveBeenCalledWith(9, 'done', null);
    expect(summary).toMatchObject({ alertsResolved: 1, writes: 1 });
  });

  it('writes nothing when everything is current', async () => {
    const ctx = createContext({ recurringSeries: [series({ is_autopay: 1 })] });
    const summary = await scanNotifications(ctx, TODAY);
    expect(summary.writes).toBe(0);
    expect(ctx.upsertByDedupeKey).not.toHaveBeenCalled();
    expect(ctx.setStatus).not.toHaveBeenCalled();
    expect(ctx.update).not.toHaveBeenCalled();
  });
});

describe('createRescanController', () => {
  function fakeTimers() {
    let clock = 0;
    const timers = new Map<number, { at: number; callback: () => void }>();
    let nextId = 1;
    return {
      now: () => clock,
      setTimer: (callback: () => void, ms: number) => {
        const id = nextId++;
        timers.set(id, { at: clock + ms, callback });
        return id;
      },
      clearTimer: (handle: unknown) => {
        timers.delete(handle as number);
      },
      advance: (ms: number) => {
        clock += ms;
        for (const [id, timer] of [...timers.entries()]) {
          if (timer.at <= clock) {
            timers.delete(id);
            timer.callback();
          }
        }
      },
      pending: () => timers.size,
    };
  }

  it('coalesces triggers while a scan is in flight into exactly one follow-up run', async () => {
    const t = fakeTimers();
    let release: (writes: number) => void = () => {};
    const scan = vi.fn(() => new Promise<number>((resolve) => { release = resolve; }));
    const controller = createRescanController({ scan, ...t });

    const first = controller.trigger();
    expect(controller.isRunning()).toBe(true);
    void controller.trigger();
    void controller.trigger();
    expect(scan).toHaveBeenCalledTimes(1);

    release(0);
    // `first` resolves only once the whole loop (including the follow-up) is
    // done, so flush microtasks instead of awaiting it here.
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(scan).toHaveBeenCalledTimes(2);
    expect(controller.isRunning()).toBe(true);
    release(0);
    await first;
    expect(controller.isRunning()).toBe(false);
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('debounces change events and ignores the echo of its own writes', async () => {
    const t = fakeTimers();
    const scan = vi.fn().mockResolvedValue(2);
    const controller = createRescanController({ scan, debounceMs: 1000, quietMs: 3000, ...t });

    controller.onDatabaseChanged();
    controller.onDatabaseChanged();
    expect(t.pending()).toBe(1);
    t.advance(999);
    expect(scan).not.toHaveBeenCalled();
    t.advance(1);
    await Promise.resolve();
    expect(scan).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();

    // The scan wrote two rows: the worker's change broadcast for them arrives within the quiet window.
    controller.onDatabaseChanged();
    expect(t.pending()).toBe(0);
    t.advance(3000);
    controller.onDatabaseChanged();
    expect(t.pending()).toBe(1);
    t.advance(1000);
    await Promise.resolve();
    expect(scan).toHaveBeenCalledTimes(2);
  });

  it('ignores change events while running, drops timers on dispose and reports scan errors', async () => {
    const t = fakeTimers();
    const onError = vi.fn();
    let release: (writes: number) => void = () => {};
    const scan = vi
      .fn<() => Promise<number>>()
      .mockImplementationOnce(() => new Promise<number>((resolve) => { release = resolve; }))
      .mockRejectedValueOnce(new Error('boom'));
    const controller = createRescanController({ scan, onError, debounceMs: 500, ...t });

    const run = controller.trigger();
    controller.onDatabaseChanged();
    expect(t.pending()).toBe(0);
    release(0);
    await run;

    await controller.trigger();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));

    controller.onDatabaseChanged();
    expect(t.pending()).toBe(1);
    controller.dispose();
    expect(t.pending()).toBe(0);
    controller.onDatabaseChanged();
    expect(t.pending()).toBe(0);
  });
});

describe('selectOsNotifiable', () => {
  it('fires once per row per session and at most once per day', () => {
    const all = settings({ custom: { os_notify: 1 }, birthday: { os_notify: 0 } });
    const classified = [
      classifyNotification(notification({ id: 1, due_date: TODAY }), all, TODAY),
      classifyNotification(notification({ id: 2, due_date: TODAY, last_notified_at: '2026-10-24T08:00:00.000Z' }), all, TODAY),
      classifyNotification(notification({ id: 3, due_date: TODAY, last_notified_at: '2026-10-23T08:00:00.000Z' }), all, TODAY),
      classifyNotification(notification({ id: 4, due_date: TODAY, type: 'birthday' }), all, TODAY),
      classifyNotification(notification({ id: 5, due_date: TODAY }), all, TODAY),
    ];
    const fired = new Set([5]);
    expect(selectOsNotifiable(classified, all, fired, TODAY).map((entry) => entry.notification.id)).toEqual([1, 3]);
  });
});
