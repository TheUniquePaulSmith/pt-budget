'use client';

/**
 * Settings → Notifications tab body. Foundation keeps the previous stub
 * (a local switch that is not persisted); the notifications feature replaces
 * it with per-type lead times, OS notification opt-in and the global toggle
 * backed by `notification_settings` / `app_metadata`.
 */

import React, { useState } from 'react';
import { Box, Divider, FormControlLabel, Stack, Switch, Typography } from '@mui/material';

export default function NotificationsSettingsTab() {
  const [notifications, setNotifications] = useState(true);

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" gutterBottom>
          Notifications
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Configure when and how you receive notifications.
        </Typography>
      </Box>

      <Divider />

      <Box>
        <Typography variant="h6" gutterBottom>
          Notification Preferences
        </Typography>
        <Stack spacing={2}>
          <FormControlLabel
            control={
              <Switch
                checked={notifications}
                onChange={(e) => setNotifications(e.target.checked)}
              />
            }
            label="Enable notifications"
          />
          <Typography variant="body2" color="text.secondary">
            Receive alerts for budget limits, storage warnings, and other important events
          </Typography>
        </Stack>
      </Box>
    </Stack>
  );
}
