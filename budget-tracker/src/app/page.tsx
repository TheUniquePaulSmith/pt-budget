'use client';

import React, { useState } from 'react';
import { Box, Tabs, Tab } from '@mui/material';
import DatabaseInitializer from '../components/DatabaseInitializer';
import Dashboard from '../components/Dashboard';
import ManageProjects from '../components/ManageProjects';
import { useDatabaseContext } from '../contexts/DatabaseContext';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ width: '100%' }}>{children}</Box>}
    </div>
  );
}

export default function Home() {
  const { isDatabaseLoaded } = useDatabaseContext();
  const [showDashboard, setShowDashboard] = useState(false);
  const [tabValue, setTabValue] = useState(0);

  const handleDatabaseReady = () => {
    setShowDashboard(true);
  };

  if (!isDatabaseLoaded && !showDashboard) {
    return <DatabaseInitializer onDatabaseReady={handleDatabaseReady} />;
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)} centered>
          <Tab label="Financial Dashboard" />
          <Tab label="House Projects" />
        </Tabs>
      </Box>
      
      <TabPanel value={tabValue} index={0}>
        <Dashboard />
      </TabPanel>
      
      <TabPanel value={tabValue} index={1}>
        <ManageProjects />
      </TabPanel>
    </Box>
  );
}
