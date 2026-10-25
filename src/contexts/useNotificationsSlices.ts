'use client';

// Page-facing slices for the notifications feature. Re-exported from
// useDatabaseSlices.ts (the hub); owned by the notifications agent.

import {
  useDatabaseCollections,
  useDatabaseNotifications,
  useDatabaseStatus,
} from './DatabaseContext';

/** Everything the Notifications page needs. */
export function useNotificationsPageSlice() {
  const collections = useDatabaseCollections();
  const notifications = useDatabaseNotifications();

  return {
    notifications: collections.notifications,
    categories: collections.categories,
    recurringSeries: collections.recurringSeries,
    transactionVersion: collections.transactionVersion,
    getNotifications: notifications.getNotifications,
    createNotification: notifications.createNotification,
    updateNotification: notifications.updateNotification,
    setNotificationStatus: notifications.setNotificationStatus,
    deleteNotification: notifications.deleteNotification,
    completeNotification: notifications.completeNotification,
    snoozeNotification: notifications.snoozeNotification,
    dismissNotification: notifications.dismissNotification,
    getNotificationSettings: notifications.getNotificationSettings,
    upsertNotificationSetting: notifications.upsertNotificationSetting,
    getNotificationPreferences: notifications.getNotificationPreferences,
  };
}

/** Bell badge and dashboard card: read-only view of the cached collection plus row actions. */
export function useNotificationBadgeSlice() {
  const collections = useDatabaseCollections();
  const notifications = useDatabaseNotifications();

  return {
    notifications: collections.notifications,
    setNotificationStatus: notifications.setNotificationStatus,
    completeNotification: notifications.completeNotification,
    snoozeNotification: notifications.snoozeNotification,
    dismissNotification: notifications.dismissNotification,
    getNotificationSettings: notifications.getNotificationSettings,
    getNotificationPreferences: notifications.getNotificationPreferences,
  };
}

/** Headless runtime (scan on open / on change): inputs the scan reads and the writes it makes. */
export function useNotificationsRuntimeSlice() {
  const collections = useDatabaseCollections();
  const notifications = useDatabaseNotifications();
  const status = useDatabaseStatus();

  return {
    isDatabaseLoaded: status.isDatabaseLoaded,
    notifications: collections.notifications,
    recurringSeries: collections.recurringSeries,
    transactionVersion: collections.transactionVersion,
    budgetVersion: collections.budgetVersion,
    runNotificationScan: notifications.runNotificationScan,
    markNotificationNotified: notifications.markNotificationNotified,
    getNotificationSettings: notifications.getNotificationSettings,
    getNotificationPreferences: notifications.getNotificationPreferences,
  };
}

/** Settings → Notifications tab: per-type rows plus the global / OS switches. */
export function useNotificationsSettingsSlice() {
  const notifications = useDatabaseNotifications();
  const status = useDatabaseStatus();

  return {
    isDatabaseLoaded: status.isDatabaseLoaded,
    getNotificationSettings: notifications.getNotificationSettings,
    upsertNotificationSetting: notifications.upsertNotificationSetting,
    getNotificationPreferences: notifications.getNotificationPreferences,
    setNotificationsEnabled: notifications.setNotificationsEnabled,
    setOsNotificationsEnabled: notifications.setOsNotificationsEnabled,
  };
}
