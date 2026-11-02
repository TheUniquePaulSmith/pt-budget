'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AddCard as AddPaymentIcon,
  Delete as DeleteIcon,
  Edit as EditIcon,
  Link as LinkIcon,
  Radar as ScanIcon,
  Rule as RuleIcon,
} from '@mui/icons-material';
import type { GridColDef } from '@mui/x-data-grid';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import type { LoanPaymentUpdate } from '@/contexts/useDatabaseLoansSlice';
import type { Account, Loan, LoanManualPaymentInput, LoanMatchRule, LoanMatchRuleInput, MerchantRuleMatchType } from '@/types/database';
import type { LoanLedgerEntry, LoanLinkCandidate, LoanRuleScanSummary, LoanSummary } from '@/types/loans';
import LinkTransactionDialog from './LinkTransactionDialog';
import LoanPaymentDialog from './LoanPaymentDialog';
import LoanPrincipalInterestChart from './LoanPrincipalInterestChart';
import LoanRuleEditorDialog from './LoanRuleEditorDialog';
import { daysLabel, formatCurrency, formatPercent, loanStatusOption, loanTypeLabel } from './loanPresentation';

interface LoanDetailDialogProps {
  open: boolean;
  loan: Loan | null;
  accounts: Account[];
  onClose: () => void;
  onEdit: (loan: Loan) => void;
  getSummary: (loanId: number) => Promise<LoanSummary | null>;
  getRules: (loanId: number) => Promise<LoanMatchRule[]>;
  addRule: (input: LoanMatchRuleInput) => Promise<number>;
  updateRule: (id: number, input: Omit<LoanMatchRuleInput, 'loan_id'>) => Promise<void>;
  deleteRule: (id: number) => Promise<void>;
  previewRuleMatches: (rule: { pattern: string; match_type: MerchantRuleMatchType; account_id?: number | null }) => Promise<LoanLinkCandidate[]>;
  applyRules: () => Promise<LoanRuleScanSummary>;
  searchLinkCandidates: (search: string) => Promise<LoanLinkCandidate[]>;
  linkTransaction: (loanId: number, transactionId: number) => Promise<number>;
  addManualPayment: (input: LoanManualPaymentInput) => Promise<number>;
  updatePayment: (id: number, update: LoanPaymentUpdate) => Promise<void>;
  deletePayment: (id: number) => Promise<void>;
  /** Bumps whenever loans or transactions change so the ledger reloads. */
  refreshToken: number;
}

