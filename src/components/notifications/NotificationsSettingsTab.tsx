'use client';

/**
 * Settings → Notifications tab body: the global switch (`app_metadata`
 * `notifications.enabled`), OS notifications (permission is requested only
 * from this switch), and per-type enable / lead days / OS opt-in rows backed
 * by `notification_settings`. Every change is saved immediately and the
 * runtime is told to reload and rescan.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Divider,
  FormControlLabel,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

import { useNotificationsSettingsSlice } from '@/contexts/useNotificationsSlices';
import { logger } from '@/lib/logging';
import { getOsNotificationPermission } from '@/lib/notificationService';
import type { NotificationSetting } from '@/types/database';
import { ALERT_TYPES, REMINDER_TYPES, type NotificationType } from '@/types/notifications';
import { NOTIFICATION_TYPE_DESCRIPTIONS, NOTIFICATION_TYPE_LABELS } from './notificationPresentation';
import { notifyNotificationSettingsChanged, setNotificationsView } from './notificationsStore';

const log = logger.child({ component: 'NotificationsSettingsTab' });

const TYPE_ORDER: NotificationType[] = [...REMINDER_TYPES, ...ALERT_TYPES];

export default function NotificationsSettingsTab() {
  const {
    isDatabaseLoaded,
    getNotificationSettings,
    upsertNotificationSetting,
    getNotificationPreferences,
    setNotificationsEnabled,
    setOsNotificationsEnabled,
  } = useNotificationsSettingsSlice();

  const [settings, setSettings] = useState<NotificationSetting[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [osEnabled, setOsEnabled] = useState(false);
  const [osPermission, setOsPermission] = useState(getOsNotificationPermission());
  const [leadDrafts, setLeadDrafts] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isDatabaseLoaded) return;
    let cancelled = false;
    Promise.all([getNotificationSettings(), getNotificationPreferences()])
      .then(([rows, preferences]) => {
        if (cancelled) return;
        setSettings(rows);
        setLeadDrafts(Object.fromEntries(rows.map((row) => [row.type, String(row.lead_days)])));
        setEnabled(preferences.enabled);
        setOsEnabled(preferences.osEnabled);
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        log.error('Failed to load notification settings', { operation: 'loadSettings', error: err });
        setError(err instanceof Error ? err.message : 'Failed to load notification settings');
      });
    return () => {
      cancelled = true;
    };
  }, [getNotificationPreferences, getNotificationSettings, isDatabaseLoaded]);

  const saveSetting = useCallback(
    async (next: NotificationSetting) => {
      setSettings((current) => current.map((row) => (row.type === next.type ? next : row)));
      try {
        await upsertNotificationSetting(next);
        notifyNotificationSettingsChanged();
      } catch (err) {
        log.error('Failed to save notification setting', { operation: 'saveSetting', error: err, type: next.type });
        setError(err instanceof Error ? err.message : 'Failed to save notification setting');
      }
    },
    [upsertNotificationSetting]
  );

  const commitLeadDays = useCallback(
    async (row: NotificationSetting) => {
      const draft = leadDrafts[row.type] ?? String(row.lead_days);
      const parsed = Number(draft);
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 365) {
        setLeadDrafts((current) => ({ ...current, [row.type]: String(row.lead_days) }));
        setError('Lead time must be a whole number of days between 0 and 365');
        return;
      }
      if (parsed === row.lead_days) return;
      setError(null);
      await saveSetting({ ...row, lead_days: parsed });
    },
    [leadDrafts, saveSetting]
  );

  const handleGlobalToggle = async (next: boolean) => {
    setEnabled(next);
    try {
      await setNotificationsEnabled(next);
      notifyNotificationSettingsChanged();
    } catch (err) {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : 'Failed to save setting');
    }
  };

  const handleOsToggle = async (next: boolean) => {
    if (next) {
      // Permission is only ever requested from here, never on app load.
      if (typeof Notification === 'undefined') {
        setError('This browser does not support OS notifications.');
        return;
      }
      let permission = Notification.permission;
      if (permission === 'default') {
        try {
          permission = await Notification.requestPermission();
        } catch (err) {
          log.warn('Notification permission request failed', { operation: 'requestPermission', error: err });
          permission = 'denied';
        }
      }
      setOsPermission(permission);
      setNotificationsView({ osPermission: permission });
      if (permission !== 'granted') {
        setError(
          permission === 'denied'
            ? 'The browser blocked notifications for this site. Allow them in the browser’s site settings, then try again.'
            : 'Notification permission was not granted.'
        );
        return;
      }
    }
    setOsEnabled(next);
    try {
      await setOsNotificationsEnabled(next);
      notifyNotificationSettingsChanged();
    } catch (err) {
      setOsEnabled(!next);
      setError(err instanceof Error ? err.message : 'Failed to save setting');
    }
  };

  const permissionText =
    osPermission === 'unsupported'
      ? 'Not supported by this browser'
      : osPermission === 'granted'
        ? 'Allowed by the browser'
        : osPermission === 'denied'
          ? 'Blocked by the browser'
          : 'Permission will be requested when you turn this on';

  return (
    <Stack spacing={3} data-testid="notifications-settings-tab">
      <Box>
        <Typography variant="h5" gutterBottom>
          Notifications
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Reminders and alerts show on the dashboard, the bell in the header and the Notifications page.
          Changes are saved immediately.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Divider />

      <Box>
        <Typography variant="h6" gutterBottom>
          General
        </Typography>
        <Stack spacing={1}>
          <FormControlLabel
            control={
              <Switch
                checked={enabled}
                onChange={(event) => void handleGlobalToggle(event.target.checked)}
                disabled={!loaded}
                slotProps={{ input: { 'data-testid': 'notifications-enabled-switch' } as React.InputHTMLAttributes<HTMLInputElement> }}
              />
            }
            label="Enable notifications"
          />
          <Typography variant="body2" color="text.secondary">
            Turning this off stops scanning for alerts and hides the badge; your reminders are kept.
          </Typography>
          <FormControlLabel
            control={
              <Switch
                checked={osEnabled}
                onChange={(event) => void handleOsToggle(event.target.checked)}
                disabled={!loaded || !enabled || osPermission === 'unsupported'}
                slotProps={{ input: { 'data-testid': 'notifications-os-switch' } as React.InputHTMLAttributes<HTMLInputElement> }}
              />
            }
            label="Also show browser (OS) notifications"
          />
          <Typography variant="body2" color="text.secondary">
            {permissionText}. Browser notifications only fire while Budget Tracker is open in a tab, once per item per day,
            and only for the types ticked below.
          </Typography>
        </Stack>
      </Box>

      <Divider />

      <Box>
        <Typography variant="h6" gutterBottom>
          Types and lead times
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Lead time is how many days before the date an item becomes due. A reminder can override it.
        </Typography>
        <Table size="small" data-testid="notification-type-table">
          <TableHead>
            <TableRow>
              <TableCell>Type</TableCell>
              <TableCell align="center">Enabled</TableCell>
              <TableCell align="right">Lead days</TableCell>
              <TableCell align="center">Browser</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {TYPE_ORDER.map((type) => {
              const row = settings.find((setting) => setting.type === type);
              if (!row) return null;
              return (
                <TableRow key={type} data-testid={`notification-setting-${type}`}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {NOTIFICATION_TYPE_LABELS[type]}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {NOTIFICATION_TYPE_DESCRIPTIONS[type]}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Switch
                      size="small"
                      checked={Boolean(row.enabled)}
                      disabled={!enabled}
                      onChange={(event) => void saveSetting({ ...row, enabled: event.target.checked ? 1 : 0 })}
                      slotProps={{ input: { 'aria-label': `Enable ${NOTIFICATION_TYPE_LABELS[type]}`, 'data-testid': `notification-setting-${type}-enabled` } as React.InputHTMLAttributes<HTMLInputElement> }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <TextField
                      type="number"
                      size="small"
                      value={leadDrafts[type] ?? String(row.lead_days)}
                      disabled={!enabled || !row.enabled}
                      onChange={(event) => setLeadDrafts((current) => ({ ...current, [type]: event.target.value }))}
                      onBlur={() => void commitLeadDays(row)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                      }}
                      sx={{ width: 96 }}
                      slotProps={{
                        htmlInput: { min: 0, max: 365, 'aria-label': `${NOTIFICATION_TYPE_LABELS[type]} lead days`, 'data-testid': `notification-setting-${type}-lead` },
                      }}
                    />
                  </TableCell>
                  <TableCell align="center">
                    <Switch
                      size="small"
                      checked={Boolean(row.os_notify)}
                      disabled={!enabled || !row.enabled || !osEnabled}
                      onChange={(event) => void saveSetting({ ...row, os_notify: event.target.checked ? 1 : 0 })}
                      slotProps={{ input: { 'aria-label': `Browser notifications for ${NOTIFICATION_TYPE_LABELS[type]}`, 'data-testid': `notification-setting-${type}-os` } as React.InputHTMLAttributes<HTMLInputElement> }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
    </Stack>
  );
}
