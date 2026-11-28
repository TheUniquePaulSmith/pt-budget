'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Box, Chip, CircularProgress, IconButton, Paper, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { ArrowBack, Edit as EditIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useTripDetailSlice } from '@/contexts/useDatabaseSlices';
import type { TripExpenseDetail } from '@/contexts/useDatabaseTripExpensesSlice';
import { useFormatters } from '@/contexts/useFormatters';
import { logger } from '@/lib/logging';
import type { Trip } from '@/types/database';

import TripInsightsTab from './TripInsightsTab';
import TripOverviewTab from './TripOverviewTab';
import TripTransactionsTab from './TripTransactionsTab';

const log = logger.child({ component: 'TripDetailView' });

export type TripDetailTab = 'overview' | 'transactions' | 'insights';

export interface TripDetailViewProps {
  trip: Trip;
  onBack: () => void;
  onEdit: (trip: Trip) => void;
}

/** One trip: its figures, its transactions with their business parts, and where the money went. */
export default function TripDetailView({ trip, onBack, onEdit }: TripDetailViewProps) {
  const { t } = useTranslation(['trips', 'common']);
  const { date } = useFormatters();
  const { transactionVersion, getTripExpenseDetail } = useTripDetailSlice();
  const [tab, setTab] = useState<TripDetailTab>('overview');
  const [detail, setDetail] = useState<TripExpenseDetail | null>(null);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await getTripExpenseDetail(trip.id);
      setDetail(next);
      setLoadError(false);
    } catch (error) {
      log.error('Failed to load trip detail', { operation: 'loadTripDetail', tripId: trip.id, error });
      setLoadError(true);
    }
  }, [getTripExpenseDetail, trip.id]);

  // Every trip-expense mutation bumps transactionVersion, so this re-reads after each one.
  useEffect(() => {
    void load();
  }, [load, transactionVersion, trip.expense_mode]);

  const hasBusiness = (trip.expense_mode ?? 'personal') !== 'personal';
  const dates =
    trip.start_date || trip.end_date
      ? t('manage.dateRange', {
          start: trip.start_date ? date(trip.start_date) : t('manage.tbd'),
          end: trip.end_date ? date(trip.end_date) : t('manage.tbd'),
        })
      : null;

  return (
    <Box data-testid="trip-detail" sx={{ p: { xs: 1, sm: 3 } }}>
      <Paper variant="outlined" sx={{ mb: 2 }}>
        <Stack
          direction="row"
          alignItems="center"
          columnGap={1}
          sx={{ px: 1, pt: 1 }}
        >
          <IconButton onClick={onBack} aria-label={t('detail.back')} data-testid="trip-detail-back">
            <ArrowBack />
          </IconButton>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="h5" component="h1" fontWeight="bold" noWrap>
              {trip.name}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
              {trip.destination && (
                <Typography variant="body2" color="text.secondary">
                  {trip.destination}
                </Typography>
              )}
              {dates && (
                <Typography variant="body2" color="text.secondary">
                  {dates}
                </Typography>
              )}
              <Chip size="small" variant="outlined" label={t(`expenseMode.${trip.expense_mode ?? 'personal'}`)} />
              {hasBusiness && trip.reimburser && (
                <Typography variant="body2" color="text.secondary">
                  {t('detail.reimbursedBy', { name: trip.reimburser })}
                </Typography>
              )}
            </Stack>
          </Box>
          <Tooltip title={t('manage.editTrip')}>
            <IconButton onClick={() => onEdit(trip)} aria-label={t('manage.editTrip')} data-testid="trip-detail-edit">
              <EditIcon />
            </IconButton>
          </Tooltip>
        </Stack>
        <Tabs
          value={tab}
          onChange={(_, next) => setTab(next as TripDetailTab)}
          aria-label={t('detail.views')}
          variant="fullWidth"
          sx={{ maxWidth: 600 }}
        >
          <Tab value="overview" label={t('detail.tabOverview')} data-testid="trip-tab-overview" />
          <Tab value="transactions" label={t('detail.tabTransactions')} data-testid="trip-tab-transactions" />
          <Tab value="insights" label={t('detail.tabInsights')} data-testid="trip-tab-insights" />
        </Tabs>
      </Paper>

      {loadError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {t('errors.loadFailed')}
        </Alert>
      )}

      {!detail ? (
        !loadError && (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
            <CircularProgress aria-label={t('detail.loading')} />
          </Box>
        )
      ) : tab === 'overview' ? (
        <TripOverviewTab trip={trip} detail={detail} onOpenTransactions={() => setTab('transactions')} />
      ) : tab === 'transactions' ? (
        <TripTransactionsTab trip={trip} rows={detail.rows} />
      ) : (
        <TripInsightsTab trip={trip} rows={detail.rows} />
      )}
    </Box>
  );
}
