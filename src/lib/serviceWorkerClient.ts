/**
 * Page side of the offline service worker (dist/sw.js, generated after
 * `next build` by scripts/build-service-worker.mjs). The offline-mode
 * controller (src/lib/offlineMode.ts) decides when to call these.
 *
 * - Offline mode is opt-in: until the user turns it on in Settings →
 *   Preferences, no worker is registered and the app loads lazily from the
 *   host. Turning it on registers `/sw.js`, which saves every file of the
 *   build so each page, language, wasm and worker module also loads offline.
 * - `next dev` never registers it and removes one left on the origin, so a
 *   cached build can never answer for the dev server.
 * - `?noServiceWorker` removes the worker and its caches (debugging escape).
 * - A new version waits: the page is told an update is ready and takes it on
 *   the user's Reload, because the database SharedWorker of the running
 *   version keeps going while any tab is open.
 *
 * Browser objects are parameters so the flow is unit-tested without a browser.
 */

import { logger } from '@/lib/logging';

const log = logger.child({ component: 'ServiceWorkerClient' });

export const SERVICE_WORKER_URL = '/sw.js';
export const PRECACHE_PREFIX = 'ptbudget-precache-';
export const DISABLE_QUERY_PARAM = 'noServiceWorker';
/** How often an open tab asks the host for a newer sw.js. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface ServiceWorkerCallbacks {
  /** The first install finished: everything is saved and the app works offline. */
  onOfflineReady: () => void;
  /** A worker was already active when the page registered: the app was saved before. */
  onAlreadyActive?: () => void;
  /** A new version is installed and waiting; `apply` activates it and reloads. */
  onUpdateReady: (apply: () => void) => void;
  /** Files saved so far by an installing worker. */
  onProgress?: (done: number, total: number) => void;
  /** The first install did not finish (a download failed, or the browser stopped it). */
  onInstallFailed?: () => void;
}

type Container = Pick<ServiceWorkerContainer, 'controller' | 'register' | 'addEventListener' | 'removeEventListener'>;

interface ProgressMessage {
  type: 'PRECACHE_PROGRESS';
  done: number;
  total: number;
}

function isProgressMessage(data: unknown): data is ProgressMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { type?: unknown }).type === 'PRECACHE_PROGRESS' &&
    typeof (data as { done?: unknown }).done === 'number' &&
    typeof (data as { total?: unknown }).total === 'number'
  );
}

/** Registers `/sw.js` and reports progress, first install and waiting updates. Returns a cleanup. */
export async function registerServiceWorker(
  container: Container,
  callbacks: ServiceWorkerCallbacks,
  reload: () => void,
  setIntervalFn: typeof setInterval = setInterval,
  clearIntervalFn: typeof clearInterval = clearInterval,
): Promise<() => void> {
  const onMessage = (event: Event) => {
    const data = (event as MessageEvent).data;
    if (isProgressMessage(data)) callbacks.onProgress?.(data.done, data.total);
  };
  container.addEventListener('message', onMessage);

  let registration: ServiceWorkerRegistration;
  try {
    registration = await container.register(SERVICE_WORKER_URL, { scope: '/', updateViaCache: 'none' });
  } catch (error) {
    container.removeEventListener('message', onMessage);
    throw error;
  }

  const apply = () => {
    const waiting = registration.waiting;
    if (!waiting) return;
    container.addEventListener('controllerchange', () => reload(), { once: true });
    waiting.postMessage({ type: 'SKIP_WAITING' });
  };

  const watch = (worker: ServiceWorker) => {
    const firstInstall = !registration.active;
    worker.addEventListener('statechange', () => {
      if (firstInstall && worker.state === 'activated') {
        log.info('Service worker installed: the app works offline', { operation: 'sw_install' });
        callbacks.onOfflineReady();
      } else if (firstInstall && worker.state === 'redundant') {
        log.warn('Service worker install did not finish', { operation: 'sw_install' });
        callbacks.onInstallFailed?.();
      } else if (!firstInstall && worker.state === 'installed') {
        log.info('Service worker update waiting', { operation: 'sw_update' });
        callbacks.onUpdateReady(apply);
      }
    });
  };

  if (registration.active) callbacks.onAlreadyActive?.();
  if (registration.waiting && registration.active) callbacks.onUpdateReady(apply);
  if (registration.installing) watch(registration.installing);
  registration.addEventListener('updatefound', () => {
    if (registration.installing) watch(registration.installing);
  });

  const timer = setIntervalFn(() => {
    registration.update().catch((error: unknown) => {
      // Offline or the host is down: the next check tries again.
      log.debug('Service worker update check failed', { operation: 'sw_update_check', error });
    });
  }, UPDATE_CHECK_INTERVAL_MS);
  return () => {
    clearIntervalFn(timer);
    container.removeEventListener('message', onMessage);
  };
}

/** Removes this origin's service workers and their precaches. */
export async function unregisterServiceWorkers(
  container: Pick<ServiceWorkerContainer, 'getRegistrations'>,
  cacheStorage: Pick<CacheStorage, 'keys' | 'delete'> | undefined,
): Promise<number> {
  const registrations = await container.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  if (cacheStorage) {
    const names = await cacheStorage.keys();
    await Promise.all(names.filter((name) => name.startsWith(PRECACHE_PREFIX)).map((name) => cacheStorage.delete(name)));
  }
  if (registrations.length > 0) {
    log.info('Removed service worker', { operation: 'sw_unregister', count: registrations.length });
  }
  return registrations.length;
}

/**
 * Asks for persistent storage, so the browser does not clear the database or
 * the saved app under storage pressure. Called when the user turns offline
 * mode on (Chromium decides silently; Firefox asks the user).
 */
export async function requestPersistentStorage(
  storage: Pick<StorageManager, 'persist' | 'persisted'> | undefined,
): Promise<boolean | null> {
  if (!storage?.persist || !storage.persisted) return null;
  try {
    if (await storage.persisted()) return true;
    const granted = await storage.persist();
    log.info('Persistent storage requested', { operation: 'storage_persist', granted });
    return granted;
  } catch (error) {
    log.warn('Persistent storage request failed', { operation: 'storage_persist', error });
    return null;
  }
}
