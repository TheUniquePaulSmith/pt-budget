'use client';

/**
 * Settings → Developer tab body (only reachable with `?debug`): log
 * retention, "clear diagnostic logs", and Reset App (which keeps the
 * diagnostic logs unless "Also clear diagnostic logs" is ticked).
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { DeleteSweep } from '@mui/icons-material';
import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';

import { ResetAppButton } from '@/components/common/ResetAppButton';
import { useSettingsSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import {
  LOG_RETENTION_AGE_OPTIONS,
  LOG_RETENTION_ENTRY_OPTIONS,
  clearLogs,
  countLogs,
  getLogRetention,
  getPersistentLogSink,
  logger,
  setLogRetention,
  subscribeToLogUpdates,
  type LogRetention,
} from '@/lib/logging';
import { resetApp } from '@/lib/resetApp';

const log = logger.child({ component: 'DeveloperSettingsTab' });

function ageLabel(days: number, t: TFunction<['developer', 'common']>): string {
  if (days === 0) return t('settingsTab.untilEvicted');
  return t('settingsTab.days', { count: days });
}

export default function DeveloperSettingsTab() {
  const { t } = useTranslation(['developer', 'common']);
  const { number } = useFormatters();
  const { terminateWorker } = useSettingsSlice();
  const [retention, setRetention] = useState<LogRetention>(() => getLogRetention());
  const [storedCount, setStoredCount] = useState<number | null>(null);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [includeLogsInReset, setIncludeLogsInReset] = useState(false);

  const refreshCount = useCallback(() => {
    void countLogs()
      .then(setStoredCount)
      .catch(() => setStoredCount(null));
  }, []);

  useEffect(() => {
    refreshCount();
    return subscribeToLogUpdates(() => refreshCount());
  }, [refreshCount]);

  const updateRetention = (patch: Partial<LogRetention>) => {
    const next = setLogRetention(patch);
    setRetention(next);
    log.info('Log retention updated', { operation: 'setLogRetention', ...next });
    void getPersistentLogSink()?.prune().then(refreshCount);
  };

  const handleClearLogs = async () => {
    setIsClearing(true);
    try {
      await clearLogs();
      log.info('Diagnostic logs cleared from settings', { operation: 'clearLogs' });
    } catch (error) {
      log.error('Failed to clear diagnostic logs', { operation: 'clearLogs', error });
    } finally {
      setIsClearing(false);
      setClearDialogOpen(false);
      refreshCount();
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" gutterBottom>
          {t('settingsTab.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          <Trans i18nKey="settingsTab.description" ns="developer" components={{ code: <code /> }} />
        </Typography>
      </Box>

      <Divider />

      <Box>
        <Typography variant="h6" gutterBottom>
          {t('settingsTab.logsTitle')}
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          <Trans i18nKey="settingsTab.logsDescription" ns="developer" components={{ code: <code /> }} />
          {storedCount !== null && (
            <>
              {' '}
              <Trans
                i18nKey="settingsTab.storing"
                ns="developer"
                count={storedCount}
                values={{ value: number(storedCount) }}
                components={{ strong: <strong data-testid="log-stored-count" /> }}
              />
            </>
          )}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel id="log-retention-entries-label">{t('settingsTab.keepAtMost')}</InputLabel>
            <Select
              labelId="log-retention-entries-label"
              label={t('settingsTab.keepAtMost')}
              value={retention.maxEntries}
              onChange={(e) => updateRetention({ maxEntries: Number(e.target.value) })}
              data-testid="log-retention-entries"
            >
              {LOG_RETENTION_ENTRY_OPTIONS.map((count) => (
                <MenuItem key={count} value={count}>
                  {t('settingsTab.entries', { value: number(count) })}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel id="log-retention-age-label">{t('settingsTab.keepFor')}</InputLabel>
            <Select
              labelId="log-retention-age-label"
              label={t('settingsTab.keepFor')}
              value={retention.maxAgeDays}
              onChange={(e) => updateRetention({ maxAgeDays: Number(e.target.value) })}
              data-testid="log-retention-age"
            >
              {LOG_RETENTION_AGE_OPTIONS.map((days) => (
                <MenuItem key={days} value={days}>
                  {ageLabel(days, t)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
        <Button
          variant="outlined"
          color="warning"
          startIcon={<DeleteSweep />}
          onClick={() => setClearDialogOpen(true)}
          disabled={storedCount === 0}
          data-testid="log-clear-settings"
        >
          {t('settingsTab.clearLogs')}
        </Button>
      </Box>

      <Divider />

      <Box>
        <Typography variant="h6" gutterBottom>
          {t('settingsTab.resetTitle')}
        </Typography>
        <Alert severity="warning" sx={{ mb: 2 }}>
          {t('settingsTab.resetWarning')}
        </Alert>
        <FormControlLabel
          sx={{ mb: 1, display: 'flex' }}
          control={
            <Checkbox
              checked={includeLogsInReset}
              onChange={(e) => setIncludeLogsInReset(e.target.checked)}
              inputProps={{ 'data-testid': 'reset-include-logs' } as React.InputHTMLAttributes<HTMLInputElement>}
            />
          }
          label={t('settingsTab.alsoClearLogs')}
        />
        <ResetAppButton onReset={() => resetApp(terminateWorker, { includeLogs: includeLogsInReset })} />
      </Box>

      <Dialog open={clearDialogOpen} onClose={() => !isClearing && setClearDialogOpen(false)}>
        <DialogTitle>{t('settingsTab.clearDialogTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('settingsTab.clearDialogBody')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearDialogOpen(false)} disabled={isClearing}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            color="warning"
            variant="contained"
            onClick={() => void handleClearLogs()}
            disabled={isClearing}
            data-testid="log-clear-confirm"
          >
            {isClearing ? t('settingsTab.clearing') : t('settingsTab.clearConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
