'use client';

/**
 * Mounted once in the root layout. It
 * - starts the offline-mode controller (src/lib/offlineMode.ts): with offline
 *   mode on, the service worker is registered again on every load; off, any
 *   worker left on the origin is removed, so the app loads lazily;
 * - shows one notice at a time: the app was saved for offline use (with
 *   Install when it can be installed), a new version waits for a reload, the
 *   connection was lost (cloud sync and cloud AI wait for it), or it is back;
 * - hosts the Safari install guide, opened by any Install control.
 */

import CloseIcon from '@mui/icons-material/Close';
import { Button, IconButton, Snackbar } from '@mui/material';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { logger } from '@/lib/logging';

import InstallGuideDialog from './InstallGuideDialog';
import { canOfferInstall, useAppInstall } from './useAppInstall';
import { getOfflineMode, useOfflineMode } from './useOfflineMode';
import { useOnlineStatus } from './useOnlineStatus';

const log = logger.child({ component: 'OfflineRuntime' });

type Notice =
  | { kind: 'offlineReady' }
  | { kind: 'updateReady'; apply: () => void }
  | { kind: 'wentOffline' }
  | { kind: 'backOnline' };

const AUTO_HIDE_MS: Record<Notice['kind'], number | null> = {
  offlineReady: 6000,
  updateReady: null,
  wentOffline: 12000,
  backOnline: 5000,
};

export default function OfflineRuntime() {
  const { t } = useTranslation('shell');
  const [notice, setNotice] = useState<Notice | null>(null);
  const installState = useAppInstall();
  const offlineMode = useOfflineMode();
  const online = useOnlineStatus();
  const previousOnline = useRef<boolean | null>(null);
  const offerInstall = notice?.kind === 'offlineReady' && canOfferInstall(installState);

  useEffect(() => {
    const controller = getOfflineMode();
    const stop = controller.onEvent((event) => {
      setNotice(event.type === 'updateReady' ? { kind: 'updateReady', apply: event.apply } : { kind: 'offlineReady' });
    });
    controller
      .start()
      .catch((error: unknown) => log.warn('Offline mode start failed', { operation: 'offline_mode_start', error }));
    return stop;
  }, []);

  useEffect(() => {
    const before = previousOnline.current;
    previousOnline.current = online;
    // Opening the app offline counts as going offline; opening it online says nothing.
    if (before === null ? online : before === online) return;
    log.info(online ? 'Back online' : 'Went offline', { operation: 'network_status' });
    // A waiting update keeps its notice: it needs the user's Reload.
    setNotice((current) =>
      current?.kind === 'updateReady' ? current : { kind: online ? 'backOnline' : 'wentOffline' },
    );
  }, [online]);

  const close = () => setNotice(null);

  let message = '';
  if (notice?.kind === 'updateReady') message = t('offline.updateReady');
  else if (notice?.kind === 'offlineReady') message = t('offline.ready');
  else if (notice?.kind === 'backOnline') message = t('network.backOnline');
  else if (notice?.kind === 'wentOffline') {
    message = offlineMode.status === 'ready' ? t('network.wentOffline') : t('network.wentOfflineNotSaved');
  }

  return (
    <>
      <Snackbar
        open={notice !== null}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') close();
        }}
        autoHideDuration={notice ? (offerInstall ? 15000 : AUTO_HIDE_MS[notice.kind]) : null}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        message={message}
        data-testid="offline-notice"
        data-notice={notice?.kind}
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
