// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_NOTIFICATION_SETTINGS } from '../lib/databaseServiceNotifications';
import type { AppNotification, RecurringSeries } from '../types/database';
import { useDatabaseNotificationsSlice } from './useDatabaseNotificationsSlice';

function createServiceMock(overrides: { notifications?: AppNotification[] } = {}) {
  const notifications = {
    list: vi.fn().mockResolvedValue(overrides.notifications ?? []),
    getById: vi.fn(),
    getByDedupeKey: vi.fn(),
    create: vi.fn().mockResolvedValue(5),
    update: vi.fn().mockResolvedValue(undefined),
    upsertByDedupeKey: vi.fn().mockResolvedValue(9),
    setStatus: vi.fn().mockResolvedValue(undefined),
    markNotified: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    removeSystemByDedupePrefix: vi.fn().mockResolvedValue(undefined),
    listSeriesPaymentsSince: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue([...DEFAULT_NOTIFICATION_SETTINGS]),
    upsertSetting: vi.fn().mockResolvedValue(undefined),
  };
  const metadataStore = new Map<string, string>();
  const appMetadata = {
    get: vi.fn(async (key: string) => metadataStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      metadataStore.set(key, value);
    }),
  };
  const getBudgetStatus = vi.fn().mockResolvedValue({
    period: { type: 'month', key: '2026-10' },
    months: ['2026-10'],
    budgetedTotal: null,
    actualExpenses: 0,
    remaining: null,
    isOverBudget: false,
    categories: [],
    unbudgetedSpend: 0,
    expectedIncome: 0,
    actualLinkedIncome: 0,
    monthsWithPlan: [],
  });
  return { notifications, appMetadata, getBudgetStatus, metadataStore };
}

function reminder(overrides: Partial<AppNotification> = {}): AppNotification {
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

const manualSeries: RecurringSeries = {
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
  last_seen_date: null,
  next_expected_date: '2026-10-25',
  is_autopay: 0,
  due_day: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('useDatabaseNotificationsSlice', () => {
  it('throws when called without an initialized service', async () => {
    const { result } = renderHook(() =>
      useDatabaseNotificationsSlice({ databaseService: null, refreshNotifications: vi.fn() })
    );

    await expect(result.current.getNotifications()).rejects.toThrow('Database service not initialized');
    await expect(result.current.getNotificationPreferences()).rejects.toThrow('Database service not initialized');
  });

  it('completes one-off rows by closing them and recurring rows by advancing them, refreshing once each', async () => {
    const service = createServiceMock();
    const refreshNotifications = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDatabaseNotificationsSlice({ databaseService: service as any, refreshNotifications })
    );

    await act(async () => {
      await result.current.completeNotification(reminder());
    });
    expect(service.notifications.setStatus).toHaveBeenCalledWith(1, 'done', null);
    expect(service.notifications.update).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.completeNotification(reminder({ id: 2, recurrence: 'yearly', due_date: '2000-10-01' }));
    });
    expect(service.notifications.update).toHaveBeenCalledTimes(1);
    const [id, input] = service.notifications.update.mock.calls[0];
    expect(id).toBe(2);
    expect(input).toMatchObject({ recurrence: 'yearly', status: 'active', snoozed_until: null });
    expect(input.due_date > '2000-10-01').toBe(true);
    expect(refreshNotifications).toHaveBeenCalledTimes(2);
  });

  it('snoozes with presets or an explicit date and dismisses', async () => {
    const service = createServiceMock();
    const refreshNotifications = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDatabaseNotificationsSlice({ databaseService: service as any, refreshNotifications })
    );

    await act(async () => {
      await result.current.snoozeNotification(4, '2026-12-01');
      await result.current.snoozeNotification(4, 'day');
      await result.current.dismissNotification(4);
    });

    expect(service.notifications.setStatus.mock.calls[0]).toEqual([4, 'snoozed', '2026-12-01']);
    expect(service.notifications.setStatus.mock.calls[1][1]).toBe('snoozed');
    expect(service.notifications.setStatus.mock.calls[1][2]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(service.notifications.setStatus.mock.calls[2]).toEqual([4, 'dismissed', null]);
    expect(refreshNotifications).toHaveBeenCalledTimes(3);
  });

  it('reads and writes the feature switches in app_metadata with sensible defaults', async () => {
    const service = createServiceMock();
    const { result } = renderHook(() =>
      useDatabaseNotificationsSlice({ databaseService: service as any, refreshNotifications: vi.fn() })
    );

    await expect(result.current.getNotificationPreferences()).resolves.toEqual({
      enabled: true,
      osEnabled: false,
      lastScanAt: null,
    });

    await act(async () => {
      await result.current.setNotificationsEnabled(false);
      await result.current.setOsNotificationsEnabled(true);
    });
    expect(service.appMetadata.set).toHaveBeenCalledWith('notifications.enabled', '0');
    expect(service.appMetadata.set).toHaveBeenCalledWith('notifications.os_enabled', '1');
    await expect(result.current.getNotificationPreferences()).resolves.toMatchObject({ enabled: false, osEnabled: true });
  });

  it('runs the scan against the live service, writes alerts and refreshes the collection once', async () => {
    const service = createServiceMock();
    const refreshNotifications = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDatabaseNotificationsSlice({ databaseService: service as any, refreshNotifications })
    );

    let summary: Awaited<ReturnType<typeof result.current.runNotificationScan>> | undefined;
    await act(async () => {
      summary = await result.current.runNotificationScan({
        recurringSeries: [manualSeries],
        settings: DEFAULT_NOTIFICATION_SETTINGS.map((setting) =>
          setting.type === 'overdue_payment' ? { ...setting, lead_days: 3 } : setting
        ),
        today: '2026-10-24',
      });
    });

    expect(service.notifications.list).toHaveBeenCalledTimes(1);
    expect(service.notifications.getSettings).not.toHaveBeenCalled();
    expect(service.notifications.listSeriesPaymentsSince).toHaveBeenCalledWith('2026-04-07');
    expect(service.getBudgetStatus).toHaveBeenCalledWith({ type: 'month', key: '2026-10' });
    expect(service.notifications.upsertByDedupeKey).toHaveBeenCalledTimes(1);
    expect(service.notifications.upsertByDedupeKey.mock.calls[0][0]).toMatchObject({
      dedupe_key: 'overdue:series:12:2026-10-25',
    });
    expect(summary).toMatchObject({ alertsUpserted: 1, writes: 1 });
    expect(refreshNotifications).toHaveBeenCalledTimes(1);
    expect(service.metadataStore.get('notifications.last_scan_at')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('skips the refresh when the scan wrote nothing and loads settings itself when not given', async () => {
    const service = createServiceMock();
    const refreshNotifications = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useDatabaseNotificationsSlice({ databaseService: service as any, refreshNotifications })
    );

    await act(async () => {
      await result.current.runNotificationScan({ recurringSeries: [{ ...manualSeries, is_autopay: 1 }], today: '2026-10-24' });
    });

    expect(service.notifications.getSettings).toHaveBeenCalledTimes(1);
    expect(service.notifications.upsertByDedupeKey).not.toHaveBeenCalled();
    expect(refreshNotifications).not.toHaveBeenCalled();
    // No database write at all on a no-op scan (cloud auto-sync watches every write).
    expect(service.appMetadata.set).not.toHaveBeenCalled();
  });
});
