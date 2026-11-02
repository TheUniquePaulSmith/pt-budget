'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography } from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { useFormatters } from '@/contexts/useFormatters';
import type { LoanLinkCandidate } from '@/types/loans';

interface LinkTransactionDialogProps {
  open: boolean;
  loanName: string;
  search: (text: string) => Promise<LoanLinkCandidate[]>;
  onClose: () => void;
  onLink: (transactionId: number) => Promise<void>;
}

export default function LinkTransactionDialog({ open, loanName, search, onClose, onLink }: LinkTransactionDialogProps) {
  const { t } = useTranslation('loans');
  const { money } = useFormatters();
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
          if (!cancelled) setError(err instanceof Error ? err.message : t('linkTransactionDialog.searchFailed'));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, search, t, text]);

  const handleLink = async (id: number) => {
    setLinkingId(id);
    setError(null);
    try {
      await onLink(id);
      setRows((previous) => previous.filter((row) => row.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('linkTransactionDialog.linkFailed'));
    } finally {
      setLinkingId(null);
    }
  };

  const columns = useMemo<GridColDef<LoanLinkCandidate>[]>(
    () => [
      { field: 'date', headerName: t('linkTransactionDialog.columnDate'), width: 110 },
      { field: 'description', headerName: t('linkTransactionDialog.columnDescription'), flex: 1.4, minWidth: 200 },
      { field: 'account_name', headerName: t('linkTransactionDialog.columnAccount'), flex: 0.8, minWidth: 140, valueGetter: (_, row) => row.account_name ?? '—' },
      {
        field: 'amount',
        headerName: t('linkTransactionDialog.columnAmount'),
        width: 120,
        align: 'right',
        headerAlign: 'right',
        renderCell: (params) => money(Math.abs(params.row.amount)),
      },
      {
        field: 'actions',
        headerName: '',
        width: 110,
        sortable: false,
        filterable: false,
        renderCell: (params) => (
          <Button size="small" variant="outlined" onClick={() => handleLink(params.row.id)} disabled={linkingId != null}>
            {linkingId === params.row.id ? t('linkTransactionDialog.linking') : t('linkTransactionDialog.link')}
          </Button>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [linkingId, money, t]
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('linkTransactionDialog.title', { name: loanName })}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
          {t('linkTransactionDialog.intro')}
        </Typography>
        <TextField
          label={t('linkTransactionDialog.searchLabel')}
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
          emptyMessage={t('linkTransactionDialog.empty')}
          disableVirtualization={process.env.NODE_ENV === 'test'}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('linkTransactionDialog.done')}</Button>
      </DialogActions>
    </Dialog>
  );
}
