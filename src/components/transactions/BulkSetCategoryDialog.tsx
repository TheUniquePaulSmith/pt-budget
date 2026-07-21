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
  Category as CategoryIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { useTransactionReportSlice } from '@/contexts/useDatabaseSlices';
import { Category } from '@/types/database';

interface BulkSetCategoryDialogProps {
  open: boolean;
  transactionIds: number[];
  onClose: () => void;
}

export default function BulkSetCategoryDialog({
  open,
  transactionIds,
  onClose,
}: BulkSetCategoryDialogProps) {
  const { categories, applyTransactionClassifications } = useTransactionReportSlice();

  const [selected, setSelected] = useState<Category | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelected(null);
      setError(null);
    }
  }, [open]);

  const apply = async (categoryId: number | null) => {
    if (transactionIds.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      await applyTransactionClassifications(
        transactionIds.map((transactionId) => ({ transactionId, categoryId }))
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set category');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CategoryIcon />
          Set Category
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Apply to {transactionIds.length} selected transaction{transactionIds.length === 1 ? '' : 's'}
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
          options={categories}
          getOptionLabel={(option) => option.name}
          value={selected}
          onChange={(_, value) => setSelected(value)}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Category"
              placeholder="Search categories..."
              autoFocus
              fullWidth
            />
          )}
          renderOption={(props, option) => {
            const { key, ...otherProps } = props;
            return (
              <Box component="li" key={key} {...otherProps}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: option.color || 'text.disabled',
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body1">{option.name}</Typography>
                </Box>
              </Box>
            );
          }}
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
