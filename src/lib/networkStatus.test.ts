import { describe, expect, it, vi } from 'vitest';

import { ALWAYS_ONLINE, connectNetworkStatus } from './networkStatus';

function fakeWindow(onLine: boolean) {
  const target = new EventTarget();
  return Object.assign(target, { navigator: { onLine } });
}

describe('connectNetworkStatus', () => {
  it('follows the browser offline and online events, notifying only on a change', () => {
    const win = fakeWindow(true);
    const store = connectNetworkStatus(win as never);
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.isOnline()).toBe(true);

    win.dispatchEvent(new Event('offline'));
    expect(store.isOnline()).toBe(false);
    win.dispatchEvent(new Event('offline'));
    expect(listener).toHaveBeenCalledTimes(1);

    win.dispatchEvent(new Event('online'));
    expect(store.isOnline()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('starts offline when the page opens without a connection', () => {
    expect(connectNetworkStatus(fakeWindow(false) as never).isOnline()).toBe(false);
  });

  it('stops notifying after unsubscribe', () => {
    const win = fakeWindow(true);
    const store = connectNetworkStatus(win as never);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    unsubscribe();
    win.dispatchEvent(new Event('offline'));
    expect(listener).not.toHaveBeenCalled();
  });

  it('is always online on the server', () => {
    expect(ALWAYS_ONLINE.isOnline()).toBe(true);
  });
});
