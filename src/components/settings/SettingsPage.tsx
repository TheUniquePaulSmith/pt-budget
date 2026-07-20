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
  InputLabel,
  MenuItem,
  Select,
  type SelectChangeEvent,
  Radio,
  RadioGroup,
  Button,
  Alert,
  IconButton,
  AppBar,
  Toolbar,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  Storage,
  Backup,
  CloudSync,
  Notifications,
  Palette,
  Security,
  Lock,
  ArrowBack,
  Save,
  SwapHoriz,
  Refresh,
  LinkOff,
} from '@mui/icons-material';
import StorageQuota from '@/components/common/Storage/StorageQuota';
import { CloudConflictDialog } from './CloudConflictDialog';
import { ChangePasswordSection } from './ChangePasswordSection';
import { CloudFilePickerDialog } from '@/components/setup/CloudFilePickerDialog';
import { EncryptionProgress } from '@/components/setup/EncryptionProgress';
import { useSettingsSlice } from '@/contexts/useDatabaseSlices';
import { ThemePresetId, useThemePreferences } from '@/theme/theme';
import type { AutoSyncSnapshot } from '@/lib/cloudAutoSyncScheduler';
import type { CloudProvider, DatabaseSource } from '@/lib/databaseSourceStorage';

const SYNC_INTERVAL_OPTIONS: Array<{ minutes: number; label: string }> = [
  { minutes: 15, label: '15 minutes' },
  { minutes: 30, label: '30 minutes' },
  { minutes: 60, label: '1 hour' },
  { minutes: 120, label: '2 hours' },
  { minutes: 240, label: '4 hours' },
  { minutes: 360, label: '6 hours' },
  { minutes: 720, label: '12 hours' },
];

function providerLabel(source: DatabaseSource): string {
  if (source === 'gdrive') return 'Google Drive';
  if (source === 'onedrive') return 'OneDrive';
  return 'Local';
}

