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

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { useLoansPageSlice } from '@/contexts/useDatabaseSlices';
import { logger } from '@/lib/logging';
import type { Loan, LoanInput } from '@/types/database';
import type { LoanSummary } from '@/types/loans';
import LoanDetailDialog from './LoanDetailDialog';
import LoanFormDialog from './LoanFormDialog';
import LoansSummaryTiles from './LoansSummaryTiles';
import { daysLabel, formatCurrency, loanStatusOption, loanTypeLabel } from './loanPresentation';

const log = logger.child({ component: 'LoansPage' });

export default function LoansPage() {
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
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load loan balances');
      })
      .finally(() => {
        if (!cancelled) setLoadingSummaries(false);
      });
    return () => {
      cancelled = true;
    };
  }, [getLoanSummary, loans, transactionVersion]);

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
      setSnack('Loan updated');
    } else {
      await addLoan(input);
      setSnack('Loan added');
    }
  };

  const handleDelete = async (loan: Loan) => {
    if (!window.confirm(`Delete "${loan.name}"? Its payment links and rules are removed; the transactions themselves stay.`)) return;
    try {
      await deleteLoan(loan.id);
      if (detailLoanId === loan.id) setDetailLoanId(null);
      setSnack('Loan deleted');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete loan');
    }
  };

  const handleScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await applyLoanRules();
      setSnack(
        result.linked > 0
          ? `Linked ${result.linked} payment${result.linked === 1 ? '' : 's'} across ${Object.keys(result.byLoan).length} loan${Object.keys(result.byLoan).length === 1 ? '' : 's'}.`
          : `No new payments matched (${result.scanned} transactions checked).`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to scan for loan payments');
    } finally {
      setScanning(false);
    }
  }, [applyLoanRules]);

  const columns = useMemo<GridColDef<Loan>[]>(
    () => [
      {
        field: 'name',
        headerName: 'Loan',
        flex: 1.4,
        minWidth: 200,
        renderCell: (params) => (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {params.row.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {[params.row.lender, loanTypeLabel(params.row.loan_type)].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        ),
      },
      { field: 'owner_display_name', headerName: 'Owner', minWidth: 120, flex: 0.6 },
      {
        field: 'project_name',
        headerName: 'Project',
        minWidth: 150,
        flex: 0.9,
        renderCell: (params) =>
          params.row.project_name ? (
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {params.row.project_name}
              </Typography>
              {params.row.project_company_name && (
                <Typography variant="caption" color="text.secondary" noWrap display="block">
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
        headerName: 'Balance',
        width: 130,
        align: 'right',
        headerAlign: 'right',
        valueGetter: (_, row) => summaries[row.id]?.payoffAmount ?? null,
        renderCell: (params) => {
          const summary = summaries[params.row.id];
          if (!summary) return loadingSummaries ? <CircularProgress size={14} /> : '—';
          return (
            <Typography variant="body2" fontWeight={600} data-testid={`loan-balance-${params.row.id}`}>
              {formatCurrency(summary.payoffAmount)}
            </Typography>
          );
        },
      },
      {
        field: 'expected_payment',
        headerName: 'Payment',
        width: 120,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number | null) => (value == null ? '—' : formatCurrency(value)),
      },
      {
        field: 'next_due',
        headerName: 'Next due',
        width: 120,
        valueGetter: (_, row) => summaries[row.id]?.nextDueDate ?? null,
        renderCell: (params) => params.value ?? '—',
      },
      {
        field: 'pay_by',
        headerName: 'Pay off by',
        width: 170,
        valueGetter: (_, row) => row.promo_end_date ?? null,
        renderCell: (params) => {
          const deferred = summaries[params.row.id]?.deferred;
          if (!deferred) return params.value ?? '—';
          const paid = summaries[params.row.id]?.isPaidOff;
          const color = deferred.charged ? 'error' : paid || deferred.onTrack ? 'success' : 'warning';
          const label = deferred.charged ? 'Interest charged' : paid ? 'Cleared' : `${deferred.promoEndDate} (${daysLabel(deferred.daysUntilPromoEnd)})`;
          return (
            <Tooltip title={deferred.charged ? `${formatCurrency(deferred.chargedAmount)} deferred interest added` : deferred.onTrack ? 'On track at the expected payment' : `About ${formatCurrency(deferred.deferredInterestAtRisk)} at risk`}>
              <Chip size="small" color={color} variant="outlined" label={label} />
            </Tooltip>
          );
        },
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 110,
        renderCell: (params) => {
          const option = loanStatusOption(params.row.status);
          return <Chip size="small" label={option.label} color={option.color} />;
        },
      },
      {
        field: 'actions',
        headerName: '',
        width: 130,
        sortable: false,
        filterable: false,
        align: 'right',
        renderCell: (params) => (
          <Stack direction="row">
            <Tooltip title="View">
              <IconButton size="small" onClick={() => setDetailLoanId(params.row.id)} aria-label={`View ${params.row.name}`}>
                <ViewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Edit">
              <IconButton size="small" onClick={() => openEdit(params.row)} aria-label={`Edit ${params.row.name}`}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton size="small" onClick={() => handleDelete(params.row)} aria-label={`Delete ${params.row.name}`}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadingSummaries, summaries]
  );

  return (
    <Box sx={{ p: { xs: 2, sm: 3 } }}>
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={2} mb={3}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <LoansIcon color="primary" />
            <Typography variant="h4" component="h1" sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}>
              Loans
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            Balances, principal vs. interest, and payoff deadlines for the money you have borrowed.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={scanning ? <CircularProgress size={18} color="inherit" /> : <ScanIcon />}
            onClick={handleScan}
            disabled={scanning || loans.length === 0}
          >
            {scanning ? 'Scanning…' : 'Find Payments'}
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={openCreate} data-testid="loans-add">
            Add Loan
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
            No loans yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Add a loan with its terms, then link the payments you make from your accounts, by rule or by hand.
          </Typography>
          <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={openCreate}>
            Add Loan
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
