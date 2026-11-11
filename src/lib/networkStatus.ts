/**
 * Whether the browser says it is online (`navigator.onLine` plus the
 * `online` / `offline` events). The browser only knows about the network
 * link, not whether a given server answers, so this is a hint for the UI:
 * features that need the internet (cloud database sync, cloud AI providers)
 * explain that they wait for the connection instead of failing.
 *
 * Pure: the window is a parameter.
 */

export interface NetworkStatusStore {
  /** True while the browser reports a connection. */
  isOnline: () => boolean;
  subscribe: (listener: () => void) => () => void;
}

type NetworkWindow = Pick<Window, 'addEventListener'> & { navigator: Pick<Navigator, 'onLine'> };

export function connectNetworkStatus(win: NetworkWindow): NetworkStatusStore {
  let online = win.navigator.onLine !== false;
  const listeners = new Set<() => void>();
  const update = (next: boolean) => {
    if (next === online) return;
    online = next;
    listeners.forEach((listener) => listener());
  };
  win.addEventListener('online', () => update(true));
  win.addEventListener('offline', () => update(false));
  return {
    isOnline: () => online,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** For the server render and browsers without a window: always online. */
export const ALWAYS_ONLINE: NetworkStatusStore = {
  isOnline: () => true,
  subscribe: () => () => undefined,
};
