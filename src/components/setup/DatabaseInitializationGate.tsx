'use client';

import { useCallback } from 'react';

import { CloudSync, CreateNewFolder, Upload } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  LinearProgress,
  Paper,
  Tooltip,
  Typography,
} from '@mui/material';

import AppLogo from '@/components/common/AppLogo';
import LanguageMenu from '@/components/common/LanguageMenu';
import { useFormatters } from '@/contexts/useFormatters';
import { PasswordSetup } from './PasswordSetup';
import { PreferencesSetup } from './PreferencesSetup';
import { InitialAccount } from './InitialAccount';
import { UnlockScreen } from './UnlockScreen';
import { LegacyDatabaseNotice } from './LegacyDatabaseNotice';
import { StorageChoice } from './StorageChoice';
import { CloudFilePickerDialog } from './CloudFilePickerDialog';
import { EncryptionProgress } from './EncryptionProgress';
import { TestBrowser, type TestResults } from './TestBrowser';
import type {
  CloudFilePickerState,
  InitializationState,
} from '../../contexts/useDatabaseInitialization';
import type { SampleDataImportProgress } from '../../lib/sampleDataService';
import { createCloudProviderClient } from '@/lib/cloudProviderClients';
import type { SyncStage } from '@/lib/cloudSyncService';
import type { CloudLinkedFile, CloudProvider, DatabaseSource } from '@/lib/databaseSourceStorage';
import type { MasterSecret, MasterSlotType, UnlockMethod, UnlockMethods } from '@/lib/encryptionTypes';
import type { Account } from '@/types/database';

interface DatabaseInitializationGateProps {
  databaseSource: DatabaseSource;
  initializationState: InitializationState;
  isLoading: boolean;
  error: string | null;
  sampleDataImportProgress: SampleDataImportProgress | null;
  storageMigrationStage: SyncStage | null;
  cloudFilePicker: CloudFilePickerState;
  onBrowserTestComplete: (
    isCompatible: boolean,
    results: TestResults
  ) => Promise<void>;
  onCreateOrOpenDatabase: (isNew: boolean) => Promise<void>;
  onLoadDatabaseFromFile: (file: File) => Promise<void>;
  onConnectCloudSource: (provider?: CloudProvider) => Promise<void>;
  onCloseCloudFilePicker: () => void;
  onCloudFileSelected: (file: CloudLinkedFile) => Promise<void>;
  onSwitchToLocalSource: () => void;
  onCancelSampleDataImport: () => void;
  /** Called when the user confirms the new database's master secret (password or recovery phrase) on the setup screen. */
  onPasswordSetupConfirmed: (master: MasterSecret, primaryUserName: string) => Promise<void>;
  /** Called when the user confirms the preferences step (default currency). */
  onPreferencesConfirmed: (defaultCurrency: string) => Promise<void>;
  /** Skips the preferences step (keeps English / USD) and continues setup. */
  onSkipPreferences: () => Promise<void>;
  /** The default currency chosen on the preferences step; the first account starts with it. */
  setupDefaultCurrency: string;
  /** Called when the user confirms their first account on the initial-account screen. */
  onInitialAccountConfirmed: (
    name: string,
    type: Account['type'],
    lastFour: string,
    currency: string
  ) => Promise<void>;
  /** Skips the initial-account screen and continues setup. */
  onSkipInitialAccount: () => Promise<void>;
  /** Called when the user enters the master secret of a loaded archive to decrypt it. */
  onPasswordEntrySubmitted: (master: MasterSecret) => Promise<void>;
  /** Cancels the pending password-entry flow. */
  onCancelPasswordEntry: () => void;
  /** Called from the storage-choice screen right after password setup. */
  onStorageChoiceSelected: (choice: 'local' | CloudProvider) => Promise<void>;
  /**
   * Called from the needs-unlock screen — both at first load of a returning
   * device and after Settings → Lock Database.
   */
  onUnlockSubmitted: (method: UnlockMethod) => Promise<void>;
  /**
   * Debug-only (`?debug`) — when set, the unlock screen shows a "Reset App"
   * button. It receives the master secret the user typed to confirm, and
   * rejects (keeping the app untouched) when it is wrong.
   */
  onResetApp?: (master: MasterSecret) => void | Promise<void>;
  /** The key slots on this device, read before the unlock screen is shown (null while unknown). */
  unlockMethods: UnlockMethods | null;
  /** While an archive waits for its secret: which kind the archive needs. */
  pendingArchiveMasterType: MasterSlotType | null;
  /** Wipes a pre-key-slot (v1) database this version cannot open. */
  onLegacyReset: () => Promise<void>;
}

