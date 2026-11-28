'use client';

import React, { useState } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useTripDetailSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { fullBusinessAmount } from '@/lib/tripInsights';
import type { TripInsightRow, TripReimbursementStatus } from '@/types/tripExpenses';
import { TRIP_REIMBURSEMENT_STATUSES } from '@/types/tripExpenses';

import { tripExpenseErrorKey } from './tripExpensePresentation';

export interface TripSplitDialogProps {
  row: TripInsightRow;
  onClose: () => void;
}

/** Splits one trip expense into its business part and the personal rest. */
export default function TripSplitDialog({ row, onClose }: TripSplitDialogProps) {
  const { t } = useTranslation(['trips', 'common']);
  const { money, date, symbol } = useFormatters();
  const { setTripAllocations } = useTripDetailSlice();
  const charge = fullBusinessAmount(row.amount);

  const [business, setBusiness] = useState(row.business_amount != null ? String(row.business_amount) : '0');
  const [status, setStatus] = useState<TripReimbursementStatus>(row.status ?? 'pending');
  const [note, setNote] = useState(row.note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsed = Number(business);
  const valid = business.trim() !== '' && Number.isFinite(parsed) && parsed >= 0 && parsed <= charge + 0.004;
  const personal = valid ? Math.round((charge - parsed) * 100) / 100 : null;

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      await setTripAllocations([{ transactionId: row.transaction_id, businessAmount: parsed, status, note }]);
      onClose();
    } catch (saveError) {
      setError(t(tripExpenseErrorKey(saveError)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{t('split.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 0.5 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <div>
            <Typography variant="body1" fontWeight={600}>
              {row.description}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('split.chargeLine', { date: date(row.date), amount: money(charge, row.account_currency) })}
            </Typography>
          </div>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" onClick={() => setBusiness(String(charge))} data-testid="trip-split-all-business">
              {t('split.allBusiness')}
            </Button>
            <Button size="small" variant="outlined" onClick={() => setBusiness('0')} data-testid="trip-split-all-personal">
              {t('split.allPersonal')}
            </Button>
          </Stack>
          <TextField
            label={t('split.businessAmount')}
            type="number"
            value={business}
            onChange={(event) => setBusiness(event.target.value)}
            error={!valid}
            helperText={
              valid
                ? t('split.personalRest', { amount: money(personal, row.account_currency) })
                : t('split.amountRange', { max: money(charge, row.account_currency) })
            }
            inputProps={{ step: '0.01', min: '0', max: String(charge), 'data-testid': 'trip-split-business-amount' }}
            InputProps={{
              startAdornment: <InputAdornment position="start">{symbol(row.account_currency)}</InputAdornment>,
            }}
            fullWidth
          />
          <FormControl fullWidth disabled={!valid || parsed === 0}>
            <InputLabel id="trip-split-status-label">{t('split.status')}</InputLabel>
            <Select
              labelId="trip-split-status-label"
              label={t('split.status')}
              value={status}
              onChange={(event) => setStatus(event.target.value as TripReimbursementStatus)}
            >
              {TRIP_REIMBURSEMENT_STATUSES.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(`reimbursementStatus.${value}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label={t('split.note')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('split.notePlaceholder')}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={!valid || saving} data-testid="trip-split-save">
          {t('common:actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
