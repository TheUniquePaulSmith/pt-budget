'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Radar as ScanIcon,
  RequestQuote as LoansIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import type { GridColDef } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { useLoansPageSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { logger } from '@/lib/logging';
import type { Loan, LoanInput } from '@/types/database';
import type { LoanSummary } from '@/types/loans';
import LoanDetailDialog from './LoanDetailDialog';
import LoanFormDialog from './LoanFormDialog';
import LoansSummaryTiles from './LoansSummaryTiles';
import { daysLabel, loanStatusOption, loanTypeLabel } from './loanPresentation';

const log = logger.child({ component: 'LoansPage' });

export default function LoansPage() {
  const { t } = useTranslation('loans');
  const { money } = useFormatters();
  const {
    loans,
    users,
    projects,
    accounts,
    transactionVersion,
    addLoan,
    updateLoan,
    deleteLoan,
    getLoanRules,
    addLoanRule,
    updateLoanRule,
    deleteLoanRule,
    previewLoanRuleMatches,
    applyLoanRules,
    searchLoanLinkCandidates,
    linkTransactionToLoan,
    addLoanManualPayment,
    updateLoanPayment,
    deleteLoanPayment,
    getLoanSummary,
  } = useLoansPageSlice();

  const [summaries, setSummaries] = useState<Record<number, LoanSummary>>({});
  const [loadingSummaries, setLoadingSummaries] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingLoan, setEditingLoan] = useState<Loan | null>(null);
  const [detailLoanId, setDetailLoanId] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snack, setSnack] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  // Balances for the list and tiles; recomputed whenever loans or transactions change.
  useEffect(() => {
    let cancelled = false;
    if (loans.length === 0) {
      setSummaries({});
      return;
    }
    setLoadingSummaries(true);
    Promise.all(loans.map((loan) => getLoanSummary(loan.id)))
      .then((results) => {
        if (cancelled) return;
        const next: Record<number, LoanSummary> = {};
        results.forEach((summary) => {
          if (summary) next[summary.loanId] = summary;
        });
        setSummaries(next);
        setRefreshToken((value) => value + 1);
      })
      .catch((err) => {
        log.error('Failed to load loan summaries', { operation: 'loadSummaries', error: err });
        if (!cancelled) setError(err instanceof Error ? err.message : t('page.loadBalancesFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoadingSummaries(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getLoanSummary, loans, t, transactionVersion]);

  // New transactions (imports, manual entry) are matched against loan rules
  // as soon as the page sees them. Idempotent, so repeated runs are cheap.
  useEffect(() => {
    if (loans.every((loan) => !loan.rule_count)) return;
    applyLoanRules().catch((err) => {
      log.warn('Automatic loan rule scan failed', { operation: 'autoApplyRules', error: err });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transactionVersion]);

  const detailLoan = useMemo(() => loans.find((loan) => loan.id === detailLoanId) ?? null, [detailLoanId, loans]);

  const openCreate = () => {
    setEditingLoan(null);
    setFormOpen(true);
  };

  const openEdit = (loan: Loan) => {
    setEditingLoan(loan);
    setFormOpen(true);
  };

  const handleSubmit = async (input: LoanInput) => {
    if (editingLoan) {
      await updateLoan(editingLoan.id, input);
      setSnack(t('page.loanUpdated'));
    } else {
      await addLoan(input);
      setSnack(t('page.loanAdded'));
    }
  };

  const handleDelete = async (loan: Loan) => {
    if (!window.confirm(t('page.confirmDelete', { name: loan.name }))) return;
    try {
      await deleteLoan(loan.id);
      if (detailLoanId === loan.id) setDetailLoanId(null);
      setSnack(t('page.loanDeleted'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('page.deleteFailed'));
    }
  };

  const handleScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await applyLoanRules();
      setSnack(
        result.linked > 0
          ? t('page.scanLinked', {
              count: Object.keys(result.byLoan).length,
              payments: t('page.paymentsLinked', { count: result.linked }),
            })
          : t('page.scanNone', { scanned: result.scanned })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('page.scanFailed'));
    } finally {
      setScanning(false);
    }
  }, [applyLoanRules, t]);

  // The loan and project cells are two lines, so the grid sizes rows to their
  // content (getRowHeight below) and every column is a flex cell that centres
  // its content in the taller row.
  const columns = useMemo<GridColDef<Loan>[]>(
    () => [
      {
        field: 'name',
        display: 'flex',
        headerName: t('page.columnLoan'),
        flex: 1.4,
        minWidth: 200,
        renderCell: (params) => (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {params.row.name}
            </Typography>
            {/* Wraps rather than truncates: the row grows to fit it. */}
            <Typography variant="caption" color="text.secondary" display="block">
              {[params.row.lender, loanTypeLabel(t, params.row.loan_type)].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        ),
      },
      { field: 'owner_display_name', headerName: t('page.columnOwner'), minWidth: 120, flex: 0.6, display: 'flex' },
      {
        field: 'project_name',
        display: 'flex',
        headerName: t('page.columnProject'),
        minWidth: 150,
        flex: 0.9,
        renderCell: (params) =>
          params.row.project_name ? (
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {params.row.project_name}
              </Typography>
              {params.row.project_company_name && (
                <Typography variant="caption" color="text.secondary" display="block">
                  {params.row.project_company_name}
                </Typography>
              )}
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              —
            </Typography>
          ),
      },
      {
        field: 'balance',
        display: 'flex',
        headerName: t('page.columnBalance'),
        width: 130,
        align: 'right',
        headerAlign: 'right',
        valueGetter: (_, row) => summaries[row.id]?.payoffAmount ?? null,
        renderCell: (params) => {
          const summary = summaries[params.row.id];
          if (!summary) return loadingSummaries ? <CircularProgress size={14} /> : '—';
          return (
            <Typography variant="body2" fontWeight={600} data-testid={`loan-balance-${params.row.id}`}>
              {money(summary.payoffAmount, params.row.account_currency)}
            </Typography>
          );
        },
      },
      {
        field: 'expected_payment',
        display: 'flex',
        headerName: t('page.columnPayment'),
        width: 120,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number | null, row) => (value == null ? '—' : money(value, row.account_currency)),
      },
      {
        field: 'next_due',
        display: 'flex',
        headerName: t('page.columnNextDue'),
        width: 120,
        valueGetter: (_, row) => summaries[row.id]?.nextDueDate ?? null,
        renderCell: (params) => params.value ?? '—',
      },
      {
        field: 'pay_by',
        display: 'flex',
        headerName: t('page.columnPayBy'),
        width: 170,
        valueGetter: (_, row) => row.promo_end_date ?? null,
        renderCell: (params) => {
          const deferred = summaries[params.row.id]?.deferred;
          if (!deferred) return params.value ?? '—';
          const paid = summaries[params.row.id]?.isPaidOff;
          const currency = params.row.account_currency;
          const color = deferred.charged ? 'error' : paid || deferred.onTrack ? 'success' : 'warning';
          const label = deferred.charged
            ? t('page.interestCharged')
            : paid
              ? t('page.cleared')
              : t('page.payByLabel', { date: deferred.promoEndDate, days: daysLabel(t, deferred.daysUntilPromoEnd) });
          const tooltip = deferred.charged
            ? t('page.tooltipCharged', { amount: money(deferred.chargedAmount, currency) })
            : deferred.onTrack
              ? t('page.tooltipOnTrack')
              : t('page.tooltipAtRisk', { amount: money(deferred.deferredInterestAtRisk, currency) });
          return (
            <Tooltip title={tooltip}>
              <Chip size="small" color={color} variant="outlined" label={label} />
            </Tooltip>
          );
        },
      },
      {
        field: 'status',
        display: 'flex',
        headerName: t('page.columnStatus'),
        width: 110,
        renderCell: (params) => {
          const option = loanStatusOption(t, params.row.status);
          return <Chip size="small" label={option.label} color={option.color} />;
        },
      },
      {
        field: 'actions',
        display: 'flex',
        headerName: '',
        width: 130,
        sortable: false,
        filterable: false,
        align: 'right',
        renderCell: (params) => (
          <Stack direction="row">
            <Tooltip title={t('page.view')}>
              <IconButton size="small" onClick={() => setDetailLoanId(params.row.id)} aria-label={t('page.viewAria', { name: params.row.name })}>
                <ViewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('page.edit')}>
              <IconButton size="small" onClick={() => openEdit(params.row)} aria-label={t('page.editAria', { name: params.row.name })}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('page.delete')}>
              <IconButton size="small" onClick={() => handleDelete(params.row)} aria-label={t('page.deleteAria', { name: params.row.name })}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadingSummaries, money, summaries, t]
  );

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2} mb={3}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LoansIcon color="primary" />
            <Typography variant="h4" component="h1" sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}>
              {t('page.title')}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {t('page.subtitle')}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={scanning ? <CircularProgress size={18} color="inherit" /> : <ScanIcon />}
            onClick={handleScan}
            disabled={scanning || loans.length === 0}
          >
            {scanning ? t('page.scanning') : t('page.findPayments')}
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} data-testid="loans-add">
            {t('page.addLoan')}
          </Button>
        </Stack>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loans.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 6, textAlign: 'center' }}>
          <Typography variant="h6" gutterBottom>
            {t('page.emptyTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            {t('page.emptyBody')}
          </Typography>
          <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={openCreate}>
            {t('page.addLoan')}
          </Button>
        </Paper>
      ) : (
        <>
          <LoansSummaryTiles loans={loans} summaries={summaries} />
          <Box data-testid="loans-grid">
            <AppDataGrid
              rows={loans}
              columns={columns}
              height={Math.min(loans.length * 60 + 130, 640)}
              hideFooter={loans.length <= 25}
              getRowHeight={() => 'auto'}
              onRowClick={(params) => setDetailLoanId(params.row.id)}
              disableVirtualization={process.env.NODE_ENV === 'test'}
              sx={{ '& .MuiDataGrid-row': { cursor: 'pointer' } }}
            />
          </Box>
        </>
      )}

      <LoanFormDialog
        open={formOpen}
        loan={editingLoan}
        users={users}
        projects={projects}
        accounts={accounts}
        onClose={() => setFormOpen(false)}
        onSubmit={handleSubmit}
      />

      <LoanDetailDialog
        open={detailLoan !== null}
        loan={detailLoan}
        accounts={accounts}
        onClose={() => setDetailLoanId(null)}
        onEdit={openEdit}
        getSummary={getLoanSummary}
        getRules={getLoanRules}
        addRule={addLoanRule}
        updateRule={updateLoanRule}
        deleteRule={deleteLoanRule}
        previewRuleMatches={previewLoanRuleMatches}
        applyRules={applyLoanRules}
        searchLinkCandidates={searchLoanLinkCandidates}
        linkTransaction={linkTransactionToLoan}
        addManualPayment={addLoanManualPayment}
        updatePayment={updateLoanPayment}
        deletePayment={deleteLoanPayment}
        refreshToken={refreshToken}
      />

      <Snackbar open={snack !== null} autoHideDuration={5000} onClose={() => setSnack(null)} message={snack ?? ''} />
    </Box>
  );
}
