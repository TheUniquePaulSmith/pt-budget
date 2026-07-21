'use client';

import React, { useEffect, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import {
  Assignment as ProjectIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { useTransactionReportSlice } from '@/contexts/useDatabaseSlices';
import { Project } from '@/types/database';

interface BulkSetProjectDialogProps {
  open: boolean;
  transactionIds: number[];
  onClose: () => void;
}

export default function BulkSetProjectDialog({
  open,
  transactionIds,
  onClose,
}: BulkSetProjectDialogProps) {
  const { projects, applyTransactionClassifications } = useTransactionReportSlice();

  const [selected, setSelected] = useState<Project | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelected(null);
      setError(null);
    }
  }, [open]);

  const apply = async (projectId: number | null) => {
    if (transactionIds.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      await applyTransactionClassifications(
        transactionIds.map((transactionId) => ({ transactionId, projectId }))
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ProjectIcon />
          Set Project
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Apply to {transactionIds.length} selected transaction{transactionIds.length === 1 ? '' : 's'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Setting a project clears any trip label on these transactions.
          </Typography>
        </Box>

        {error && (
          <Box sx={{ mb: 2, p: 2, bgcolor: 'error.light', borderRadius: 1 }}>
            <Typography color="error.dark" variant="body2">
              {error}
            </Typography>
          </Box>
        )}

        <Autocomplete
          options={projects}
          getOptionLabel={(option) => option.name}
          value={selected}
          onChange={(_, value) => setSelected(value)}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Project"
              placeholder="Search projects..."
              autoFocus
              fullWidth
            />
          )}
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          color="inherit"
          startIcon={<ClearIcon />}
          onClick={() => void apply(null)}
          disabled={loading}
        >
          Clear
        </Button>
        <Button
          variant="contained"
          onClick={() => void apply(selected?.id ?? null)}
          disabled={loading || !selected}
        >
          {loading ? 'Saving…' : 'Apply'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
