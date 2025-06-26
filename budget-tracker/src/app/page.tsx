'use client';

import React, { useState } from 'react';
import { Box, Tabs, Tab, AppBar, Toolbar, IconButton, Typography } from '@mui/material';
import { Settings } from '@mui/icons-material';
import DatabaseInitializer from '../components/DatabaseInitializer';
import Dashboard from '../components/Dashboard';
import ManageProjects from '../components/ManageProjects';
import TransactionReport from '../components/TransactionReport';
import SettingsPage from '../components/SettingsPage';
import AutoSaveIndicator from '../components/AutoSaveIndicator';
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
  const [showSettings, setShowSettings] = useState(false);

  const handleDatabaseReady = () => {
    setShowDashboard(true);
  };

  if (!isDatabaseLoaded && !showDashboard) {
    return <DatabaseInitializer onDatabaseReady={handleDatabaseReady} />;
  }

  if (showSettings) {
    return <SettingsPage onClose={() => setShowSettings(false)} />;
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header with Navigation */}
      <AppBar position="sticky" color="default" elevation={1}>
        <Toolbar>
          <Box sx={{ flexGrow: 1 }}>
            <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
              <Tab label="Financial Dashboard" />
              <Tab label="House Projects" />
              <Tab label="Transaction Report" />
            </Tabs>
          </Box>
          {isDatabaseLoaded && <AutoSaveIndicator />}
          <IconButton 
            color="inherit" 
            onClick={() => setShowSettings(true)}
            sx={{ ml: 2 }}
          >
            <Settings />
          </IconButton>
        </Toolbar>
      </AppBar>
      
      <TabPanel value={tabValue} index={0}>
        <Dashboard />
      </TabPanel>
      
      <TabPanel value={tabValue} index={1}>
        <ManageProjects />
      </TabPanel>
      
      <TabPanel value={tabValue} index={2}>
        <TransactionReport />
      </TabPanel>
    </Box>
  );
}
