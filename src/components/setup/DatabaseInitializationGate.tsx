'use client';

import { useCallback } from 'react';

import { DatasetOutlined, CloudSync, CreateNewFolder, Upload } from '@mui/icons-material';
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

import { PasswordSetup } from './PasswordSetup';
import { PasswordEntry } from './PasswordEntry';
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
  /** Called when the user confirms a new password on the setup screen. */
  onPasswordSetupConfirmed: (password: string, primaryUserName: string) => Promise<void>;
  /** Called when the user enters a password to decrypt a loaded archive. */
  onPasswordEntrySubmitted: (password: string) => Promise<void>;
  /** Cancels the pending password-entry flow. */
  onCancelPasswordEntry: () => void;
  /** Called from the storage-choice screen right after password setup. */
  onStorageChoiceSelected: (choice: 'local' | CloudProvider) => Promise<void>;
  /** Called from the needs-cloud-password screen. */
  onCloudPasswordSubmitted: (password: string) => Promise<void>;
  /** Continues into the app without unlocking cloud sync this session. */
  onSkipCloudUnlock: () => Promise<void>;
}

const centeredBoxSx = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  p: 2,
} as const;

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
  onPasswordEntrySubmitted,
  onCancelPasswordEntry,
  onStorageChoiceSelected,
  onCloudPasswordSubmitted,
  onSkipCloudUnlock,
}: DatabaseInitializationGateProps) {
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
          <Typography variant="h6">Initializing database...</Typography>
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
      <PasswordSetup
        onPasswordConfirmed={onPasswordSetupConfirmed}
        isLoading={isLoading}
        error={error}
      />
    );
  }

  if (initializationState === 'needs-password-entry') {
    return (
      <PasswordEntry
        description="This database file is encrypted. Enter your password to unlock and import it."
        onPasswordSubmitted={onPasswordEntrySubmitted}
        onCancel={onCancelPasswordEntry}
        isLoading={isLoading}
        error={error}
      />
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

  if (initializationState === 'needs-cloud-password') {
    return (
      <PasswordEntry
        description="Enter your database password to enable cloud sync on this device."
        onPasswordSubmitted={onCloudPasswordSubmitted}
        onCancel={() => {
          void onSkipCloudUnlock();
        }}
        isLoading={isLoading}
        error={error}
      />
    );
  }

  if (initializationState === 'needs-setup') {
    const googleConfigured = createCloudProviderClient('gdrive').isConfigured();
    const oneDriveConfigured = createCloudProviderClient('onedrive').isConfigured();

    return (
      <Box sx={centeredBoxSx}>
        <Paper sx={{ p: 4, maxWidth: 560, textAlign: 'center' }}>
          <DatasetOutlined sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
          <Typography variant="h4" gutterBottom>
            Welcome to Budget Tracker
          </Typography>
          <Typography variant="body1" sx={{ mb: 4 }}>
            To get started, you can create a new database or load an existing one from a file.
          </Typography>

          {error && (
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
              Create New Database
            </Button>

            <Button
              variant="outlined"
              startIcon={<Upload />}
              onClick={handleLoadFromFile}
              disabled={isLoading}
              size="large"
            >
              Load from File
            </Button>
          </Box>

          <Divider sx={{ my: 3 }}>
            <Typography variant="caption" color="text.secondary">
              or open an existing cloud backup
            </Typography>
          </Divider>

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Tooltip
              title={googleConfigured ? '' : 'Google Drive is not configured for this deployment.'}
            >
              <span>
                <Button
                  variant="outlined"
                  startIcon={<CloudSync />}
                  onClick={() => handleOpenFromCloud('gdrive')}
                  disabled={isLoading || !googleConfigured}
                >
                  Open from Google Drive
                </Button>
              </span>
            </Tooltip>
            <Tooltip
              title={oneDriveConfigured ? '' : 'OneDrive is not configured for this deployment.'}
            >
              <span>
                <Button
                  variant="outlined"
                  startIcon={<CloudSync />}
                  onClick={() => handleOpenFromCloud('onedrive')}
                  disabled={isLoading || !oneDriveConfigured}
                >
                  Open from OneDrive
                </Button>
              </span>
            </Tooltip>
          </Box>

          {isLoading && (
            <Box sx={{ mt: 3 }}>
              {sampleDataImportProgress ? (
                <Box sx={{ textAlign: 'left' }}>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    Importing sample data
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
                    Files completed: {sampleDataImportProgress.completedFiles} /{' '}
                    {sampleDataImportProgress.totalFiles}
                  </Typography>
                  {sampleDataImportProgress.currentFile && (
                    <Typography variant="caption" display="block" color="text.secondary">
                      Current file: {sampleDataImportProgress.currentFile}
                    </Typography>
                  )}
                  {sampleDataImportProgress.currentTable && (
                    <Typography variant="caption" display="block" color="text.secondary" sx={{ mb: 2 }}>
                      {sampleDataImportProgress.currentTable}: {sampleDataImportProgress.importedRows.toLocaleString()}
                      {sampleDataImportProgress.expectedRows !== null
                        ? ` / ${sampleDataImportProgress.expectedRows.toLocaleString()}`
                        : ''}{' '}
                      rows
                    </Typography>
                  )}
                  <Button
                    variant="text"
                    color="inherit"
                    onClick={onCancelSampleDataImport}
                    disabled={!sampleDataImportProgress.isCancelable}
                  >
                    Cancel Sample Data Import
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
    const providerLabel =
      databaseSource === 'gdrive' ? 'Google Drive' : 'OneDrive';

    return (
      <Box sx={centeredBoxSx}>
        <Paper sx={{ p: 4, maxWidth: 560, textAlign: 'center' }}>
          <CloudSync sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
          <Typography variant="h4" gutterBottom>
            Connect {providerLabel}
          </Typography>
          <Typography variant="body1" sx={{ mb: 4 }}>
            This browser is configured to use {providerLabel} as the database source.
            Authenticate and choose a backup archive to continue.
          </Typography>

          {error && (
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
              Connect {providerLabel}
            </Button>
            <Button
              variant="outlined"
              onClick={onSwitchToLocalSource}
              disabled={isLoading}
              size="large"
            >
              Use Local Database Instead
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
            Database Error
          </Typography>
          <Typography variant="body1" sx={{ mb: 3 }}>
            {error || 'An unknown error occurred while initializing the database.'}
          </Typography>
          <Button
            variant="contained"
            onClick={() => {
              window.location.reload();
            }}
          >
            Reload Page
          </Button>
        </Paper>
      </Box>
    );
  }

  return null;
}