function Stat({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <Box sx={{ flex: '1 1 150px', minWidth: 0 }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="h6" noWrap data-testid={testId}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Box>
  );
}

export default function LoanDetailDialog({
  open,
  loan,
  accounts,
  onClose,
  onEdit,
  getSummary,
  getRules,
  addRule,
  updateRule,
  deleteRule,
  previewRuleMatches,
  applyRules,
  searchLinkCandidates,
  linkTransaction,
  addManualPayment,
  updatePayment,
  deletePayment,
  refreshToken,
}: LoanDetailDialogProps) {
  const [summary, setSummary] = useState<LoanSummary | null>(null);
  const [rules, setRules] = useState<LoanMatchRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [paymentEntry, setPaymentEntry] = useState<LoanLedgerEntry | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<LoanMatchRule | null>(null);
  const [scanning, setScanning] = useState(false);

  const loanId = loan?.id ?? null;

  const reload = useCallback(async () => {
    if (loanId == null) return;
    setLoading(true);
    setError(null);
    try {
      const [nextSummary, nextRules] = await Promise.all([getSummary(loanId), getRules(loanId)]);
      setSummary(nextSummary);
      setRules(nextRules);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load loan');
    } finally {
      setLoading(false);
    }
  }, [getRules, getSummary, loanId]);

  useEffect(() => {
    if (!open || loanId == null) {
      setSummary(null);
      setRules([]);
      return;
    }
    void reload();
  }, [loanId, open, refreshToken, reload]);

  const handleApplyRules = async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await applyRules();
      const mine = loanId != null ? result.byLoan[loanId] ?? 0 : 0;
      setNotice(mine > 0 ? `Linked ${mine} new payment${mine === 1 ? '' : 's'} to this loan.` : 'No new matching transactions.');
      if (result.linked === 0) await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply rules');
    } finally {
      setScanning(false);
    }
  };

  const handleDeletePayment = async (entry: LoanLedgerEntry) => {
    if (entry.payment_id == null) return;
    const what = entry.transaction_id != null ? 'Unlink this transaction from the loan?' : 'Delete this recorded payment?';
    if (!window.confirm(what)) return;
    try {
      await deletePayment(entry.payment_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove payment');
    }
  };

  const handleDeleteRule = async (rule: LoanMatchRule) => {
    if (!window.confirm(`Delete the rule "${rule.pattern}"? Payments it already linked stay on the loan.`)) return;
    try {
      await deleteRule(rule.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rule');
    }
  };

  const ledgerColumns = useMemo<GridColDef<LoanLedgerEntry>[]>(
    () => [
      { field: 'date', headerName: 'Date', width: 110 },
      {
        field: 'description',
        headerName: 'Payment',
        flex: 1.4,
        minWidth: 200,
        renderCell: (params) => {
          const row = params.row;
          if (row.kind === 'deferred_interest_charge') {
            return (
              <Chip size="small" color="error" variant="outlined" label="Deferred interest charged" />
            );
          }
          return (
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {row.description || (row.transaction_id == null ? 'Recorded by hand' : 'Transaction')}
              </Typography>
              {row.account_name && (
                <Typography variant="caption" color="text.secondary" noWrap display="block">
                  {row.account_name}
                </Typography>
              )}
            </Box>
          );
        },
      },
      {
        field: 'amount',
        headerName: 'Amount',
        width: 115,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number) => formatCurrency(value),
      },
      {
        field: 'principal',
        headerName: 'Principal',
        width: 115,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number) => formatCurrency(value),
      },
      {
        field: 'interest',
        headerName: 'Interest',
        width: 115,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number) => formatCurrency(value),
      },
      {
        field: 'balance_after',
        headerName: 'Balance',
        width: 120,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number) => formatCurrency(value),
      },
      {
        field: 'source',
        headerName: 'Source',
        width: 150,
        sortable: false,
        renderCell: (params) => {
          const row = params.row;
          if (row.kind !== 'payment') return null;
          return (
            <Stack direction="row" spacing={0.5}>
              <Chip size="small" variant="outlined" label={row.match_source === 'rule' ? 'Rule' : 'Manual'} />
              {row.split_source === 'manual' && (
                <Tooltip title="Principal / interest entered from the statement">
                  <Chip size="small" color="info" variant="outlined" label="Split set" />
                </Tooltip>
              )}
            </Stack>
          );
        },
      },
      {
        field: 'actions',
        headerName: '',
        width: 100,
        sortable: false,
        filterable: false,
        align: 'right',
        renderCell: (params) => {
          const row = params.row;
          if (row.kind !== 'payment') return null;
          return (
            <Stack direction="row">
              <Tooltip title="Edit split / notes">
                <IconButton
                  size="small"
                  onClick={() => {
                    setPaymentEntry(row);
                    setPaymentOpen(true);
                  }}
                  aria-label="Edit payment"
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={row.transaction_id != null ? 'Unlink from loan' : 'Delete payment'}>
                <IconButton size="small" onClick={() => handleDeletePayment(row)} aria-label="Remove payment">
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  if (!loan) return null;

  const status = loanStatusOption(loan.status);
  const projection = summary?.projection ?? null;
  const deferred = summary?.deferred ?? null;
  const ledgerRows = summary?.ledger ?? [];

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth data-testid="loan-detail-dialog">
        <DialogTitle>
          <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1}>
            <Box>
              <Typography variant="h5" component="span" data-testid="loan-detail-title">
                {loan.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {[loan.lender, loan.owner_display_name, loanTypeLabel(loan.loan_type)].filter(Boolean).join(' · ')}
                {loan.project_name ? ` · Project: ${loan.project_name}${loan.project_company_name ? ` (${loan.project_company_name})` : ''}` : ''}
                {loan.account_name ? ` · Account: ${loan.account_name}` : ''}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" label={status.label} color={status.color} />
              <Button size="small" startIcon={<EditIcon />} onClick={() => onEdit(loan)}>
                Edit Loan
              </Button>
            </Stack>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {notice && (
            <Alert severity="info" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
              {notice}
            </Alert>
          )}

          {loading && !summary ? (
            <Box display="flex" justifyContent="center" py={6}>
              <CircularProgress />
            </Box>
          ) : summary ? (
            <>
              <Box display="flex" flexWrap="wrap" gap={3} mb={2}>
                <Stat label="Balance" value={formatCurrency(summary.balance)} hint={summary.accruedInterest > 0 ? `+ ${formatCurrency(summary.accruedInterest)} interest accrued` : undefined} testId="loan-detail-balance" />
                <Stat label="Payoff today" value={formatCurrency(summary.payoffAmount)} hint={loan.allows_full_payoff ? 'Full payoff allowed' : `Restricted: ${loan.prepayment_terms || 'see lender terms'}`} />
                <Stat label="Paid so far" value={formatCurrency(summary.totalPaid)} hint={`${formatCurrency(summary.totalPrincipalPaid)} principal · ${formatCurrency(summary.totalInterestPaid)} interest`} />
                <Stat
                  label="Original amount"
                  value={formatCurrency(summary.originalPrincipal)}
                  hint={[loan.opened_date ? `Opened ${loan.opened_date}` : null, loan.interest_rate != null ? `${formatPercent(loan.interest_rate)} APR` : null, loan.term_months ? `${loan.term_months} months` : null].filter(Boolean).join(' · ') || undefined}
                />
                <Stat
                  label="Next payment"
                  value={summary.nextDueDate ?? (summary.isPaidOff ? 'Paid off' : '—')}
                  hint={loan.expected_payment != null ? `${formatCurrency(loan.expected_payment)} expected` : projection?.paymentDerivedFromTerm ? `${formatCurrency(projection.assumedPayment)} from the term` : 'Set an expected payment for a projection'}
                />
                <Stat
                  label="Projected payoff"
                  value={summary.isPaidOff ? 'Paid off' : projection ? (projection.neverPaysOff ? 'Never at this payment' : projection.payoffDate ?? '—') : '—'}
                  hint={projection && !projection.neverPaysOff ? `${projection.monthsRemaining} payments · ${formatCurrency(projection.totalInterestRemaining)} more interest` : projection?.neverPaysOff ? 'The payment does not cover the interest' : undefined}
                />
              </Box>

              {deferred && (
                <Alert
                  severity={deferred.charged ? 'error' : deferred.onTrack ? 'success' : 'warning'}
                  sx={{ mb: 2 }}
                  data-testid="loan-deferred-panel"
                >
                  {deferred.charged ? (
                    <>
                      The promo ended {deferred.promoEndDate} with a balance of {formatCurrency(deferred.projectedBalanceAtPromoEnd)}, so{' '}
                      <strong>{formatCurrency(deferred.chargedAmount)}</strong> of deferred interest was added. Interest now accrues at{' '}
                      {formatPercent(loan.deferred_interest_rate)}.
                    </>
                  ) : summary.isPaidOff ? (
                    <>Paid off inside the promo: no deferred interest is due.</>
                  ) : (
                    <>
                      <strong>Pay off by {deferred.promoEndDate}</strong> ({daysLabel(deferred.daysUntilPromoEnd)}) to avoid{' '}
                      {formatPercent(loan.deferred_interest_rate)} deferred interest. Accrued so far: {formatCurrency(deferred.deferredInterestAccrued)}.{' '}
                      {deferred.onTrack
                        ? `At the expected payment the balance clears in time.`
                        : `At the expected payment ${formatCurrency(deferred.projectedBalanceAtPromoEnd)} would remain and about ${formatCurrency(deferred.deferredInterestAtRisk)} of interest would be charged.`}{' '}
                      {deferred.requiredMonthlyToAvoid != null && (
                        <>
                          Required: <strong>{formatCurrency(deferred.requiredMonthlyToAvoid)}</strong>
                          {deferred.paymentsRemainingInPromo > 0 ? ` × ${deferred.paymentsRemainingInPromo} payment${deferred.paymentsRemainingInPromo === 1 ? '' : 's'}` : ' now'}.
                        </>
                      )}
                    </>
                  )}
                </Alert>
              )}

              <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                <Typography variant="subtitle1" gutterBottom>
                  Principal vs. interest
                </Typography>
                <LoanPrincipalInterestChart summary={summary} />
              </Paper>

              <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={1}>
                <Typography variant="subtitle1">Payments ({summary.paymentCount})</Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" startIcon={<LinkIcon />} onClick={() => setLinkOpen(true)} data-testid="loan-link-transaction">
                    Link Transaction
                  </Button>
                  <Button
                    size="small"
                    startIcon={<AddPaymentIcon />}
                    onClick={() => {
                      setPaymentEntry(null);
                      setPaymentOpen(true);
                    }}
                    data-testid="loan-record-payment"
                  >
                    Record Payment
                  </Button>
                </Stack>
              </Box>
              <Box data-testid="loan-payments-grid">
                <AppDataGrid
                  rows={ledgerRows}
                  columns={ledgerColumns}
                  getRowId={(row) => (row.kind === 'payment' ? `payment-${row.payment_id}` : `charge-${row.date}`)}
                  height={Math.min(Math.max(ledgerRows.length, 2) * 52 + 72, 420)}
                  hideFooter={ledgerRows.length <= 25}
                  emptyMessage="No payments linked yet."
                  disableVirtualization={process.env.NODE_ENV === 'test'}
                />
              </Box>

              <Divider sx={{ my: 3 }} />

              <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={1}>
                <Box>
                  <Typography variant="subtitle1">Payment rules ({rules.length})</Typography>
                  <Typography variant="body2" color="text.secondary">
                    Transactions matching a rule are linked automatically; they never become subscriptions or bills.
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    startIcon={scanning ? <CircularProgress size={16} color="inherit" /> : <ScanIcon />}
                    onClick={handleApplyRules}
                    disabled={scanning || rules.length === 0}
                  >
                    Apply Rules Now
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<RuleIcon />}
                    onClick={() => {
                      setEditingRule(null);
                      setRuleEditorOpen(true);
                    }}
                    data-testid="loan-add-rule"
                  >
                    Add Rule
                  </Button>
                </Stack>
              </Box>
              {rules.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No rules yet. Add one with the text your bank uses for this payment (for example &quot;SYNCHRONY BANK PAYMENT&quot;).
                </Typography>
              ) : (
                <Stack spacing={1} data-testid="loan-rules-list">
                  {rules.map((rule) => (
                    <Paper key={rule.id} variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="body2" fontFamily="monospace" sx={{ flex: '1 1 200px' }}>
                        {rule.pattern}
                      </Typography>
                      <Chip size="small" variant="outlined" label={rule.match_type === 'contains' ? 'Contains' : rule.match_type === 'prefix' ? 'Starts with' : 'Exact'} />
                      <Chip size="small" variant="outlined" label={rule.account_name ? `From ${rule.account_name}` : 'Any account'} />
                      {!rule.enabled && <Chip size="small" label="Disabled" />}
                      <Box flex={1} />
                      <IconButton
                        size="small"
                        aria-label="Edit rule"
                        onClick={() => {
                          setEditingRule(rule);
                          setRuleEditorOpen(true);
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" aria-label="Delete rule" onClick={() => handleDeleteRule(rule)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Paper>
                  ))}
                </Stack>
              )}

              {loan.notes && (
                <>
                  <Divider sx={{ my: 3 }} />
                  <Typography variant="subtitle1" gutterBottom>
                    Notes
                  </Typography>
                  <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                    {loan.notes}
                  </Typography>
                </>
              )}
            </>
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose} data-testid="loan-detail-close">
            Close
          </Button>
        </DialogActions>
      </Dialog>

      <LinkTransactionDialog
        open={linkOpen}
        loanName={loan.name}
        search={searchLinkCandidates}
        onClose={() => setLinkOpen(false)}
        onLink={async (transactionId) => {
          await linkTransaction(loan.id, transactionId);
        }}
      />

      <LoanPaymentDialog
        open={paymentOpen}
        loanId={loan.id}
        entry={paymentEntry}
        onClose={() => setPaymentOpen(false)}
        onAdd={async (input) => {
          await addManualPayment(input);
          await reload();
        }}
        onUpdate={async (id, update) => {
          await updatePayment(id, update);
          await reload();
        }}
      />

      <LoanRuleEditorDialog
        open={ruleEditorOpen}
        loan={loan}
        loans={[loan]}
        accounts={accounts}
        editingRule={editingRule}
        onClose={() => setRuleEditorOpen(false)}
        onCreate={async (input) => {
          await addRule(input);
          const result = await applyRules();
          const mine = result.byLoan[loan.id] ?? 0;
          setNotice(mine > 0 ? `Rule created and ${mine} payment${mine === 1 ? '' : 's'} linked.` : 'Rule created. It applies to future transactions.');
          await reload();
        }}
        onUpdate={async (id, input) => {
          await updateRule(id, input);
          await applyRules();
          await reload();
        }}
        previewMatches={previewRuleMatches}
      />
    </>
  );
}
