'use client';

import React, { useRef, useState } from 'react';
import {
  Box,
  CircularProgress,
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
  BugReport,
  Download,
  Upload,
  Tune,
} from '@mui/icons-material';
import type { TFunction } from 'i18next';
import { Trans, useTranslation } from 'react-i18next';
import StorageQuota from '@/components/common/Storage/StorageQuota';
import { CloudConflictDialog } from './CloudConflictDialog';
import { SecurityKeySlotsSection } from './SecurityKeySlotsSection';
import { CloudFilePickerDialog } from '@/components/setup/CloudFilePickerDialog';
import { EncryptionProgress } from '@/components/setup/EncryptionProgress';
import NotificationsSettingsTab from '@/components/notifications/NotificationsSettingsTab';
import DeveloperSettingsTab from '@/components/common/Console/DeveloperSettingsTab';
import PreferencesSettingsTab from './PreferencesSettingsTab';
import { useSettingsSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { ThemeDensityPreference, ThemePresetId, useThemePreferences } from '@/theme/theme';
import { isDebugMode } from '@/lib/debugMode';
import type { AutoSyncSnapshot } from '@/lib/cloudAutoSyncScheduler';
import type { CloudProvider, DatabaseSource } from '@/lib/databaseSourceStorage';

type SettingsT = TFunction<'settings'>;

/** Sync intervals in minutes; the label is resolved through `t` at render time. */
const SYNC_INTERVAL_OPTIONS: number[] = [15, 30, 60, 120, 240, 360, 720];

function syncIntervalLabel(minutes: number, t: SettingsT): string {
  return minutes < 60 ? t('syncInterval.minutes', { count: minutes }) : t('syncInterval.hours', { count: minutes / 60 });
}

function providerLabel(source: DatabaseSource, t: SettingsT): string {
  if (source === 'gdrive') return t('providers.gdrive');
  if (source === 'onedrive') return t('providers.onedrive');
  return t('providers.local');
}

function syncStateLabel(status: AutoSyncSnapshot, t: SettingsT): string {
  switch (status.state) {
    case 'idle':
      return t('syncState.synced');
    case 'pending':
      return t('syncState.pending');
    case 'syncing':
      return t('syncState.syncing');
    case 'paused-auth':
      return status.pauseReason === 'encryption-locked' ? t('syncState.locked') : t('syncState.needsReconnect');
    case 'paused-conflict':
      return t('syncState.conflict');
    case 'offline':
      return t('syncState.offline');
    case 'error':
      return status.lastError ? t('syncState.error', { error: status.lastError }) : t('syncState.syncError');
    case 'disabled':
    default:
      return t('syncState.disabled');
  }
}

type SettingsTabId =
  | 'preferences'
  | 'storage'
  | 'source'
  | 'security'
  | 'backup'
  | 'display'
  | 'notifications'
  | 'developer';

interface TabPanelProps {
  children?: React.ReactNode;
  index: SettingsTabId;
  value: SettingsTabId;
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
  const { t } = useTranslation(['settings', 'common']);
  const { dateTime } = useFormatters();
  const [tabValue, setTabValue] = useState<SettingsTabId>('preferences');
  const debugMode = isDebugMode();

  const {
    exportDatabase,
    reseedCommunityRules,
    getMerchantRuleCounts,
    getMerchantRulesSeedVersion,
    exportMerchantRules,
    importMerchantRules,
    connectCloudSource,
    migrateDatabaseToCloud,
    saveDatabaseToCurrentCloud,
    switchToLocalSource,
    changeMaster,
    getUnlockMethods,
    addUnlockSlot,
    removeUnlockSlot,
    renameUnlockSlot,
    users,
    lockDatabase,
    syncNow,
    setAutoSyncEnabled,
    setSyncIntervalMinutes,
    reconnectCloudSource,
    resolveCloudConflict,
    disconnectCloudProvider,
    closeCloudFilePicker,
    handleCloudFileSelected,
    disconnectWorker,
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
  const [importingRules, setImportingRules] = useState(false);
  const [rulesImportError, setRulesImportError] = useState<string | null>(null);
  const [rulesImportResult, setRulesImportResult] = useState<{
    imported: number;
    rejected: number;
  } | null>(null);
  const [migratingProvider, setMigratingProvider] = useState<CloudProvider | null>(null);
  const [conflictDialogOpen, setConflictDialogOpen] = useState(false);
  const [isLocking, setIsLocking] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const exportInFlightRef = useRef(false);
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

  const handleExportCustomRules = async () => {
    const file = await exportMerchantRules();
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `merchant-rules-custom-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportRulesFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImportingRules(true);
    setRulesImportError(null);
    setRulesImportResult(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const result = await importMerchantRules(parsed);
      setRulesImportResult(result);
      const counts = await getMerchantRuleCounts();
      setRuleCounts(counts);
    } catch (err) {
      setRulesImportError(err instanceof Error ? err.message : t('backup.importFailed'));
    } finally {
      setImportingRules(false);
    }
  };

  const {
    availableThemes,
    selectedThemeId,
    setSelectedThemeId,
    density,
    densityPreference,
    setDensityPreference,
  } = useThemePreferences();

  const handleExportData = async () => {
    // The ref closes the window between a click and the disabled re-render, so a
    // fast double click cannot start two exports (and download two archives).
    if (exportInFlightRef.current) {
      return;
    }
    exportInFlightRef.current = true;
    setIsExporting(true);
    try {
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
    } finally {
      exportInFlightRef.current = false;
      setIsExporting(false);
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

  const renderLinkedFile = (provider: CloudProvider, file: { fileName: string; modifiedAt?: string | null }) => (
    <Trans
      i18nKey={file.modifiedAt ? 'source.linkedFileWithDate' : 'source.linkedFile'}
      ns="settings"
      values={{ provider: providerLabel(provider, t), file: file.fileName, time: file.modifiedAt ? dateTime(file.modifiedAt) : '' }}
      components={{ strong: <strong /> }}
    />
  );

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Header */}
      <AppBar position="sticky" color="default" elevation={1}>
        <Toolbar>
          <IconButton
            edge="start"
            onClick={onClose}
            aria-label={t('page.close')}
            sx={{ mr: 2 }}
          >
            <ArrowBack />
          </IconButton>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            {t('page.title')}
          </Typography>
        </Toolbar>
      </AppBar>

      <Box sx={{ maxWidth: 1200, mx: 'auto', p: { xs: 1, sm: 3 } }}>
        <Paper sx={{ width: '100%' }}>
          <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tabs
              value={tabValue}
              onChange={(_, newValue) => setTabValue(newValue as SettingsTabId)}
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
              <Tab icon={<Tune />} label={t('tabs.preferences')} value="preferences" data-testid="settings-tab-preferences" />
              <Tab icon={<Storage />} label={t('tabs.storage')} value="storage" />
              <Tab icon={<CloudSync />} label={t('tabs.source')} value="source" />
              <Tab icon={<Security />} label={t('tabs.security')} value="security" />
              <Tab icon={<Backup />} label={t('tabs.backup')} value="backup" />
              <Tab icon={<Palette />} label={t('tabs.display')} value="display" />
              <Tab icon={<Notifications />} label={t('tabs.notifications')} value="notifications" />
              {debugMode && <Tab icon={<BugReport />} label={t('tabs.developer')} value="developer" />}
            </Tabs>
          </Box>

          {/* Preferences Tab — language, default currency, exchange rates */}
          <TabPanel value={tabValue} index="preferences">
            <PreferencesSettingsTab />
          </TabPanel>

          {/* Storage Tab */}
          <TabPanel value={tabValue} index="storage">
            <Stack spacing={3}>
              <Box>
                <Typography variant="h5" gutterBottom>
                  {t('storage.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {t('storage.description')}
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  {t('storage.currentUsage')}
                </Typography>
                <Box sx={{ maxWidth: 600 }}>
                  <StorageQuota variant="card" />
                </Box>
              </Box>

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  {t('storage.infoTitle')}
                </Typography>
                <Alert severity="info" sx={{ mb: 2 }}>
                  {t('storage.infoAlert')}
                </Alert>
                <Stack spacing={2}>
                  <Typography variant="body2">
                    <Trans i18nKey="storage.localStorage" ns="settings" components={{ strong: <strong /> }} />
                  </Typography>
                  <Typography variant="body2">
                    <Trans i18nKey="storage.browserLimits" ns="settings" components={{ strong: <strong /> }} />
                  </Typography>
                  <Typography variant="body2">
                    <Trans i18nKey="storage.backupRecommended" ns="settings" components={{ strong: <strong /> }} />
                  </Typography>
                </Stack>
              </Box>
            </Stack>
          </TabPanel>

          {/* Database Source Tab */}
          <TabPanel value={tabValue} index="source">
            <Stack spacing={3}>
              <Box>
                <Typography variant="h5" gutterBottom>
                  {t('source.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {t('source.description')}
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  {t('source.syncStatus')}
                </Typography>
                <Stack spacing={1.5}>
                  <Typography variant="body2">
                    <Trans
                      i18nKey="source.activeSource"
                      ns="settings"
                      values={{ provider: providerLabel(databaseSource, t) }}
                      components={{ strong: <strong /> }}
                    />
                  </Typography>
                  {databaseSource !== 'local' && (
                    <>
                      <Typography variant="body2">
                        <Trans
                          i18nKey="source.status"
                          ns="settings"
                          values={{ status: syncStateLabel(syncStatus, t) }}
                          components={{ strong: <strong /> }}
                        />
                      </Typography>
                      <Typography variant="body2">
                        <Trans
                          i18nKey="source.lastSynced"
                          ns="settings"
                          values={{ time: syncStatus.lastSyncAt ? dateTime(syncStatus.lastSyncAt) : t('source.notSyncedYet') }}
                          components={{ strong: <strong /> }}
                        />
                      </Typography>
                      {syncStatus.pendingSince && (
                        <Typography variant="body2">
                          <Trans
                            i18nKey="source.unsyncedSince"
                            ns="settings"
                            values={{ time: dateTime(syncStatus.pendingSince) }}
                            components={{ strong: <strong /> }}
                          />
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
                      {t('source.resolve')}
                    </Button>
                  }
                >
                  {t('source.conflictAlert')}
                </Alert>
              )}

              {syncStatus.state === 'paused-auth' && (
                <Alert
                  severity="warning"
                  action={
                    <Button color="inherit" size="small" onClick={() => void handleReconnect()}>
                      {t('source.reconnect')}
                    </Button>
                  }
                >
                  {syncStatus.pauseReason === 'encryption-locked'
                    ? t('source.enterPassword')
                    : t('source.reconnectTo', { provider: providerLabel(databaseSource, t) })}
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
                  label={t('source.autoSync')}
                />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {t('source.autoSyncHelp')}
                </Typography>

                <FormControl size="small" sx={{ mt: 2, minWidth: 200 }}>
                  <InputLabel id="sync-frequency-label">{t('source.syncFrequency')}</InputLabel>
                  <Select
                    labelId="sync-frequency-label"
                    label={t('source.syncFrequency')}
                    value={databaseSourceState.syncIntervalMinutes}
                    onChange={handleSyncIntervalChange}
                    disabled={databaseSource === 'local'}
                  >
                    {SYNC_INTERVAL_OPTIONS.map((minutes) => (
                      <MenuItem key={minutes} value={minutes}>
                        {syncIntervalLabel(minutes, t)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {t('source.syncFrequencyHelp')}
                </Typography>
              </Box>

              {(linkedGoogleFile || linkedOneDriveFile) && (
                <>
                  <Divider />
                  <Box>
                    <Typography variant="h6" gutterBottom>
                      {t('source.linkedFiles')}
                    </Typography>
                    <Stack spacing={1.5}>
                      {linkedGoogleFile && (
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                          <Typography variant="body2">{renderLinkedFile('gdrive', linkedGoogleFile)}</Typography>
                          <Button
                            size="small"
                            color="inherit"
                            startIcon={<LinkOff />}
                            onClick={() => handleDisconnect('gdrive')}
                          >
                            {t('source.disconnect')}
                          </Button>
                        </Stack>
                      )}
                      {linkedOneDriveFile && (
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                          <Typography variant="body2">{renderLinkedFile('onedrive', linkedOneDriveFile)}</Typography>
                          <Button
                            size="small"
                            color="inherit"
                            startIcon={<LinkOff />}
                            onClick={() => handleDisconnect('onedrive')}
                          >
                            {t('source.disconnect')}
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
                  {t('source.sourceActions')}
                </Typography>

                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  {t('source.connect')}
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
                    {t('source.openFromGoogleDrive')}
                  </Button>
                  <Button
                    variant="contained"
                    startIcon={<CloudSync />}
                    onClick={() => {
                      void handleConnectCloudSource('onedrive');
                    }}
                  >
                    {t('source.openFromOneDrive')}
                  </Button>
                </Box>

                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  {t('source.convert')}
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
                    {migratingProvider === 'gdrive' ? t('source.converting') : t('source.convertToGoogleDrive')}
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<SwapHoriz />}
                    onClick={() => {
                      void handleMigrateToCloud('onedrive');
                    }}
                    disabled={!isDatabaseLoaded || migratingProvider !== null}
                  >
                    {migratingProvider === 'onedrive' ? t('source.converting') : t('source.convertToOneDrive')}
                  </Button>
                </Box>

                <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                  {t('source.sync')}
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
                      ? t('source.syncing')
                      : syncStatus.state === 'paused-auth'
                        ? t('source.reconnect')
                        : t('source.syncNow')}
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<Save />}
                    onClick={() => {
                      void saveDatabaseToCurrentCloud();
                    }}
                    disabled={!isDatabaseLoaded || databaseSource === 'local'}
                  >
                    {t('source.saveCloudCopy')}
                  </Button>
                </Box>

                <Divider sx={{ my: 2 }} />

                <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <Button
                    variant="text"
                    onClick={switchToLocalSource}
                    disabled={databaseSource === 'local'}
                  >
                    {t('source.switchToLocal')}
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
          <TabPanel value={tabValue} index="security">
            <Stack spacing={3}>
              <Box>
                <Typography variant="h5" gutterBottom>
                  {t('security.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {t('security.description')}
                </Typography>
              </Box>

              <Divider />

              <SecurityKeySlotsSection
                getUnlockMethods={getUnlockMethods}
                changeMaster={changeMaster}
                addUnlockSlot={addUnlockSlot}
                removeUnlockSlot={removeUnlockSlot}
                renameUnlockSlot={renameUnlockSlot}
                userName={users.find((user) => user.is_primary)?.display_name ?? users[0]?.display_name ?? 'Budget Tracker'}
                databaseSource={databaseSource}
                syncStage={syncStage}
              />

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  {t('security.lockTitle')}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t('security.lockHelp')}
                </Typography>
                <Button
                  variant="outlined"
                  color="warning"
                  startIcon={isLocking ? undefined : <Lock />}
                  onClick={() => void handleLockDatabase()}
                  disabled={!isDatabaseLoaded || isLocking}
                >
                  {isLocking ? t('security.locking') : t('security.lock')}
                </Button>
              </Box>
            </Stack>

            <Dialog open={lockConfirmOpen} onClose={() => setLockConfirmOpen(false)}>
              <DialogTitle>{t('security.lockDialogTitle')}</DialogTitle>
              <DialogContent>
                <Typography variant="body2">
                  {lockSyncError
                    ? t('security.lockDialogBodyWithError', { error: lockSyncError })
                    : t('security.lockDialogBody')}
                </Typography>
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setLockConfirmOpen(false)}>{t('common:actions.cancel')}</Button>
                <Button
                  variant="contained"
                  color="warning"
                  onClick={() => void handleLockDatabase({ skipSync: true })}
                >
                  {t('security.lockAnyway')}
                </Button>
              </DialogActions>
            </Dialog>
          </TabPanel>

          {/* Data & Backup Tab */}
          <TabPanel value={tabValue} index="backup">
            <Stack spacing={3}>
              <Box>
                <Typography variant="h5" gutterBottom>
                  {t('backup.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {t('backup.description')}
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  {t('backup.exportTitle')}
                </Typography>
                <Stack spacing={2}>
                  <Button
                    variant="contained"
                    startIcon={isExporting ? <CircularProgress size={18} color="inherit" /> : <Backup />}
                    onClick={handleExportData}
                    disabled={!isDatabaseLoaded || isExporting}
                    aria-busy={isExporting}
                  >
                    {isExporting ? t('backup.exporting') : t('backup.exportDatabase')}
                  </Button>
                  <Typography variant="body2" color="text.secondary">
                    {t('backup.exportHelp')}
                  </Typography>
                </Stack>
              </Box>

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  {t('backup.merchantRules')}
                </Typography>
                <Stack spacing={2}>
                  <Typography variant="body2" color="text.secondary">
                    {t('backup.merchantRulesHelp')}
                    {ruleCounts && ` ${t('backup.ruleCounts', { community: ruleCounts.community, user: ruleCounts.user })}`}
                    {rulesSeedVersion != null && rulesSeedVersion > 0 && ` ${t('backup.seedVersion', { version: rulesSeedVersion })}`}
                  </Typography>
                  <Box>
                    <Button
                      variant="outlined"
                      onClick={handleReseedCommunityRules}
                      disabled={!isDatabaseLoaded || reseeding}
                    >
                      {reseeding ? t('backup.reapplying') : t('backup.reapply')}
                    </Button>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {t('backup.reapplyHelp')}
                  </Typography>

                  <Divider />

                  <Typography variant="subtitle2">{t('backup.customRules')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('backup.customRulesHelp')}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                    <Button
                      variant="outlined"
                      startIcon={<Download />}
                      onClick={handleExportCustomRules}
                      disabled={!isDatabaseLoaded || !ruleCounts?.user}
                    >
                      {t('backup.exportCustomRules')}
                    </Button>
                    <input
                      accept="application/json"
                      style={{ display: 'none' }}
                      id="import-custom-rules-input"
                      type="file"
                      onChange={handleImportRulesFile}
                    />
                    <label htmlFor="import-custom-rules-input">
                      <Button
                        variant="outlined"
                        component="span"
                        startIcon={<Upload />}
                        disabled={!isDatabaseLoaded || importingRules}
                      >
                        {importingRules ? t('backup.importing') : t('backup.importCustomRules')}
                      </Button>
                    </label>
                  </Box>
                  {rulesImportError && <Alert severity="error">{rulesImportError}</Alert>}
                  {rulesImportResult && (
                    <Alert severity={rulesImportResult.rejected > 0 ? 'warning' : 'success'}>
                      {t('backup.imported', { count: rulesImportResult.imported })}
                      {rulesImportResult.rejected > 0 && ` ${t('backup.skipped', { count: rulesImportResult.rejected })}`}
                    </Alert>
                  )}
                </Stack>
              </Box>

              <Divider />

            </Stack>
          </TabPanel>

          {/* Display Tab */}
          <TabPanel value={tabValue} index="display">
            <Stack spacing={3}>
              <Box>
                <Typography variant="h5" gutterBottom>
                  {t('display.title')}
                </Typography>
                <Typography variant="body2" color="text.secondary" paragraph>
                  {t('display.description')}
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  {t('display.themePresets')}
                </Typography>

                <FormControl fullWidth>
                  <FormLabel id="theme-preset-label">{t('display.builtInStyles')}</FormLabel>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ mt: 1, mb: 2 }}
                  >
                    {t('display.presetsHelp')}
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
                            ? t('display.modeSystem')
                            : themePreset.paletteMode === 'dark'
                            ? t('display.modeDark')
                            : t('display.modeLight');
                        const densityLabel =
                          themePreset.density === 'compact'
                            ? t('display.densityCompact')
                            : t('display.densityComfortable');
                        // Preset text lives in the frozen theme module; translate by id, falling back to its English.
                        const presetLabel = t(`display.presets.${themePreset.id}.label`, { defaultValue: themePreset.label });
                        const presetDescription = t(`display.presets.${themePreset.id}.description`, { defaultValue: themePreset.description });

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
                                      {presetLabel}
                                    </Typography>
                                    <Chip size="small" label={modeLabel} />
                                    <Chip size="small" label={densityLabel} />
                                  </Stack>
                                  <Typography variant="body2" color="text.secondary">
                                    {presetDescription}
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

              <Divider />

              <Box>
                <Typography variant="h6" gutterBottom>
                  {t('display.density')}
                </Typography>
                <FormControl>
                  <FormLabel id="theme-density-label">{t('display.spacing')}</FormLabel>
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 1 }}>
                    {t('display.densityHelp', { density: t(`display.densityValues.${density}`) })}
                  </Typography>
                  <RadioGroup
                    row
                    aria-labelledby="theme-density-label"
                    name="theme-density"
                    value={densityPreference}
                    onChange={(event) =>
                      setDensityPreference(event.target.value as ThemeDensityPreference)
                    }
                  >
                    <FormControlLabel value="auto" control={<Radio />} label={t('display.densityAuto')} />
                    <FormControlLabel value="compact" control={<Radio />} label={t('display.densityCompactOption')} />
                    <FormControlLabel value="comfortable" control={<Radio />} label={t('display.densityComfortableOption')} />
                  </RadioGroup>
                </FormControl>
              </Box>
            </Stack>
          </TabPanel>

          {/* Notifications Tab — body owned by the notifications feature */}
          <TabPanel value={tabValue} index="notifications">
            <NotificationsSettingsTab />
          </TabPanel>

          {/* Developer Tab — only visible with ?debug; body owned by the logging feature */}
          {debugMode && (
            <TabPanel value={tabValue} index="developer">
              <DeveloperSettingsTab />
            </TabPanel>
          )}
        </Paper>
      </Box>
    </Box>
  );
};

export default SettingsPage;
