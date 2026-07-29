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

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { accountColumn, cardColumn, userColumn } from '@/components/common/DataGrid/columns';
import { useSubscriptionsSlice } from '@/contexts/useDatabaseSlices';
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

const CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

type TotalSpentRange = 'all' | 'last30' | 'last90' | 'last12' | 'custom';

const TOTAL_SPENT_RANGE_LABELS: Record<TotalSpentRange, string> = {
  all: 'All time',
  last30: 'Last 30 days',
  last90: 'Last 90 days',
  last12: 'Last 12 months',
  custom: 'Custom',
};

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
}

export default function SubscriptionsPage({ onOpenAiPanel }: SubscriptionsPageProps) {
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
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load recurring series range');
      })
      .finally(() => {
        if (!cancelled) setLoadingRange(false);
      });

    return () => {
      cancelled = true;
    };
  }, [getRecurringSeriesWithStats, recurringSeries, totalSpentDateRange, totalSpentRange, transactionVersion]);

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
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load unmatched transactions');
      })
      .finally(() => {
        if (!cancelled) setLoadingClusterTransactions(false);
      });

    return () => {
      cancelled = true;
    };
  }, [detailCluster, getTransactionsByIds]);

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
      setError(err instanceof Error ? err.message : 'Subscription scan failed');
    } finally {
      setScanning(false);
    }
  }, [runSubscriptionScan]);

  const handleConfirm = useCallback(
    (series: RecurringSeries) => {
      updateRecurringSeriesStatus(series.id, 'active').catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to confirm series')
      );
    },
    [updateRecurringSeriesStatus]
  );

  const handleIgnore = useCallback(
    (series: RecurringSeries) => {
      updateRecurringSeriesStatus(series.id, 'ignored').catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to ignore series')
      );
    },
    [updateRecurringSeriesStatus]
  );

  const handleRestore = useCallback(
    (series: RecurringSeries) => {
      updateRecurringSeriesStatus(series.id, 'active').catch((err) =>
        setError(err instanceof Error ? err.message : 'Failed to restore series')
      );
    },
    [updateRecurringSeriesStatus]
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
    { field: 'normalized_description', headerName: 'Description', flex: 1.4, minWidth: 220 },
    {
      field: 'occurrences',
      headerName: 'Occurrences',
      width: 130,
      align: 'right',
      headerAlign: 'right',
      renderCell: (params) => <Chip label={params.row.occurrences} size="small" />,
    },
    {
      field: 'average_amount',
      headerName: 'Avg Amount',
      width: 130,
      align: 'right',
      headerAlign: 'right',
      renderCell: (params) => CURRENCY.format(params.row.average_amount),
    },
    { field: 'first_seen', headerName: 'First Seen', width: 115 },
    { field: 'last_seen', headerName: 'Last Seen', width: 115 },
    {
      field: 'actions',
      headerName: 'Actions',
      minWidth: 280,
      align: 'right',
      headerAlign: 'right',
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button size="small" startIcon={<ViewIcon />} onClick={() => setDetailCluster(params.row)}>
            View Transactions
          </Button>
          <Button size="small" onClick={() => openCreateRuleFromCluster(params.row)}>
            Create Rule
          </Button>
        </Stack>
      ),
    },
  ], [openCreateRuleFromCluster]);

  const ruleColumns = useMemo<GridColDef<MerchantRule>[]>(() => [
    {
      field: 'source',
      headerName: 'Source',
      width: 120,
      renderCell: (params) => <Chip label={params.row.source} size="small" variant="outlined" />,
    },
    { field: 'pattern', headerName: 'Pattern', flex: 1.2, minWidth: 180 },
    { field: 'match_type', headerName: 'Match', width: 100 },
    { field: 'merchant_name', headerName: 'Merchant', flex: 1, minWidth: 150 },
    {
      field: 'service_name',
      headerName: 'Service',
      flex: 0.8,
      minWidth: 130,
      valueGetter: (_, row) => row.service_name || '—',
    },
    { field: 'default_kind', headerName: 'Kind', width: 110 },
    { field: 'priority', headerName: 'Priority', width: 95, align: 'right', headerAlign: 'right' },
    {
      field: 'enabled',
      headerName: 'Enabled',
      width: 110,
      renderCell: (params) => (
        <Chip
          label={params.row.enabled ? 'Enabled' : 'Disabled'}
          size="small"
          color={params.row.enabled ? 'success' : 'default'}
        />
      ),
    },
    {
      field: 'actions',
      headerName: 'Actions',
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
          Edit
        </Button>
      ),
    },
  ], []);

  const clusterTransactionColumns = useMemo<GridColDef<Transaction>[]>(() => [
    { field: 'date', headerName: 'Date', width: 110 },
    { field: 'description', headerName: 'Description', flex: 1.4, minWidth: 200 },
    userColumn<Transaction>(),
    accountColumn<Transaction>(),
    cardColumn<Transaction>(),
    {
      field: 'amount',
      headerName: 'Amount',
      width: 120,
      align: 'right',
      headerAlign: 'right',
      renderCell: (params) => CURRENCY.format(Math.abs(params.row.amount)),
    },
  ], []);

  return (
    <Box sx={{ p: 3 }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2} mb={3}>
        <Box>
          <Typography variant="h4" gutterBottom>
            Subscriptions
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Recurring payments detected from your transaction history.
          </Typography>
        </Box>
        <Box display="flex" gap={1}>
          <Button variant="outlined" startIcon={<RuleIcon />} onClick={() => setRulesDialogOpen(true)}>
            View Rules
          </Button>
          <Button variant="outlined" startIcon={<AddIcon />} onClick={openCreateRule}>
            Add Rule
          </Button>
          <Button
            variant="contained"
            startIcon={scanning ? <CircularProgress size={18} color="inherit" /> : <ScanIcon />}
            onClick={handleScan}
            disabled={scanning}
          >
            {scanning ? 'Scanning…' : 'Rescan'}
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
            No recurring charges detected yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Scan your transaction history to find subscriptions and recurring bills.
          </Typography>
          <Button
            variant="contained"
            size="large"
            startIcon={scanning ? <CircularProgress size={18} color="inherit" /> : <ScanIcon />}
            onClick={handleScan}
            disabled={scanning}
          >
            {scanning ? 'Scanning…' : 'Scan Transactions'}
          </Button>
        </Paper>
      ) : (
        <>
          <SubscriptionSummaryTiles series={visibleRecurringSeries} />

          <Box display="flex" alignItems="center" flexWrap="wrap" gap={1} mb={3}>
            <Box display="flex" alignItems="center" gap={1} mr={1}>
              <DateRangeIcon color="action" fontSize="small" />
              <Typography variant="body2" color="text.secondary">
                Total Spent:
              </Typography>
            </Box>
            {(Object.keys(TOTAL_SPENT_RANGE_LABELS) as TotalSpentRange[]).map((range) => (
              <Chip
                key={range}
                label={
                  range === 'custom' && customStartDate && customEndDate
                    ? `${customStartDate} to ${customEndDate}`
                    : TOTAL_SPENT_RANGE_LABELS[range]
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
              title={`Needs Review (${candidates.length})`}
              series={candidates}
              onConfirm={handleConfirm}
              onIgnore={handleIgnore}
              onEdit={(series) => setDetailSeries(series)}
              onViewTransactions={(series) => setDetailSeries(series)}
            />
          )}

          <SeriesTable
            title={`Subscriptions (${activeSubscriptions.length})`}
            series={activeSubscriptions}
            emptyMessage="No active subscriptions yet — confirm candidates above or run a scan."
            onIgnore={handleIgnore}
            onEdit={openEditRuleForSeries}
            onViewTransactions={(series) => setDetailSeries(series)}
          />

          <SeriesTable
            title={`Recurring Bills (${activeBills.length})`}
            series={activeBills}
            emptyMessage="No recurring bills detected yet."
            onIgnore={handleIgnore}
            onEdit={openEditRuleForSeries}
            onViewTransactions={(series) => setDetailSeries(series)}
          />

          {hiddenSeries.length > 0 && (
            <SeriesTable
              title={`Hidden (${hiddenSeries.length})`}
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
                    Unmatched Recurring Charges ({clusters.length})
                  </Typography>
                </Button>
                <Stack direction="row" spacing={1}>
                  {onOpenAiPanel && (
                    <Button size="small" startIcon={<AiIcon />} onClick={onOpenAiPanel}>
                      Suggest names with AI
                    </Button>
                  )}
                </Stack>
              </Box>
              <Collapse in={unmatchedExpanded}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  These descriptions repeat but do not match any merchant rule yet. Create a rule to
                  name the merchant and track the charge.
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
        <DialogTitle>Select Total Spent Range</DialogTitle>
        <DialogContent>
          <Stack spacing={2} pt={1}>
            <TextField
              label="Start Date"
              type="date"
              value={tempCustomStartDate}
              onChange={(event) => setTempCustomStartDate(event.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="End Date"
              type="date"
              value={tempCustomEndDate}
              onChange={(event) => setTempCustomEndDate(event.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomRangeDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={applyCustomRange} disabled={!tempCustomStartDate || !tempCustomEndDate}>
            Apply
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rulesDialogOpen} onClose={() => setRulesDialogOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle>Merchant Rules</DialogTitle>
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
          <Button onClick={() => setRulesDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={detailCluster !== null} onClose={() => setDetailCluster(null)} maxWidth="md" fullWidth>
        <DialogTitle>{detailCluster?.normalized_description ?? 'Unmatched Transactions'}</DialogTitle>
        <DialogContent>
          {loadingClusterTransactions ? (
            <Box display="flex" justifyContent="center" py={3}>
              <CircularProgress size={28} />
            </Box>
          ) : clusterTransactions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No transactions found for this recurring charge.
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
          <Button onClick={() => setDetailCluster(null)}>Close</Button>
          {detailCluster && (
            <Button variant="contained" onClick={() => openCreateRuleFromCluster(detailCluster)}>
              Create Rule
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
            ? `Scan complete: ${scanSummary.merchantsMatched} merchants assigned, ` +
              `${scanSummary.seriesCreated} new recurring charges, ` +
              `${scanSummary.transactionsLinked} transactions linked`
            : ''
        }
      />
    </Box>
  );
}
