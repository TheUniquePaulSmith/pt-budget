'use client';

/**
 * Settings → Developer tab body (only reachable with `?debug`). Owned by the
 * logging feature, which adds log retention and "clear diagnostic logs".
 */

import React from 'react';
import { Alert, Box, Divider, Stack, Typography } from '@mui/material';

import { ResetAppButton } from '@/components/common/ResetAppButton';
import { useSettingsSlice } from '@/contexts/useDatabaseSlices';
import { resetApp } from '@/lib/resetApp';

export default function DeveloperSettingsTab() {
  const { disconnectWorker } = useSettingsSlice();

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
          Reset App
        </Typography>
        <Alert severity="warning" sx={{ mb: 2 }}>
          Deletes the database, all settings, and cookies, then reloads the app to its
          original, first-run state. This cannot be undone.
        </Alert>
        <ResetAppButton onReset={() => resetApp(disconnectWorker)} />
      </Box>
    </Stack>
  );
}
