'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useTripDetailSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { logger } from '@/lib/logging';
import type { Trip } from '@/types/database';
import type { TripDepositCandidate, TripInsightRow, TripReimbursement } from '@/types/tripExpenses';

import { shiftIsoDate, todayIsoDate, tripExpenseErrorKey } from './tripExpensePresentation';

const log = logger.child({ component: 'RecordReimbursementDialog' });

export interface RecordReimbursementDialogProps {
  trip: Trip;
  rows: readonly TripInsightRow[];
  /** What is still owed (default currency); the amount a new receipt starts with. */
  outstanding: number;
  /** The receipt to edit; null records a new one. */
  receipt: TripReimbursement | null;
  onClose: () => void;
}

/**
 * Records money received back for a trip. It may have come in a deposit of
 * its own or inside a paycheck; it need not match what was claimed.
 */
export default function RecordReimbursementDialog({ trip, rows, outstanding, receipt, onClose }: RecordReimbursementDialogProps) {
  const { t } = useTranslation(['trips', 'common']);
  const { money, date, symbol } = useFormatters();
  const { findTripDepositCandidates, addTripReimbursement, updateTripReimbursement } = useTripDetailSlice();

  const [amount, setAmount] = useState(() =>
    receipt ? String(receipt.amount) : outstanding > 0 ? outstanding.toFixed(2) : ''
  );
  const [receivedDate, setReceivedDate] = useState(receipt?.received_date ?? todayIsoDate());
  const [note, setNote] = useState(receipt?.note ?? '');
  const [deposits, setDeposits] = useState<TripDepositCandidate[]>([]);
  const [depositId, setDepositId] = useState<number | null>(receipt?.transaction_id ?? null);
  const [asRefund, setAsRefund] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Business parts not yet paid back, offered to mark reimbursed with this receipt.
  const openItems = useMemo(
    () =>
      rows.filter(
        (row) => (row.business_amount ?? 0) > 0 && (row.status === 'pending' || row.status === 'submitted')
      ),
    [rows]
  );
  const [markIds, setMarkIds] = useState<Set<number>>(
    () => new Set(receipt ? [] : openItems.map((row) => row.transaction_id))
  );

  // Deposits from the trip's start (or two months back) to today.
  useEffect(() => {
    let cancelled = false;
    const today = todayIsoDate();
    const from = trip.start_date && trip.start_date < today ? trip.start_date : shiftIsoDate(today, -60);
    findTripDepositCandidates(from, today)
      .then((found) => {
        if (cancelled) return;
        // The receipt's own deposit stays selectable even when it is outside the window.
        const linked = receipt?.transaction_id;
        if (linked != null && !found.some((candidate) => candidate.transaction_id === linked)) {
          found = [
            {
              transaction_id: linked,
              date: receipt?.transaction_date ?? '',
              description: receipt?.transaction_description ?? '',
              amount: receipt?.transaction_amount ?? 0,
              type: receipt?.transaction_type ?? 'income',
              account_id: receipt?.transaction_account_id ?? 0,
              account_currency: receipt?.transaction_account_currency ?? '',
            },
            ...found,
          ];
        }
        setDeposits(found);
      })
      .catch((loadError) => log.error('Failed to load deposits', { operation: 'loadDeposits', error: loadError }));
    return () => {
      cancelled = true;
    };
  }, [findTripDepositCandidates, receipt, trip.start_date]);

  const deposit = deposits.find((candidate) => candidate.transaction_id === depositId) ?? null;
  const depositOptionLabel = (candidate: TripDepositCandidate) =>
    t('reimburse.depositOption', {
      description: candidate.description,
      date: date(candidate.date),
      amount: money(candidate.amount, candidate.account_currency),
    });

  const toggleMark = (id: number) =>
    setMarkIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleSave = async () => {
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError(t('errors.TRIP_REIMBURSEMENT_AMOUNT_INVALID'));
      return;
    }
    setSaving(true);
    setError(null);
    const input = {
      amount: parsed,
      receivedDate: receivedDate || null,
      transactionId: depositId,
      note,
      markReimbursedIds: [...markIds],
      countDepositAsRefund: deposit?.type === 'income' && asRefund,
    };
    try {
      if (receipt) await updateTripReimbursement(receipt.id, input);
      else await addTripReimbursement({ ...input, tripId: trip.id });
      onClose();
    } catch (saveError) {
      setError(t(tripExpenseErrorKey(saveError)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{receipt ? t('reimburse.edit') : t('reimburse.record')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2" color="text.secondary">
            {t('reimburse.intro')}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={t('reimburse.amount')}
              type="number"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              inputProps={{ step: '0.01', min: '0', 'data-testid': 'trip-reimbursement-amount' }}
              InputProps={{ startAdornment: <InputAdornment position="start">{symbol()}</InputAdornment> }}
              helperText={t('reimburse.amountHelp')}
              fullWidth
              required
            />
            <TextField
              label={t('reimburse.receivedDate')}
              type="date"
              value={receivedDate}
              onChange={(event) => setReceivedDate(event.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Stack>

          <Box>
            <Autocomplete
              options={deposits}
              value={deposit}
              onChange={(_, next) => {
                setDepositId(next?.transaction_id ?? null);
                setAsRefund(false);
              }}
              getOptionLabel={depositOptionLabel}
              isOptionEqualToValue={(option, value) => option.transaction_id === value.transaction_id}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('reimburse.deposit')}
                  placeholder={t('reimburse.depositPlaceholder')}
                  inputProps={{ ...params.inputProps, 'data-testid': 'trip-reimbursement-deposit' }}
                />
              )}
              noOptionsText={t('reimburse.noDeposits')}
            />
            <FormHelperText>{t('reimburse.depositHelp')}</FormHelperText>
          </Box>

          {deposit?.type === 'income' && (
            <Box>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={asRefund}
                    onChange={(event) => setAsRefund(event.target.checked)}
                    inputProps={{ 'aria-describedby': 'trip-reimbursement-refund-help' }}
                    data-testid="trip-reimbursement-as-refund"
                  />
                }
                label={t('reimburse.countAsRefund')}
              />
              <FormHelperText id="trip-reimbursement-refund-help">{t('reimburse.countAsRefundHelp')}</FormHelperText>
            </Box>
          )}
          {deposit?.type === 'refund' && <Alert severity="info">{t('reimburse.alreadyRefund')}</Alert>}
          {!deposit && <Alert severity="info">{t('reimburse.paycheckHelp')}</Alert>}

          {openItems.length > 0 && (
            <Box>
              <Typography variant="subtitle2" component="h3">
                {t('reimburse.markTitle')}
              </Typography>
              <FormGroup>
                {openItems.map((row) => (
                  <FormControlLabel
                    key={row.transaction_id}
                    control={<Checkbox checked={markIds.has(row.transaction_id)} onChange={() => toggleMark(row.transaction_id)} />}
                    label={t('reimburse.markItem', {
                      description: row.description,
                      amount: money(row.business_amount, row.account_currency),
                    })}
                  />
                ))}
              </FormGroup>
            </Box>
          )}

          <TextField
            label={t('common:fields.notes')}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            multiline
            minRows={2}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={saving} data-testid="trip-reimbursement-save">
          {t('common:actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
