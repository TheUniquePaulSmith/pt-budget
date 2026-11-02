'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import type { LoanLinkCandidate } from '@/types/loans';
import { formatCurrency } from './loanPresentation';

interface LinkTransactionDialogProps {
  open: boolean;
  loanName: string;
  search: (text: string) => Promise<LoanLinkCandidate[]>;
  onClose: () => void;
  onLink: (transactionId: number) => Promise<void>;
}

export default function LinkTransactionDialog({ open, loanName, search, onClose, onLink }: LinkTransactionDialogProps) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<LoanLinkCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [linkingId, setLinkingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setText('');
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      search(text)
        .then((data) => {
          if (!cancelled) setRows(data);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to search transactions');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, search, text]);

  const handleLink = async (id: number) => {
    setLinkingId(id);
    setError(null);
    try {
      await onLink(id);
      setRows((previous) => previous.filter((row) => row.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to link transaction');
    } finally {
      setLinkingId(null);
    }
  };

  const columns = useMemo<GridColDef<LoanLinkCandidate>[]>(
    () => [
      { field: 'date', headerName: 'Date', width: 110 },
      { field: 'description', headerName: 'Description', flex: 1.4, minWidth: 200 },
      { field: 'account_name', headerName: 'Account', flex: 0.8, minWidth: 140, valueGetter: (_, row) => row.account_name ?? '—' },
      {
        field: 'amount',
        headerName: 'Amount',
        width: 120,
        align: 'right',
        headerAlign: 'right',
        renderCell: (params) => formatCurrency(Math.abs(params.row.amount)),
      },
      {
        field: 'actions',
        headerName: '',
        width: 110,
        sortable: false,
        filterable: false,
        renderCell: (params) => (
          <Button size="small" variant="outlined" onClick={() => handleLink(params.row.id)} disabled={linkingId != null}>
            {linkingId === params.row.id ? 'Linking…' : 'Link'}
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linkingId]
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Link a payment to {loanName}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
          Outgoing transactions that are not yet a payment on any loan, newest first.
        </Typography>
        <TextField
          label="Search description"
          value={text}
          onChange={(event) => setText(event.target.value)}
          size="small"
          fullWidth
          autoFocus
          sx={{ mb: 2 }}
          slotProps={{ htmlInput: { 'data-testid': 'loan-link-search' } }}
        />
        <AppDataGrid
          rows={rows}
          columns={columns}
          loading={loading}
          height={380}
          hideFooter
          emptyMessage="No unlinked outgoing transactions match."
          disableVirtualization={process.env.NODE_ENV === 'test'}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
