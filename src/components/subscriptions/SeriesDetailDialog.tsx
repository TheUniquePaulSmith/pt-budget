'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';

import type {
  RecurringSeries,
  RecurringSeriesStatus,
  Transaction,
} from '@/types/database';
import type { RecurringSeriesUpdate } from '@/contexts/useDatabaseSubscriptionsSlice';

const CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

interface SeriesDetailDialogProps {
  open: boolean;
  series: RecurringSeries | null;
  onClose: () => void;
  onSave: (id: number, updates: RecurringSeriesUpdate) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  getSeriesTransactions: (seriesId: number) => Promise<Transaction[]>;
}

const SeriesDetailDialog: React.FC<SeriesDetailDialogProps> = ({
  open,
  series,
  onClose,
  onSave,
  onDelete,
  getSeriesTransactions,
}) => {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<RecurringSeries['kind']>('subscription');
  const [cadence, setCadence] = useState<RecurringSeries['cadence']>('monthly');
  const [expectedAmount, setExpectedAmount] = useState('');
  const [status, setStatus] = useState<RecurringSeriesStatus>('active');
  const [notes, setNotes] = useState('');
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !series) return;

    setName(series.name);
    setKind(series.kind);
    setCadence(series.cadence);
    setExpectedAmount(series.expected_amount != null ? String(series.expected_amount) : '');
    setStatus(series.status);
    setNotes(series.notes || '');
    setError(null);

    setLoadingTransactions(true);
    getSeriesTransactions(series.id)
      .then(setTransactions)
      .catch((err) => {
        console.error('Failed to load series transactions:', err);
        setTransactions([]);
      })
      .finally(() => setLoadingTransactions(false));
  }, [open, series, getSeriesTransactions]);

  const handleSave = async () => {
    if (!series) return;
    if (!name.trim()) {
      setError('Name is required');
      return;
    }

    const parsedAmount = expectedAmount.trim() === '' ? null : Number(expectedAmount);
    if (parsedAmount !== null && Number.isNaN(parsedAmount)) {
      setError('Expected amount must be a number');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(series.id, {
        name: name.trim(),
        kind,
        cadence,
        expected_amount: parsedAmount,
        status,
        notes: notes.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!series) return;
    setSaving(true);
    setError(null);
    try {
      await onDelete(series.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete series');
    } finally {
      setSaving(false);
    }
  };

  if (!series) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{series.name}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box display="flex" flexWrap="wrap" gap={2} mt={1} mb={3}>
          <TextField
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            sx={{ flex: '2 1 240px' }}
            size="small"
          />
          <TextField
            select
            label="Type"
            value={kind}
            onChange={(event) => setKind(event.target.value as RecurringSeries['kind'])}
            sx={{ flex: '1 1 140px' }}
            size="small"
          >
            <MenuItem value="subscription">Subscription</MenuItem>
            <MenuItem value="bill">Recurring bill</MenuItem>
          </TextField>
          <TextField
            select
            label="Cadence"
            value={cadence}
            onChange={(event) => setCadence(event.target.value as RecurringSeries['cadence'])}
            sx={{ flex: '1 1 140px' }}
            size="small"
          >
            <MenuItem value="weekly">Weekly</MenuItem>
            <MenuItem value="biweekly">Every 2 weeks</MenuItem>
            <MenuItem value="monthly">Monthly</MenuItem>
            <MenuItem value="quarterly">Quarterly</MenuItem>
            <MenuItem value="yearly">Yearly</MenuItem>
            <MenuItem value="irregular">Irregular</MenuItem>
          </TextField>
          <TextField
            label="Expected amount"
            value={expectedAmount}
            onChange={(event) => setExpectedAmount(event.target.value)}
            sx={{ flex: '1 1 140px' }}
            size="small"
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          <TextField
            select
            label="Status"
            value={status}
            onChange={(event) => setStatus(event.target.value as RecurringSeriesStatus)}
            sx={{ flex: '1 1 140px' }}
            size="small"
          >
            <MenuItem value="candidate">Needs review</MenuItem>
            <MenuItem value="active">Active</MenuItem>
            <MenuItem value="inactive">Inactive</MenuItem>
            <MenuItem value="ignored">Ignored</MenuItem>
          </TextField>
          <TextField
            label="Notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            fullWidth
            size="small"
            multiline
            minRows={2}
          />
        </Box>

        <Typography variant="subtitle1" gutterBottom>
          Matched transactions
        </Typography>
        {loadingTransactions ? (
          <Box display="flex" justifyContent="center" py={3}>
            <CircularProgress size={28} />
          </Box>
        ) : transactions.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No transactions are linked to this series yet.
          </Typography>
        ) : (
          <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 320 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Account</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {transactions.map((txn) => (
                  <TableRow key={txn.id} hover>
                    <TableCell>{txn.date}</TableCell>
                    <TableCell>{txn.description}</TableCell>
                    <TableCell>{txn.account_name || '—'}</TableCell>
                    <TableCell align="right">{CURRENCY.format(Math.abs(txn.amount))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>
      <DialogActions>
        <Button color="error" onClick={handleDelete} disabled={saving}>
          Delete Series
        </Button>
        <Box flex={1} />
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SeriesDetailDialog;
