'use client';

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, Edit as EditIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useTripDetailSlice } from '@/contexts/useDatabaseSlices';
import type { TripExpenseDetail } from '@/contexts/useDatabaseTripExpensesSlice';
import { useFormatters } from '@/contexts/useFormatters';
import type { Trip } from '@/types/database';
import type { TripReimbursement } from '@/types/tripExpenses';
import { TRIP_REIMBURSEMENT_STATUSES } from '@/types/tripExpenses';

import RecordReimbursementDialog from './RecordReimbursementDialog';
import { reimbursementStatusColor, tripExpenseErrorKey } from './tripExpensePresentation';

interface FigureProps {
  label: string;
  value: string;
  help?: string;
  testId: string;
  tone?: 'default' | 'positive' | 'warning';
}

function Figure({ label, value, help, testId, tone = 'default' }: FigureProps) {
  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent sx={{ '&:last-child': { pb: 2 } }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography
          variant="h5"
          component="p"
          fontWeight="bold"
          data-testid={testId}
          color={tone === 'positive' ? 'success.main' : tone === 'warning' ? 'warning.main' : 'text.primary'}
        >
          {value}
        </Typography>
        {help && (
          <Typography variant="caption" color="text.secondary">
            {help}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export interface TripOverviewTabProps {
  trip: Trip;
  detail: TripExpenseDetail;
  onOpenTransactions: () => void;
}

export default function TripOverviewTab({ trip, detail, onOpenTransactions }: TripOverviewTabProps) {
  const { t } = useTranslation(['trips', 'common']);
  const { money, date } = useFormatters();
  const { deleteTripReimbursement } = useTripDetailSlice();
  const { summary, receipts, rows } = detail;
  const hasBusiness = (trip.expense_mode ?? 'personal') !== 'personal';

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<TripReimbursement | null>(null);
  const [toDelete, setToDelete] = useState<TripReimbursement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openRecord = (receipt: TripReimbursement | null) => {
    setEditing(receipt);
    setDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteTripReimbursement(toDelete.id);
      setToDelete(null);
    } catch (deleteError) {
      setError(t(tripExpenseErrorKey(deleteError)));
    }
  };

  const outstanding = summary.outstanding;

  return (
    <Stack spacing={2}>
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {summary.missing_rate_count > 0 && (
        <Alert severity="warning">{t('overview.missingRates', { count: summary.missing_rate_count })}</Alert>
      )}
      {rows.length === 0 && (
        <Alert
          severity="info"
          action={
            <Button color="inherit" size="small" onClick={onOpenTransactions}>
              {t('overview.addTransactions')}
            </Button>
          }
        >
          {t('overview.empty')}
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gap: 2,
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' },
        }}
      >
        <Figure label={t('overview.spent')} value={money(summary.gross_spend)} help={t('overview.spentHelp')} testId="trip-figure-spent" />
        {hasBusiness && (
          <>
            <Figure
              label={t('overview.business')}
              value={money(summary.business_share)}
              help={t('overview.businessHelp')}
              testId="trip-figure-business"
            />
            <Figure
              label={t('overview.personal')}
              value={money(summary.personal_share)}
              help={t('overview.personalHelp')}
              testId="trip-figure-personal"
            />
            <Figure
              label={t('overview.received')}
              value={money(summary.received)}
              help={trip.reimburser ? t('overview.receivedFrom', { name: trip.reimburser }) : undefined}
              testId="trip-figure-received"
              tone="positive"
            />
            <Figure
              label={outstanding < 0 ? t('overview.overReceived') : t('overview.outstanding')}
              value={money(Math.abs(outstanding))}
              help={outstanding < 0 ? t('overview.overReceivedHelp') : t('overview.outstandingHelp')}
              testId="trip-figure-outstanding"
              tone={outstanding > 0 ? 'warning' : 'default'}
            />
            <Figure
              label={t('overview.netCost')}
              value={money(summary.net_cost)}
              help={t('overview.netCostHelp')}
              testId="trip-figure-net-cost"
            />
          </>
        )}
      </Box>

      {hasBusiness && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography variant="subtitle1" component="h2" fontWeight="bold" gutterBottom>
            {t('overview.statusTitle')}
          </Typography>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            {TRIP_REIMBURSEMENT_STATUSES.map((status) => (
              <Chip
                key={status}
                data-testid={`trip-status-count-${status}`}
                color={reimbursementStatusColor(status)}
                variant={summary.status_counts[status] > 0 ? 'filled' : 'outlined'}
                label={t('overview.statusCount', {
                  status: t(`reimbursementStatus.${status}`),
                  number: summary.status_counts[status],
                  amount: money(summary.status_amounts[status]),
                })}
              />
            ))}
          </Stack>
          {summary.denied_share > 0 && (
            <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
              {t('overview.deniedHelp')}
            </Typography>
          )}
        </Paper>
      )}

      {hasBusiness && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1, gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle1" component="h2" fontWeight="bold">
              {t('overview.receiptsTitle')}
            </Typography>
            <Button variant="contained" startIcon={<AddIcon />} onClick={() => openRecord(null)} data-testid="trip-record-reimbursement">
              {t('reimburse.record')}
            </Button>
          </Stack>
          {receipts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('overview.receiptsEmpty')}
            </Typography>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" aria-label={t('overview.receiptsTitle')}>
                <TableHead>
                  <TableRow>
                    <TableCell>{t('common:fields.date')}</TableCell>
                    <TableCell align="right">{t('common:fields.amount')}</TableCell>
                    <TableCell>{t('reimburse.deposit')}</TableCell>
                    <TableCell>{t('common:fields.notes')}</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {receipts.map((receipt) => (
                    <TableRow key={receipt.id} data-testid={`trip-receipt-${receipt.id}`}>
                      <TableCell>{receipt.received_date ? date(receipt.received_date) : t('manage.tbd')}</TableCell>
                      <TableCell align="right">{money(receipt.amount)}</TableCell>
                      <TableCell>
                        {receipt.transaction_id == null ? (
                          <Typography variant="body2" color="text.secondary">
                            {t('reimburse.noDeposit')}
                          </Typography>
                        ) : (
                          <>
                            <Typography variant="body2">{receipt.transaction_description}</Typography>
                            <Typography variant="caption" color="text.secondary">
                              {t('reimburse.depositLine', {
                                date: receipt.transaction_date ? date(receipt.transaction_date) : '',
                                amount: money(receipt.transaction_amount, receipt.transaction_account_currency),
                                type: t(`reimburse.depositType.${receipt.transaction_type === 'refund' ? 'refund' : 'income'}`),
                              })}
                            </Typography>
                          </>
                        )}
                      </TableCell>
                      <TableCell>{receipt.note}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title={t('reimburse.edit')}>
                          <IconButton size="small" aria-label={t('reimburse.edit')} onClick={() => openRecord(receipt)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('reimburse.delete')}>
                          <IconButton size="small" aria-label={t('reimburse.delete')} onClick={() => setToDelete(receipt)}>
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          )}
        </Paper>
      )}

      {dialogOpen && (
        <RecordReimbursementDialog
          trip={trip}
          rows={rows}
          outstanding={outstanding}
          receipt={editing}
          onClose={() => setDialogOpen(false)}
        />
      )}

      <Dialog open={toDelete !== null} onClose={() => setToDelete(null)}>
        <DialogTitle>{t('reimburse.delete')}</DialogTitle>
        <DialogContent>
          <Typography>{t('reimburse.deleteConfirm', { amount: money(toDelete?.amount ?? 0) })}</Typography>
          {toDelete?.transaction_type === 'refund' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('reimburse.deleteKeepsRefund')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setToDelete(null)}>{t('common:actions.cancel')}</Button>
          <Button color="error" onClick={() => void confirmDelete()}>
            {t('common:actions.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
