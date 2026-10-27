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

import { ResetAppButton } from '@/components/common/ResetAppButton';
import { useSettingsSlice } from '@/contexts/useDatabaseSlices';
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

function ageLabel(days: number): string {
  if (days === 0) return 'Until evicted by the entry cap';
  if (days === 1) return '1 day';
  return `${days} days`;
}

export default function DeveloperSettingsTab() {
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
          Developer
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Debug-only tools, visible because the app was opened with <code>?debug</code>.
        </Typography>
      </Box>

      <Divider />

      <Box>
        <Typography variant="h6" gutterBottom>
          Diagnostic logs
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Structured logs from every tab and the database worker are kept in a separate, unencrypted
          browser store (<code>ptbudgetapp-logs</code>) and shown in the Developer Console.
          {storedCount !== null && (
            <>
              {' '}
              Currently storing <strong data-testid="log-stored-count">{storedCount.toLocaleString()}</strong>{' '}
              {storedCount === 1 ? 'entry' : 'entries'}.
            </>
          )}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <InputLabel id="log-retention-entries-label">Keep at most</InputLabel>
            <Select
              labelId="log-retention-entries-label"
              label="Keep at most"
              value={retention.maxEntries}
              onChange={(e) => updateRetention({ maxEntries: Number(e.target.value) })}
              data-testid="log-retention-entries"
            >
              {LOG_RETENTION_ENTRY_OPTIONS.map((count) => (
                <MenuItem key={count} value={count}>
                  {count.toLocaleString()} entries
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 240 }}>
            <InputLabel id="log-retention-age-label">Keep for</InputLabel>
            <Select
              labelId="log-retention-age-label"
              label="Keep for"
              value={retention.maxAgeDays}
              onChange={(e) => updateRetention({ maxAgeDays: Number(e.target.value) })}
              data-testid="log-retention-age"
            >
              {LOG_RETENTION_AGE_OPTIONS.map((days) => (
                <MenuItem key={days} value={days}>
                  {ageLabel(days)}
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
          Clear diagnostic logs
        </Button>
      </Box>

      <Divider />

      <Box>
        <Typography variant="h6" gutterBottom>
          Reset App
        </Typography>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Deletes the database, all settings, and cookies, then reloads the app to its
          original, first-run state. This cannot be undone.
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
          label="Also clear diagnostic logs"
        />
        <ResetAppButton onReset={() => resetApp(terminateWorker, { includeLogs: includeLogsInReset })} />
      </Box>

      <Dialog open={clearDialogOpen} onClose={() => !isClearing && setClearDialogOpen(false)}>
        <DialogTitle>Clear diagnostic logs?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Every stored log entry from every tab and the database worker is deleted. Your
            financial data is not affected.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setClearDialogOpen(false)} disabled={isClearing}>
            Cancel
          </Button>
          <Button
            color="warning"
            variant="contained"
            onClick={() => void handleClearLogs()}
            disabled={isClearing}
            data-testid="log-clear-confirm"
          >
            {isClearing ? 'Clearing…' : 'Clear logs'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
