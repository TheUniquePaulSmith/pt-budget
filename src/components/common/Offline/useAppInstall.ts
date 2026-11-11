'use client';

/**
 * The page's one install store (src/lib/appInstall.ts). It connects when this
 * module is first imported (the root layout imports it through
 * OfflineRuntime), so a `beforeinstallprompt` fired before any Install
 * control renders is still caught.
 */

import { useSyncExternalStore } from 'react';

import { type AppInstallState, type AppInstallStore, connectAppInstall, createAppInstallStore } from '@/lib/appInstall';
import { logger } from '@/lib/logging';

const log = logger.child({ component: 'AppInstall' });

const serverStore = createAppInstallStore({ guide: null, standalone: false });

let browserStore: AppInstallStore | null = null;

export function getAppInstallStore(): AppInstallStore {
  if (typeof window === 'undefined') return serverStore;
  browserStore ??= connectAppInstall(window);
  return browserStore;
}

if (typeof window !== 'undefined') getAppInstallStore();

/** Click handler for every Install control: the browser's dialog, or the Safari guide. */
function install(): void {
  getAppInstallStore()
    .requestInstall()
    .then((outcome) => log.info('Install requested', { operation: 'app_install', outcome }))
    .catch((error: unknown) => log.warn('Install prompt failed', { operation: 'app_install', error }));
}

/** Install status plus the actions the controls call. */
export function useAppInstall(): AppInstallState & { install: () => void; closeGuide: () => void } {
  const store = getAppInstallStore();
  const state = useSyncExternalStore(store.subscribe, store.getState, serverStore.getState);
  return { ...state, install, closeGuide: store.closeGuide };
}

/** Whether an Install control should show: the browser can prompt, or Safari's guide applies. */
export function canOfferInstall(state: Pick<AppInstallState, 'status'>): boolean {
  return state.status === 'promptable' || state.status === 'guide';
}
