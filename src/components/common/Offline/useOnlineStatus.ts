'use client';

/** Whether the browser reports a connection (src/lib/networkStatus.ts), as a hook. */

import { useSyncExternalStore } from 'react';

import { ALWAYS_ONLINE, connectNetworkStatus, type NetworkStatusStore } from '@/lib/networkStatus';

let browserStore: NetworkStatusStore | null = null;

export function getNetworkStatus(): NetworkStatusStore {
  if (typeof window === 'undefined') return ALWAYS_ONLINE;
  browserStore ??= connectNetworkStatus(window);
  return browserStore;
}

/** True while online; false once the browser fires `offline`, until it fires `online` again. */
export function useOnlineStatus(): boolean {
  const store = getNetworkStatus();
  return useSyncExternalStore(store.subscribe, store.isOnline, ALWAYS_ONLINE.isOnline);
}
