import { describe, expect, it, vi } from 'vitest';

import {
  PERSIST_REQUESTED_KEY,
  registerServiceWorker,
  requestPersistentStorage,
  serviceWorkerMode,
  unregisterServiceWorkers,
} from './serviceWorkerClient';

describe('serviceWorkerMode', () => {
  it('registers only on a production build of a browser that supports it', () => {
    expect(serviceWorkerMode({ supported: true, production: true, search: '' })).toBe('register');
    expect(serviceWorkerMode({ supported: true, production: true, search: '?loadSampleData' })).toBe('register');
    expect(serviceWorkerMode({ supported: false, production: true, search: '' })).toBe('none');
  });

  it('removes the worker under next dev and with ?noServiceWorker', () => {
    expect(serviceWorkerMode({ supported: true, production: false, search: '' })).toBe('unregister');
    expect(serviceWorkerMode({ supported: true, production: true, search: '?noServiceWorker' })).toBe('unregister');
  });
});

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  postMessage = vi.fn();

  moveTo(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

function setup(options: { controller?: boolean; waiting?: boolean; installing?: boolean } = {}) {
  const registration = Object.assign(new EventTarget(), {
    installing: options.installing ? new FakeWorker() : null,
    waiting: options.waiting ? new FakeWorker() : null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  const container = Object.assign(new EventTarget(), {
    controller: options.controller ? ({} as ServiceWorker) : null,
    register: vi.fn().mockResolvedValue(registration),
  });
  const callbacks = { onOfflineReady: vi.fn(), onUpdateReady: vi.fn() };
  const reload = vi.fn();
  return { registration, container, callbacks, reload };
}

describe('registerServiceWorker', () => {
  it('registers /sw.js at the root and reports the first install once it is active', async () => {
    const { registration, container, callbacks, reload } = setup({ installing: true });
    const stop = await registerServiceWorker(container as never, callbacks, reload);

    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
    const worker = registration.installing as unknown as FakeWorker;
    worker.moveTo('installed');
    expect(callbacks.onOfflineReady).not.toHaveBeenCalled();
    worker.moveTo('activated');
    expect(callbacks.onOfflineReady).toHaveBeenCalledTimes(1);
    expect(callbacks.onUpdateReady).not.toHaveBeenCalled();
    stop();
  });

  it('reports a waiting update and activates it only when applied, then reloads', async () => {
    const { registration, container, callbacks, reload } = setup({ controller: true, waiting: true });
    const stop = await registerServiceWorker(container as never, callbacks, reload);

    expect(callbacks.onUpdateReady).toHaveBeenCalledTimes(1);
    const waiting = registration.waiting as unknown as FakeWorker;
    expect(waiting.postMessage).not.toHaveBeenCalled();

    const apply = callbacks.onUpdateReady.mock.calls[0][0] as () => void;
    apply();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(reload).not.toHaveBeenCalled();
    container.dispatchEvent(new Event('controllerchange'));
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('reports an update found while the page is open', async () => {
    const { registration, container, callbacks, reload } = setup({ controller: true });
    const stop = await registerServiceWorker(container as never, callbacks, reload);

    const worker = new FakeWorker();
    registration.installing = worker as never;
    registration.dispatchEvent(new Event('updatefound'));
    worker.moveTo('installed');
    expect(callbacks.onUpdateReady).toHaveBeenCalledTimes(1);
    expect(callbacks.onOfflineReady).not.toHaveBeenCalled();
    stop();
  });

  it('checks for a new version periodically until stopped', async () => {
    const { registration, container, callbacks, reload } = setup();
    let tick: () => void = () => undefined;
    const setIntervalFn = vi.fn((fn: () => void) => {
      tick = fn;
      return 7;
    });
    const clearIntervalFn = vi.fn();
    const stop = await registerServiceWorker(
      container as never,
      callbacks,
      reload,
      setIntervalFn as never,
      clearIntervalFn as never,
    );

    tick();
    expect(registration.update).toHaveBeenCalledTimes(1);
    stop();
    expect(clearIntervalFn).toHaveBeenCalledWith(7);
  });
});

describe('unregisterServiceWorkers', () => {
  it('removes the registrations and only the precache caches', async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const cacheStorage = {
      keys: vi.fn().mockResolvedValue(['ptbudget-precache-abc', 'someone-else']),
      delete: vi.fn().mockResolvedValue(true),
    };
    const count = await unregisterServiceWorkers(
      { getRegistrations: vi.fn().mockResolvedValue([{ unregister }]) } as never,
      cacheStorage,
    );

    expect(count).toBe(1);
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(cacheStorage.delete).toHaveBeenCalledTimes(1);
    expect(cacheStorage.delete).toHaveBeenCalledWith('ptbudget-precache-abc');
  });
});

describe('requestPersistentStorage', () => {
  function memoryStore() {
    const data = new Map<string, string>();
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
  }

  it('asks once per device and remembers that it asked', async () => {
    const storage = { persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(false) };
    const store = memoryStore();

    expect(await requestPersistentStorage(storage, store)).toBe(false);
    expect(store.getItem(PERSIST_REQUESTED_KEY)).not.toBeNull();
    expect(await requestPersistentStorage(storage, store)).toBe(false);
    expect(storage.persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask when storage is already persistent or the API is missing', async () => {
    const storage = { persisted: vi.fn().mockResolvedValue(true), persist: vi.fn() };
    expect(await requestPersistentStorage(storage, memoryStore())).toBe(true);
    expect(storage.persist).not.toHaveBeenCalled();
    expect(await requestPersistentStorage(undefined, memoryStore())).toBeNull();
  });

  it('survives a browser that throws', async () => {
    const storage = { persisted: vi.fn().mockRejectedValue(new Error('denied')), persist: vi.fn() };
    expect(await requestPersistentStorage(storage, memoryStore())).toBeNull();
  });
});
