'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  TextField,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { EditNote, MoreVert, Receipt } from '@mui/icons-material';
import type { GridColDef } from '@mui/x-data-grid';
import { gridExpandedSortedRowIdsSelector, useGridApiContext, useGridSelector } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { accountColumn, cardColumn, categoryChipColumn, currencyColumn, dateColumn, indicatorsColumn, userColumn } from '@/components/common/DataGrid/columns';
import { useLongPress } from '@/components/common/DataGrid/useLongPress';
import { useFormatters } from '@/contexts/useFormatters';
import TransactionLabelDialog from '@/components/transactions/TransactionLabelDialog';
import TransactionRowActionsMenu from '@/components/transactions/TransactionRowActionsMenu';
import { Transaction } from '@/types/database';

interface RecentTransactionsProps {
  transactions: Transaction[];
  limit?: number;
  onLimitChange?: (limit: number) => void;
  onSetComment?: (txId: number, comment: string) => Promise<void>;
  budgetedCategoryIds?: Set<number>;
}

const EMPTY_BUDGETED_CATEGORY_IDS = new Set<number>();

const RecentTransactions: React.FC<RecentTransactionsProps> = ({
  transactions,
  limit = 10,
  onLimitChange,
  onSetComment,
  budgetedCategoryIds = EMPTY_BUDGETED_CATEGORY_IDS,
}) => {
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [commentTransaction, setCommentTransaction] = useState<Transaction | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [labelTransaction, setLabelTransaction] = useState<Transaction | null>(null);
  const [quickActions, setQuickActions] = useState<{
    anchorEl?: HTMLElement | null;
    anchorPosition?: { top: number; left: number } | null;
    transaction: Transaction;
  } | null>(null);

  const { t } = useTranslation(['dashboard', 'common']);
  const { money, date } = useFormatters();
  const formatCurrency = useCallback((amount: number, currency?: string | null) => money(amount, currency), [money]);

  const rows = useMemo(() => transactions.slice(0, limit), [transactions, limit]);

  // Right-click and long-press open the same row menu as the kebab button.
  const openRowMenuAt = useCallback(
    (rowId: number, position: { top: number; left: number }) => {
      const transaction = rows.find((row) => row.id === rowId);
      if (transaction) setQuickActions({ anchorPosition: position, transaction });
    },
    [rows]
  );
  const handleRowContextMenu = (event: React.MouseEvent<HTMLElement>) => {
    const rowId = Number(event.currentTarget.getAttribute('data-id'));
    if (!Number.isFinite(rowId)) return;
    event.preventDefault();
    openRowMenuAt(rowId, { top: event.clientY, left: event.clientX });
  };
  const longPressHandlers = useLongPress(({ target, clientX, clientY }) => {
    const rowId = Number(target.getAttribute('data-id'));
    if (Number.isFinite(rowId)) openRowMenuAt(rowId, { top: clientY, left: clientX });
  });
  const handleOpenCommentDialog = (transaction: Transaction) => {
    setCommentTransaction(transaction);
    setCommentDraft(transaction.comment || '');
    setCommentDialogOpen(true);
  };

  const handleOpenLabelDialog = (transaction: Transaction) => {
    setLabelTransaction(transaction);
    setLabelDialogOpen(true);
  };

  const handleSaveComment = async () => {
    if (!commentTransaction || !onSetComment) return;
    await onSetComment(commentTransaction.id, commentDraft);
    setCommentDialogOpen(false);
    setCommentTransaction(null);
    setCommentDraft('');
  };

  const columns = useMemo<GridColDef<Transaction>[]>(() => [
    {
      ...dateColumn<Transaction>('date'),
      valueFormatter: (value) => value ? date(String(value)) : '',
    },
    { field: 'description', headerName: t('common:fields.description'), flex: 1.4, minWidth: 220 },
    categoryChipColumn<Transaction>(),
    { field: 'company_name', headerName: t('common:fields.company'), minWidth: 160, flex: 0.8, valueGetter: (_, row) => row.company_name || '' },
    userColumn<Transaction>(),
    accountColumn<Transaction>(),
    cardColumn<Transaction>(),
    indicatorsColumn(budgetedCategoryIds),
    currencyColumn<Transaction>('amount', money, { currencyOf: (row) => row.account_currency }),
    {
      field: 'actions',
      headerName: t('common:fields.actions'),
      width: 130,
      sortable: false,
      filterable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: (params) => (
        <Stack direction="row" spacing={0.5} justifyContent="center">
          <IconButton
            size="small"
            onClick={() => handleOpenCommentDialog(params.row)}
            title={t('recentTransactions.editComment')}
            disabled={!onSetComment}
          >
            <EditNote fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={() => handleOpenLabelDialog(params.row)}
            title={t('recentTransactions.labelTransaction')}
          >
            <Receipt fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            onClick={(event) =>
              setQuickActions({ anchorEl: event.currentTarget, transaction: params.row })
            }
            title={t('recentTransactions.moreActions')}
          >
            <MoreVert fontSize="small" />
          </IconButton>
        </Stack>
      ),
    },
  ], [budgetedCategoryIds, onSetComment, money, date, t]);

  function FooterSummary() {
    const apiRef = useGridApiContext();
    const rowIds = useGridSelector(apiRef, gridExpandedSortedRowIdsSelector);
    const filteredRows = rowIds
      .map((id) => apiRef.current.getRow(id) as Transaction | null)
      .filter((row): row is Transaction => !!row);
    const net = filteredRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return (
      <Typography variant="body2" color="text.secondary">
        {t('recentTransactions.footer', { count: filteredRows.length, net: formatCurrency(net) })}
      </Typography>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">
          {t('recentTransactions.title')}
        </Typography>
        {onLimitChange && (
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>{t('recentTransactions.show')}</InputLabel>
            <Select
              value={limit}
              label={t('recentTransactions.show')}
              onChange={(e) => onLimitChange(Number(e.target.value))}
            >
              {[10, 25, 50, 100].map((option) => (
                <MenuItem key={option} value={option}>{t('recentTransactions.last', { count: option })}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Box>
      <AppDataGrid
        rows={rows}
        columns={columns}
        height={Math.min(Math.max(rows.length * 54 + 150, 320), 680)}
        initialState={{ pagination: { paginationModel: { pageSize: Math.min(limit, 100), page: 0 } } }}
        showToolbar
        slotProps={{ row: { onContextMenu: handleRowContextMenu, ...longPressHandlers } }}
        getRowClassName={(params) => (params.row.is_excluded ? 'transaction-row--excluded' : '')}
        sx={{ '& .transaction-row--excluded': { opacity: 0.55 } }}
        footerSummary={<FooterSummary />}
        emptyMessage={t('recentTransactions.empty')}
        disableVirtualization={process.env.NODE_ENV === 'test'}
      />
      <Dialog open={commentDialogOpen} onClose={() => setCommentDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{t('recentTransactions.editComment')}</DialogTitle>
        <DialogContent>
          <TextField
            label={t('common:fields.comment')}
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
            fullWidth
            multiline
            minRows={3}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCommentDialogOpen(false)}>{t('common:actions.cancel')}</Button>
          <Button variant="contained" onClick={() => { void handleSaveComment(); }} disabled={!onSetComment}>{t('common:actions.save')}</Button>
        </DialogActions>
      </Dialog>
      <TransactionLabelDialog
        open={labelDialogOpen}
        onClose={() => setLabelDialogOpen(false)}
        transaction={labelTransaction}
        onSuccess={() => setLabelDialogOpen(false)}
      />
      <TransactionRowActionsMenu
        anchorEl={quickActions?.anchorEl ?? null}
        anchorPosition={quickActions?.anchorPosition ?? null}
        transaction={quickActions?.transaction ?? null}
        onClose={() => setQuickActions(null)}
      />
    </Paper>
  );
};

export default RecentTransactions;
