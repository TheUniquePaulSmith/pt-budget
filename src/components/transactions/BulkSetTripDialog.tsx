'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert,
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
import { Clear as ClearIcon, FlightTakeoff as TripIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useTripAssignSlice } from '@/contexts/useDatabaseSlices';
import type { Trip } from '@/types/database';

interface BulkSetTripDialogProps {
  open: boolean;
  transactionIds: number[];
  onClose: () => void;
}

/** Puts the selected transactions on a trip, or takes them off theirs. */
export default function BulkSetTripDialog({ open, transactionIds, onClose }: BulkSetTripDialogProps) {
  const { t } = useTranslation(['transactions', 'common']);
  const { trips, assignTransactionsToTrip } = useTripAssignSlice();

  const [selected, setSelected] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelected(null);
      setError(null);
    }
  }, [open]);

  const apply = async (tripId: number | null) => {
    if (transactionIds.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      await assignTransactionsToTrip(transactionIds, tripId);
      onClose();
    } catch {
      setError(t('bulkTrip.setFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TripIcon />
          {t('bulkTrip.title')}
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            {t('bulkTrip.applyTo', { count: transactionIds.length })}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('bulkTrip.clearsProject')}
          </Typography>
          {selected?.expense_mode === 'business' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {t('bulkTrip.businessDefault')}
            </Typography>
          )}
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Autocomplete
          options={trips}
          getOptionLabel={(option) => option.name}
          value={selected}
          onChange={(_, value) => setSelected(value)}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          renderInput={(params) => (
            <TextField
              {...params}
              label={t('common:fields.trip')}
              placeholder={t('bulkTrip.searchPlaceholder')}
              autoFocus
              fullWidth
              inputProps={{ ...params.inputProps, 'data-testid': 'bulk-trip-select' }}
            />
          )}
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button color="inherit" startIcon={<ClearIcon />} onClick={() => void apply(null)} disabled={loading}>
          {t('bulkTrip.remove')}
        </Button>
        <Button
          variant="contained"
          onClick={() => void apply(selected?.id ?? null)}
          disabled={loading || !selected}
          data-testid="bulk-trip-apply"
        >
          {loading ? t('common:status.saving') : t('common:actions.apply')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
