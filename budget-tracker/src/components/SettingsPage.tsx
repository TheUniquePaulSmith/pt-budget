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
      {value === index && <Box sx={{ p: 3 }}>{children}</Box>}
    </div>
  );
}

interface SettingsPageProps {
  onClose: () => void;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ onClose }) => {
  const [tabValue, setTabValue] = useState(0);
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);  const {
    exportDatabase,
    saveDatabaseToSession,
    clearSession,
    isDatabaseLoaded,
    autoSaveEnabled,
    autoSaveFileHandle,
    lastAutoSave,
    enableAutoSave,
    disableAutoSave,
  } = useDatabaseContext();

  const handleExportData = () => {
    const dbData = exportDatabase();
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
  const handleClearSession = async () => {
    if (confirm('This will clear your saved session data. You will need to reload your database file next time you visit. Continue?')) {
      try {
        await clearSession();
        alert('Session data cleared successfully.');
      } catch (error) {
        console.error('Error clearing session:', error);
        alert('Failed to clear session data.');
      }
    }
  };

  const handleAutoSaveToggle = async (enabled: boolean) => {
    if (enabled) {
      try {
        const success = await enableAutoSave();
        if (!success) {
          console.log('Auto-save setup was cancelled');
        }
      } catch (error) {
        console.error('Error enabling auto-save:', error);
      }
    } else {
      disableAutoSave();
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
      </AppBar>

      <Box sx={{ maxWidth: 1200, mx: 'auto', p: 3 }}>
        <Paper sx={{ width: '100%' }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
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
                  Your budget data is stored locally in your browser using IndexedDB. 
                  This data persists between sessions but is tied to this specific browser.
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

              <Divider />              <Box>
                <Typography variant="h6" gutterBottom>
                  Auto-Save
                </Typography>
                <Stack spacing={2}>
                  <FormControlLabel
                    control={
                      <Switch
                        checked={autoSaveEnabled}
                        onChange={(e) => handleAutoSaveToggle(e.target.checked)}
                        disabled={!('showSaveFilePicker' in window)}
                      />
                    }
                    label="Auto-save to file"
                  />                  {autoSaveEnabled && autoSaveFileHandle && (
                    <Typography variant="body2" color="text.secondary">
                      Saving to: <strong>{autoSaveFileHandle.name}</strong>
                    </Typography>
                  )}
                  {autoSaveEnabled && !autoSaveFileHandle && (
                    <Typography variant="body2" color="text.secondary">
                      Auto-save enabled, but file location unknown
                    </Typography>
                  )}
                  {autoSaveEnabled && lastAutoSave && (
                    <Typography variant="body2" color="text.secondary">
                      Last saved: <strong>{lastAutoSave.toLocaleString()}</strong>
                    </Typography>
                  )}
                  {!('showSaveFilePicker' in window) && (
                    <Typography variant="body2" color="error">
                      Auto-save is not available in this browser
                    </Typography>
                  )}
                  <Typography variant="body2" color="text.secondary">
                    When enabled, your database will be automatically saved to a file on your device after each change
                  </Typography>
                </Stack>
              </Box>

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  Session Management
                </Typography>
                <Stack spacing={2}>
                  <Button
                    variant="outlined"
                    color="warning"
                    onClick={handleClearSession}
                  >
                    Clear Session Data
                  </Button>
                  <Typography variant="body2" color="text.secondary">
                    Session data allows you to continue where you left off when you return to the app
                  </Typography>
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
