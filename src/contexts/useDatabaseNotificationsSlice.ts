"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import {
  NOTIFICATIONS_ENABLED_KEY,
  NOTIFICATIONS_LAST_SCAN_KEY,
  NOTIFICATIONS_OS_ENABLED_KEY,
  completeNotification as planCompletion,
  scanNotifications,
  type SnoozePreset,
  snoozeUntil,
} from '../lib/notificationService';
import { todayLocalISO } from '../lib/dateOnly';
import type {
  AppNotification,
  AppNotificationInput,
  NotificationSetting,
  NotificationStatus,
  RecurringSeries,
} from '../types/database';
import type { NotificationScanSummary, SeriesPaymentRow } from '../types/notifications';

/** Feature-level switches kept in `app_metadata` (both default to on / off respectively). */
export interface NotificationPreferences {
  enabled: boolean;
  osEnabled: boolean;
  lastScanAt: string | null;
}

export interface RunNotificationScanOptions {
  recurringSeries: RecurringSeries[];
  settings?: NotificationSetting[];
  today?: string;
}

/**
 * Provider-domain slice for notifications (schema v3). Owned by the
 * notifications feature after the foundation lands; DatabaseContext imports
 * this interface, so new methods can be added here without touching it.
 */
export interface DatabaseNotificationsSlice {
  getNotifications: (filter?: { status?: NotificationStatus }) => Promise<AppNotification[]>;
  createNotification: (input: AppNotificationInput) => Promise<number>;
  updateNotification: (id: number, input: AppNotificationInput) => Promise<void>;
  upsertNotificationByDedupeKey: (input: AppNotificationInput & { dedupe_key: string }) => Promise<number>;
  setNotificationStatus: (id: number, status: NotificationStatus, snoozedUntil?: string | null) => Promise<void>;
  markNotificationNotified: (id: number) => Promise<void>;
  deleteNotification: (id: number) => Promise<void>;
  getNotificationSettings: () => Promise<NotificationSetting[]>;
  upsertNotificationSetting: (setting: NotificationSetting) => Promise<void>;
  // --- feature additions ---
  /** "Done": recurring reminders advance to their next occurrence, everything else closes. */
  completeNotification: (notification: AppNotification) => Promise<void>;
  snoozeNotification: (id: number, until: SnoozePreset | string) => Promise<void>;
  dismissNotification: (id: number) => Promise<void>;
  listSeriesPaymentsSince: (sinceDate: string) => Promise<SeriesPaymentRow[]>;
  getNotificationPreferences: () => Promise<NotificationPreferences>;
  setNotificationsEnabled: (enabled: boolean) => Promise<void>;
  setOsNotificationsEnabled: (enabled: boolean) => Promise<void>;
  /**
   * Runs the system-alert scan against the live service and refreshes the
   * cached collection once at the end (never per write).
   */
  runNotificationScan: (options: RunNotificationScanOptions) => Promise<NotificationScanSummary>;
}

type NotificationsService = Pick<DatabaseService, 'notifications' | 'appMetadata' | 'getBudgetStatus'>;

interface UseDatabaseNotificationsSliceOptions {
  databaseService: NotificationsService | null;
  refreshNotifications: () => Promise<void>;
}

