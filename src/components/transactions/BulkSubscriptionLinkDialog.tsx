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
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['transactions', 'common']);
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
      setError(err instanceof Error ? err.message : t('bulkSeries.linkFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutorenewIcon />
          {t('bulkSeries.title')}
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">
            {t('bulkSeries.linkTo', { count: transactionIds.length })}
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
              label={t('bulkSeries.seriesLabel')}
              placeholder={t('bulkSeries.searchPlaceholder')}
              autoFocus
              helperText={
                options.length === 0
                  ? t('bulkSeries.noSeriesHelp')
                  : t('bulkSeries.seriesHelp')
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
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button
          variant="contained"
          onClick={() => void apply()}
          disabled={loading || !selected}
        >
          {loading ? t('common:status.saving') : t('bulkSeries.link')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
