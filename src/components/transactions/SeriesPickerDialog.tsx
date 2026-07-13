'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
} from '@mui/material';
import {
  Autorenew as AutorenewIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { useTransactionQuickActionsSlice } from '@/contexts/useDatabaseSlices';
import { RecurringSeries, Transaction } from '@/types/database';

interface SeriesPickerDialogProps {
  open: boolean;
  transaction: Transaction | null;
  onClose: () => void;
}

export default function SeriesPickerDialog({
  open,
  transaction,
  onClose,
}: SeriesPickerDialogProps) {
  const { recurringSeries, linkTransactionToSeries, unlinkTransactionFromSeries } =
    useTransactionQuickActionsSlice();

  const [selected, setSelected] = useState<RecurringSeries | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () =>
      recurringSeries
        .filter((series) => series.status === 'active' || series.status === 'candidate')
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name)),
    [recurringSeries]
  );

  useEffect(() => {
    if (open && transaction) {
      setSelected(options.find((series) => series.id === transaction.series_id) ?? null);
      setError(null);
    }
  }, [open, transaction, options]);

  const runAction = async (action: () => Promise<void>, failureMessage: string) => {
    setLoading(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : failureMessage);
    } finally {
      setLoading(false);
    }
  };

  if (!transaction) return null;

  const isLinked = transaction.series_id != null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutorenewIcon />
          Subscription Link
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
            Current Link
          </Typography>
          <Chip
            label={
              isLinked
                ? transaction.series_name || `Series #${transaction.series_id}`
                : 'Not linked'
            }
            color={isLinked ? 'primary' : 'default'}
            variant="outlined"
            size="small"
          />
        </Box>

        {error && (
          <Box sx={{ mb: 2, p: 2, bgcolor: 'error.light', borderRadius: 1 }}>
            <Typography color="error.dark" variant="body2">
              {error}
            </Typography>
          </Box>
        )}

        <Autocomplete
          options={options}
          getOptionLabel={(option) => option.name}
          value={selected}
          onChange={(_, value) => setSelected(value)}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Subscription / Bill"
              placeholder="Search recurring series..."
              autoFocus
              helperText={
                options.length === 0
                  ? 'No recurring series yet — run a scan from the Subscriptions page first'
                  : 'Active and candidate series are shown'
              }
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
                    {option.kind} • {option.cadence} • {option.status}
                  </Typography>
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
          onClick={() =>
            void runAction(
              () => unlinkTransactionFromSeries(transaction.id),
              'Failed to unlink transaction'
            )
          }
          disabled={loading || !isLinked}
        >
          Unlink
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            if (selected) {
              void runAction(
                () => linkTransactionToSeries(transaction.id, selected.id),
                'Failed to link transaction'
              );
            }
          }}
          disabled={loading || !selected}
        >
          {loading ? 'Saving…' : 'Link'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
