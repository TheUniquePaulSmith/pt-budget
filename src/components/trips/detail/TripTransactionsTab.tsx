'use client';

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Menu,
  MenuItem,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Business as BusinessIcon,
  CallSplit as SplitIcon,
  LinkOff as RemoveIcon,
  Person as PersonalIcon,
  Flag as StatusIcon,
} from '@mui/icons-material';
import type { GridColDef, GridRowSelectionModel } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';

import AccountLabel from '@/components/accounts/AccountLabel';
import { useAccountLabels } from '@/components/accounts/useAccountLabels';
import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { useTripDetailSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { fullBusinessAmount } from '@/lib/tripInsights';
import type { Trip } from '@/types/database';
import type { TripInsightRow, TripReimbursementStatus } from '@/types/tripExpenses';
import { TRIP_REIMBURSEMENT_STATUSES } from '@/types/tripExpenses';

import AddTripTransactionsDialog from './AddTripTransactionsDialog';
import TripSplitDialog from './TripSplitDialog';
import { reimbursementStatusColor, tripExpenseErrorKey } from './tripExpensePresentation';

const EMPTY_SELECTION: GridRowSelectionModel = { type: 'include', ids: new Set() };

/** The personal part of a row in its account currency (money out positive, a refund negative). */
function personalAmount(row: TripInsightRow): number {
  if (row.type === 'refund') return -row.amount;
  if (row.type !== 'expense') return 0;
  const business = row.status === 'denied' ? 0 : row.business_amount ?? 0;
  return Math.round((-row.amount - business) * 100) / 100;
}

export interface TripTransactionsTabProps {
  trip: Trip;
  rows: TripInsightRow[];
}

export default function TripTransactionsTab({ trip, rows }: TripTransactionsTabProps) {
  const { t } = useTranslation(['trips', 'common']);
  const { money, date } = useFormatters();
  const { accounts, users, assignTransactionsToTrip, setTripAllocations, setTripReimbursementStatus } = useTripDetailSlice();
  const labels = useAccountLabels(accounts, users);
  const hasBusiness = (trip.expense_mode ?? 'personal') !== 'personal';

  const [selection, setSelection] = useState<GridRowSelectionModel>(EMPTY_SELECTION);
  const [splitRow, setSplitRow] = useState<TripInsightRow | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [statusAnchor, setStatusAnchor] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedRows = useMemo(() => {
    const ids = selection.ids;
    return rows.filter((row) => (selection.type === 'include' ? ids.has(row.transaction_id) : !ids.has(row.transaction_id)));
  }, [rows, selection]);
  const selectedExpenses = selectedRows.filter((row) => row.type === 'expense' && row.amount < 0);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setSelection(EMPTY_SELECTION);
    } catch (runError) {
      setError(t(tripExpenseErrorKey(runError)));
    } finally {
      setBusy(false);
    }
  };

  const markAll = (business: boolean) =>
    run(() =>
      setTripAllocations(
        selectedExpenses.map((row) => ({
          transactionId: row.transaction_id,
          businessAmount: business ? fullBusinessAmount(row.amount) : 0,
        }))
      )
    );

  const setStatus = (status: TripReimbursementStatus) => {
    setStatusAnchor(null);
    void run(() => setTripReimbursementStatus(selectedExpenses.map((row) => row.transaction_id), status));
  };

  const remove = (ids: number[]) => run(() => assignTransactionsToTrip(ids, null));

  const columns = useMemo<GridColDef<TripInsightRow>[]>(() => {
    const list: GridColDef<TripInsightRow>[] = [
      {
        field: 'date',
        headerName: t('common:fields.date'),
        minWidth: 110,
        valueFormatter: (value) => (value ? date(String(value)) : ''),
      },
      { field: 'description', headerName: t('common:fields.description'), flex: 1, minWidth: 180 },
      {
        field: 'account_id',
        headerName: t('common:fields.account'),
        minWidth: 150,
        flex: 0.7,
        sortable: false,
        renderCell: (params) => (
          <Typography variant="body2" component="div" sx={{ minWidth: 0, maxWidth: '100%' }}>
            <AccountLabel label={labels.get(params.row.account_id)} noWrap tabIndex={params.tabIndex} />
          </Typography>
        ),
      },
      {
        field: 'user_name',
        headerName: t('common:fields.user'),
        minWidth: 110,
        valueFormatter: (value) => (value ? String(value) : t('common:fields.none')),
      },
      {
        field: 'category_name',
        headerName: t('common:fields.category'),
        minWidth: 140,
        renderCell: (params) =>
          params.row.category_name ? (
            <Chip
              size="small"
              label={params.row.category_name}
              sx={{ bgcolor: params.row.category_color || 'action.selected', color: 'common.white' }}
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {t('insights.uncategorized')}
            </Typography>
          ),
      },
      {
        field: 'amount',
        headerName: t('common:fields.amount'),
        type: 'number',
        minWidth: 120,
        renderCell: (params) => (
          <Typography variant="body2" fontWeight={600} color={params.row.amount < 0 ? 'error.main' : 'success.main'}>
            {money(params.row.amount, params.row.account_currency)}
          </Typography>
        ),
      },
    ];
    if (hasBusiness) {
      list.push(
        {
          field: 'business_amount',
          headerName: t('transactions.business'),
          type: 'number',
          minWidth: 110,
          renderCell: (params) =>
            (params.row.business_amount ?? 0) > 0 ? (
              <Typography
                variant="body2"
                sx={params.row.status === 'denied' ? { textDecoration: 'line-through' } : undefined}
                data-testid={`trip-row-business-${params.row.transaction_id}`}
              >
                {money(params.row.business_amount, params.row.account_currency)}
              </Typography>
            ) : (
              <Typography variant="body2" color="text.secondary">
                —
              </Typography>
            ),
        },
        {
          field: 'personal',
          headerName: t('transactions.personal'),
          type: 'number',
          minWidth: 110,
          valueGetter: (_value, row) => personalAmount(row),
          renderCell: (params) => (
            <Typography variant="body2" data-testid={`trip-row-personal-${params.row.transaction_id}`}>
              {money(personalAmount(params.row), params.row.account_currency)}
            </Typography>
          ),
        },
        {
          field: 'status',
          headerName: t('transactions.status'),
          minWidth: 120,
          renderCell: (params) =>
            params.row.status && (params.row.business_amount ?? 0) > 0 ? (
              <Chip
                size="small"
                color={reimbursementStatusColor(params.row.status)}
                label={t(`reimbursementStatus.${params.row.status}`)}
              />
            ) : null,
        }
      );
    }
    list.push({
      field: 'actions',
      headerName: t('common:fields.actions'),
      sortable: false,
      filterable: false,
      minWidth: hasBusiness ? 100 : 60,
      renderCell: (params) => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          {hasBusiness && params.row.type === 'expense' && params.row.amount < 0 && (
            <Tooltip title={t('transactions.split')}>
              <IconButton
                size="small"
                aria-label={t('transactions.splitRow', { description: params.row.description })}
                onClick={() => setSplitRow(params.row)}
                tabIndex={params.tabIndex}
                data-testid={`trip-row-split-${params.row.transaction_id}`}
              >
                <SplitIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t('transactions.remove')}>
            <IconButton
              size="small"
              aria-label={t('transactions.removeRow', { description: params.row.description })}
              onClick={() => void remove([params.row.transaction_id])}
              tabIndex={params.tabIndex}
            >
              <RemoveIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    });
    // The money first, so the split stays in view on narrow screens; who and where after it.
    const order = ['date', 'description', 'amount', 'business_amount', 'personal', 'status', 'category_name', 'user_name', 'account_id', 'actions'];
    return [...list].sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
    // `remove` only closes over stable callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, hasBusiness, labels, money, t]);

  return (
    <Stack spacing={2}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack direction="row" alignItems="center" sx={{ mb: 1.5, gap: 1, flexWrap: 'wrap' }}>
          <Typography variant="subtitle1" component="h2" fontWeight="bold" sx={{ flexGrow: 1 }}>
            {t('transactions.title', { count: rows.length })}
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAddOpen(true)} data-testid="trip-add-transactions">
            {t('transactions.add')}
          </Button>
        </Stack>
        {hasBusiness && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {trip.expense_mode === 'business' ? t('transactions.helpBusiness') : t('transactions.helpMixed')}
          </Typography>
        )}

        {selectedRows.length > 0 && (
          <Stack
            direction="row"
            alignItems="center"
            data-testid="trip-bulk-actions"
            sx={{ mb: 1.5, p: 1, gap: 1, flexWrap: 'wrap', bgcolor: 'action.hover', borderRadius: 1 }}
          >
            <Typography variant="body2" sx={{ mr: 1 }}>
              {t('transactions.selected', { count: selectedRows.length })}
            </Typography>
            {hasBusiness && (
              <>
                <Button
                  size="small"
                  startIcon={<BusinessIcon />}
                  disabled={busy || selectedExpenses.length === 0}
                  onClick={() => void markAll(true)}
                  data-testid="trip-bulk-business"
                >
                  {t('transactions.allBusiness')}
                </Button>
                <Button
                  size="small"
                  startIcon={<PersonalIcon />}
                  disabled={busy || selectedExpenses.length === 0}
                  onClick={() => void markAll(false)}
                  data-testid="trip-bulk-personal"
                >
                  {t('transactions.allPersonal')}
                </Button>
                <Button
                  size="small"
                  startIcon={<StatusIcon />}
                  disabled={busy || selectedExpenses.length === 0}
                  onClick={(event) => setStatusAnchor(event.currentTarget)}
                  aria-haspopup="menu"
                  data-testid="trip-bulk-status"
                >
                  {t('transactions.setStatus')}
                </Button>
                <Menu anchorEl={statusAnchor} open={statusAnchor !== null} onClose={() => setStatusAnchor(null)}>
                  {TRIP_REIMBURSEMENT_STATUSES.map((status) => (
                    <MenuItem key={status} onClick={() => setStatus(status)}>
                      {t(`reimbursementStatus.${status}`)}
                    </MenuItem>
                  ))}
                </Menu>
              </>
            )}
            <Button
              size="small"
              color="error"
              startIcon={<RemoveIcon />}
              disabled={busy}
              onClick={() => void remove(selectedRows.map((row) => row.transaction_id))}
              data-testid="trip-bulk-remove"
            >
              {t('transactions.removeSelected')}
            </Button>
          </Stack>
        )}

        <AppDataGrid<TripInsightRow>
          rows={rows}
          columns={columns}
          getRowId={(row) => row.transaction_id}
          checkboxSelection
          rowSelectionModel={selection}
          onRowSelectionModelChange={setSelection}
          initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
          emptyMessage={t('transactions.empty')}
          height={560}
          // Custom cells (amounts, the account label) sit on the row's centre line like the chips.
          sx={{
            '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center' },
            '& .MuiDataGrid-cell--textRight': { justifyContent: 'flex-end' },
          }}
        />
      </Paper>

      {splitRow && <TripSplitDialog row={splitRow} onClose={() => setSplitRow(null)} />}
      {addOpen && <AddTripTransactionsDialog trip={trip} onClose={() => setAddOpen(false)} />}
    </Stack>
  );
}
