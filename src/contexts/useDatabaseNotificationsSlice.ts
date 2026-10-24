"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import type {
  AppNotification,
  AppNotificationInput,
  NotificationSetting,
  NotificationStatus,
} from '../types/database';

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
}

type NotificationsService = Pick<DatabaseService, 'notifications'>;

interface UseDatabaseNotificationsSliceOptions {
  databaseService: NotificationsService | null;
  refreshNotifications: () => Promise<void>;
}

export function useDatabaseNotificationsSlice({
  databaseService,
  refreshNotifications,
}: UseDatabaseNotificationsSliceOptions): DatabaseNotificationsSlice {
  const requireService = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    return databaseService.notifications;
  }, [databaseService]);

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
    }),
    [
      createNotification,
      deleteNotification,
      getNotificationSettings,
      getNotifications,
      markNotificationNotified,
      setNotificationStatus,
      updateNotification,
      upsertNotificationByDedupeKey,
      upsertNotificationSetting,
    ]
  );
}
