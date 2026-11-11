import { describe, expect, it, vi } from 'vitest';

import { createOfflineMode, fetchOfflineSummary, type OfflineModeDeps } from './offlineMode';
import type { ServiceWorkerCallbacks } from './serviceWorkerClient';

function setup(overrides: Partial<OfflineModeDeps> & { preferenceOn?: boolean } = {}) {
  let preferenceOn = overrides.preferenceOn ?? false;
  let callbacks: ServiceWorkerCallbacks | null = null;
  const stopRegistration = vi.fn();
  const deps: OfflineModeDeps = {
    supported: true,
    production: true,
    disabledByQuery: false,
    preference: { get: () => preferenceOn, set: (on) => void (preferenceOn = on) },
    register: vi.fn(async (next: ServiceWorkerCallbacks) => {
      callbacks = next;
      return stopRegistration;
    }),
    unregister: vi.fn().mockResolvedValue(0),
    requestPersistence: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
  const controller = createOfflineMode(deps);
  return {
    controller,
    deps,
    stopRegistration,
    callbacks: () => callbacks!,
    preference: () => preferenceOn,
  };
}

describe('createOfflineMode', () => {
  it('is off by default: nothing is registered and any worker left on the origin is removed', async () => {
    const { controller, deps } = setup();
    await controller.start();

    expect(controller.getState().status).toBe('off');
    expect(deps.register).not.toHaveBeenCalled();
    expect(deps.unregister).toHaveBeenCalledTimes(1);
  });

  it('turning it on remembers the choice, asks for persistent storage and reports the download', async () => {
    const { controller, deps, callbacks, preference } = setup();
    const events = vi.fn();
    controller.onEvent(events);
    await controller.start();
    await controller.enable();

    expect(preference()).toBe(true);
    expect(deps.requestPersistence).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toEqual({ status: 'downloading', done: 0, total: 0 });

    callbacks().onProgress!(120, 335);
    expect(controller.getState()).toEqual({ status: 'downloading', done: 120, total: 335 });

    callbacks().onOfflineReady();
    expect(controller.getState().status).toBe('ready');
    expect(events).toHaveBeenCalledWith({ type: 'offlineReady' });

    // Progress from a later update downloads in the background and changes nothing here.
    callbacks().onProgress!(3, 335);
    expect(controller.getState().status).toBe('ready');
  });

  it('registers again on every load while on, and reads an earlier download as ready', async () => {
    const { controller, deps, callbacks } = setup({ preferenceOn: true });
    await controller.start();
    expect(deps.register).toHaveBeenCalledTimes(1);
    expect(deps.unregister).not.toHaveBeenCalled();

    callbacks().onAlreadyActive!();
    expect(controller.getState().status).toBe('ready');
  });

  it('passes a waiting update on to the page', async () => {
    const { controller, callbacks } = setup({ preferenceOn: true });
    const events = vi.fn();
    controller.onEvent(events);
    await controller.start();
    const apply = vi.fn();
    callbacks().onUpdateReady(apply);
    expect(events).toHaveBeenCalledWith({ type: 'updateReady', apply });
  });

  it('turning it off forgets the choice, stops listening and removes the saved app', async () => {
    const { controller, deps, stopRegistration, callbacks, preference } = setup({ preferenceOn: true });
    await controller.start();
    callbacks().onAlreadyActive!();
    await controller.disable();

    expect(preference()).toBe(false);
    expect(stopRegistration).toHaveBeenCalledTimes(1);
    expect(deps.unregister).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe('off');
  });

  it('reports a download that did not finish, and a registration that failed', async () => {
    const first = setup();
    await first.controller.enable();
    first.callbacks().onInstallFailed!();
    expect(first.controller.getState().status).toBe('error');

    const second = setup({ register: vi.fn().mockRejectedValue(new Error('blocked')) });
    await second.controller.enable();
    expect(second.controller.getState().status).toBe('error');
  });

  it('never registers under next dev, with ?noServiceWorker, or without service worker support', async () => {
    const dev = setup({ production: false, preferenceOn: true });
    await dev.controller.start();
    await dev.controller.enable();
    expect(dev.controller.getState().status).toBe('devBuild');
    expect(dev.deps.register).not.toHaveBeenCalled();
    expect(dev.deps.unregister).toHaveBeenCalledTimes(1);

    const query = setup({ disabledByQuery: true, preferenceOn: true });
    await query.controller.start();
    expect(query.deps.register).not.toHaveBeenCalled();
    expect(query.deps.unregister).toHaveBeenCalledTimes(1);

    const unsupported = setup({ supported: false, preferenceOn: true });
    await unsupported.controller.start();
    await unsupported.controller.enable();
    expect(unsupported.controller.getState().status).toBe('unsupported');
    expect(unsupported.deps.register).not.toHaveBeenCalled();
    expect(unsupported.deps.unregister).not.toHaveBeenCalled();
  });

  it('starts once per page load', async () => {
    const { controller, deps } = setup({ preferenceOn: true });
    await controller.start();
    await controller.start();
    expect(deps.register).toHaveBeenCalledTimes(1);
  });
});

describe('fetchOfflineSummary', () => {
  it('reads the summary the build wrote, and gives up quietly without one', async () => {
    const ok = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 'abc', files: 335, bytes: 17_000_000 })));
    expect(await fetchOfflineSummary(ok)).toEqual({ version: 'abc', files: 335, bytes: 17_000_000 });
    expect(ok).toHaveBeenCalledWith('/offline.json', { cache: 'no-cache' });

    expect(await fetchOfflineSummary(vi.fn().mockResolvedValue(new Response('', { status: 404 })))).toBeNull();
    expect(await fetchOfflineSummary(vi.fn().mockResolvedValue(new Response('{"files":"x"}')))).toBeNull();
    expect(await fetchOfflineSummary(vi.fn().mockRejectedValue(new TypeError('offline')))).toBeNull();
  });
});
