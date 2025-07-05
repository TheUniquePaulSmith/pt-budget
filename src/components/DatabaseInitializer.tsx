'use client';

import React, { useState } from 'react';
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

interface DatabaseInitializerProps {
  onDatabaseLoaded: () => void;
}

const DatabaseInitializer: React.FC<DatabaseInitializerProps> = ({ onDatabaseLoaded }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { createNewDatabase, loadDatabaseFromFile } = useDatabaseContext();

  const handleCreateNew = async () => {
    setLoading(true);
    setError(null);
    
    try {
      await createNewDatabase();
      onDatabaseLoaded();
    } catch (err) {
      console.error('Failed to create database:', err);
      setError('Failed to create new database. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadFromFile = async () => {
    setLoading(true);
    setError(null);
    
    try {
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
            console.error('Failed to load database:', err);
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
      console.error('Failed to load database:', err);
      setError('Failed to load database file. Please try again.');
      setLoading(false);
    }
  };

  const handleDownloadSample = () => {
    // You can implement sample database download here if needed
    alert('Sample database download not implemented yet.');
  };

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

          <Button
            variant="text"
            size="large"
            startIcon={<Download />}
            onClick={handleDownloadSample}
            disabled={loading}
            fullWidth
          >
            Download Sample Database
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
