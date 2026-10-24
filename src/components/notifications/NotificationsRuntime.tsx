'use client';

/**
 * Headless runtime for notifications, mounted once by the app shell.
 *
 * Responsibilities:
 *   - load `notification_settings` and the feature switches from the database
 *     and publish them to `notificationsStore` (reloaded when the settings tab
 *     says they changed);
 *   - run the system-alert scan after the collections load, on the worker's
 *     `database_changed` broadcast (debounced, ignoring the echo of the scan's
 *     own writes), when the page asks for a rescan, and when the tab comes
 *     back into view after a while;
 *   - fire OS notifications for newly due rows while a tab is open.
 *
 * Keeping the effects here rather than in the bell means they run even when
 * the bell is not rendered.
 */

import { useEffect, useRef } from 'react';

import { useNotificationsRuntimeSlice } from '@/contexts/useDatabaseSlices';
import { databaseWorkerService } from '@/lib/databaseWorkerService';
import { todayLocalISO } from '@/lib/dateOnly';
import { logger } from '@/lib/logging';
import {
  classifyNotifications,
  createRescanController,
  getOsNotificationPermission,
  selectDue,
  selectOsNotifiable,
} from '@/lib/notificationService';
import { typeLabel } from './notificationPresentation';
import {
  getNotificationsView,
  onNotificationRescanRequested,
  onNotificationSettingsChanged,
  setNotificationsView,
  useNotificationsView,
} from './notificationsStore';

const log = logger.child({ component: 'NotificationsRuntime' });

/** A tab that was hidden for longer than this rescans when it becomes visible again. */
const VISIBILITY_RESCAN_MS = 30 * 60 * 1000;
/** How often the published "today" is checked so surfaces roll over at midnight. */
const DAY_TICK_MS = 60 * 1000;

export default function NotificationsRuntime(): null {
  const {
    isDatabaseLoaded,
    notifications,
    recurringSeries,
    runNotificationScan,
    markNotificationNotified,
    getNotificationSettings,
    getNotificationPreferences,
  } = useNotificationsRuntimeSlice();
  const view = useNotificationsView();

  // Long-lived callbacks see the latest props through a ref so the rescan
  // controller (created once per database session) is never recreated.
  const latest = useRef({ recurringSeries, runNotificationScan, getNotificationSettings, getNotificationPreferences });
  latest.current = { recurringSeries, runNotificationScan, getNotificationSettings, getNotificationPreferences };

  const firedThisSession = useRef(new Set<number>());
  const lastScanFinishedAt = useRef(0);

  // Load settings + switches, then run the first scan. Re-run whenever the
  // settings tab reports a change.
  useEffect(() => {
    if (!isDatabaseLoaded) {
      setNotificationsView({ ready: false, scanning: false });
      return;
    }
    let cancelled = false;

    // Created inside the effect (not memoized) so a StrictMode re-run never
    // keeps a disposed controller around.
    const controller = createRescanController({
      scan: async () => {
        const current = getNotificationsView();
        if (!current.preferences.enabled) {
          setNotificationsView({ scanning: false });
          return 0;
        }
        setNotificationsView({ scanning: true, lastError: null });
        try {
          const summary = await latest.current.runNotificationScan({
            recurringSeries: latest.current.recurringSeries,
            settings: current.settings,
          });
          lastScanFinishedAt.current = Date.now();
          setNotificationsView({
            scanning: false,
            lastScan: summary,
            preferences: { ...getNotificationsView().preferences, lastScanAt: new Date().toISOString() },
          });
          return summary.writes;
        } catch (error) {
          setNotificationsView({ scanning: false, lastError: error instanceof Error ? error.message : 'Notification scan failed' });
          throw error;
        }
      },
      onError: (error) => log.error('Notification scan failed', { operation: 'scanNotifications', error }),
    });

    const load = async () => {
      try {
        const [settings, preferences] = await Promise.all([
          latest.current.getNotificationSettings(),
          latest.current.getNotificationPreferences(),
        ]);
        if (cancelled) return;
        setNotificationsView({
          ready: true,
          today: todayLocalISO(),
          settings,
          preferences,
          osPermission: getOsNotificationPermission(),
        });
        await controller.trigger();
      } catch (error) {
        if (cancelled) return;
        log.error('Failed to load notification settings', { operation: 'loadSettings', error });
        setNotificationsView({ ready: true, lastError: error instanceof Error ? error.message : 'Failed to load notification settings' });
      }
    };

    void load();
    const unsubscribeSettings = onNotificationSettingsChanged(() => {
      void load();
    });
    const unsubscribeRescan = onNotificationRescanRequested(() => {
      void controller.trigger();
    });
    const unsubscribeChanges = databaseWorkerService.onDatabaseChanged(() => {
      controller.onDatabaseChanged();
    });

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const today = todayLocalISO();
      if (today !== getNotificationsView().today) setNotificationsView({ today });
      if (Date.now() - lastScanFinishedAt.current > VISIBILITY_RESCAN_MS) void controller.trigger();
    };
    document.addEventListener('visibilitychange', onVisibility);

    const dayTick = window.setInterval(() => {
      const today = todayLocalISO();
      if (today !== getNotificationsView().today) {
        setNotificationsView({ today });
        void controller.trigger();
      }
    }, DAY_TICK_MS);

    return () => {
      cancelled = true;
      unsubscribeSettings();
      unsubscribeRescan();
      unsubscribeChanges();
      document.removeEventListener('visibilitychange', onVisibility);
      window.clearInterval(dayTick);
      controller.dispose();
    };
  }, [isDatabaseLoaded]);

  // OS notifications for due rows: once per row per session, only while a tab is open.
  useEffect(() => {
    if (!view.ready || !view.preferences.enabled || !view.preferences.osEnabled) return;
    if (getOsNotificationPermission() !== 'granted') return;

    const due = selectDue(classifyNotifications(notifications, view.settings, view.today));
    const toFire = selectOsNotifiable(due, view.settings, firedThisSession.current, view.today);
    if (toFire.length === 0) return;

    for (const entry of toFire) {
      firedThisSession.current.add(entry.notification.id);
      try {
        const osNotification = new Notification(entry.notification.title, {
          body: entry.notification.body ?? typeLabel(entry.notification.type),
          tag: `ptbudget-notification-${entry.notification.id}`,
        });
        osNotification.onclick = () => {
          window.focus();
          osNotification.close();
        };
      } catch (error) {
        log.warn('Could not show OS notification', { operation: 'osNotify', error, notificationId: entry.notification.id });
      }
      markNotificationNotified(entry.notification.id).catch((error) => {
        log.warn('Could not record OS notification', { operation: 'markNotified', error, notificationId: entry.notification.id });
      });
    }
  }, [markNotificationNotified, notifications, view.preferences.enabled, view.preferences.osEnabled, view.ready, view.settings, view.today]);

  return null;
}
