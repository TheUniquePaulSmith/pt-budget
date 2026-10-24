'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Box, CircularProgress } from '@mui/material';

// The pop-out AI window. Static export serves it at /ai/ (trailingSlash);
// AiPanelProvider opens it with window.open('/ai/', 'ptbudget-ai', ...).
const AiPopoutPage = dynamic(() => import('../../../components/ai/AiPopoutPage'), {
  ssr: false,
  loading: () => (
    <Box sx={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <CircularProgress size={32} />
    </Box>
  ),
});

export default function AiPage() {
  return <AiPopoutPage />;
}
