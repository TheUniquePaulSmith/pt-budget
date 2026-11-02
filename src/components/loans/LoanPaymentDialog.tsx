'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import type { LoanPaymentUpdate } from '@/contexts/useDatabaseLoansSlice';
import { useFormatters } from '@/contexts/useFormatters';
import type { LoanManualPaymentInput } from '@/types/database';
import type { LoanLedgerEntry } from '@/types/loans';

interface LoanPaymentDialogProps {
  open: boolean;
  loanId: number;
  /** The loan's currency (its linked account's); null for the default currency. */
  currency?: string | null;
  /** The ledger row being edited, or null to record a new manual payment. */
  entry: LoanLedgerEntry | null;
  onClose: () => void;
  onAdd: (input: LoanManualPaymentInput) => Promise<void>;
  onUpdate: (paymentId: number, update: LoanPaymentUpdate) => Promise<void>;
}

/**
 * Records a payment made from an untracked account, or edits a payment's
 * principal / interest split from the lender's statement. Leaving the split
 * empty keeps (or restores) the computed split.
 */
export default function LoanPaymentDialog({ open, loanId, currency, entry, onClose, onAdd, onUpdate }: LoanPaymentDialogProps) {
  const { t } = useTranslation('loans');
  const { money } = useFormatters();
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [principal, setPrincipal] = useState('');
  const [interest, setInterest] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isLinked = entry?.transaction_id != null;

  useEffect(() => {
    if (!open) return;
    if (entry) {
      setDate(entry.date);
      setAmount(String(entry.amount));
      setPrincipal(entry.split_source === 'manual' ? String(entry.principal) : '');
      setInterest(entry.split_source === 'manual' ? String(entry.interest) : '');
      setNotes(entry.notes ?? '');
    } else {
      setDate('');
      setAmount('');
      setPrincipal('');
      setInterest('');
      setNotes('');
    }
    setError(null);
  }, [entry, open]);

  const parse = (text: string, label: string): number | null => {
    if (text.trim() === '') return null;
    const value = Number(text);
    if (!Number.isFinite(value) || value < 0) throw new Error(t('paymentDialog.mustBeZeroOrMore', { label }));
    return value;
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const principalValue = parse(principal, t('paymentDialog.fieldPrincipal'));
      const interestValue = parse(interest, t('paymentDialog.fieldInterest'));
      if (entry) {
        const update: LoanPaymentUpdate = {
          principal_amount: principalValue,
          interest_amount: interestValue,
          notes: notes.trim() || null,
        };
        if (!isLinked) {
          update.payment_date = date;
          update.amount = parse(amount, t('paymentDialog.fieldAmount')) ?? 0;
        }
        await onUpdate(entry.payment_id as number, update);
      } else {
        await onAdd({
          loan_id: loanId,
          payment_date: date,
          amount: parse(amount, t('paymentDialog.fieldAmount')) ?? 0,
          principal_amount: principalValue,
          interest_amount: interestValue,
          notes: notes.trim() || null,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('paymentDialog.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{entry ? t('paymentDialog.editTitle') : t('paymentDialog.recordTitle')}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          {isLinked && entry && (
            <Typography variant="body2" color="text.secondary">
              {t('paymentDialog.linkedInfo', {
                description: entry.description || t('paymentDialog.aTransaction'),
                date: entry.date,
                amount: money(entry.amount, currency),
              })}
            </Typography>
          )}
          {!isLinked && (
            <>
              <TextField
                label={t('paymentDialog.date')}
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                size="small"
                required
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'data-testid': 'loan-payment-date' } }}
              />
              <TextField
                label={t('paymentDialog.amount')}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                size="small"
                required
                slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'loan-payment-amount' } }}
              />
            </>
          )}
          <Typography variant="subtitle2">{t('paymentDialog.splitTitle')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('paymentDialog.splitHelp')}
          </Typography>
          <Box display="flex" gap={2}>
            <TextField
              label={t('paymentDialog.principal')}
              value={principal}
              onChange={(event) => setPrincipal(event.target.value)}
              size="small"
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'loan-payment-principal' } }}
            />
            <TextField
              label={t('paymentDialog.interest')}
              value={interest}
              onChange={(event) => setInterest(event.target.value)}
              size="small"
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'loan-payment-interest' } }}
            />
          </Box>
          <TextField label={t('paymentDialog.notes')} value={notes} onChange={(event) => setNotes(event.target.value)} size="small" multiline minRows={2} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('paymentDialog.cancel')}
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving} data-testid="loan-payment-save">
          {saving ? t('paymentDialog.saving') : entry ? t('paymentDialog.save') : t('paymentDialog.record')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
