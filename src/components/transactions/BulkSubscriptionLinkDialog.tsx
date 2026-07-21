'use client';

import React, { useEffect, useMemo, useState } from 'react';
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
import { Autorenew as AutorenewIcon } from '@mui/icons-material';
import { useTransactionReportSlice } from '@/contexts/useDatabaseSlices';
import { RecurringSeries } from '@/types/database';

interface BulkSubscriptionLinkDialogProps {
  open: boolean;
  transactionIds: number[];
  onClose: () => void;
}

export default function BulkSubscriptionLinkDialog({
  open,
  transactionIds,
  onClose,
}: BulkSubscriptionLinkDialogProps) {
  const { recurringSeries, bulkLinkTransactionsToSeries } = useTransactionReportSlice();

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
    if (open) {
      setSelected(null);
      setError(null);
    }
  }, [open]);

  const apply = async () => {
    if (transactionIds.length === 0 || !selected) return;
    setLoading(true);
    setError(null);
    try {
      await bulkLinkTransactionsToSeries(transactionIds, selected.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link transactions');
    } finally {
      setLoading(false);
    }
  };

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
          <Typography variant="body2" color="text.secondary">
            Link {transactionIds.length} selected transaction{transactionIds.length === 1 ? '' : 's'} to a recurring series
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
          variant="contained"
          onClick={() => void apply()}
          disabled={loading || !selected}
        >
          {loading ? 'Saving…' : 'Link'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
