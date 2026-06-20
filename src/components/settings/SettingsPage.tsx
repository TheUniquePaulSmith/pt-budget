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
  FormControl,
  FormLabel,
  Radio,
  RadioGroup,
  Button,
  Alert,
  IconButton,
  AppBar,
  Toolbar,
  Chip,
} from '@mui/material';
import {
  Storage,
  Backup,
  CloudSync,
  Notifications,
  Palette,
  ArrowBack,
  Save,
  SwapHoriz,
} from '@mui/icons-material';
import StorageQuota from '@/components/common/Storage/StorageQuota';
import { useSettingsSlice } from '@/contexts/useDatabaseSlices';
import { ThemePresetId, useThemePreferences } from '@/theme/theme';
import type { CloudProvider } from '@/lib/databaseSourceStorage';

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

  const {
    exportDatabase,
    connectCloudSource,
    migrateDatabaseToCloud,
    saveDatabaseToCurrentCloud,
    switchToLocalSource,
    isDatabaseLoaded,
    databaseSource,
    databaseSourceState,
  } = useSettingsSlice();
  const {
    availableThemes,
    selectedThemeId,
    setSelectedThemeId,
  } = useThemePreferences();

  const handleExportData = async () => {
    const dbData = await exportDatabase();
    if (dbData) {
      const blob = new Blob([dbData], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `budget-tracker-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleConnectCloudSource = async (provider: CloudProvider) => {
    try {
      await connectCloudSource(provider);
    } catch {
      // Error is surfaced through the provider state.
    }
  };

  const handleMigrateToCloud = async (provider: CloudProvider) => {
    try {
      await migrateDatabaseToCloud(provider);
    } catch {
      // Error is surfaced through the provider state.
    }
  };

  const linkedGoogleFile = databaseSourceState.linkedFiles.gdrive ?? null;
  const linkedOneDriveFile = databaseSourceState.linkedFiles.onedrive ?? null;

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

      <Box sx={{ maxWidth: 1200, mx: 'auto', p: { xs: 1, sm: 3 } }}>
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
                  padding: { xs: '6px 8px', sm: '12px 16px' },
                },
              }}
            >
              <Tab icon={<Storage />} label="Storage" />
              <Tab icon={<CloudSync />} label="Database Source" />
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
                  Database Source
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  Choose whether the working copy is local, Google Drive, or OneDrive.
                  Cloud sources keep using the browser database as the working copy and let you sync that copy manually.
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  Current Source
                </Typography>
                <Stack spacing={1.5}>
                  <Typography variant="body2">
                    <strong>Active source:</strong> {databaseSource}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Last local write:</strong>{' '}
                    {databaseSourceState.lastLocalWriteTimestamp ?? 'Not recorded yet'}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Last cloud file timestamp:</strong>{' '}
                    {databaseSourceState.lastCloudFileTimestamp ?? 'Not recorded yet'}
                  </Typography>
                  <Typography variant="body2">
                    <strong>Last cloud sync:</strong>{' '}
                    {databaseSourceState.lastCloudSyncTimestamp ?? 'Not synced yet'}
                  </Typography>
                </Stack>
              </Box>

              {(databaseSourceState.lastSyncError || linkedGoogleFile || linkedOneDriveFile) && (
                <>
                  <Divider />
                  <Box>
                    <Typography variant="h6" gutterBottom>
                      Linked Cloud Files
                    </Typography>
                    <Stack spacing={1.5}>
                      <Typography variant="body2">
                        <strong>Google Drive:</strong>{' '}
                        {linkedGoogleFile
                          ? `${linkedGoogleFile.fileName}${linkedGoogleFile.modifiedAt ? ` (${linkedGoogleFile.modifiedAt})` : ''}`
                          : 'No file linked'}
                      </Typography>
                      <Typography variant="body2">
                        <strong>OneDrive:</strong>{' '}
                        {linkedOneDriveFile
                          ? `${linkedOneDriveFile.fileName}${linkedOneDriveFile.modifiedAt ? ` (${linkedOneDriveFile.modifiedAt})` : ''}`
                          : 'No file linked'}
                      </Typography>
                    </Stack>
                  </Box>
                </>
              )}

              {databaseSourceState.lastSyncError && (
                <Alert severity="warning">{databaseSourceState.lastSyncError}</Alert>
              )}

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  Source Actions
                </Typography>
                <Stack spacing={2} direction={{ xs: 'column', md: 'row' }} flexWrap="wrap">
                  <Button
                    variant="contained"
                    startIcon={<CloudSync />}
                    onClick={() => {
                      void handleConnectCloudSource('gdrive');
                    }}
                  >
                    Open from Google Drive
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<CloudSync />}
                    onClick={() => {
                      void handleConnectCloudSource('onedrive');
                    }}
                  >
                    Open from OneDrive
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<SwapHoriz />}
                    onClick={() => {
                      void handleMigrateToCloud('gdrive');
                    }}
                    disabled={!isDatabaseLoaded}
                  >
                    Convert Local to Google Drive
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<SwapHoriz />}
                    onClick={() => {
                      void handleMigrateToCloud('onedrive');
                    }}
                    disabled={!isDatabaseLoaded}
                  >
                    Convert Local to OneDrive
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<Save />}
                    onClick={() => {
                      void saveDatabaseToCurrentCloud();
                    }}
                    disabled={!isDatabaseLoaded || databaseSource === 'local'}
                  >
                    Save Current Cloud Copy
                  </Button>
                  <Button
                    variant="text"
                    onClick={switchToLocalSource}
                    disabled={databaseSource === 'local'}
                  >
                    Switch Back to Local
                  </Button>
                </Stack>
              </Box>

              <Divider />

              <Alert severity="info">
                Configure client-side cloud auth with NEXT_PUBLIC_GOOGLE_CLIENT_ID,
                NEXT_PUBLIC_MICROSOFT_CLIENT_ID, and optionally NEXT_PUBLIC_MICROSOFT_TENANT_ID.
              </Alert>
            </Stack>
          </TabPanel>

          <TabPanel value={tabValue} index={2}>
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
                    Downloads a complete backup archive containing the VFS snapshot and dbstatus.json
                  </Typography>
                </Stack>
              </Box>

              <Divider />

            </Stack>
          </TabPanel>

          {/* Display Tab */}
          <TabPanel value={tabValue} index={3}>
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
                  Theme Presets
                </Typography>

                <FormControl fullWidth>
                  <FormLabel id="theme-preset-label">Built-in Styles</FormLabel>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 1, mb: 2 }}
                  >
                    Choose how the app looks. Your selection is saved locally in this browser.
                  </Typography>

                  <RadioGroup
                    aria-labelledby="theme-preset-label"
                    name="theme-preset"
                    value={selectedThemeId}
                    onChange={(event) =>
                      setSelectedThemeId(event.target.value as ThemePresetId)
                    }
                  >
                    <Stack spacing={2}>
                      {availableThemes.map((themePreset) => {
                        const isSelected = themePreset.id === selectedThemeId;
                        const modeLabel =
                          themePreset.paletteMode === 'system'
                            ? 'Uses device theme'
                            : themePreset.paletteMode === 'dark'
                            ? 'Dark surfaces'
                            : 'Light surfaces';
                        const densityLabel =
                          themePreset.density === 'compact'
                            ? 'Compact density'
                            : 'Comfortable density';

                        return (
                          <Paper
                            key={themePreset.id}
                            variant="outlined"
                            sx={{
                              borderColor: isSelected ? 'primary.main' : 'divider',
                              bgcolor: isSelected
                                ? 'action.selected'
                                : 'background.paper',
                              transition: 'border-color 120ms ease, background-color 120ms ease',
                            }}
                          >
                            <FormControlLabel
                              value={themePreset.id}
                              control={<Radio />}
                              sx={{
                                alignItems: 'flex-start',
                                m: 0,
                                width: '100%',
                                px: 2,
                                py: 1.5,
                                '& .MuiFormControlLabel-label': {
                                  width: '100%',
                                },
                              }}
                              label={
                                <Box>
                                  <Stack
                                    direction={{ xs: 'column', sm: 'row' }}
                                    spacing={1}
                                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                                    sx={{ mb: 0.75 }}
                                  >
                                    <Typography variant="subtitle1">
                                      {themePreset.label}
                                    </Typography>
                                    <Chip size="small" label={modeLabel} />
                                    <Chip size="small" label={densityLabel} />
                                  </Stack>
                                  <Typography variant="body2" color="text.secondary">
                                    {themePreset.description}
                                  </Typography>
                                </Box>
                              }
                            />
                          </Paper>
                        );
                      })}
                    </Stack>
                  </RadioGroup>
                </FormControl>
              </Box>
            </Stack>
          </TabPanel>

          {/* Notifications Tab */}
          <TabPanel value={tabValue} index={4}>
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
