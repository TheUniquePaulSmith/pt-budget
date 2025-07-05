'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Paper,
  Stack,
  CircularProgress,
  Alert,
} from '@mui/material';
import {
  Add,
  Upload,
  Download,
} from '@mui/icons-material';
import { useDatabaseContext } from '../contexts/DatabaseContext';
import { appLogger } from '../lib/logger';

interface DatabaseInitializerProps {
  onDatabaseLoaded: () => void;
}



const DatabaseInitializer: React.FC<DatabaseInitializerProps> = ({ onDatabaseLoaded }) => {
  const [loading, setLoading] = useState(true); // Start with loading true for auto-check
  const [error, setError] = useState<string | null>(null);
  const [isCheckingExisting, setIsCheckingExisting] = useState(true);
  
  const { createOrOpenDatabase, loadDatabaseFromFile } = useDatabaseContext();

  // Auto-check for existing database on component mount
  useEffect(() => {
    const checkForExistingDatabase = async () => {
      try {
        // Check for 'new' query parameter to bypass existing database check
        const urlParams = new URLSearchParams(window.location.search);
        const forceNew = urlParams.has('new');

        if (forceNew) {
          appLogger.info('Query parameter "new" detected, bypassing existing database check');
          setIsCheckingExisting(false);
          setLoading(false);
          return;
        }

        appLogger.info('Checking for existing IndexedDB database...');
        setIsCheckingExisting(true);

        const dbName = 'ptbudgetapp';
        const exists = (await window.indexedDB.databases()).map(db => db.name).includes(dbName);

        if (exists) {
          appLogger.info('Existing IndexedDB database found, loading');
          await createOrOpenDatabase(true);
          onDatabaseLoaded();
        } else {
          appLogger.info('No existing IndexedDB database found');
          setIsCheckingExisting(false);
        }        
      } catch (err) {
        appLogger.error('Failed to check for existing database:', err);
        //setError('Failed to check for existing database. You can still create a new one.');
        setIsCheckingExisting(false);
      } finally {
        setLoading(false);
      }
    };

    checkForExistingDatabase();
  }, []);

  const handleCreateNew = async () => {
    setLoading(true);
    setError(null);
    
    try {
      appLogger.info('Creating new database...');
      await createOrOpenDatabase(false);
      onDatabaseLoaded();
    } catch (err) {
      appLogger.error('Failed to create database:', err);
      setError('Failed to create new database. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadFromFile = async () => {
    setLoading(true);
    setError(null);
    
    try {
      appLogger.info('Loading database from file...');
      // Create file input element
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.db,.sqlite,.sqlite3';
      
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          try {
            await loadDatabaseFromFile(file);
            onDatabaseLoaded();
          } catch (err) {
            appLogger.error('Failed to load database:', err);
            setError('Failed to load database file. Please check the file format.');
          } finally {
            setLoading(false);
          }
        } else {
          setLoading(false);
        }
      };
      
      input.click();
    } catch (err) {
      appLogger.error('Failed to load database:', err);
      setError('Failed to load database file. Please try again.');
      setLoading(false);
    }
  };

  // Show loading screen while checking for existing database
  if (isCheckingExisting) {
    return (
      <Box sx={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        p: 2
      }}>
        <Paper sx={{ 
          p: 4, 
          maxWidth: 500, 
          width: '100%',
          textAlign: 'center'
        }}>
          <Typography variant="h4" gutterBottom>
            Budget Tracker
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
            <CircularProgress size={40} />
            <Typography variant="body1" color="text.secondary">
              Checking for existing database...
            </Typography>
          </Box>
        </Paper>
      </Box>
    );
  }

  return (
    <Box sx={{ 
      minHeight: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      p: 2
    }}>
      <Paper sx={{ 
        p: 4, 
        maxWidth: 500, 
        width: '100%',
        textAlign: 'center'
      }}>
        <Typography variant="h4" gutterBottom>
          Budget Tracker
        </Typography>
        <Typography variant="body1" color="text.secondary" paragraph>
          Choose how you&apos;d like to get started with your budget tracking.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Stack spacing={2}>
          <Button
            variant="contained"
            size="large"
            startIcon={loading ? <CircularProgress size={20} /> : <Add />}
            onClick={handleCreateNew}
            disabled={loading}
            fullWidth
          >
            Create New Database
          </Button>

          <Button
            variant="outlined"
            size="large"
            startIcon={<Upload />}
            onClick={handleLoadFromFile}
            disabled={loading}
            fullWidth
          >
            Load Existing Database
          </Button>

        
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ mt: 3, display: 'block' }}>
          Your data is stored locally and persists in the browser only. 
          You can export or import your database at any time.
        </Typography>
      </Paper>
    </Box>
  );
};

export default DatabaseInitializer;
