'use client';

import React from 'react';
import { Box, CircularProgress } from '@mui/material';

/** Suspense fallback while a lazily loaded page chunk arrives. */
export default function PageFallback() {
  return (
    <Box
      role="status"
      aria-label="Loading page"
      sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240 }}
    >
      <CircularProgress size={32} />
    </Box>
  );
}
