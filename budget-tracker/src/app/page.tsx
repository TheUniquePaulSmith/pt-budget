'use client';

import React, { useState } from 'react';
import { Box } from '@mui/material';
import DatabaseInitializer from '../components/DatabaseInitializer';
import Dashboard from '../components/Dashboard';
import { useDatabaseContext } from '../contexts/DatabaseContext';

export default function Home() {
  const { isDatabaseLoaded } = useDatabaseContext();
  const [showDashboard, setShowDashboard] = useState(false);

  const handleDatabaseReady = () => {
    setShowDashboard(true);
  };

  if (!isDatabaseLoaded && !showDashboard) {
    return <DatabaseInitializer onDatabaseReady={handleDatabaseReady} />;
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Dashboard />
    </Box>
  );
}
