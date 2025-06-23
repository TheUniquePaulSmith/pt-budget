'use client';

import React, { useState, useRef } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Alert,
  Divider,
  IconButton,
  Stack,
} from '@mui/material';
import {
  CloudUpload,
  Create,
  Download,
  Close,
  Storage,
  GetApp,
} from '@mui/icons-material';
import { useDatabaseContext } from '../contexts/DatabaseContext';

interface DatabaseInitializerProps {
  onDatabaseReady: () => void;
}

const DatabaseInitializer: React.FC<DatabaseInitializerProps> = ({ onDatabaseReady }) => {
  const {
    isInitialized,
    isDatabaseLoaded,
    isLoading,
    error,
    initializeDatabase,
    createNewDatabase,
    loadDatabaseFromFile,
    exportDatabase,
  } = useDatabaseContext();

  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!isInitialized) {
      initializeDatabase();
    }
  }, [isInitialized, initializeDatabase]);

  React.useEffect(() => {
    if (isDatabaseLoaded) {
      onDatabaseReady();
    }
  }, [isDatabaseLoaded, onDatabaseReady]);

  const handleCreateNewDatabase = () => {
    createNewDatabase();
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      loadDatabaseFromFile(file);
      setShowLoadDialog(false);
    }
  };

  const handleLoadExistingDatabase = () => {
    setShowLoadDialog(true);
  };

  const handleDownloadSample = () => {
    const sampleDb = exportDatabase();
    if (sampleDb) {
      const blob = new Blob([sampleDb], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'budget-tracker-sample.db';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  if (!isInitialized) {
    return (
      <Box
        display="flex"
        justifyContent="center"
        alignItems="center"
        minHeight="100vh"
        bgcolor="background.default"
      >
        <Card sx={{ maxWidth: 400, width: '100%', mx: 2 }}>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <CircularProgress size={60} sx={{ mb: 3 }} />
            <Typography variant="h6" gutterBottom>
              Initializing Database
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Setting up the SQLite environment...
            </Typography>
          </CardContent>
        </Card>
      </Box>
    );
  }

  if (isDatabaseLoaded) {
    return null; // Database is ready, don't show this component
  }

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      bgcolor="background.default"
      p={2}
    >
      <Card sx={{ maxWidth: 600, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Box textAlign="center" mb={4}>
            <Storage sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
            <Typography variant="h4" gutterBottom>
              Welcome to Budget Tracker
            </Typography>
            <Typography variant="body1" color="text.secondary" paragraph>
              To get started, you need to either create a new database or load an existing one.
              Your financial data is stored locally in an SQLite database file.
            </Typography>
          </Box>

          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}

          <Stack spacing={3}>
            <Box>
              <Typography variant="h6" gutterBottom>
                Create New Database
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Start fresh with a new database. This will create default categories and settings.
              </Typography>
              <Button
                variant="contained"
                size="large"
                startIcon={<Create />}
                onClick={handleCreateNewDatabase}
                disabled={isLoading}
                fullWidth
              >
                {isLoading ? 'Creating...' : 'Create New Database'}
              </Button>
            </Box>

            <Divider>OR</Divider>

            <Box>
              <Typography variant="h6" gutterBottom>
                Load Existing Database
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Upload a previously saved database file to continue with your existing data.
              </Typography>
              <Button
                variant="outlined"
                size="large"
                startIcon={<CloudUpload />}
                onClick={handleLoadExistingDatabase}
                disabled={isLoading}
                fullWidth
              >
                Load Existing Database
              </Button>
            </Box>
          </Stack>

          <Box mt={4} pt={3} borderTop={1} borderColor="divider">
            <Typography variant="body2" color="text.secondary" textAlign="center">
              <strong>Privacy Note:</strong> All your financial data is stored locally on your device.
              No data is sent to external servers.
            </Typography>
          </Box>
        </CardContent>
      </Card>

      {/* Load Database Dialog */}
      <Dialog
        open={showLoadDialog}
        onClose={() => setShowLoadDialog(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Load Database File
          <IconButton
            onClick={() => setShowLoadDialog(false)}
            sx={{ position: 'absolute', right: 8, top: 8 }}
          >
            <Close />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" paragraph>
            Select a previously saved Budget Tracker database file (.db) to load your data.
          </Typography>
          
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".db,.sqlite,.sqlite3"
            style={{ display: 'none' }}
          />
          
          <Button
            variant="outlined"
            startIcon={<GetApp />}
            onClick={() => fileInputRef.current?.click()}
            fullWidth
            sx={{ mt: 2 }}
          >
            Choose Database File
          </Button>

          {isDatabaseLoaded && (
            <Alert severity="success" sx={{ mt: 2 }}>
              Database loaded successfully!
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowLoadDialog(false)}>
            Cancel
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default DatabaseInitializer;
