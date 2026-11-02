'use client';

import React from 'react';
import { Box, CircularProgress } from '@mui/material';
import { useTranslation } from 'react-i18next';

/** Suspense fallback while a lazily loaded page chunk arrives. */
export default function PageFallback() {
  const { t } = useTranslation('shell');
  return (
    <Box
      role="status"
      aria-label={t('pageFallback.loading')}
      sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 240 }}
    >
      <CircularProgress size={32} />
    </Box>
  );
}
