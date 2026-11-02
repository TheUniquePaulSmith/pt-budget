'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  DateRange as DateRangeIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  Radar as ScanIcon,
  ReceiptLong as ViewIcon,
  Rule as RuleIcon,
  SmartToy as AiIcon,
} from '@mui/icons-material';
import type { GridColDef } from '@mui/x-data-grid';
import { format, subDays, subMonths } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { accountColumn, cardColumn, userColumn } from '@/components/common/DataGrid/columns';
import { useSubscriptionsSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import type {
  MerchantRule,
  RecurringSeries,
  SubscriptionScanSummary,
  Transaction,
  UnmatchedCluster,
} from '@/types/database';
import SubscriptionSummaryTiles from './SubscriptionSummaryTiles';
import SeriesTable from './SeriesTable';
import SeriesDetailDialog from './SeriesDetailDialog';
import RuleEditorDialog, { type RuleEditorPrefill } from './RuleEditorDialog';
import LoansSubscriptionsSection, { type LoansSubscriptionsSectionHandle } from '@/components/loans/LoansSubscriptionsSection';

type TotalSpentRange = 'all' | 'last30' | 'last90' | 'last12' | 'custom';

/** Range options in display order; labels resolve through `subscriptions:page.range<Key>`. */
const TOTAL_SPENT_RANGES: ReadonlyArray<{ value: TotalSpentRange; labelKey: 'page.rangeAll' | 'page.rangeLast30' | 'page.rangeLast90' | 'page.rangeLast12' | 'page.rangeCustom' }> = [
  { value: 'all', labelKey: 'page.rangeAll' },
  { value: 'last30', labelKey: 'page.rangeLast30' },
  { value: 'last90', labelKey: 'page.rangeLast90' },
  { value: 'last12', labelKey: 'page.rangeLast12' },
  { value: 'custom', labelKey: 'page.rangeCustom' },
];

function getRelativeRange(range: Exclude<TotalSpentRange, 'all' | 'custom'>) {
  const now = new Date();
  const endDate = format(now, 'yyyy-MM-dd');
  const startDate = format(range === 'last12' ? subMonths(now, 12) : subDays(now, range === 'last30' ? 30 : 90), 'yyyy-MM-dd');
  return { startDate, endDate };
}

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(' ')
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(' ');
}

interface SubscriptionsPageProps {
  onOpenAiPanel?: () => void;
  onNavigateToLoans?: () => void;
}

