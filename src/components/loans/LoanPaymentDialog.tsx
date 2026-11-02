'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';

import type { LoanPaymentUpdate } from '@/contexts/useDatabaseLoansSlice';
import type { LoanManualPaymentInput } from '@/types/database';
import type { LoanLedgerEntry } from '@/types/loans';
import { formatCurrency } from './loanPresentation';

interface LoanPaymentDialogProps {
  open: boolean;
  loanId: number;
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
export default function LoanPaymentDialog({ open, loanId, entry, onClose, onAdd, onUpdate }: LoanPaymentDialogProps) {
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
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or more`);
    return value;
  };

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const principalValue = parse(principal, 'Principal');
      const interestValue = parse(interest, 'Interest');
      if (entry) {
        const update: LoanPaymentUpdate = {
          principal_amount: principalValue,
          interest_amount: interestValue,
          notes: notes.trim() || null,
        };
        if (!isLinked) {
          update.payment_date = date;
          update.amount = parse(amount, 'Amount') ?? 0;
        }
        await onUpdate(entry.payment_id as number, update);
      } else {
        await onAdd({
          loan_id: loanId,
          payment_date: date,
          amount: parse(amount, 'Amount') ?? 0,
          principal_amount: principalValue,
          interest_amount: interestValue,
          notes: notes.trim() || null,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save payment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{entry ? 'Edit Payment' : 'Record Payment'}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          {isLinked && entry && (
            <Typography variant="body2" color="text.secondary">
              Linked to {entry.description || 'a transaction'} on {entry.date} ({formatCurrency(entry.amount)}). Date and amount
              follow the transaction.
            </Typography>
          )}
          {!isLinked && (
            <>
              <TextField
                label="Date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                size="small"
                required
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'data-testid': 'loan-payment-date' } }}
              />
              <TextField
                label="Amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                size="small"
                required
                slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'loan-payment-amount' } }}
              />
            </>
          )}
          <Typography variant="subtitle2">Principal / interest split</Typography>
          <Typography variant="body2" color="text.secondary">
            Leave both empty to use the split computed from the loan terms. Fill one or both from the statement to override it.
          </Typography>
          <Box display="flex" gap={2}>
            <TextField
              label="Principal"
              value={principal}
              onChange={(event) => setPrincipal(event.target.value)}
              size="small"
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'loan-payment-principal' } }}
            />
            <TextField
              label="Interest"
              value={interest}
              onChange={(event) => setInterest(event.target.value)}
              size="small"
              sx={{ flex: 1 }}
              slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'loan-payment-interest' } }}
            />
          </Box>
          <TextField label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} size="small" multiline minRows={2} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving} data-testid="loan-payment-save">
          {saving ? 'Saving…' : entry ? 'Save' : 'Record'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
