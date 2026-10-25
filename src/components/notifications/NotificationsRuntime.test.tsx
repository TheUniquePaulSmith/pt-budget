// @vitest-environment jsdom

import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSlice = vi.fn();
const mockOnDatabaseChanged = vi.fn();

vi.mock('@/contexts/useDatabaseSlices', () => ({
  useNotificationsRuntimeSlice: () => mockSlice(),
}));
vi.mock('@/lib/databaseWorkerService', () => ({
  databaseWorkerService: { onDatabaseChanged: (callback: () => void) => mockOnDatabaseChanged(callback) },
}));

import { DEFAULT_NOTIFICATION_SETTINGS } from '@/lib/databaseServiceNotifications';
import NotificationsRuntime from './NotificationsRuntime';
import {
  getNotificationsView,
  requestNotificationRescan,
  resetNotificationsView,
  setNotificationsView,
} from './notificationsStore';

const EMPTY_SUMMARY = { today: '2026-10-24', alertsUpserted: 0, alertsResolved: 0, remindersAdvanced: 0, snoozesExpired: 0, writes: 0 };

function sliceValue(overrides: Record<string, unknown> = {}) {
  return {
    isDatabaseLoaded: true,
    notifications: [],
    recurringSeries: [],
    transactionVersion: 0,
    budgetVersion: 0,
    runNotificationScan: vi.fn().mockResolvedValue(EMPTY_SUMMARY),
    markNotificationNotified: vi.fn().mockResolvedValue(undefined),
    getNotificationSettings: vi.fn().mockResolvedValue([...DEFAULT_NOTIFICATION_SETTINGS]),
    getNotificationPreferences: vi.fn().mockResolvedValue({ enabled: true, osEnabled: false, lastScanAt: null }),
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('NotificationsRuntime', () => {
  beforeEach(() => {
    resetNotificationsView();
    mockOnDatabaseChanged.mockReset();
    mockOnDatabaseChanged.mockImplementation(() => () => {});
  });

  it('loads settings and scans once when the database is ready, and publishes the result', async () => {
    const slice = sliceValue();
    mockSlice.mockReturnValue(slice);

    render(<NotificationsRuntime />);

    await waitFor(() => expect(slice.runNotificationScan).toHaveBeenCalledTimes(1));
    expect(slice.getNotificationSettings).toHaveBeenCalledTimes(1);
    expect(slice.getNotificationPreferences).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getNotificationsView().lastScanFinishedAt).toBeGreaterThan(0));
    expect(getNotificationsView().ready).toBe(true);
    expect(getNotificationsView().scanning).toBe(false);
    expect(mockOnDatabaseChanged).toHaveBeenCalledTimes(1);
  });

  it('does nothing until the database is loaded', async () => {
    const slice = sliceValue({ isDatabaseLoaded: false });
    mockSlice.mockReturnValue(slice);

    render(<NotificationsRuntime />);
    await flush();

    expect(slice.getNotificationSettings).not.toHaveBeenCalled();
    expect(slice.runNotificationScan).not.toHaveBeenCalled();
    expect(mockOnDatabaseChanged).not.toHaveBeenCalled();
    expect(getNotificationsView().ready).toBe(false);
  });

  it('is remount-safe: a remount shortly after a scan only re-subscribes, it does not reload or rescan', async () => {
    const slice = sliceValue();
    mockSlice.mockReturnValue(slice);

    const first = render(<NotificationsRuntime />);
    await waitFor(() => expect(getNotificationsView().lastScanFinishedAt).toBeGreaterThan(0));
    first.unmount();

    // The shell mounts the runtime in a different subtree for full-screen pages.
    const second = render(<NotificationsRuntime />);
    await flush();

    expect(slice.getNotificationSettings).toHaveBeenCalledTimes(1);
    expect(slice.runNotificationScan).toHaveBeenCalledTimes(1);
    expect(mockOnDatabaseChanged).toHaveBeenCalledTimes(2);
    expect(getNotificationsView().ready).toBe(true);

    // An explicit Rescan still works after the remount.
    await act(async () => {
      requestNotificationRescan();
    });
    await waitFor(() => expect(slice.runNotificationScan).toHaveBeenCalledTimes(2));
    second.unmount();
  });

  it('reloads on remount once the last scan is stale (or the store was reset for a new database session)', async () => {
    const slice = sliceValue();
    mockSlice.mockReturnValue(slice);

    const first = render(<NotificationsRuntime />);
    await waitFor(() => expect(slice.runNotificationScan).toHaveBeenCalledTimes(1));
    first.unmount();

    setNotificationsView({ lastScanFinishedAt: Date.now() - 10 * 60 * 1000 });
    const second = render(<NotificationsRuntime />);
    await waitFor(() => expect(slice.runNotificationScan).toHaveBeenCalledTimes(2));
    expect(slice.getNotificationSettings).toHaveBeenCalledTimes(2);
    second.unmount();
  });

  it('rescans on a database change after the debounce, ignoring the echo of its own writes', async () => {
    vi.useFakeTimers();
    try {
      let changeCallback: (() => void) | null = null;
      mockOnDatabaseChanged.mockImplementation((callback: () => void) => {
        changeCallback = callback;
        return () => {};
      });
      const slice = sliceValue({
        runNotificationScan: vi
          .fn()
          .mockResolvedValueOnce(EMPTY_SUMMARY)
          .mockResolvedValue({ ...EMPTY_SUMMARY, alertsUpserted: 1, writes: 1 }),
      });
      mockSlice.mockReturnValue(slice);

      render(<NotificationsRuntime />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(slice.runNotificationScan).toHaveBeenCalledTimes(1);
      expect(changeCallback).not.toBeNull();

      await act(async () => {
        changeCallback!();
        await vi.advanceTimersByTimeAsync(1400);
      });
      expect(slice.runNotificationScan).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(slice.runNotificationScan).toHaveBeenCalledTimes(2);

      // That scan wrote a row: the worker's change broadcast for it must not start a third scan.
      await act(async () => {
        changeCallback!();
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(slice.runNotificationScan).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
