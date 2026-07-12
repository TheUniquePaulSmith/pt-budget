'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Paper,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  Radar as ScanIcon,
  SmartToy as AiIcon,
} from '@mui/icons-material';

import { useSubscriptionsSlice } from '@/contexts/useDatabaseSlices';
import type {
  MerchantRule,
  RecurringSeries,
  SubscriptionScanSummary,
  UnmatchedCluster,
} from '@/types/database';
import SubscriptionSummaryTiles from './SubscriptionSummaryTiles';
import SeriesTable from './SeriesTable';
import SeriesDetailDialog from './SeriesDetailDialog';
import RuleEditorDialog, { type RuleEditorPrefill } from './RuleEditorDialog';

const CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

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
    deleteRecurringSeries,
    getSeriesTransactions,
    getUnmatchedRecurringClusters,
  } = useSubscriptionsSlice();

  const [clusters, setClusters] = useState<UnmatchedCluster[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanSummary, setScanSummary] = useState<SubscriptionScanSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const [detailSeries, setDetailSeries] = useState<RecurringSeries | null>(null);
  const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
  const [ruleEditorPrefill, setRuleEditorPrefill] = useState<RuleEditorPrefill | null>(null);
  const [editingRule, setEditingRule] = useState<MerchantRule | null>(null);

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

  const candidates = useMemo(
    () => recurringSeries.filter((series) => series.status === 'candidate'),
    [recurringSeries]
  );
  const activeSubscriptions = useMemo(
    () => recurringSeries.filter((series) => series.status === 'active' && series.kind === 'subscription'),
    [recurringSeries]
  );
  const activeBills = useMemo(
    () => recurringSeries.filter((series) => series.status === 'active' && series.kind === 'bill'),
    [recurringSeries]
  );
  const hiddenSeries = useMemo(
    () => recurringSeries.filter((series) => series.status === 'ignored' || series.status === 'inactive'),
    [recurringSeries]
  );

  const hasAnyData = recurringSeries.length > 0 || clusters.length > 0;

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
          <SubscriptionSummaryTiles series={recurringSeries} />

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
            <Box mb={4}>
              <Button
                size="small"
                onClick={() => setShowHidden((value) => !value)}
                endIcon={showHidden ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              >
                Hidden ({hiddenSeries.length})
              </Button>
              <Collapse in={showHidden}>
                <SeriesTable
                  title=""
                  series={hiddenSeries}
                  onRestore={handleRestore}
                  onEdit={(series) => setDetailSeries(series)}
                  onViewTransactions={(series) => setDetailSeries(series)}
                />
              </Collapse>
            </Box>
          )}

          {clusters.length > 0 && (
            <Box mb={4}>
              <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
                <Typography variant="h6" gutterBottom>
                  Unmatched Recurring Charges ({clusters.length})
                </Typography>
                {onOpenAiPanel && (
                  <Button size="small" startIcon={<AiIcon />} onClick={onOpenAiPanel}>
                    Suggest names with AI
                  </Button>
                )}
              </Box>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                These descriptions repeat but do not match any merchant rule yet. Create a rule to
                name the merchant and track the charge.
              </Typography>
              <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Description</TableCell>
                      <TableCell align="right">Occurrences</TableCell>
                      <TableCell align="right">Avg Amount</TableCell>
                      <TableCell>First Seen</TableCell>
                      <TableCell>Last Seen</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {clusters.map((cluster) => (
                      <TableRow key={cluster.normalized_description} hover>
                        <TableCell>{cluster.normalized_description}</TableCell>
                        <TableCell align="right">
                          <Chip label={cluster.occurrences} size="small" />
                        </TableCell>
                        <TableCell align="right">{CURRENCY.format(cluster.average_amount)}</TableCell>
                        <TableCell>{cluster.first_seen}</TableCell>
                        <TableCell>{cluster.last_seen}</TableCell>
                        <TableCell align="right">
                          <Button size="small" onClick={() => openCreateRuleFromCluster(cluster)}>
                            Create Rule
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </>
      )}

      <SeriesDetailDialog
        open={detailSeries !== null}
        series={detailSeries}
        onClose={() => setDetailSeries(null)}
        onSave={updateRecurringSeries}
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
