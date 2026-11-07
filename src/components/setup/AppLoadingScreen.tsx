'use client';

import React from 'react';
import { Box, Typography } from '@mui/material';

import AppLogo from '@/components/common/AppLogo';

interface AppLoadingScreenProps {
  /** One short line under the logo saying what the app is doing right now. */
  message: string;
}

/**
 * The quiet full-screen loading view shown before the app shell exists: the
 * animated winged-money logo with a single status line beneath it. There is no
 * spinner, the logo's flap is the activity cue. Used while the shell chunk
 * loads, while the first-run browser compatibility test runs (outside
 * `?debug`), and while the database worker starts.
 */
export default function AppLoadingScreen({ message }: AppLoadingScreenProps) {
  return (
    <Box
      data-testid="app-loading-screen"
      role="status"
      aria-live="polite"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 3,
        p: 2,
        textAlign: 'center',
      }}
    >
      <AppLogo scale={6} />
      <Typography variant="h6" component="p" color="text.secondary" sx={{ fontWeight: 400 }}>
        {message}
      </Typography>
    </Box>
  );
}
