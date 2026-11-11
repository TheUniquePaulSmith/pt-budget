'use client';

/**
 * The page's one offline-mode controller (src/lib/offlineMode.ts), wired to
 * the real browser: the localStorage preference, the service worker client
 * and Cache Storage. OfflineRuntime calls `start()` once per load; Settings →
 * Preferences turns it on and off.
 */

import { useSyncExternalStore } from 'react';

import { createOfflineMode, type OfflineModeController, type OfflineModeState, OFFLINE_MODE_KEY } from '@/lib/offlineMode';
import {
  DISABLE_QUERY_PARAM,
  registerServiceWorker,
  requestPersistentStorage,
  unregisterServiceWorkers,
} from '@/lib/serviceWorkerClient';

const preference = {
  get: (): boolean => {
    try {
      return window.localStorage.getItem(OFFLINE_MODE_KEY) === 'on';
    } catch {
      return false;
    }
  },
  set: (on: boolean): void => {
    try {
      if (on) window.localStorage.setItem(OFFLINE_MODE_KEY, 'on');
      else window.localStorage.removeItem(OFFLINE_MODE_KEY);
    } catch {
      // Storage blocked: offline mode lasts for this page load only.
    }
  },
};

const serverController = createOfflineMode({
  supported: false,
  production: false,
  disabledByQuery: false,
  preference: { get: () => false, set: () => undefined },
  register: async () => () => undefined,
  unregister: async () => undefined,
  requestPersistence: async () => undefined,
});

let browserController: OfflineModeController | null = null;

export function getOfflineMode(): OfflineModeController {
  if (typeof window === 'undefined') return serverController;
  browserController ??= createOfflineMode({
    supported: 'serviceWorker' in navigator,
    production: process.env.NODE_ENV === 'production',
    disabledByQuery: new URLSearchParams(window.location.search).has(DISABLE_QUERY_PARAM),
    preference,
    register: (callbacks) => registerServiceWorker(navigator.serviceWorker, callbacks, () => window.location.reload()),
    unregister: () =>
      unregisterServiceWorkers(navigator.serviceWorker, typeof caches === 'undefined' ? undefined : caches),
    requestPersistence: () => requestPersistentStorage(navigator.storage),
  });
  return browserController;
}

/** Offline-mode status plus the Settings actions. */
export function useOfflineMode(): OfflineModeState & Pick<OfflineModeController, 'enable' | 'disable'> {
  const controller = getOfflineMode();
  const state = useSyncExternalStore(controller.subscribe, controller.getState, serverController.getState);
  return { ...state, enable: controller.enable, disable: controller.disable };
}