export function useDatabaseNotificationsSlice({
  databaseService,
  refreshNotifications,
}: UseDatabaseNotificationsSliceOptions): DatabaseNotificationsSlice {
  const requireDatabase = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    return databaseService;
  }, [databaseService]);

  const requireService = useCallback(() => requireDatabase().notifications, [requireDatabase]);

  const getNotifications = useCallback(
    async (filter?: { status?: NotificationStatus }) => requireService().list(filter),
    [requireService]
  );

  const createNotification = useCallback(
    async (input: AppNotificationInput) => {
      const id = await requireService().create(input);
      await refreshNotifications();
      return id;
    },
    [refreshNotifications, requireService]
  );

  const updateNotification = useCallback(
    async (id: number, input: AppNotificationInput) => {
      await requireService().update(id, input);
      await refreshNotifications();
    },
    [refreshNotifications, requireService]
  );

  const upsertNotificationByDedupeKey = useCallback(
    async (input: AppNotificationInput & { dedupe_key: string }) => {
      const id = await requireService().upsertByDedupeKey(input);
      await refreshNotifications();
      return id;
    },
    [refreshNotifications, requireService]
  );

  const setNotificationStatus = useCallback(
    async (id: number, status: NotificationStatus, snoozedUntil: string | null = null) => {
      await requireService().setStatus(id, status, snoozedUntil);
      await refreshNotifications();
    },
    [refreshNotifications, requireService]
  );

  const markNotificationNotified = useCallback(
    async (id: number) => requireService().markNotified(id),
    [requireService]
  );

  const deleteNotification = useCallback(
    async (id: number) => {
      await requireService().remove(id);
      await refreshNotifications();
    },
    [refreshNotifications, requireService]
  );

  const getNotificationSettings = useCallback(
    async () => requireService().getSettings(),
    [requireService]
  );

  const upsertNotificationSetting = useCallback(
    async (setting: NotificationSetting) => requireService().upsertSetting(setting),
    [requireService]
  );

  const completeNotification = useCallback(
    async (notification: AppNotification) => {
      const plan = planCompletion(notification, todayLocalISO());
      if (plan.kind === 'advance') {
        await requireService().update(notification.id, plan.input);
      } else {
        await requireService().setStatus(notification.id, 'done', null);
      }
      await refreshNotifications();
    },
    [refreshNotifications, requireService]
  );

  const snoozeNotification = useCallback(
    async (id: number, until: SnoozePreset | string) => {
      const date = until === 'day' || until === 'week' ? snoozeUntil(until, todayLocalISO()) : until;
      await requireService().setStatus(id, 'snoozed', date);
      await refreshNotifications();
    },
    [refreshNotifications, requireService]
  );

  const dismissNotification = useCallback(
    async (id: number) => {
      await requireService().setStatus(id, 'dismissed', null);
      await refreshNotifications();
    },
    [refreshNotifications, requireService]
  );

  const listSeriesPaymentsSince = useCallback(
    async (sinceDate: string) => requireService().listSeriesPaymentsSince(sinceDate),
    [requireService]
  );

  const getNotificationPreferences = useCallback(async (): Promise<NotificationPreferences> => {
    const metadata = requireDatabase().appMetadata;
    const [enabled, osEnabled, lastScanAt] = await Promise.all([
      metadata.get(NOTIFICATIONS_ENABLED_KEY),
      metadata.get(NOTIFICATIONS_OS_ENABLED_KEY),
      metadata.get(NOTIFICATIONS_LAST_SCAN_KEY),
    ]);
    return {
      enabled: enabled === null ? true : enabled === '1' || enabled === 'true',
      osEnabled: osEnabled === '1' || osEnabled === 'true',
      lastScanAt,
    };
  }, [requireDatabase]);

  const setNotificationsEnabled = useCallback(
    async (enabled: boolean) => {
      await requireDatabase().appMetadata.set(NOTIFICATIONS_ENABLED_KEY, enabled ? '1' : '0');
    },
    [requireDatabase]
  );

  const setOsNotificationsEnabled = useCallback(
    async (enabled: boolean) => {
      await requireDatabase().appMetadata.set(NOTIFICATIONS_OS_ENABLED_KEY, enabled ? '1' : '0');
    },
    [requireDatabase]
  );

  const runNotificationScan = useCallback(
    async ({ recurringSeries, settings, today = todayLocalISO() }: RunNotificationScanOptions) => {
      const database = requireDatabase();
      const service = database.notifications;
      const [notifications, resolvedSettings] = await Promise.all([
        service.list(),
        settings ? Promise.resolve(settings) : service.getSettings(),
      ]);
      const summary = await scanNotifications(
        {
          notifications,
          settings: resolvedSettings,
          recurringSeries,
          listSeriesPaymentsSince: (sinceDate) => service.listSeriesPaymentsSince(sinceDate),
          getBudgetStatus: (month) => database.getBudgetStatus({ type: 'month', key: month }),
          upsertByDedupeKey: (input) => service.upsertByDedupeKey(input),
          setStatus: (id, status, snoozedUntil) => service.setStatus(id, status, snoozedUntil ?? null),
          update: (id, input) => service.update(id, input),
        },
        today
      );
      // Only touch app_metadata when the scan already wrote rows: a write on
      // every scan would leave cloud auto-sync permanently "pending".
      if (summary.writes > 0) {
        await database.appMetadata.set(NOTIFICATIONS_LAST_SCAN_KEY, new Date().toISOString());
        await refreshNotifications();
      }
      return summary;
    },
    [refreshNotifications, requireDatabase]
  );

  return useMemo(
    () => ({
      getNotifications,
      createNotification,
      updateNotification,
      upsertNotificationByDedupeKey,
      setNotificationStatus,
      markNotificationNotified,
      deleteNotification,
      getNotificationSettings,
      upsertNotificationSetting,
      completeNotification,
      snoozeNotification,
      dismissNotification,
      listSeriesPaymentsSince,
      getNotificationPreferences,
      setNotificationsEnabled,
      setOsNotificationsEnabled,
      runNotificationScan,
    }),
    [
      completeNotification,
      createNotification,
      deleteNotification,
      dismissNotification,
      getNotificationPreferences,
      getNotificationSettings,
      getNotifications,
      listSeriesPaymentsSince,
      markNotificationNotified,
      runNotificationScan,
      setNotificationStatus,
      setNotificationsEnabled,
      setOsNotificationsEnabled,
      snoozeNotification,
      updateNotification,
      upsertNotificationByDedupeKey,
      upsertNotificationSetting,
    ]
  );
}
