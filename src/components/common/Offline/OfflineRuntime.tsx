'use client';

/**
 * Mounted once in the root layout: registers the offline service worker on
 * production builds (src/lib/serviceWorkerClient.ts), asks once for
 * persistent storage, and shows one notice when the app first becomes
 * available offline (with Install when the app can be installed) or when a
 * new version is waiting for a reload. Also hosts the Safari install guide,
 * opened by any Install control through the install store.
 */

import CloseIcon from '@mui/icons-material/Close';
import { Button, IconButton, Snackbar } from '@mui/material';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { logger } from '@/lib/logging';
import {
  registerServiceWorker,
  requestPersistentStorage,
  serviceWorkerMode,
  unregisterServiceWorkers,
} from '@/lib/serviceWorkerClient';

import InstallGuideDialog from './InstallGuideDialog';
import { canOfferInstall, useAppInstall } from './useAppInstall';

const log = logger.child({ component: 'OfflineRuntime' });

type Notice = { kind: 'offlineReady' } | { kind: 'updateReady'; apply: () => void };

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export default function OfflineRuntime() {
  const { t } = useTranslation('shell');
  const [notice, setNotice] = useState<Notice | null>(null);
  const installState = useAppInstall();
  const offerInstall = notice?.kind === 'offlineReady' && canOfferInstall(installState);

  useEffect(() => {
    // Registering twice (Strict Mode) is harmless: the browser keeps one registration.
    const mode = serviceWorkerMode({
      supported: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      production: process.env.NODE_ENV === 'production',
      search: window.location.search,
    });
    if (mode === 'none') return;
    if (mode === 'unregister') {
      unregisterServiceWorkers(navigator.serviceWorker, typeof caches === 'undefined' ? undefined : caches).catch(
        (error: unknown) => log.warn('Service worker removal failed', { operation: 'sw_unregister', error }),
      );
      return;
    }

    let cleanup: (() => void) | undefined;
    let cancelled = false;
    registerServiceWorker(
      navigator.serviceWorker,
      {
        onOfflineReady: () => setNotice({ kind: 'offlineReady' }),
        onUpdateReady: (apply) => setNotice({ kind: 'updateReady', apply }),
      },
      () => window.location.reload(),
    )
      .then((stop) => {
        if (cancelled) stop();
        else cleanup = stop;
        return requestPersistentStorage(navigator.storage, safeLocalStorage());
      })
      .catch((error: unknown) => log.warn('Service worker registration failed', { operation: 'sw_register', error }));

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  const close = () => setNotice(null);

  return (
    <>
      <Snackbar
        open={notice !== null}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') close();
        }}
        autoHideDuration={notice?.kind === 'offlineReady' ? (offerInstall ? 15000 : 6000) : null}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        message={notice?.kind === 'updateReady' ? t('offline.updateReady') : t('offline.ready')}
        data-testid="offline-notice"
        action={
          <>
            {notice?.kind === 'updateReady' && (
              <Button color="inherit" size="small" onClick={notice.apply} data-testid="offline-reload">
                {t('offline.reload')}
              </Button>
            )}
            {offerInstall && (
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  close();
                  installState.install();
                }}
                data-testid="offline-install"
              >
                {t('offline.install')}
              </Button>
            )}
            <IconButton color="inherit" size="small" aria-label={t('offline.close')} onClick={close}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </>
        }
      />
      <InstallGuideDialog open={installState.guideOpen} guide={installState.guide} onClose={installState.closeGuide} />
    </>
  );
}
