'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Box, CircularProgress, Typography } from '@mui/material';

// Dynamically import the main app content to prevent SSR issues
const AppContent = dynamic(() => import('../components/AppContent'), {
  ssr: false,
  loading: () => (
    <Box 
      sx={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        flexDirection: 'column',
        gap: 2
      }}
    >
      <CircularProgress size={40} />
      <Typography variant="body1" color="text.secondary">
        Loading Budget Tracker...
      </Typography>
    </Box>
  ),
});

export default function Home() {
  return <AppContent />;
}
