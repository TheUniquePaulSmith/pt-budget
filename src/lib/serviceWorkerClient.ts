/**
 * Page side of the offline service worker (dist/sw.js, generated after
 * `next build` by scripts/build-service-worker.mjs).
 *
 * - Production builds register `/sw.js`, which saves every file of the build
 *   so each page, language, wasm and worker module also loads offline.
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
export const PERSIST_REQUESTED_KEY = 'budgetTracker_storagePersistRequested';
/** How often an open tab asks the host for a newer sw.js. */
export const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export type ServiceWorkerMode = 'register' | 'unregister' | 'none';

/** What the page should do with the service worker on this load. */
export function serviceWorkerMode(options: {
  supported: boolean;
  production: boolean;
  search: string;
}): ServiceWorkerMode {
  if (!options.supported) return 'none';
  if (!options.production) return 'unregister';
  if (new URLSearchParams(options.search).has(DISABLE_QUERY_PARAM)) return 'unregister';
  return 'register';
}

export interface ServiceWorkerCallbacks {
  /** The first install finished: everything is saved and the app works offline. */
  onOfflineReady: () => void;
  /** A new version is installed and waiting; `apply` activates it and reloads. */
  onUpdateReady: (apply: () => void) => void;
}

type Container = Pick<ServiceWorkerContainer, 'controller' | 'register' | 'addEventListener'>;

/** Registers `/sw.js` and reports first install and waiting updates. Returns a cleanup. */
export async function registerServiceWorker(
  container: Container,
  callbacks: ServiceWorkerCallbacks,
  reload: () => void,
  setIntervalFn: typeof setInterval = setInterval,
  clearIntervalFn: typeof clearInterval = clearInterval,
): Promise<() => void> {
  const registration = await container.register(SERVICE_WORKER_URL, { scope: '/', updateViaCache: 'none' });

  const apply = () => {
    const waiting = registration.waiting;
    if (!waiting) return;
    container.addEventListener('controllerchange', () => reload(), { once: true });
    waiting.postMessage({ type: 'SKIP_WAITING' });
  };

  const watch = (worker: ServiceWorker) => {
    const firstInstall = !container.controller;
    worker.addEventListener('statechange', () => {
      if (firstInstall && worker.state === 'activated') {
        log.info('Service worker installed: the app works offline', { operation: 'sw_install' });
        callbacks.onOfflineReady();
      } else if (!firstInstall && worker.state === 'installed') {
        log.info('Service worker update waiting', { operation: 'sw_update' });
        callbacks.onUpdateReady(apply);
      }
    });
  };

  if (registration.waiting && container.controller) callbacks.onUpdateReady(apply);
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
  return () => clearIntervalFn(timer);
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

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * Asks once per device for persistent storage, so the browser does not clear
 * the database under storage pressure. Chromium decides silently; Firefox
 * asks the user, which is why it is asked only once.
 */
export async function requestPersistentStorage(
  storage: Pick<StorageManager, 'persist' | 'persisted'> | undefined,
  store: KeyValueStore | undefined,
): Promise<boolean | null> {
  if (!storage?.persist || !storage.persisted) return null;
  try {
    if (await storage.persisted()) return true;
    if (store?.getItem(PERSIST_REQUESTED_KEY)) return false;
    store?.setItem(PERSIST_REQUESTED_KEY, new Date().toISOString());
    const granted = await storage.persist();
    log.info('Persistent storage requested', { operation: 'storage_persist', granted });
    return granted;
  } catch (error) {
    log.warn('Persistent storage request failed', { operation: 'storage_persist', error });
    return null;
  }
}
