'use client';

import { useCallback } from 'react';

import { DatasetOutlined, CreateNewFolder, Upload } from '@mui/icons-material';
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';

import { TestBrowser, type TestResults } from './TestBrowser';
import type { InitializationState } from '../../contexts/useDatabaseInitialization';

interface DatabaseInitializationGateProps {
  initializationState: InitializationState;
  isLoading: boolean;
  error: string | null;
  onBrowserTestComplete: (
    isCompatible: boolean,
    results: TestResults
  ) => Promise<void>;
  onCreateOrOpenDatabase: (isNew: boolean) => Promise<void>;
  onLoadDatabaseFromFile: (file: File) => Promise<void>;
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
  onBrowserTestComplete,
  onCreateOrOpenDatabase,
  onLoadDatabaseFromFile,
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
    input.accept = '.db,.sqlite,.sqlite3';

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
              <CircularProgress size={24} />
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