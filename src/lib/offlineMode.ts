/**
 * Offline mode: an opt-in device preference. Off (the default), the app loads
 * lazily from the host like any website and no service worker is registered.
 * Turning it on in Settings → Preferences registers the worker
 * (src/lib/serviceWorkerClient.ts), which downloads every file of the build so
 * the whole app opens without a connection; turning it off removes the worker
 * and the saved files. The user's data lives on the device either way.
 *
 * One store for the Settings section and OfflineRuntime (the notices). The
 * browser pieces are injected, so the flow is unit-tested without a browser.
 */

import type { ServiceWorkerCallbacks } from '@/lib/serviceWorkerClient';

/** localStorage key (a device preference, like the language). */
export const OFFLINE_MODE_KEY = 'budgetTracker_offlineMode';
/** Written next to sw.js by scripts/build-service-worker.mjs. */
export const OFFLINE_SUMMARY_URL = '/offline.json';

export type OfflineModeStatus =
  /** No service worker support in this browser. */
  | 'unsupported'
  /** `next dev`: offline mode only works in a production build. */
  | 'devBuild'
  | 'off'
  | 'downloading'
  | 'ready'
  /** The download did not finish; the user can try again. */
  | 'error';

export interface OfflineModeState {
  status: OfflineModeStatus;
  /** Files saved so far / in total while downloading. */
  done: number;
  total: number;
}

export type OfflineModeEvent = { type: 'offlineReady' } | { type: 'updateReady'; apply: () => void };

export interface OfflineSummary {
  version: string;
  files: number;
  bytes: number;
}

export interface OfflineModeDeps {
  supported: boolean;
  production: boolean;
  /** `?noServiceWorker`: remove the worker for this load whatever the preference says. */
  disabledByQuery: boolean;
  preference: { get: () => boolean; set: (on: boolean) => void };
  register: (callbacks: ServiceWorkerCallbacks) => Promise<() => void>;
  unregister: () => Promise<unknown>;
  requestPersistence: () => Promise<unknown>;
}

export interface OfflineModeController {
  getState: () => OfflineModeState;
  subscribe: (listener: () => void) => () => void;
  /** Notices for the page: first download finished, a new version waits for Reload. */
  onEvent: (listener: (event: OfflineModeEvent) => void) => () => void;
  /** Called once per page load: re-registers when on, cleans up when off. */
  start: () => Promise<void>;
  /** Turns offline mode on and starts the download. */
  enable: () => Promise<void>;
  /** Turns offline mode off and removes the saved app. */
  disable: () => Promise<void>;
}

export function createOfflineMode(deps: OfflineModeDeps): OfflineModeController {
  const initialStatus: OfflineModeStatus = !deps.supported
    ? 'unsupported'
    : !deps.production
      ? 'devBuild'
      : 'off';
  let state: OfflineModeState = { status: initialStatus, done: 0, total: 0 };
  let stopRegistration: (() => void) | null = null;
  let started = false;
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(event: OfflineModeEvent) => void>();

  const set = (next: Partial<OfflineModeState>) => {
    const merged = { ...state, ...next };
    if (merged.status === state.status && merged.done === state.done && merged.total === state.total) return;
    state = merged;
    listeners.forEach((listener) => listener());
  };
  const emit = (event: OfflineModeEvent) => eventListeners.forEach((listener) => listener(event));
  const available = () => deps.supported && deps.production;

  const register = async () => {
    stopRegistration?.();
    stopRegistration = null;
    set({ status: 'downloading', done: 0, total: 0 });
    try {
      stopRegistration = await deps.register({
        onProgress: (done, total) => {
          if (state.status === 'downloading') set({ done, total });
        },
        onAlreadyActive: () => set({ status: 'ready' }),
        onOfflineReady: () => {
          set({ status: 'ready' });
          emit({ type: 'offlineReady' });
        },
        onUpdateReady: (apply) => emit({ type: 'updateReady', apply }),
        onInstallFailed: () => set({ status: 'error' }),
      });
    } catch {
      set({ status: 'error' });
    }
  };

  const removeWorker = async () => {
    stopRegistration?.();
    stopRegistration = null;
    await deps.unregister();
  };

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onEvent: (listener) => {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    start: async () => {
      if (started) return;
      started = true;
      if (!deps.supported) return;
      // Under `next dev`, with ?noServiceWorker, or with offline mode off: no worker may answer for this origin.
      if (!deps.production || deps.disabledByQuery || !deps.preference.get()) {
        await deps.unregister();
        return;
      }
      await register();
    },
    enable: async () => {
      if (!available()) return;
      deps.preference.set(true);
      // Asked on the user's own action: Firefox shows a prompt for it.
      void deps.requestPersistence();
      await register();
    },
    disable: async () => {
      if (!available()) return;
      deps.preference.set(false);
      set({ status: 'off', done: 0, total: 0 });
      await removeWorker();
    },
  };
}

/** Reads the build's precache summary; null under `next dev` or when it cannot be fetched. */
export async function fetchOfflineSummary(fetchFn: typeof fetch = fetch): Promise<OfflineSummary | null> {
  try {
    const response = await fetchFn(OFFLINE_SUMMARY_URL, { cache: 'no-cache' });
    if (!response.ok) return null;
    const data = (await response.json()) as Partial<OfflineSummary>;
    return typeof data.files === 'number' && typeof data.bytes === 'number'
      ? { version: String(data.version ?? ''), files: data.files, bytes: data.bytes }
      : null;
  } catch {
    return null;
  }
}
