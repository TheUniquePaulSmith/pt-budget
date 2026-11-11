'use client';

/**
 * Settings → Preferences → Offline mode: the switch that saves the whole app
 * on this device (src/lib/offlineMode.ts). Off by default, so new users only
 * download the pages they open; on, the service worker downloads every file
 * of the build once, with progress here, and later updates only what changed.
 */

import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, FormControlLabel, LinearProgress, Switch, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useOfflineMode } from '@/components/common/Offline/useOfflineMode';
import { useOnlineStatus } from '@/components/common/Offline/useOnlineStatus';
import { useFormatters } from '@/contexts/useFormatters';
import { fetchOfflineSummary, type OfflineSummary } from '@/lib/offlineMode';

const BYTES_PER_MB = 1024 * 1024;

export default function OfflineModeSection() {
  const { t } = useTranslation('settings');
  const { number } = useFormatters();
  const mode = useOfflineMode();
  const online = useOnlineStatus();
  const [summary, setSummary] = useState<OfflineSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const available = mode.status !== 'unsupported' && mode.status !== 'devBuild';
  const on = mode.status === 'downloading' || mode.status === 'ready' || mode.status === 'error';

  // The size is only shown before turning it on, and fetching it needs the host.
  const wantsSummary = mode.status === 'off' && online && summary === null;
  useEffect(() => {
    if (!wantsSummary) return;
    let cancelled = false;
    void fetchOfflineSummary().then((result) => {
      if (!cancelled) setSummary(result);
    });
    return () => {
      cancelled = true;
    };
  }, [wantsSummary]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box data-testid="settings-offline">
      <Typography variant="h6" gutterBottom>
        {t('preferences.offline.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        {t('preferences.offline.description')}
      </Typography>

      {mode.status === 'unsupported' && <Alert severity="info">{t('preferences.offline.unsupported')}</Alert>}
      {mode.status === 'devBuild' && (
        <Alert severity="info" data-testid="settings-offline-dev">
          {t('preferences.offline.devBuild')}
        </Alert>
      )}

      {available && (
        <>
          <FormControlLabel
            control={
              <Switch
                checked={on}
                disabled={busy || (!on && !online)}
                onChange={(_event, checked) => void run(checked ? mode.enable : mode.disable)}
                inputProps={{ 'aria-describedby': 'settings-offline-state' }}
                data-testid="settings-offline-switch"
              />
            }
            label={t('preferences.offline.switchLabel')}
          />
          {summary && !on && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }} data-testid="settings-offline-size">
              {t('preferences.offline.size', {
                size: number(Math.max(1, Math.round(summary.bytes / BYTES_PER_MB)), { maximumFractionDigits: 0 }),
                files: number(summary.files),
              })}
            </Typography>
          )}
          <Box id="settings-offline-state" sx={{ mt: 1.5 }}>
            {!on && !online && (
              <Alert severity="warning" data-testid="settings-offline-needs-connection">
                {t('preferences.offline.needsConnection')}
              </Alert>
            )}
            {mode.status === 'downloading' && (
              <Box data-testid="settings-offline-progress">
                <Typography variant="body2" sx={{ mb: 1 }}>
                  {mode.total > 0
                    ? t('preferences.offline.downloading', { done: number(mode.done), total: number(mode.total) })
                    : t('preferences.offline.downloadingStart')}
                </Typography>
                <LinearProgress
                  variant={mode.total > 0 ? 'determinate' : 'indeterminate'}
                  value={mode.total > 0 ? (mode.done / mode.total) * 100 : undefined}
                />
              </Box>
            )}
            {mode.status === 'ready' && (
              <Alert severity="success" data-testid="settings-offline-ready">
                {t('preferences.offline.ready')}
              </Alert>
            )}
            {mode.status === 'error' && (
              <Alert
                severity="error"
                data-testid="settings-offline-error"
                action={
                  <Button color="inherit" size="small" disabled={busy || !online} onClick={() => void run(mode.enable)}>
                    {t('preferences.offline.retry')}
                  </Button>
                }
              >
                {t('preferences.offline.error')}
              </Alert>
            )}
          </Box>
        </>
      )}
    </Box>
  );
}