const centeredBoxSx = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  p: 2,
} as const;

/** Language picker pinned to the top-right of the screens shown before a database exists. */
function LanguageMenuCorner() {
  return (
    <Box sx={{ position: 'fixed', top: 8, right: 8, zIndex: (theme) => theme.zIndex.appBar }}>
      <LanguageMenu />
    </Box>
  );
}

export function DatabaseInitializationGate({
  databaseSource,
  initializationState,
  isLoading,
  error,
  sampleDataImportProgress,
  storageMigrationStage,
  cloudFilePicker,
  onBrowserTestComplete,
  onCreateOrOpenDatabase,
  onLoadDatabaseFromFile,
  onConnectCloudSource,
  onCloseCloudFilePicker,
  onCloudFileSelected,
  onSwitchToLocalSource,
  onCancelSampleDataImport,
  onPasswordSetupConfirmed,
  onPreferencesConfirmed,
  onSkipPreferences,
  setupDefaultCurrency,
  onInitialAccountConfirmed,
  onSkipInitialAccount,
  onPasswordEntrySubmitted,
  onCancelPasswordEntry,
  onStorageChoiceSelected,
  onUnlockSubmitted,
  onResetApp,
  unlockMethods,
  pendingArchiveMasterType,
  onLegacyReset,
}: DatabaseInitializationGateProps) {
  const { t } = useTranslation(['setup', 'common']);
  const { number } = useFormatters();

  const handleCreateNew = useCallback(async () => {
    try {
      await onCreateOrOpenDatabase(true);
    } catch {
      // Error is handled by the initialization hook.
    }
  }, [onCreateOrOpenDatabase]);

  const handleLoadFromFile = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';

    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) {
        return;
      }

      try {
        await onLoadDatabaseFromFile(file);
      } catch {
        // Error is handled by the initialization hook.
      }
    };

    input.click();
  }, [onLoadDatabaseFromFile]);

  const handleOpenFromCloud = useCallback(
    (provider: CloudProvider) => {
      void onConnectCloudSource(provider).catch(() => {
        // Error is handled by the initialization hook.
      });
    },
    [onConnectCloudSource]
  );

  const sampleDataProgressValue =
    sampleDataImportProgress?.expectedRows && sampleDataImportProgress.expectedRows > 0
      ? Math.min(
          100,
          Math.round(
            (sampleDataImportProgress.importedRows /
              sampleDataImportProgress.expectedRows) *
              100
          )
        )
      : null;

  if (initializationState === 'initialized') {
    return null;
  }

  if (initializationState === 'checking') {
    return (
      <Box sx={centeredBoxSx}>
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress size={60} sx={{ mb: 2 }} />
          <Typography variant="h6">{t('gate.initializing')}</Typography>
        </Box>
      </Box>
    );
  }

  if (initializationState === 'testing-browser') {
    return (
      <Box sx={centeredBoxSx}>
        <TestBrowser
          onTestComplete={(isCompatible, results) => {
            void onBrowserTestComplete(isCompatible, results);
          }}
        />
      </Box>
    );
  }

  if (initializationState === 'needs-password-setup') {
    return (
      <>
        <LanguageMenuCorner />
        <PasswordSetup
          onPasswordConfirmed={onPasswordSetupConfirmed}
          isLoading={isLoading}
          error={error}
        />
      </>
    );
  }

  if (initializationState === 'needs-preferences') {
    return (
      <PreferencesSetup
        onPreferencesConfirmed={onPreferencesConfirmed}
        onSkip={onSkipPreferences}
        isLoading={isLoading}
        error={error}
      />
    );
  }

  if (initializationState === 'needs-initial-account') {
    return (
      <InitialAccount
        defaultCurrency={setupDefaultCurrency}
        onAccountConfirmed={onInitialAccountConfirmed}
        onSkip={onSkipInitialAccount}
        isLoading={isLoading}
        error={error}
      />
    );
  }

  if (initializationState === 'needs-password-entry') {
    const archiveMasterType = pendingArchiveMasterType ?? 'password';
    return (
      <>
        <LanguageMenuCorner />
        <UnlockScreen
          masterType={archiveMasterType}
          description={archiveMasterType === 'recovery' ? t('gate.importRecoveryDescription') : t('gate.importPasswordDescription')}
          onUnlock={(method) => {
            if (method.type !== 'password' && method.type !== 'recovery') {
              return Promise.reject(new Error('An archive can only be opened with its password or recovery phrase'));
            }
            return onPasswordEntrySubmitted(method);
          }}
          onCancel={onCancelPasswordEntry}
          isLoading={isLoading}
          error={error}
        />
      </>
    );
  }

  if (initializationState === 'needs-storage-choice') {
    if (storageMigrationStage) {
      return <EncryptionProgress stage={storageMigrationStage} />;
    }

    return (
      <StorageChoice
        onChoiceSelected={onStorageChoiceSelected}
        isLoading={isLoading}
        error={error}
      />
    );
  }

  if (initializationState === 'needs-unlock') {
    const masterIsRecovery = unlockMethods?.methods.some((slot) => slot.isMaster && slot.type === 'recovery') === true;
    return (
      <>
        <LanguageMenuCorner />
        <UnlockScreen
          methods={unlockMethods}
          description={masterIsRecovery ? t('gate.unlockRecoveryDescription') : t('gate.unlockDescription')}
          onUnlock={onUnlockSubmitted}
          onResetApp={onResetApp}
          isLoading={isLoading}
          error={error}
        />
      </>
    );
  }

  if (initializationState === 'needs-legacy-reset') {
    return (
      <>
        <LanguageMenuCorner />
        <LegacyDatabaseNotice onReset={onLegacyReset} />
      </>
    );
  }

  if (initializationState === 'needs-setup') {
    const googleConfigured = createCloudProviderClient('gdrive').isConfigured();
    const oneDriveConfigured = createCloudProviderClient('onedrive').isConfigured();

    return (
      <Box sx={centeredBoxSx}>
        <LanguageMenuCorner />
        <Paper sx={{ p: 4, maxWidth: 560, textAlign: 'center' }}>
          <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
            <AppLogo scale={6} />
          </Box>
          <Typography variant="h4" gutterBottom>
            {t('gate.welcomeTitle')}
          </Typography>
          <Typography variant="body1" sx={{ mb: 4 }}>
            {t('gate.welcomeDescription')}
          </Typography>

          {/* Suppressed while the picker dialog is open — connectCloudSource
              and handleCloudFileSelected always mirror the same message into
              cloudFilePicker.error, so the dialog below already shows it. */}
          {error && !cloudFilePicker.isOpen && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              startIcon={<CreateNewFolder />}
              onClick={() => {
                void handleCreateNew();
              }}
              disabled={isLoading}
              size="large"
            >
              {t('gate.createNewDatabase')}
            </Button>

            <Button
              variant="outlined"
              startIcon={<Upload />}
              onClick={handleLoadFromFile}
              disabled={isLoading}
              size="large"
            >
              {t('gate.loadFromFile')}
            </Button>
          </Box>

          <Divider sx={{ my: 3 }}>
            <Typography variant="caption" color="text.secondary">
              {t('gate.orOpenCloudBackup')}
            </Typography>
          </Divider>

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Tooltip
              title={googleConfigured ? '' : t('gate.providerNotConfigured', { provider: t('provider.gdrive') })}
            >
              <span>
                <Button
                  variant="outlined"
                  startIcon={<CloudSync />}
                  onClick={() => handleOpenFromCloud('gdrive')}
                  disabled={isLoading || !googleConfigured}
                >
                  {t('gate.openFromProvider', { provider: t('provider.gdrive') })}
                </Button>
              </span>
            </Tooltip>
            <Tooltip
              title={oneDriveConfigured ? '' : t('gate.providerNotConfigured', { provider: t('provider.onedrive') })}
            >
              <span>
                <Button
                  variant="outlined"
                  startIcon={<CloudSync />}
                  onClick={() => handleOpenFromCloud('onedrive')}
                  disabled={isLoading || !oneDriveConfigured}
                >
                  {t('gate.openFromProvider', { provider: t('provider.onedrive') })}
                </Button>
              </span>
            </Tooltip>
          </Box>

          {isLoading && (
            <Box sx={{ mt: 3 }}>
              {sampleDataImportProgress ? (
                <Box sx={{ textAlign: 'left' }}>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    {t('gate.importingSampleData')}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {sampleDataImportProgress.message}
                  </Typography>
                  <LinearProgress
                    variant={
                      sampleDataProgressValue !== null ? 'determinate' : 'indeterminate'
                    }
                    value={sampleDataProgressValue ?? 0}
                    sx={{ mb: 1 }}
                  />
                  <Typography variant="caption" display="block" color="text.secondary">
                    {t('gate.filesCompleted', {
                      completed: sampleDataImportProgress.completedFiles,
                      total: sampleDataImportProgress.totalFiles,
                    })}
                  </Typography>
                  {sampleDataImportProgress.currentFile && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      {t('gate.currentFile', { file: sampleDataImportProgress.currentFile })}
                    </Typography>
                  )}
                  {sampleDataImportProgress.currentTable && (
                    <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 2 }}>
                      {sampleDataImportProgress.expectedRows !== null
                        ? t('gate.tableRowsOfExpected', {
                            table: sampleDataImportProgress.currentTable,
                            imported: number(sampleDataImportProgress.importedRows),
                            expected: number(sampleDataImportProgress.expectedRows),
                          })
                        : t('gate.tableRows', {
                            table: sampleDataImportProgress.currentTable,
                            imported: number(sampleDataImportProgress.importedRows),
                          })}
                    </Typography>
                  )}
                  <Button
                    variant="text"
                    color="inherit"
                    onClick={onCancelSampleDataImport}
                    disabled={!sampleDataImportProgress.isCancelable}
                  >
                    {t('gate.cancelSampleDataImport')}
                  </Button>
                </Box>
              ) : (
                <CircularProgress size={24} />
              )}
            </Box>
          )}
        </Paper>

        <CloudFilePickerDialog
          open={cloudFilePicker.isOpen}
          provider={cloudFilePicker.provider}
          files={cloudFilePicker.files}
          isLoading={cloudFilePicker.isLoading}
          error={cloudFilePicker.error}
          onSelect={onCloudFileSelected}
          onClose={onCloseCloudFilePicker}
        />
      </Box>
    );
  }

  if (initializationState === 'needs-cloud-auth') {
    // Falls back to databaseSource (the persisted source) only when no
    // connect attempt has been made yet this session — cloudFilePicker.provider
    // tracks whichever provider was actually attempted, which matters because
    // a failed attempt from a fresh local session never persists
    // databaseSource away from 'local'.
    const providerLabel =
      (cloudFilePicker.provider ?? databaseSource) === 'gdrive' ? t('provider.gdrive') : t('provider.onedrive');

    return (
      <Box sx={centeredBoxSx}>
        <Paper sx={{ p: 4, maxWidth: 560, textAlign: 'center' }}>
          <CloudSync sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
          <Typography variant="h4" gutterBottom>
            {t('gate.connectProvider', { provider: providerLabel })}
          </Typography>
          <Typography variant="body1" sx={{ mb: 4 }}>
            {t('gate.cloudAuthDescription', { provider: providerLabel })}
          </Typography>

          {/* Suppressed while the picker dialog is open — see the matching comment above. */}
          {error && !cloudFilePicker.isOpen && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Button
              variant="contained"
              startIcon={<CloudSync />}
              onClick={() => {
                void onConnectCloudSource();
              }}
              disabled={isLoading}
              size="large"
            >
              {t('gate.connectProvider', { provider: providerLabel })}
            </Button>
            <Button
              variant="outlined"
              onClick={onSwitchToLocalSource}
              disabled={isLoading}
              size="large"
            >
              {t('gate.useLocalInstead')}
            </Button>
          </Box>

          {isLoading && (
            <Box sx={{ mt: 3 }}>
              <CircularProgress size={24} />
            </Box>
          )}
        </Paper>

        <CloudFilePickerDialog
          open={cloudFilePicker.isOpen}
          provider={cloudFilePicker.provider}
          files={cloudFilePicker.files}
          isLoading={cloudFilePicker.isLoading}
          error={cloudFilePicker.error}
          onSelect={onCloudFileSelected}
          onClose={onCloseCloudFilePicker}
        />
      </Box>
    );
  }

  if (initializationState === 'error') {
    return (
      <Box sx={centeredBoxSx}>
        <Paper sx={{ p: 4, maxWidth: 500, textAlign: 'center' }}>
          <Typography variant="h5" color="error" gutterBottom>
            {t('gate.databaseError')}
          </Typography>
          <Typography variant="body1" sx={{ mb: 3 }}>
            {error || t('gate.unknownInitError')}
          </Typography>
          <Button
            variant="contained"
            onClick={() => {
              window.location.reload();
            }}
          >
            {t('gate.reloadPage')}
          </Button>
        </Paper>
      </Box>
    );
  }

  return null;
}