function syncStateLabel(status: AutoSyncSnapshot): string {
  switch (status.state) {
    case 'idle':
      return 'Synced';
    case 'pending':
      return 'Pending changes';
    case 'syncing':
      return 'Syncing…';
    case 'paused-auth':
      return status.pauseReason === 'encryption-locked'
        ? 'Locked — needs password'
        : 'Needs reconnect';
    case 'paused-conflict':
      return 'Conflict — needs resolution';
    case 'offline':
      return 'Offline';
    case 'error':
      return status.lastError ? `Error: ${status.lastError}` : 'Sync error';
    case 'disabled':
    default:
      return 'Disabled';
  }
}

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
    reseedCommunityRules,
    getMerchantRuleCounts,
    getMerchantRulesSeedVersion,
    connectCloudSource,
    migrateDatabaseToCloud,
    saveDatabaseToCurrentCloud,
    switchToLocalSource,
    changePassword,
    lockDatabase,
    syncNow,
    setAutoSyncEnabled,
    setSyncIntervalMinutes,
    reconnectCloudSource,
    resolveCloudConflict,
    disconnectCloudProvider,
    closeCloudFilePicker,
    handleCloudFileSelected,
    isDatabaseLoaded,
    databaseSource,
    databaseSourceState,
    syncStatus,
    syncStage,
    cloudFilePicker,
  } = useSettingsSlice();
  const [ruleCounts, setRuleCounts] = useState<{ community: number; user: number } | null>(null);
  const [rulesSeedVersion, setRulesSeedVersion] = useState<number | null>(null);
  const [reseeding, setReseeding] = useState(false);
  const [migratingProvider, setMigratingProvider] = useState<CloudProvider | null>(null);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);
  const [lockSyncError, setLockSyncError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!isDatabaseLoaded) return;
    getMerchantRuleCounts().then(setRuleCounts).catch(() => setRuleCounts(null));
    getMerchantRulesSeedVersion().then(setRulesSeedVersion).catch(() => setRulesSeedVersion(null));
  }, [isDatabaseLoaded, getMerchantRuleCounts, getMerchantRulesSeedVersion]);

  const handleReseedCommunityRules = async () => {
    setReseeding(true);
    try {
      await reseedCommunityRules();
      const counts = await getMerchantRuleCounts();
      setRuleCounts(counts);
      const version = await getMerchantRulesSeedVersion();
      setRulesSeedVersion(version);
    } catch (err) {
      console.error('Failed to re-apply community merchant rules:', err);
    } finally {
      setReseeding(false);
    }
  };
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
    setMigratingProvider(provider);
    try {
      await migrateDatabaseToCloud(provider);
    } catch {
      // Error is surfaced through the provider state.
    } finally {
      setMigratingProvider(null);
    }
  };

  const handleReconnect = async () => {
    try {
      await reconnectCloudSource();
    } catch {
      // Error is surfaced through the provider state.
    }
  };

  const handleDisconnect = (provider: CloudProvider) => {
    disconnectCloudProvider(provider);
  };

  const handleResolveConflict = async (choice: Parameters<typeof resolveCloudConflict>[0]) => {
    await resolveCloudConflict(choice);
    setConflictDialogOpen(false);
  };

  const handleSyncIntervalChange = (event: SelectChangeEvent<number>) => {
    setSyncIntervalMinutes(Number(event.target.value));
  };

  const handleLockDatabase = async (options?: { skipSync?: boolean }) => {
    setIsLocking(true);
    try {
      const result = await lockDatabase(options);
      if (!result.locked && result.syncError) {
        setLockSyncError(result.syncError);
        setLockConfirmOpen(true);
      } else {
        setLockConfirmOpen(false);
        setLockSyncError(null);
      }
    } finally {
      setIsLocking(false);
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
            aria-label="Close settings"
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
              <Tab icon={<Security />} label="Security" />
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

          {/* Database Source Tab */}
          <TabPanel value={tabValue} index={1}>
            <Stack spacing={3}>
              <Box>
                <Typography variant="h5" gutterBottom>
                  Database Source
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  Choose whether the working copy is local, Google Drive, or OneDrive. Cloud
                  sources sync automatically about 15 seconds after changes settle, or on demand.
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  Sync Status
                </Typography>
                <Stack spacing={1.5}>
                  <Typography variant="body2">
                    <strong>Active source:</strong> {providerLabel(databaseSource)}
                  </Typography>
                  {databaseSource !== 'local' && (
                    <>
                      <Typography variant="body2">
                        <strong>Status:</strong> {syncStateLabel(syncStatus)}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Last synced:</strong>{' '}
                        {syncStatus.lastSyncAt
                          ? new Date(syncStatus.lastSyncAt).toLocaleString()
                          : 'Not synced yet'}
                      </Typography>
                      {syncStatus.pendingSince && (
                        <Typography variant="body2">
                          <strong>Unsynced changes since:</strong>{' '}
                          {new Date(syncStatus.pendingSince).toLocaleString()}
                        </Typography>
                      )}
                    </>
                  )}
                </Stack>

                {syncStage && (
                  <Box sx={{ mt: 2 }}>
                    <EncryptionProgress stage={syncStage} variant="inline" />
                  </Box>
                )}
              </Box>

              {databaseSourceState.conflict && (
                <Alert
                  severity="warning"
                  action={
                    <Button color="inherit" size="small" onClick={() => setConflictDialogOpen(true)}>
                      Resolve…
                    </Button>
                  }
                >
                  The cloud copy changed while this device also had unsynced changes.
                </Alert>
              )}

              {syncStatus.state === 'paused-auth' && (
                <Alert
                  severity="warning"
                  action={
                    <Button color="inherit" size="small" onClick={() => void handleReconnect()}>
                      Reconnect
                    </Button>
                  }
                >
                  {syncStatus.pauseReason === 'encryption-locked'
                    ? 'Enter your database password to resume cloud sync.'
                    : `Reconnect to ${providerLabel(databaseSource)} to resume syncing.`}
                </Alert>
              )}

              {databaseSourceState.lastSyncError && (
                <Alert severity="error">{databaseSourceState.lastSyncError}</Alert>
              )}

              <Divider />

              <Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={databaseSourceState.autoSyncEnabled}
                      onChange={(e) => setAutoSyncEnabled(e.target.checked)}
                      disabled={databaseSource === 'local'}
                    />
                  }
                  label="Automatically sync changes"
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  When enabled, edits upload automatically shortly after you stop editing. Turn
                  this off to only sync when you click &quot;Sync Now&quot;.
                </Typography>

                <FormControl size="small" sx={{ mt: 2, minWidth: 200 }}>
                  <InputLabel id="sync-frequency-label">Sync frequency</InputLabel>
                  <Select
                    labelId="sync-frequency-label"
                    label="Sync frequency"
                    value={databaseSourceState.syncIntervalMinutes}
                    onChange={handleSyncIntervalChange}
                    disabled={databaseSource === 'local'}
                  >
                    {SYNC_INTERVAL_OPTIONS.map((option) => (
                      <MenuItem key={option.minutes} value={option.minutes}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  How long to wait after a local change before syncing automatically.
                </Typography>
              </Box>

              {(linkedGoogleFile || linkedOneDriveFile) && (
                <>
                  <Divider />
                  <Box>
                    <Typography variant="h6" gutterBottom>
                      Linked Cloud Files
                    </Typography>
                    <Stack spacing={1.5}>
                      {linkedGoogleFile && (
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                          <Typography variant="body2">
                            <strong>Google Drive:</strong> {linkedGoogleFile.fileName}
                            {linkedGoogleFile.modifiedAt
                              ? ` (${new Date(linkedGoogleFile.modifiedAt).toLocaleString()})`
                              : ''}
                          </Typography>
                          <Button
                            size="small"
                            color="inherit"
                            startIcon={<LinkOff />}
                            onClick={() => handleDisconnect('gdrive')}
                          >
                            Disconnect
                          </Button>
                        </Stack>
                      )}
                      {linkedOneDriveFile && (
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                          <Typography variant="body2">
                            <strong>OneDrive:</strong> {linkedOneDriveFile.fileName}
                            {linkedOneDriveFile.modifiedAt
                              ? ` (${new Date(linkedOneDriveFile.modifiedAt).toLocaleString()})`
                              : ''}
                          </Typography>
                          <Button
                            size="small"
                            color="inherit"
                            startIcon={<LinkOff />}
                            onClick={() => handleDisconnect('onedrive')}
                          >
                            Disconnect
                          </Button>
                        </Stack>
                      )}
                    </Stack>
                  </Box>
                </>
              )}

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  Source Actions
                </Typography>

                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Connect
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 1.5,
                    mb: 2,
                  }}
                >
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
                </Box>

                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Convert
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 1.5,
                    mb: 2,
                  }}
                >
                  <Button
                    variant="outlined"
                    startIcon={<SwapHoriz />}
                    onClick={() => {
                      void handleMigrateToCloud('gdrive');
                    }}
                    disabled={!isDatabaseLoaded || migratingProvider !== null}
                  >
                    {migratingProvider === 'gdrive' ? 'Converting…' : 'Convert Local to Google Drive'}
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<SwapHoriz />}
                    onClick={() => {
                      void handleMigrateToCloud('onedrive');
                    }}
                    disabled={!isDatabaseLoaded || migratingProvider !== null}
                  >
                    {migratingProvider === 'onedrive' ? 'Converting…' : 'Convert Local to OneDrive'}
                  </Button>
                </Box>

                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  Sync
                </Typography>
                <Box
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                    gap: 1.5,
                  }}
                >
                  <Button
                    variant="outlined"
                    startIcon={<Refresh />}
                    onClick={() => {
                      if (syncStatus.state === 'paused-auth') {
                        void handleReconnect();
                      } else {
                        void syncNow();
                      }
                    }}
                    disabled={
                      !isDatabaseLoaded || databaseSource === 'local' || syncStatus.state === 'syncing'
                    }
                  >
                    {syncStatus.state === 'syncing'
                      ? 'Syncing…'
                      : syncStatus.state === 'paused-auth'
                        ? 'Reconnect'
                        : 'Sync Now'}
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
                </Box>

                <Divider sx={{ my: 2 }} />

                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="text"
                    onClick={switchToLocalSource}
                    disabled={databaseSource === 'local'}
                  >
                    Switch Back to Local
                  </Button>
                </Box>
              </Box>
            </Stack>

            <CloudFilePickerDialog
              open={cloudFilePicker.isOpen}
              provider={cloudFilePicker.provider}
              files={cloudFilePicker.files}
              isLoading={cloudFilePicker.isLoading}
              error={cloudFilePicker.error}
              onSelect={handleCloudFileSelected}
              onClose={closeCloudFilePicker}
            />
            <CloudConflictDialog
              open={conflictDialogOpen}
              conflict={databaseSourceState.conflict}
              pendingChangesSince={databaseSourceState.pendingChangesSince}
              onResolve={handleResolveConflict}
              onClose={() => setConflictDialogOpen(false)}
            />
          </TabPanel>

          {/* Security Tab */}
          <TabPanel value={tabValue} index={2}>
            <Stack spacing={3}>
              <Box>
                <Typography variant="h5" gutterBottom>
                  Security
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  Manage the password that protects your exports and cloud backups.
                </Typography>
              </Box>

              <Divider />

              <ChangePasswordSection
                changePassword={changePassword}
                databaseSource={databaseSource}
                syncStage={syncStage}
              />

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  Lock Database
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  Syncs your database to the cloud (if connected), then locks it — you&apos;ll need
                  your password to continue.
                </Typography>
                <Button
                  variant="outlined"
                  color="warning"
                  startIcon={isLocking ? undefined : <Lock />}
                  onClick={() => void handleLockDatabase()}
                  disabled={!isDatabaseLoaded || isLocking}
                >
                  {isLocking ? 'Locking…' : 'Lock Database'}
                </Button>
              </Box>
            </Stack>

            <Dialog open={lockConfirmOpen} onClose={() => setLockConfirmOpen(false)}>
              <DialogTitle>Lock without syncing?</DialogTitle>
              <DialogContent>
                <Typography variant="body2">
                  Your database couldn&apos;t be fully synced{lockSyncError ? ` (${lockSyncError})` : ''}.
                  Locking now leaves those changes unsynced until you unlock and reconnect. Lock
                  anyway?
                </Typography>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setLockConfirmOpen(false)}>Cancel</Button>
                <Button
                  variant="contained"
                  color="warning"
                  onClick={() => void handleLockDatabase({ skipSync: true })}
                >
                  Lock Anyway
                </Button>
              </DialogActions>
            </Dialog>
          </TabPanel>

          {/* Data & Backup Tab */}
          <TabPanel value={tabValue} index={3}>
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

              <Box>
                <Typography variant="h6" gutterBottom>
                  Merchant Rules
                </Typography>
                <Stack spacing={2}>
                  <Typography variant="body2" color="text.secondary">
                    Merchant rules match bank charge descriptions to merchants and subscriptions on
                    the Subscriptions page.
                    {ruleCounts &&
                      ` Currently ${ruleCounts.community} community rules and ${ruleCounts.user} of your own.`}
                    {rulesSeedVersion != null && rulesSeedVersion > 0 &&
                      ` Community list version: ${rulesSeedVersion}.`}
                  </Typography>
                  <Box>
                    <Button
                      variant="outlined"
                      onClick={handleReseedCommunityRules}
                      disabled={!isDatabaseLoaded || reseeding}
                    >
                      {reseeding ? 'Re-applying…' : 'Re-apply Community Rules'}
                    </Button>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    Restores the bundled community rule list. Rules you have edited or disabled are
                    left untouched.
                  </Typography>
                </Stack>
              </Box>

              <Divider />

            </Stack>
          </TabPanel>

          {/* Display Tab */}
          <TabPanel value={tabValue} index={4}>
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
          <TabPanel value={tabValue} index={5}>
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
