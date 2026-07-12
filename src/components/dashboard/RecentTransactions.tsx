'use client';

import React, { useMemo, useState } from 'react';
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
import { EditNote } from '@mui/icons-material';
import type { GridColDef } from '@mui/x-data-grid';
import { gridExpandedSortedRowIdsSelector, useGridApiContext, useGridSelector } from '@mui/x-data-grid';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { accountColumn, cardColumn, categoryChipColumn, currencyColumn, dateColumn, indicatorsColumn, userColumn } from '@/components/common/DataGrid/columns';
import { Transaction } from '@/types/database';
import { format, parseISO } from 'date-fns';

interface RecentTransactionsProps {
  transactions: Transaction[];
  limit?: number;
  onLimitChange?: (limit: number) => void;
  onSetComment?: (txId: number, comment: string) => Promise<void>;
}

const RecentTransactions: React.FC<RecentTransactionsProps> = ({
  transactions,
  limit = 10,
  onLimitChange,
  onSetComment,
}) => {
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [commentTransaction, setCommentTransaction] = useState<Transaction | null>(null);
  const [commentDraft, setCommentDraft] = useState('');

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const rows = useMemo(() => transactions.slice(0, limit), [transactions, limit]);
  const budgetedCategoryIds = useMemo(() => new Set<number>(), []);
  const handleOpenCommentDialog = (transaction: Transaction) => {
    setCommentTransaction(transaction);
    setCommentDraft(transaction.comment || '');
    setCommentDialogOpen(true);
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
      valueFormatter: (value) => value ? format(parseISO(String(value)), 'MMM dd, yyyy') : '',
    },
    { field: 'description', headerName: 'Description', flex: 1.4, minWidth: 220 },
    categoryChipColumn<Transaction>(),
    { field: 'company_name', headerName: 'Company', minWidth: 160, flex: 0.8, valueGetter: (_, row) => row.company_name || '' },
    userColumn<Transaction>(),
    accountColumn<Transaction>(),
    cardColumn<Transaction>(),
    indicatorsColumn(budgetedCategoryIds),
    currencyColumn<Transaction>('amount'),
    {
      field: 'commentAction',
      headerName: 'Comment',
      width: 120,
      sortable: false,
      filterable: false,
      renderCell: (params) => {
        const hasComment = !!params.row.comment?.trim();
        return (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <IconButton size="small" onClick={() => handleOpenCommentDialog(params.row)} title="Edit Comment" disabled={!onSetComment}>
              <EditNote fontSize="small" />
            </IconButton>
            <Typography variant="caption" color={hasComment ? 'success.main' : 'text.secondary'}>
              {hasComment ? 'Yes' : 'No'}
            </Typography>
          </Stack>
        );
      },
    },
  ], [budgetedCategoryIds, onSetComment]);

  function FooterSummary() {
    const apiRef = useGridApiContext();
    const rowIds = useGridSelector(apiRef, gridExpandedSortedRowIdsSelector);
    const filteredRows = rowIds
      .map((id) => apiRef.current.getRow(id) as Transaction | null)
      .filter((row): row is Transaction => !!row);
    const net = filteredRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    return (
      <Typography variant="body2" color="text.secondary">
        {filteredRows.length} shown • Net {formatCurrency(net)}
      </Typography>
    );
  }

  return (
    <Paper sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">
          Recent Transactions
        </Typography>
        {onLimitChange && (
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Show</InputLabel>
            <Select
              value={limit}
              label="Show"
              onChange={(e) => onLimitChange(Number(e.target.value))}
            >
              <MenuItem value={10}>Last 10</MenuItem>
              <MenuItem value={25}>Last 25</MenuItem>
              <MenuItem value={50}>Last 50</MenuItem>
              <MenuItem value={100}>Last 100</MenuItem>
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
        footerSummary={<FooterSummary />}
        emptyMessage="No transactions found. Add your first transaction to get started."
        disableVirtualization={process.env.NODE_ENV === 'test'}
      />
      <Dialog open={commentDialogOpen} onClose={() => setCommentDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Edit Comment</DialogTitle>
        <DialogContent>
          <TextField
            label="Comment"
            value={commentDraft}
            onChange={(event) => setCommentDraft(event.target.value)}
            fullWidth
            multiline
            minRows={3}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCommentDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={() => { void handleSaveComment(); }} disabled={!onSetComment}>Save</Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
};

export default RecentTransactions;
