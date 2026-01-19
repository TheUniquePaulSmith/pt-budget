'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Box,
  Typography,
  Chip,
  Autocomplete,
  SelectChangeEvent,
} from '@mui/material';
import {
  Label as LabelIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { useDatabaseContext } from '@/contexts/DatabaseContext';
import { Transaction, Project, Trip } from '@/types/database';

interface TransactionLabelDialogProps {
  open: boolean;
  onClose: () => void;
  transaction: Transaction | null;
  onSuccess: () => void;
}

export default function TransactionLabelDialog({
  open,
  onClose,
  transaction,
  onSuccess,
}: TransactionLabelDialogProps) {
  const { 
    projects, 
    trips,
    updateTransactionLabels,
    refreshTransactions
  } = useDatabaseContext();
  
  const [labelType, setLabelType] = useState<'none' | 'project' | 'trip'>('none');
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (transaction && open) {
      // Set initial values based on current transaction labels
      if (transaction.project_id) {
        setLabelType('project');
        setSelectedProjectId(transaction.project_id);
        setSelectedTripId(null);
      } else if (transaction.trip_id) {
        setLabelType('trip');
        setSelectedTripId(transaction.trip_id);
        setSelectedProjectId(null);
      } else {
        setLabelType('none');
        setSelectedProjectId(null);
        setSelectedTripId(null);
      }
    }
  }, [transaction, open]);

  const handleLabelTypeChange = (event: SelectChangeEvent) => {
    const value = event.target.value as 'none' | 'project' | 'trip';
    setLabelType(value);
    setSelectedProjectId(null);
    setSelectedTripId(null);
    setError(null);
  };

  const handleSubmit = async () => {
    if (!transaction) return;

    setLoading(true);
    setError(null);

    try {
      let projectId: number | null = null;
      let tripId: number | null = null;

      if (labelType === 'project' && selectedProjectId) {
        projectId = selectedProjectId;
      } else if (labelType === 'trip' && selectedTripId) {
        tripId = selectedTripId;
      }

      await updateTransactionLabels(transaction.id, projectId, tripId);
      await refreshTransactions();
      onSuccess();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update transaction label');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setError(null);
    setLabelType('none');
    setSelectedProjectId(null);
    setSelectedTripId(null);
    onClose();
  };

  const getCurrentLabel = () => {
    if (!transaction) return null;
    
    if (transaction.project_id && transaction.project_name) {
      return (
        <Chip
          icon={<LabelIcon />}
          label={`Project: ${transaction.project_name}`}
          color="primary"
          variant="outlined"
          size="small"
        />
      );
    }
    
    if (transaction.trip_id && transaction.trip_name) {
      return (
        <Chip
          icon={<LabelIcon />}
          label={`Trip: ${transaction.trip_name}`}
          color="secondary"
          variant="outlined"
          size="small"
        />
      );
    }
    
    return (
      <Chip
        icon={<ClearIcon />}
        label="No Label"
        variant="outlined"
        size="small"
      />
    );
  };

  if (!transaction) return null;

  return (
    <Dialog 
      open={open} 
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LabelIcon />
          Label Transaction
        </Box>
      </DialogTitle>
      
      <DialogContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Transaction
          </Typography>
          <Typography variant="body1" fontWeight="medium">
            {transaction.description}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            ${Math.abs(transaction.amount).toFixed(2)} • {new Date(transaction.date).toLocaleDateString()}
          </Typography>
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Current Label
          </Typography>
          {getCurrentLabel()}
        </Box>

        {error && (
          <Box sx={{ mb: 2, p: 2, bgcolor: 'error.light', borderRadius: 1 }}>
            <Typography color="error.dark" variant="body2">
              {error}
            </Typography>
          </Box>
        )}

        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>Label Type</InputLabel>
          <Select
            value={labelType}
            label="Label Type"
            onChange={handleLabelTypeChange}
          >
            <MenuItem value="none">No Label</MenuItem>
            <MenuItem value="project">Project</MenuItem>
            <MenuItem value="trip">Trip</MenuItem>
          </Select>
        </FormControl>

        {labelType === 'project' && (
          <Autocomplete
            options={projects}
            getOptionLabel={(option) => option.name}
            value={projects.find(p => p.id === selectedProjectId) || null}
            onChange={(_, newValue) => {
              setSelectedProjectId(newValue?.id || null);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select Project"
                placeholder="Search projects..."
                fullWidth
              />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={key} {...otherProps}>
                  <Box>
                    <Typography variant="body1">{option.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {option.company_name} • {option.status}
                    </Typography>
                  </Box>
                </Box>
              );
            }}
          />
        )}

        {labelType === 'trip' && (
          <Autocomplete
            options={trips}
            getOptionLabel={(option) => option.name}
            value={trips.find(t => t.id === selectedTripId) || null}
            onChange={(_, newValue) => {
              setSelectedTripId(newValue?.id || null);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select Trip"
                placeholder="Search trips..."
                fullWidth
              />
            )}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={key} {...otherProps}>
                  <Box>
                    <Typography variant="body1">{option.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {option.destination ? `${option.destination} • ` : ''}{option.trip_category} • {option.status}
                    </Typography>
                  </Box>
                </Box>
              );
            }}
          />
        )}
      </DialogContent>
      
      <DialogActions>
        <Button onClick={handleClose}>Cancel</Button>
        <Button 
          onClick={handleSubmit} 
          variant="contained"
          disabled={loading || (labelType === 'project' && !selectedProjectId) || (labelType === 'trip' && !selectedTripId)}
        >
          {loading ? 'Updating...' : 'Update Label'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}