export default function SubscriptionsPage({ onOpenAiPanel, onNavigateToLoans }: SubscriptionsPageProps) {
  const { t } = useTranslation('subscriptions');
  const { money } = useFormatters();
  const {
    transactionVersion,
    companies,
    merchantRules,
    recurringSeries,
    runSubscriptionScan,
    addMerchantRule,
    updateMerchantRule,
    previewMerchantRuleMatches,
    updateRecurringSeries,
    updateRecurringSeriesStatus,
    setRecurringSeriesCompany,
    deleteRecurringSeries,
    getRecurringSeriesWithStats,
    getTransactionsByIds,
    getSeriesTransactions,
    getUnmatchedRecurringClusters,
  } = useSubscriptionsSlice();

  const [clusters, setClusters] = useState<UnmatchedCluster[]>([]);
  const [rangedRecurringSeries, setRangedRecurringSeries] = useState<RecurringSeries[]>([]);
  const [scanning, setScanning] = useState(false);
  const [loadingRange, setLoadingRange] = useState(false);
  const [scanSummary, setScanSummary] = useState<SubscriptionScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalSpentRange, setTotalSpentRange] = useState<TotalSpentRange>('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [customRangeDialogOpen, setCustomRangeDialogOpen] = useState(false);
  const [tempCustomStartDate, setTempCustomStartDate] = useState('');
  const [tempCustomEndDate, setTempCustomEndDate] = useState('');
  const [unmatchedExpanded, setUnmatchedExpanded] = useState(true);
  const [rulesDialogOpen, setRulesDialogOpen] = useState(false);

  const [detailSeries, setDetailSeries] = useState<RecurringSeries | null>(null);
  const [detailCluster, setDetailCluster] = useState<UnmatchedCluster | null>(null);
  const [clusterTransactions, setClusterTransactions] = useState<Transaction[]>([]);
  const [loadingClusterTransactions, setLoadingClusterTransactions] = useState(false);
  const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
  const [ruleEditorPrefill, setRuleEditorPrefill] = useState<RuleEditorPrefill | null>(null);
  const [editingRule, setEditingRule] = useState<MerchantRule | null>(null);
  // Loan payment rules (schema v5) live in their own section; this handle
  // lets an unmatched cluster be tracked as a loan payment instead of a rule.
  const [loansHandle, setLoansHandle] = useState<LoansSubscriptionsSectionHandle | null>(null);

  const totalSpentDateRange = useMemo(() => {
    if (totalSpentRange === 'all') return null;
    if (totalSpentRange === 'custom') {
      return customStartDate && customEndDate
        ? { startDate: customStartDate, endDate: customEndDate }
        : null;
    }
    return getRelativeRange(totalSpentRange);
  }, [customEndDate, customStartDate, totalSpentRange]);

  const visibleRecurringSeries = totalSpentRange === 'all' ? recurringSeries : rangedRecurringSeries;

  useEffect(() => {
    let cancelled = false;
    getUnmatchedRecurringClusters()
      .then((data) => {
        if (!cancelled) setClusters(data);
      })
      .catch((err) => {
        console.error('Failed to load unmatched clusters:', err);
      });
    return () => {
      cancelled = true;
    };
  }, [getUnmatchedRecurringClusters, transactionVersion]);

  useEffect(() => {
    if (totalSpentRange === 'all') {
      setRangedRecurringSeries([]);
      setLoadingRange(false);
      return;
    }
    if (!totalSpentDateRange) {
      setRangedRecurringSeries(recurringSeries);
      return;
    }

    let cancelled = false;
    setLoadingRange(true);
    getRecurringSeriesWithStats(totalSpentDateRange)
      .then((data) => {
        if (!cancelled) setRangedRecurringSeries(data);
      })
      .catch((err) => {
        console.error('Failed to load recurring series range:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : t('page.loadRangeFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoadingRange(false);
      });

    return () => {
      cancelled = true;
    };
  }, [getRecurringSeriesWithStats, recurringSeries, t, totalSpentDateRange, totalSpentRange, transactionVersion]);

  useEffect(() => {
    if (!detailCluster) {
      setClusterTransactions([]);
      return;
    }

    let cancelled = false;
    setLoadingClusterTransactions(true);
    getTransactionsByIds(detailCluster.transaction_ids)
      .then((data) => {
        if (!cancelled) setClusterTransactions(data);
      })
      .catch((err) => {
        console.error('Failed to load unmatched transactions:', err);
        if (!cancelled) setError(err instanceof Error ? err.message : t('page.loadUnmatchedFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoadingClusterTransactions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detailCluster, getTransactionsByIds, t]);

  const candidates = useMemo(
    () => visibleRecurringSeries.filter((series) => series.status === 'candidate'),
    [visibleRecurringSeries]
  );
  const activeSubscriptions = useMemo(
    () => visibleRecurringSeries.filter((series) => series.status === 'active' && series.kind === 'subscription'),
    [visibleRecurringSeries]
  );
  const activeBills = useMemo(
    () => visibleRecurringSeries.filter((series) => series.status === 'active' && series.kind === 'bill'),
    [visibleRecurringSeries]
  );
  const hiddenSeries = useMemo(
    () => visibleRecurringSeries.filter((series) => series.status === 'ignored' || series.status === 'inactive'),
    [visibleRecurringSeries]
  );

  const hasAnyData = recurringSeries.length > 0 || clusters.length > 0;

  const handleTotalSpentRangeChange = useCallback((range: TotalSpentRange) => {
    if (range === 'custom') {
      setTempCustomStartDate(customStartDate);
      setTempCustomEndDate(customEndDate);
      setCustomRangeDialogOpen(true);
      return;
    }
    setTotalSpentRange(range);
  }, [customEndDate, customStartDate]);

  const applyCustomRange = useCallback(() => {
    if (!tempCustomStartDate || !tempCustomEndDate) return;
    setCustomStartDate(tempCustomStartDate);
    setCustomEndDate(tempCustomEndDate);
    setTotalSpentRange('custom');
    setCustomRangeDialogOpen(false);
  }, [tempCustomEndDate, tempCustomStartDate]);

  const handleScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const summary = await runSubscriptionScan();
      setScanSummary(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('page.scanFailed'));
    } finally {
      setScanning(false);
    }
  }, [runSubscriptionScan, t]);

  const handleConfirm = useCallback(
    (series: RecurringSeries) => {
      updateRecurringSeriesStatus(series.id, 'active').catch((err) =>
        setError(err instanceof Error ? err.message : t('page.confirmFailed'))
      );
    },
    [t, updateRecurringSeriesStatus]
  );

  const handleIgnore = useCallback(
    (series: RecurringSeries) => {
      updateRecurringSeriesStatus(series.id, 'ignored').catch((err) =>
        setError(err instanceof Error ? err.message : t('page.ignoreFailed'))
      );
    },
    [t, updateRecurringSeriesStatus]
  );

  const handleRestore = useCallback(
    (series: RecurringSeries) => {
      updateRecurringSeriesStatus(series.id, 'active').catch((err) =>
        setError(err instanceof Error ? err.message : t('page.restoreFailed'))
      );
    },
    [t, updateRecurringSeriesStatus]
  );

  const openCreateRuleFromCluster = useCallback((cluster: UnmatchedCluster) => {
    setEditingRule(null);
    setRuleEditorPrefill({
      pattern: cluster.normalized_description,
      merchant_name: titleCase(cluster.normalized_description),
      default_kind: 'subscription',
    });
    setRuleEditorOpen(true);
  }, []);

  const openCreateRule = useCallback(() => {
    setEditingRule(null);
    setRuleEditorPrefill(null);
    setRuleEditorOpen(true);
  }, []);

  const trackClusterAsLoan = useCallback(
    (cluster: UnmatchedCluster) => {
      setDetailCluster(null);
      loansHandle?.trackAsLoanPayment({ pattern: cluster.normalized_description, match_type: 'contains' });
    },
    [loansHandle]
  );

  const openEditRuleForSeries = useCallback(
    (series: RecurringSeries) => {
      const rule = merchantRules.find((candidate) => candidate.id === series.rule_id) ?? null;
      if (rule) {
        setEditingRule(rule);
        setRuleEditorPrefill(null);
        setRuleEditorOpen(true);
      } else {
        setDetailSeries(series);
      }
    },
    [merchantRules]
  );

  const handleRuleCreated = useCallback(
    async (rule: Parameters<typeof addMerchantRule>[0]) => {
      await addMerchantRule(rule);
      // Re-run the scan so the new rule takes effect immediately
      await handleScan();
    },
    [addMerchantRule, handleScan]
  );

  const handleRuleUpdated = useCallback(
    async (id: number, updates: Parameters<typeof updateMerchantRule>[1]) => {
      await updateMerchantRule(id, updates);
      await handleScan();
    },
    [updateMerchantRule, handleScan]
  );

  const clusterColumns = useMemo<GridColDef<UnmatchedCluster>[]>(() => [
    { field: 'normalized_description', headerName: t('page.columnDescription'), flex: 1.4, minWidth: 220 },
    {
      field: 'occurrences',
      headerName: t('page.columnOccurrences'),
      width: 130,
      align: 'right',
      headerAlign: 'right',
      renderCell: (params) => <Chip label={params.row.occurrences} size="small" />,
    },
    {
      field: 'average_amount',
      headerName: t('page.columnAvgAmount'),
      width: 130,
      align: 'right',
      headerAlign: 'right',
      // Averaged across accounts: default currency.
      renderCell: (params) => money(params.row.average_amount),
    },
    { field: 'first_seen', headerName: t('page.columnFirstSeen'), width: 115 },
    { field: 'last_seen', headerName: t('page.columnLastSeen'), width: 115 },
    {
      field: 'actions',
      headerName: t('page.columnActions'),
      minWidth: 420,
      align: 'right',
      headerAlign: 'right',
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button size="small" startIcon={<ViewIcon />} onClick={() => setDetailCluster(params.row)}>
            {t('page.viewTransactions')}
          </Button>
          <Button size="small" onClick={() => openCreateRuleFromCluster(params.row)}>
            {t('page.createRule')}
          </Button>
          <Button size="small" onClick={() => trackClusterAsLoan(params.row)} disabled={!loansHandle} data-testid="cluster-track-as-loan">
            {t('page.trackAsLoan')}
          </Button>
        </Stack>
      ),
    },
  ], [loansHandle, money, openCreateRuleFromCluster, t, trackClusterAsLoan]);

  const ruleColumns = useMemo<GridColDef<MerchantRule>[]>(() => [
    {
      field: 'source',
      headerName: t('page.columnSource'),
      width: 120,
      renderCell: (params) => <Chip label={t(`ruleSource.${params.row.source}`)} size="small" variant="outlined" />,
    },
    { field: 'pattern', headerName: t('page.columnPattern'), flex: 1.2, minWidth: 180 },
    { field: 'match_type', headerName: t('page.columnMatch'), width: 100, valueFormatter: (value: MerchantRule['match_type']) => t(`matchType.${value}`) },
    { field: 'merchant_name', headerName: t('page.columnMerchant'), flex: 1, minWidth: 150 },
    {
      field: 'service_name',
      headerName: t('page.columnService'),
      flex: 0.8,
      minWidth: 130,
      valueGetter: (_, row) => row.service_name || '—',
    },
    { field: 'default_kind', headerName: t('page.columnKind'), width: 110, valueFormatter: (value: MerchantRule['default_kind']) => t(`kind.${value}`) },
    { field: 'priority', headerName: t('page.columnPriority'), width: 95, align: 'right', headerAlign: 'right' },
    {
      field: 'enabled',
      headerName: t('page.columnEnabled'),
      width: 110,
      renderCell: (params) => (
        <Chip
          label={params.row.enabled ? t('page.enabled') : t('page.disabled')}
          size="small"
          color={params.row.enabled ? 'success' : 'default'}
        />
      ),
    },
    {
      field: 'actions',
      headerName: t('page.columnActions'),
      width: 100,
      align: 'right',
      headerAlign: 'right',
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Button
          size="small"
          onClick={() => {
            setEditingRule(params.row);
            setRuleEditorPrefill(null);
            setRulesDialogOpen(false);
            setRuleEditorOpen(true);
          }}
        >
          {t('page.edit')}
        </Button>
      ),
    },
  ], [t]);

  const clusterTransactionColumns = useMemo<GridColDef<Transaction>[]>(() => [
    { field: 'date', headerName: t('page.columnDate'), width: 110 },
    { field: 'description', headerName: t('page.columnDescription'), flex: 1.4, minWidth: 200 },
    userColumn<Transaction>({
      headerName: t('columns.user'),
      owner: t('columns.owner'),
      effectiveUser: t('columns.effectiveUser'),
      unassigned: t('columns.unassigned'),
    }),
    accountColumn<Transaction>({ headerName: t('columns.account'), owner: t('columns.owner'), unknownAccount: t('columns.unknownAccount') }),
    cardColumn<Transaction>({ headerName: t('columns.card'), noCard: t('columns.noCard') }),
    {
      field: 'amount',
      headerName: t('page.columnAmount'),
      width: 120,
      align: 'right',
      headerAlign: 'right',
      // A transaction's amount is in its account's currency.
      renderCell: (params) => money(Math.abs(params.row.amount), params.row.account_currency),
    },
  ], [money, t]);

  return (
    <Box sx={{ p: 3 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2} mb={3}>
        <Box>
          <Typography variant="h4" gutterBottom>
            {t('page.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('page.subtitle')}
          </Typography>
        </Box>
        <Box display="flex" gap={1}>
          <Button variant="outlined" startIcon={<RuleIcon />} onClick={() => setRulesDialogOpen(true)}>
            {t('page.viewRules')}
          </Button>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={openCreateRule}>
            {t('page.addRule')}
          </Button>
          <Button
            variant="contained"
            startIcon={scanning ? <CircularProgress size={18} color="inherit" /> : <ScanIcon />}
            onClick={handleScan}
            disabled={scanning}
          >
            {scanning ? t('page.scanning') : t('page.rescan')}
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {!hasAnyData ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            {t('page.emptyTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('page.emptyBody')}
          </Typography>
          <Button
            variant="contained"
            size="large"
            startIcon={scanning ? <CircularProgress size={18} color="inherit" /> : <ScanIcon />}
            onClick={handleScan}
            disabled={scanning}
          >
            {scanning ? t('page.scanning') : t('page.scanTransactions')}
          </Button>
        </Paper>
      ) : null}

      {!hasAnyData && (
        <Box mt={3}>
          <LoansSubscriptionsSection onReady={setLoansHandle} onNavigateToLoans={onNavigateToLoans} refreshToken={transactionVersion} />
        </Box>
      )}

      {hasAnyData && (
        <>
          <SubscriptionSummaryTiles series={visibleRecurringSeries} />

          <Box display="flex" alignItems="center" flexWrap="wrap" gap={1} mb={3}>
            <Box display="flex" alignItems="center" gap={1} mr={1}>
              <DateRangeIcon color="action" fontSize="small" />
              <Typography variant="body2" color="text.secondary">
                {t('page.totalSpent')}
              </Typography>
            </Box>
            {TOTAL_SPENT_RANGES.map(({ value: range, labelKey }) => (
              <Chip
                key={range}
                label={
                  range === 'custom' && customStartDate && customEndDate
                    ? t('page.customRange', { start: customStartDate, end: customEndDate })
                    : t(labelKey)
                }
                variant={totalSpentRange === range ? 'filled' : 'outlined'}
                color={totalSpentRange === range ? 'primary' : 'default'}
                onClick={() => handleTotalSpentRangeChange(range)}
                size="small"
              />
            ))}
            {loadingRange && <CircularProgress size={18} />}
          </Box>

          {candidates.length > 0 && (
            <SeriesTable
              title={t('page.needsReview', { count: candidates.length })}
              series={candidates}
              onConfirm={handleConfirm}
              onIgnore={handleIgnore}
              onEdit={(series) => setDetailSeries(series)}
              onViewTransactions={(series) => setDetailSeries(series)}
            />
          )}

          <SeriesTable
            title={t('page.subscriptionsCount', { count: activeSubscriptions.length })}
            series={activeSubscriptions}
            emptyMessage={t('page.noActiveSubscriptions')}
            onIgnore={handleIgnore}
            onEdit={openEditRuleForSeries}
            onViewTransactions={(series) => setDetailSeries(series)}
          />

          <SeriesTable
            title={t('page.recurringBills', { count: activeBills.length })}
            series={activeBills}
            emptyMessage={t('page.noBills')}
            onIgnore={handleIgnore}
            onEdit={openEditRuleForSeries}
            onViewTransactions={(series) => setDetailSeries(series)}
          />

          <LoansSubscriptionsSection onReady={setLoansHandle} onNavigateToLoans={onNavigateToLoans} refreshToken={transactionVersion} />

          {hiddenSeries.length > 0 && (
            <SeriesTable
              title={t('page.hidden', { count: hiddenSeries.length })}
              series={hiddenSeries}
              onRestore={handleRestore}
              onEdit={(series) => setDetailSeries(series)}
              onViewTransactions={(series) => setDetailSeries(series)}
            />
          )}

          {clusters.length > 0 && (
            <Box mb={4}>
              <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                <Button
                  size="small"
                  onClick={() => setUnmatchedExpanded((value) => !value)}
                  endIcon={unmatchedExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                  sx={{ px: 0, justifyContent: 'flex-start' }}
                >
                  <Typography variant="h6" component="span">
                    {t('page.unmatched', { count: clusters.length })}
                  </Typography>
                </Button>
                <Stack direction="row" spacing={1}>
                  {onOpenAiPanel && (
                    <Button size="small" startIcon={<AiIcon />} onClick={onOpenAiPanel}>
                      {t('page.suggestNames')}
                    </Button>
                  )}
                </Stack>
              </Box>
              <Collapse in={unmatchedExpanded}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {t('page.unmatchedHelp')}
                </Typography>
                <AppDataGrid
                  rows={clusters}
                  columns={clusterColumns}
                  getRowId={(row) => row.normalized_description}
                  height={Math.min(clusters.length * 52 + 130, 520)}
                  hideFooter={clusters.length <= 25}
                  disableVirtualization={process.env.NODE_ENV === 'test'}
                />
              </Collapse>
            </Box>
          )}
        </>
      )}

      <Dialog open={customRangeDialogOpen} onClose={() => setCustomRangeDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('page.selectRange')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} pt={1}>
            <TextField
              label={t('page.startDate')}
              type="date"
              value={tempCustomStartDate}
              onChange={(event) => setTempCustomStartDate(event.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label={t('page.endDate')}
              type="date"
              value={tempCustomEndDate}
              onChange={(event) => setTempCustomEndDate(event.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomRangeDialogOpen(false)}>{t('page.cancel')}</Button>
          <Button variant="contained" onClick={applyCustomRange} disabled={!tempCustomStartDate || !tempCustomEndDate}>
            {t('page.apply')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rulesDialogOpen} onClose={() => setRulesDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>{t('page.merchantRules')}</DialogTitle>
        <DialogContent>
          <AppDataGrid
            rows={merchantRules}
            columns={ruleColumns}
            height={520}
            initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
            disableVirtualization={process.env.NODE_ENV === 'test'}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRulesDialogOpen(false)}>{t('page.close')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={detailCluster !== null} onClose={() => setDetailCluster(null)} maxWidth="md" fullWidth>
        <DialogTitle>{detailCluster?.normalized_description ?? t('page.unmatchedTransactions')}</DialogTitle>
        <DialogContent>
          {loadingClusterTransactions ? (
            <Box display="flex" justifyContent="center" py={3}>
              <CircularProgress size={28} />
            </Box>
          ) : clusterTransactions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('page.noClusterTransactions')}
            </Typography>
          ) : (
            <AppDataGrid
              rows={clusterTransactions}
              columns={clusterTransactionColumns}
              height={Math.min(clusterTransactions.length * 52 + 72, 380)}
              hideFooter
              disableVirtualization={process.env.NODE_ENV === 'test'}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDetailCluster(null)}>{t('page.close')}</Button>
          {detailCluster && (
            <Button onClick={() => trackClusterAsLoan(detailCluster)} disabled={!loansHandle}>
              {t('page.trackAsLoan')}
            </Button>
          )}
          {detailCluster && (
            <Button variant="contained" onClick={() => openCreateRuleFromCluster(detailCluster)}>
              {t('page.createRule')}
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <SeriesDetailDialog
        open={detailSeries !== null}
        series={detailSeries}
        companies={companies}
        onClose={() => setDetailSeries(null)}
        onSave={updateRecurringSeries}
        onSetCompany={setRecurringSeriesCompany}
        onDelete={deleteRecurringSeries}
        getSeriesTransactions={getSeriesTransactions}
      />

      <RuleEditorDialog
        open={ruleEditorOpen}
        editingRule={editingRule}
        prefill={ruleEditorPrefill}
        companies={companies}
        onClose={() => setRuleEditorOpen(false)}
        onCreate={handleRuleCreated}
        onUpdate={handleRuleUpdated}
        previewMatches={previewMerchantRuleMatches}
      />

      <Snackbar
        open={scanSummary !== null}
        autoHideDuration={6000}
        onClose={() => setScanSummary(null)}
        message={
          scanSummary
            ? t('page.scanComplete', {
                merchants: scanSummary.merchantsMatched,
                series: scanSummary.seriesCreated,
                transactions: scanSummary.transactionsLinked,
              })
            : ''
        }
      />
    </Box>
  );
}
