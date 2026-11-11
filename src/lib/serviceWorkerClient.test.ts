import { describe, expect, it, vi } from 'vitest';

import { registerServiceWorker, requestPersistentStorage, unregisterServiceWorkers } from './serviceWorkerClient';

class FakeWorker extends EventTarget {
  state: ServiceWorkerState = 'installing';
  postMessage = vi.fn();

  moveTo(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

function setup(options: { active?: boolean; waiting?: boolean; installing?: boolean } = {}) {
  const registration = Object.assign(new EventTarget(), {
    active: options.active ? new FakeWorker() : null,
    installing: options.installing ? new FakeWorker() : null,
    waiting: options.waiting ? new FakeWorker() : null,
    update: vi.fn().mockResolvedValue(undefined),
  });
  const container = Object.assign(new EventTarget(), {
    controller: options.active ? ({} as ServiceWorker) : null,
    register: vi.fn().mockResolvedValue(registration),
  });
  const callbacks = {
    onOfflineReady: vi.fn(),
    onAlreadyActive: vi.fn(),
    onUpdateReady: vi.fn(),
    onProgress: vi.fn(),
    onInstallFailed: vi.fn(),
  };
  const reload = vi.fn();
  return { registration, container, callbacks, reload };
}

const progress = (done: number, total: number) =>
  new MessageEvent('message', { data: { type: 'PRECACHE_PROGRESS', version: 'v', done, total } });

describe('registerServiceWorker', () => {
  it('registers /sw.js at the root, reports progress, and reports the first install once it is active', async () => {
    const { registration, container, callbacks, reload } = setup({ installing: true });
    const stop = await registerServiceWorker(container as never, callbacks, reload);

    expect(container.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' });
    expect(callbacks.onAlreadyActive).not.toHaveBeenCalled();
    container.dispatchEvent(progress(10, 335));
    container.dispatchEvent(new MessageEvent('message', { data: { type: 'SOMETHING_ELSE' } }));
    expect(callbacks.onProgress).toHaveBeenCalledTimes(1);
    expect(callbacks.onProgress).toHaveBeenCalledWith(10, 335);

    const worker = registration.installing as unknown as FakeWorker;
    worker.moveTo('installed');
    expect(callbacks.onOfflineReady).not.toHaveBeenCalled();
    worker.moveTo('activated');
    expect(callbacks.onOfflineReady).toHaveBeenCalledTimes(1);
    expect(callbacks.onUpdateReady).not.toHaveBeenCalled();

    stop();
    container.dispatchEvent(progress(20, 335));
    expect(callbacks.onProgress).toHaveBeenCalledTimes(1);
  });

  it('reports a first install that did not finish', async () => {
    const { registration, container, callbacks, reload } = setup({ installing: true });
    const stop = await registerServiceWorker(container as never, callbacks, reload);
    (registration.installing as unknown as FakeWorker).moveTo('redundant');
    expect(callbacks.onInstallFailed).toHaveBeenCalledTimes(1);
    expect(callbacks.onOfflineReady).not.toHaveBeenCalled();
    stop();
  });

  it('says so when the app was already saved on an earlier visit', async () => {
    const { container, callbacks, reload } = setup({ active: true });
    const stop = await registerServiceWorker(container as never, callbacks, reload);
    expect(callbacks.onAlreadyActive).toHaveBeenCalledTimes(1);
    stop();
  });

  it('reports a waiting update and activates it only when applied, then reloads', async () => {
    const { registration, container, callbacks, reload } = setup({ active: true, waiting: true });
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
    const { registration, container, callbacks, reload } = setup({ active: true });
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

  it('stops listening when the registration itself fails', async () => {
    const container = Object.assign(new EventTarget(), {
      controller: null,
      register: vi.fn().mockRejectedValue(new Error('blocked')),
    });
    const onProgress = vi.fn();
    await expect(
      registerServiceWorker(container as never, { onOfflineReady: vi.fn(), onUpdateReady: vi.fn(), onProgress }, vi.fn()),
    ).rejects.toThrow('blocked');
    container.dispatchEvent(progress(1, 2));
    expect(onProgress).not.toHaveBeenCalled();
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
  it('asks when storage is not yet persistent', async () => {
    const storage = { persisted: vi.fn().mockResolvedValue(false), persist: vi.fn().mockResolvedValue(true) };
    expect(await requestPersistentStorage(storage)).toBe(true);
    expect(storage.persist).toHaveBeenCalledTimes(1);
  });

  it('does not ask when storage is already persistent or the API is missing', async () => {
    const storage = { persisted: vi.fn().mockResolvedValue(true), persist: vi.fn() };
    expect(await requestPersistentStorage(storage)).toBe(true);
    expect(storage.persist).not.toHaveBeenCalled();
    expect(await requestPersistentStorage(undefined)).toBeNull();
  });

  it('survives a browser that throws', async () => {
    const storage = { persisted: vi.fn().mockRejectedValue(new Error('denied')), persist: vi.fn() };
    expect(await requestPersistentStorage(storage)).toBeNull();
  });
});
