'use client';

import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  Tabs,
  Tab,
  Stack,
  Divider,
  Switch,
  FormControlLabel,
  Button,
  Alert,
  IconButton,
  AppBar,
  Toolbar,
} from '@mui/material';
import {
  Storage,
  Backup,
  Security,
  Notifications,
  Palette,
  ArrowBack,
} from '@mui/icons-material';
import StorageQuota from './StorageQuota';
import { useDatabaseContext } from '../contexts/DatabaseContext';

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && <Box sx={{ p: { xs: 2, sm: 3 } }}>{children}</Box>}
    </div>
  );
}

interface SettingsPageProps {
  onClose: () => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ onClose }) => {
  const [tabValue, setTabValue] = useState(0);
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);

  const {
    exportDatabase,
    isDatabaseLoaded,
    handleDatabaseCorruption,
    error,
  } = useDatabaseContext();

  const handleExportData = async () => {
    const dbData = await exportDatabase();
    if (dbData) {
      const blob = new Blob([dbData], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `budget-tracker-${new Date().toISOString().split('T')[0]}.db`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleRecoverDatabase = async () => {
    if (confirm('This will delete all existing data and create a new database. Are you sure you want to continue?')) {
      setIsRecovering(true);
      try {
        await handleDatabaseCorruption();
      } finally {
        setIsRecovering(false);
      }
    }
  };



  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header */}
      <AppBar position="sticky" color="default" elevation={1}>
        <Toolbar>
          <IconButton 
            edge="start" 
            onClick={onClose}
            sx={{ mr: 2 }}
          >
            <ArrowBack />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Settings
          </Typography>
        </Toolbar>
      </AppBar>      <Box sx={{ maxWidth: 1200, mx: 'auto', p: { xs: 1, sm: 3 } }}>
        <Paper sx={{ width: '100%' }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs 
              value={tabValue} 
              onChange={(_, newValue) => setTabValue(newValue)}
              variant="scrollable"
              scrollButtons="auto"
              allowScrollButtonsMobile
              sx={{
                '& .MuiTab-root': {
                  minWidth: { xs: 80, sm: 120 },
                  fontSize: { xs: '0.75rem', sm: '0.875rem' },
                  padding: { xs: '6px 8px', sm: '12px 16px' }
                }
              }}
            >
              <Tab icon={<Storage />} label="Storage" />
              <Tab icon={<Backup />} label="Data & Backup" />
              <Tab icon={<Palette />} label="Display" />
              <Tab icon={<Notifications />} label="Notifications" />
            </Tabs>
          </Box>

          {/* Storage Tab */}
          <TabPanel value={tabValue} index={0}>
            <Stack spacing={3}>
              <Box>
                <Typography variant="h5" gutterBottom>
                  Storage Management
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  Monitor your browser storage usage and manage your data storage.
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  Current Storage Usage
                </Typography>
                <Box sx={{ maxWidth: 600 }}>
                  <StorageQuota variant="card" />
                </Box>
              </Box>

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  Storage Information
                </Typography>
                <Alert severity="info" sx={{ mb: 2 }}>
                  Your budget data is stored locally in your browser using OPFS (Origin Private File System).
                  This data persists between sessions and is tied to this specific browser and origin.
                </Alert>
                <Stack spacing={2}>
                  <Typography variant="body2">
                    • <strong>Local Storage:</strong> Data is stored on your device and never sent to external servers
                  </Typography>
                  <Typography variant="body2">
                    • <strong>Browser Limits:</strong> Most browsers allow up to 60% of available disk space
                  </Typography>
                  <Typography variant="body2">
                    • <strong>Backup Recommended:</strong> Export your data regularly to prevent loss
                  </Typography>
                </Stack>
              </Box>
            </Stack>
          </TabPanel>

          {/* Data & Backup Tab */}
          <TabPanel value={tabValue} index={1}>
            <Stack spacing={3}>
              <Box>
                <Typography variant="h5" gutterBottom>
                  Data & Backup
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  Export your data for backup or import into other applications.
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  Export Data
                </Typography>
                <Stack spacing={2}>
                  <Button
                    variant="contained"
                    startIcon={<Backup />}
                    onClick={handleExportData}
                    disabled={!isDatabaseLoaded}
                  >
                    Export Database
                  </Button>
                  <Typography variant="body2" color="text.secondary">
                    Downloads a complete backup of your database file (.db format)
                  </Typography>
                </Stack>
              </Box>

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  Database Recovery
                </Typography>
                {error && error.includes('corruption') && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    Database corruption detected. Use the recovery option below to fix the issue.
                  </Alert>
                )}
                <Stack spacing={2}>
                  <Button
                    variant="outlined"
                    color="warning"
                    startIcon={<Security />}
                    onClick={handleRecoverDatabase}
                    disabled={isRecovering}
                  >
                    {isRecovering ? 'Recovering Database...' : 'Recover Corrupted Database'}
                  </Button>
                  <Alert severity="warning">
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      <strong>Warning:</strong> This will permanently delete all existing data and create a new database.
                    </Typography>
                    <Typography variant="body2">
                      Use this option only if you're experiencing database corruption errors.
                      Make sure to export your data first if possible.
                    </Typography>
                  </Alert>
                </Stack>
              </Box>

            </Stack>
          </TabPanel>

          {/* Display Tab */}
          <TabPanel value={tabValue} index={2}>
            <Stack spacing={3}>
              <Box>
                <Typography variant="h5" gutterBottom>
                  Display Settings
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  Customize the appearance of your budget tracker.
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  Theme
                </Typography>
                <FormControlLabel
                  control={
                    <Switch
                      checked={darkMode}
                      onChange={(e) => setDarkMode(e.target.checked)}
                    />
                  }
                  label="Dark mode"
                />
                <Typography variant="body2" color="text.secondary">
                  Toggle between light and dark themes (coming soon)
                </Typography>
              </Box>
            </Stack>
          </TabPanel>

          {/* Notifications Tab */}
          <TabPanel value={tabValue} index={3}>
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
          </TabPanel>
        </Paper>
      </Box>
    </Box>
  );
};

export default SettingsPage;
