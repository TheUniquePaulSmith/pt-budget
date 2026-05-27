'use client';

import { useCallback } from 'react';

import { DatasetOutlined, CreateNewFolder, Upload } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  LinearProgress,
  Paper,
  Typography,
} from '@mui/material';

import { TestBrowser, type TestResults } from './TestBrowser';
import type { InitializationState } from '../../contexts/useDatabaseInitialization';
import type { SampleDataImportProgress } from '../../lib/sampleDataService';

interface DatabaseInitializationGateProps {
  initializationState: InitializationState;
  isLoading: boolean;
  error: string | null;
  sampleDataImportProgress: SampleDataImportProgress | null;
  onBrowserTestComplete: (
    isCompatible: boolean,
    results: TestResults
  ) => Promise<void>;
  onCreateOrOpenDatabase: (isNew: boolean) => Promise<void>;
  onLoadDatabaseFromFile: (file: File) => Promise<void>;
  onCancelSampleDataImport: () => void;
}

const centeredBoxSx = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  p: 2,
} as const;

export function DatabaseInitializationGate({
  initializationState,
  isLoading,
  error,
  sampleDataImportProgress,
  onBrowserTestComplete,
  onCreateOrOpenDatabase,
  onLoadDatabaseFromFile,
  onCancelSampleDataImport,
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

  if (initializationState === 'needs-setup') {
    return (
      <Box sx={centeredBoxSx}>
        <Paper sx={{ p: 4, maxWidth: 500, textAlign: 'center' }}>
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

          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
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