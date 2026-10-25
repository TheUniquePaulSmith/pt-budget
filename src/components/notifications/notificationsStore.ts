'use client';

/**
 * Tiny external store shared by the notification surfaces.
 *
 * `NotificationsRuntime` (mounted once by the shell) owns the settings and
 * feature switches, runs the scan, and publishes the results here; the bell,
 * dashboard card, page and settings tab read them with `useNotificationsView`
 * and classify the cached `notifications` collection themselves. Keeping the
 * store outside React means a page can ask for a rescan without a context
 * provider wrapping it.
 */

import { useSyncExternalStore } from 'react';

import { DEFAULT_NOTIFICATION_SETTINGS } from '@/lib/databaseServiceNotifications';
import { todayLocalISO } from '@/lib/dateOnly';
import type { NotificationSetting } from '@/types/database';
import type { NotificationScanSummary } from '@/types/notifications';
import type { NotificationPreferences } from '@/contexts/useDatabaseNotificationsSlice';

export interface NotificationsView {
  /** True once the runtime has loaded settings and preferences from the database. */
  ready: boolean;
  today: string;
  settings: NotificationSetting[];
  preferences: NotificationPreferences;
  scanning: boolean;
  lastScan: NotificationScanSummary | null;
  lastError: string | null;
  /** Browser permission for OS notifications, mirrored so the settings tab can show it. */
  osPermission: NotificationPermission | 'unsupported';
  /** Epoch ms when the last scan finished (0 = never); lets a remounted runtime skip a redundant reload. */
  lastScanFinishedAt: number;
}

const DEFAULT_VIEW: NotificationsView = {
  ready: false,
  today: '1970-01-01',
  settings: [...DEFAULT_NOTIFICATION_SETTINGS],
  preferences: { enabled: true, osEnabled: false, lastScanAt: null },
  scanning: false,
  lastScan: null,
  lastError: null,
  osPermission: 'unsupported',
  lastScanFinishedAt: 0,
};

let state: NotificationsView = { ...DEFAULT_VIEW, today: safeToday() };
const listeners = new Set<() => void>();

function safeToday(): string {
  try {
    return todayLocalISO();
  } catch {
    return DEFAULT_VIEW.today;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

export function getNotificationsView(): NotificationsView {
  return state;
}

export function setNotificationsView(patch: Partial<NotificationsView>): void {
  state = { ...state, ...patch };
  emit();
}

/** Test helper: back to the initial state (does not drop subscribers). */
export function resetNotificationsView(): void {
  state = { ...DEFAULT_VIEW, today: safeToday() };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useNotificationsView(): NotificationsView {
  return useSyncExternalStore(subscribe, getNotificationsView, getNotificationsView);
}

// ---------------------------------------------------------------------------
// Commands from surfaces to the runtime
// ---------------------------------------------------------------------------

type RescanListener = () => void;
type SettingsChangedListener = () => void;

const rescanListeners = new Set<RescanListener>();
const settingsListeners = new Set<SettingsChangedListener>();

/** Page "Rescan" button: asks the runtime for an immediate scan. */
export function requestNotificationRescan(): void {
  for (const listener of rescanListeners) listener();
}

export function onNotificationRescanRequested(listener: RescanListener): () => void {
  rescanListeners.add(listener);
  return () => {
    rescanListeners.delete(listener);
  };
}

/** Settings tab: per-type rows or feature switches changed; the runtime reloads and rescans. */
export function notifyNotificationSettingsChanged(): void {
  for (const listener of settingsListeners) listener();
}

export function onNotificationSettingsChanged(listener: SettingsChangedListener): () => void {
  settingsListeners.add(listener);
  return () => {
    settingsListeners.delete(listener);
  };
}
