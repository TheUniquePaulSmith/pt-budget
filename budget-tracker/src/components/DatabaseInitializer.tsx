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

const DatabaseInitializer: React.FC<DatabaseInitializerProps> = ({ onDatabaseReady }) => {  const {
    isInitialized,
    isDatabaseLoaded,
    isLoading,
    error,
    initializeDatabase,
    createNewDatabase,
    loadDatabaseFromFile,
    loadDatabaseFromSession,
    hasSession,
    exportDatabase,
    saveDatabaseToSession,
    setupAutoSave,
    setupAutoSaveWithExistingFile,
    setupAutoSaveWithFileHandle,
    autoSaveEnabled,
  } = useDatabaseContext();const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [sessionInfo, setSessionInfo] = useState<{ fileName?: string; lastAccessed: number; createdAt: number } | null>(null);
  const [hasDetectedSession, setHasDetectedSession] = useState(false);
  const [showFileSaveRequiredMessage, setShowFileSaveRequiredMessage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (!isInitialized) {
      initializeDatabase();
    } else {
      // Check for saved session after database is initialized
      checkForSavedSession();
    }
  }, [isInitialized, initializeDatabase]);  const checkForSavedSession = async () => {
    try {
      console.log('Checking for saved session...');
      const sessionExists = await hasSession();
      console.log('Session exists:', sessionExists);
      
      if (sessionExists) {
        // Get session info and show as option
        const { sessionManager } = await import('../lib/sessionManager');
        const info = await sessionManager.getSessionInfo();
        console.log('Session info:', info);
        
        if (info) {
          setSessionInfo(info);
          setHasDetectedSession(true);
          console.log('Session detected and state updated');
        }
      } else {
        console.log('No session found');
      }
    } catch (error) {
      console.error('Error checking for saved session:', error);
    }
  };  const handleLoadSession = async () => {
    try {
      setShowFileSaveRequiredMessage(false); // Clear any previous messages
      const success = await loadDatabaseFromSession();
      if (success) {
        // For resuming session, don't prompt for auto-save - let user enable it manually later
        console.log('Session loaded successfully - auto-save disabled by default');
        onDatabaseReady();
      }
    } catch (error) {
      console.error('Error loading session:', error);
    }
  };// Automatically setup auto-save with new file (for create new / load existing)
  const trySetupAutoSave = async (): Promise<boolean> => {
    if ('showSaveFilePicker' in window) {
      try {
        const success = await setupAutoSave();
        if (success) {
          console.log('Auto-save enabled automatically with new file');
          return true;
        }
        return false;
      } catch (error) {
        console.log('Auto-save setup was cancelled or failed:', error);
        return false;
      }
    } else {
      // For browsers that don't support File System Access API, allow proceeding without auto-save
      console.log('Browser does not support File System Access API - proceeding without auto-save');
      return true; // Allow the database creation/loading to proceed
    }
  };

  // Setup auto-save with existing file (for resume session)
  const trySetupAutoSaveWithExistingFile = async (): Promise<boolean> => {
    if ('showOpenFilePicker' in window) {
      try {
        const success = await setupAutoSaveWithExistingFile();
        if (success) {
          console.log('Auto-save enabled with existing file');
          return true;
        }
        return false;
      } catch (error) {
        console.log('Auto-save setup with existing file was cancelled or failed:', error);
        return false;
      }
    } else {
      console.log('Browser does not support File System Access API - auto-save not available');
      return false;
    }
  };

  React.useEffect(() => {
    if (isDatabaseLoaded) {
      onDatabaseReady();
    }
  }, [isDatabaseLoaded, onDatabaseReady]);  const handleCreateNewDatabase = async () => {
    try {
      // First setup auto-save (this will prompt for file location)
      const autoSaveSuccess = await trySetupAutoSave();
      
      if (autoSaveSuccess) {
        // Only create the database if auto-save was successfully set up
        createNewDatabase();
        setShowFileSaveRequiredMessage(false);
      } else {
        // If user cancelled file selection, don't create the database
        console.log('Database creation cancelled - file save location required');
        setShowFileSaveRequiredMessage(true);
        // Hide the message after 5 seconds
        setTimeout(() => setShowFileSaveRequiredMessage(false), 5000);
      }
    } catch (error) {
      console.error('Error creating new database:', error);
    }
  };  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      try {
        // First setup auto-save (this will prompt for save location)
        const autoSaveSuccess = await trySetupAutoSave();
        
        if (autoSaveSuccess) {
          // Only load the database if auto-save was successfully set up
          await loadDatabaseFromFile(file);
          setShowLoadDialog(false);
          setShowFileSaveRequiredMessage(false);
        } else {
          // If user cancelled file save selection, don't load the database
          console.log('Database loading cancelled - file save location required');
          setShowFileSaveRequiredMessage(true);
          // Hide the message after 5 seconds
          setTimeout(() => setShowFileSaveRequiredMessage(false), 5000);
          // Reset the file input
          if (event.target) {
            event.target.value = '';
          }
        }
      } catch (error) {
        console.error('Error loading database file:', error);
        // Reset the file input on error
        if (event.target) {
          event.target.value = '';
        }
      }
    }
  };

  // Handle loading existing database with File System Access API
  const handleLoadExistingDatabaseWithFileAPI = async () => {
    if (!('showOpenFilePicker' in window)) {
      // Fallback to traditional file input for unsupported browsers
      setShowLoadDialog(true);
      return;
    }

    try {
      setShowFileSaveRequiredMessage(false);
      
      // Use File System Access API to select and load the file
      const [fileHandle] = await (window as any).showOpenFilePicker({
        types: [{
          description: 'Database files',
          accept: { 'application/octet-stream': ['.db'] },
        }],
        multiple: false,
      });

      // Get the file from the handle
      const file = await fileHandle.getFile();
      
      // Load the database
      await loadDatabaseFromFile(file);
      
      // Set up auto-save with the same file handle (no additional prompt needed!)
      const autoSaveSuccess = await setupAutoSaveWithFileHandle(fileHandle);
      
      if (autoSaveSuccess) {
        console.log('Database loaded and auto-save enabled with the same file');
      } else {
        console.log('Database loaded but auto-save setup failed');
      }    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('File selection cancelled by user');
      } else {
        console.error('Error loading database file:', error);
      }
    }
  };  const handleLoadExistingDatabase = () => {
    setShowFileSaveRequiredMessage(false); // Clear any previous messages
    
    if ('showOpenFilePicker' in window) {
      // Use File System Access API for modern browsers
      handleLoadExistingDatabaseWithFileAPI();
    } else {
      // Fallback to traditional file input for older browsers
      setShowLoadDialog(true);
    }
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
        <CardContent sx={{ p: 4 }}>          <Box textAlign="center" mb={4}>
            <Storage sx={{ fontSize: 64, color: 'primary.main', mb: 2 }} />
            <Typography variant="h4" gutterBottom>
              {hasDetectedSession ? 'Welcome Back to Budget Tracker' : 'Welcome to Budget Tracker'}
            </Typography>            <Typography variant="body1" color="text.secondary" paragraph>
              {hasDetectedSession 
                ? 'Continue with your previous session or choose another option below.'
                : 'To get started, you need to either create a new database or load an existing one. Your financial data is stored locally in an SQLite database file.'
              }
            </Typography>
          </Box>{error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}          {showFileSaveRequiredMessage && (
            <Alert severity="warning" sx={{ mb: 3 }}>
              A file save location is required to proceed. Please choose where to save your database file when prompted.
            </Alert>
          )}          {!('showSaveFilePicker' in window) && (
            <Alert severity="info" sx={{ mb: 3 }}>
              <Typography variant="body2">
                <strong>Note:</strong> Your browser has limited file access capabilities. 
                You can create databases and load existing ones, but auto-save to specific files isn't available. 
                Use the "Export Data" button in the dashboard to manually save your work.
              </Typography>
            </Alert>
          )}

          <Stack spacing={3}>
            {/* Show detected session option first if available */}
            {hasDetectedSession && sessionInfo && (
              <>                <Box>
                  <Typography variant="h6" gutterBottom color="primary">
                    Continue Previous Session
                  </Typography>
                  <Card variant="outlined" sx={{ mb: 2 }}>
                    <CardContent sx={{ py: 2 }}>
                      <Typography variant="body2" gutterBottom>
                        <strong>Detected saved session:</strong>
                      </Typography>
                      {sessionInfo.fileName && (
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                          File: {sessionInfo.fileName}
                        </Typography>
                      )}
                      <Typography variant="body2" color="text.secondary">
                        Last accessed: {new Date(sessionInfo.lastAccessed).toLocaleString()}
                      </Typography>
                    </CardContent>
                  </Card>                  <Typography variant="body2" color="text.secondary" paragraph>
                    Resume your previous work. Auto-save will be disabled by default - you can enable it later from the dashboard.
                  </Typography>
                  <Button
                    variant="contained"
                    size="large"
                    startIcon={<Storage />}
                    onClick={handleLoadSession}
                    disabled={isLoading}
                    fullWidth
                    sx={{ mb: 1 }}
                  >
                    {isLoading ? 'Loading Session...' : 'Continue Previous Session'}
                  </Button>
                  <Typography variant="body2" color="text.secondary" textAlign="center">
                    or choose another option below
                  </Typography>
                </Box>

                <Divider>OR</Divider>
              </>
            )}            <Box>
              <Typography variant="h6" gutterBottom>
                Create New Database
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                Start fresh with a new database. {('showSaveFilePicker' in window) 
                  ? "You'll need to choose where to save your database file (required for automatic backups and data persistence)."
                  : "Default categories and settings will be created. Use 'Export Data' to save your work manually."}
              </Typography>
              <Button
                variant={hasDetectedSession ? "outlined" : "contained"}
                size="large"
                startIcon={<Create />}
                onClick={handleCreateNewDatabase}
                disabled={isLoading}
                fullWidth
              >
                {isLoading ? 'Creating...' : 'Create New Database'}
              </Button>
            </Box>

            <Divider>OR</Divider>            <Box>
              <Typography variant="h6" gutterBottom>
                Load Existing Database
              </Typography>
              <Typography variant="body2" color="text.secondary" paragraph>
                {('showOpenFilePicker' in window) 
                  ? "Open a previously saved database file. Auto-save will write changes back to the same file."
                  : "Upload a previously saved database file. Use 'Export Data' to save your changes manually."}
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
          </Button>        </DialogActions>      </Dialog>
    </Box>
  );
};

export default DatabaseInitializer;
