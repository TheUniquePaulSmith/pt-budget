'use client';

// Page-facing slices for the notifications feature. Re-exported from
// useDatabaseSlices.ts (the hub); owned by the notifications agent.

import {
  useDatabaseBudget,
  useDatabaseCollections,
  useDatabaseNotifications,
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
    getNotificationSettings: notifications.getNotificationSettings,
    upsertNotificationSetting: notifications.upsertNotificationSetting,
  };
}

/** Bell badge and dashboard card: read-only view of the cached collection. */
export function useNotificationBadgeSlice() {
  const collections = useDatabaseCollections();
  const notifications = useDatabaseNotifications();

  return {
    notifications: collections.notifications,
    setNotificationStatus: notifications.setNotificationStatus,
  };
}

/** Headless runtime (scan on open / on change): inputs the scan reads and the upsert it writes. */
export function useNotificationsRuntimeSlice() {
  const collections = useDatabaseCollections();
  const notifications = useDatabaseNotifications();
  const budgets = useDatabaseBudget();

  return {
    notifications: collections.notifications,
    recurringSeries: collections.recurringSeries,
    transactionVersion: collections.transactionVersion,
    budgetVersion: collections.budgetVersion,
    upsertNotificationByDedupeKey: notifications.upsertNotificationByDedupeKey,
    setNotificationStatus: notifications.setNotificationStatus,
    markNotificationNotified: notifications.markNotificationNotified,
    getNotificationSettings: notifications.getNotificationSettings,
    getBudgetStatus: budgets.getBudgetStatus,
  };
}
