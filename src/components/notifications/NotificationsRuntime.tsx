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
 *     own writes), and when the page asks for a rescan - nothing else;
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

/** How often the published "today" is checked so surfaces roll over at midnight (no scan). */
const DAY_TICK_MS = 60 * 1000;
/**
 * The shell mounts the runtime in two places (full-screen pages vs. the normal
 * chrome), so navigating to Settings or the Developer Console remounts it. A
 * remount within this window of the last scan only re-subscribes; it does not
 * reload settings or rescan (which would issue worker queries from the new page).
 */
const REMOUNT_RELOAD_AFTER_MS = 60 * 1000;

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
          const finishedAt = Date.now();
          setNotificationsView({
            scanning: false,
            lastScan: summary,
            lastScanFinishedAt: finishedAt,
            preferences: { ...getNotificationsView().preferences, lastScanAt: new Date(finishedAt).toISOString() },
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

    const current = getNotificationsView();
    const recentlyScanned = current.ready && Date.now() - current.lastScanFinishedAt < REMOUNT_RELOAD_AFTER_MS;
    if (recentlyScanned) {
      // Remount shortly after a scan: keep what the store has, just listen again.
      setNotificationsView({ scanning: false });
    } else {
      void load();
    }
    const unsubscribeSettings = onNotificationSettingsChanged(() => {
      void load();
    });
    const unsubscribeRescan = onNotificationRescanRequested(() => {
      void controller.trigger();
    });
    const unsubscribeChanges = databaseWorkerService.onDatabaseChanged(() => {
      controller.onDatabaseChanged();
    });

    // Surfaces classify against the published "today"; roll it at midnight.
    const dayTick = window.setInterval(() => {
      const today = todayLocalISO();
      if (today !== getNotificationsView().today) setNotificationsView({ today });
    }, DAY_TICK_MS);

    return () => {
      cancelled = true;
      unsubscribeSettings();
      unsubscribeRescan();
      unsubscribeChanges();
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
