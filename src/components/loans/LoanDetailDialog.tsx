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
import { Trans, useTranslation } from 'react-i18next';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import type { LoanPaymentUpdate } from '@/contexts/useDatabaseLoansSlice';
import { useFormatters } from '@/contexts/useFormatters';
import type { Account, Loan, LoanManualPaymentInput, LoanMatchRule, LoanMatchRuleInput, MerchantRuleMatchType } from '@/types/database';
import type { LoanLedgerEntry, LoanLinkCandidate, LoanRuleScanSummary, LoanSummary } from '@/types/loans';
import LinkTransactionDialog from './LinkTransactionDialog';
import LoanPaymentDialog from './LoanPaymentDialog';
import LoanPrincipalInterestChart from './LoanPrincipalInterestChart';
import LoanRuleEditorDialog from './LoanRuleEditorDialog';
import { daysLabel, loanStatusOption, loanTypeLabel } from './loanPresentation';

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
  const { t } = useTranslation('loans');
  const { money, percent } = useFormatters();
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
  // Every amount on this dialog is the loan's: shown in its linked account's currency.
  const currency = loan?.account_currency ?? null;
  const amount = useCallback((value: number | null | undefined) => money(value, currency), [currency, money]);
  const rate = (value: number | null | undefined) => percent(value, { fromPercent: true, maximumFractionDigits: 2 });

  const reload = useCallback(async () => {
    if (loanId == null) return;
    setLoading(true);
    setError(null);
    try {
      const [nextSummary, nextRules] = await Promise.all([getSummary(loanId), getRules(loanId)]);
      setSummary(nextSummary);
      setRules(nextRules);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('detailDialog.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [getRules, getSummary, loanId, t]);

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
      setNotice(mine > 0 ? t('detailDialog.rulesLinked', { count: mine }) : t('detailDialog.rulesNone'));
      if (result.linked === 0) await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('detailDialog.applyFailed'));
    } finally {
      setScanning(false);
    }
  };

  const handleDeletePayment = async (entry: LoanLedgerEntry) => {
    if (entry.payment_id == null) return;
    const what = entry.transaction_id != null ? t('detailDialog.confirmUnlink') : t('detailDialog.confirmDeletePayment');
    if (!window.confirm(what)) return;
    try {
      await deletePayment(entry.payment_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('detailDialog.removePaymentFailed'));
    }
  };

  const handleDeleteRule = async (rule: LoanMatchRule) => {
    if (!window.confirm(t('detailDialog.confirmDeleteRule', { pattern: rule.pattern }))) return;
    try {
      await deleteRule(rule.id);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('detailDialog.deleteRuleFailed'));
    }
  };

  const ledgerColumns = useMemo<GridColDef<LoanLedgerEntry>[]>(
    () => [
      { field: 'date', headerName: t('detailDialog.columnDate'), width: 110 },
      {
        field: 'description',
        headerName: t('detailDialog.columnPayment'),
        flex: 1.4,
        minWidth: 200,
        renderCell: (params) => {
          const row = params.row;
          if (row.kind === 'deferred_interest_charge') {
            return (
              <Chip size="small" color="error" variant="outlined" label={t('detailDialog.deferredChargedChip')} />
            );
          }
          return (
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {row.description || (row.transaction_id == null ? t('detailDialog.recordedByHand') : t('detailDialog.transaction'))}
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
        headerName: t('detailDialog.columnAmount'),
        width: 115,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number) => amount(value),
      },
      {
        field: 'principal',
        headerName: t('detailDialog.columnPrincipal'),
        width: 115,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number) => amount(value),
      },
      {
        field: 'interest',
        headerName: t('detailDialog.columnInterest'),
        width: 115,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number) => amount(value),
      },
      {
        field: 'balance_after',
        headerName: t('detailDialog.columnBalance'),
        width: 120,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number) => amount(value),
      },
      {
        field: 'source',
        headerName: t('detailDialog.columnSource'),
        width: 150,
        sortable: false,
        renderCell: (params) => {
          const row = params.row;
          if (row.kind !== 'payment') return null;
          return (
            <Stack direction="row" spacing={0.5}>
              <Chip size="small" variant="outlined" label={row.match_source === 'rule' ? t('detailDialog.sourceRule') : t('detailDialog.sourceManual')} />
              {row.split_source === 'manual' && (
                <Tooltip title={t('detailDialog.splitSetTooltip')}>
                  <Chip size="small" color="info" variant="outlined" label={t('detailDialog.splitSet')} />
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
              <Tooltip title={t('detailDialog.editSplitTooltip')}>
                <IconButton
                  size="small"
                  onClick={() => {
                    setPaymentEntry(row);
                    setPaymentOpen(true);
                  }}
                  aria-label={t('detailDialog.editPaymentAria')}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={row.transaction_id != null ? t('detailDialog.unlinkTooltip') : t('detailDialog.deletePaymentTooltip')}>
                <IconButton size="small" onClick={() => handleDeletePayment(row)} aria-label={t('detailDialog.removePaymentAria')}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          );
        },
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [amount, t]
  );

  if (!loan) return null;

  const status = loanStatusOption(t, loan.status);
  const projection = summary?.projection ?? null;
  const deferred = summary?.deferred ?? null;
  const ledgerRows = summary?.ledger ?? [];

  const subtitle = [
    loan.lender,
    loan.owner_display_name,
    loanTypeLabel(t, loan.loan_type),
    loan.project_name
      ? loan.project_company_name
        ? t('detailDialog.projectWithCompanyPart', { name: loan.project_name, company: loan.project_company_name })
        : t('detailDialog.projectPart', { name: loan.project_name })
      : null,
    loan.account_name ? t('detailDialog.accountPart', { name: loan.account_name }) : null,
  ]
    .filter(Boolean)
    .join(' · ');

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
                {subtitle}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              <Chip size="small" label={status.label} color={status.color} />
              <Button size="small" startIcon={<EditIcon />} onClick={() => onEdit(loan)}>
                {t('detailDialog.editLoan')}
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
                <Stat
                  label={t('detailDialog.statBalance')}
                  value={amount(summary.balance)}
                  hint={summary.accruedInterest > 0 ? t('detailDialog.accruedHint', { amount: amount(summary.accruedInterest) }) : undefined}
                  testId="loan-detail-balance"
                />
                <Stat
                  label={t('detailDialog.statPayoffToday')}
                  value={amount(summary.payoffAmount)}
                  hint={
                    loan.allows_full_payoff
                      ? t('detailDialog.fullPayoffAllowed')
                      : t('detailDialog.restricted', { terms: loan.prepayment_terms || t('detailDialog.seeLenderTerms') })
                  }
                />
                <Stat
                  label={t('detailDialog.statPaidSoFar')}
                  value={amount(summary.totalPaid)}
                  hint={t('detailDialog.paidSplit', { principal: amount(summary.totalPrincipalPaid), interest: amount(summary.totalInterestPaid) })}
                />
                <Stat
                  label={t('detailDialog.statOriginalAmount')}
                  value={amount(summary.originalPrincipal)}
                  hint={
                    [
                      loan.opened_date ? t('detailDialog.openedOn', { date: loan.opened_date }) : null,
                      loan.interest_rate != null ? t('detailDialog.apr', { rate: rate(loan.interest_rate) }) : null,
                      loan.term_months ? t('plurals.months', { ns: 'common', count: loan.term_months }) : null,
                    ]
                      .filter(Boolean)
                      .join(' · ') || undefined
                  }
                />
                <Stat
                  label={t('detailDialog.statNextPayment')}
                  value={summary.nextDueDate ?? (summary.isPaidOff ? t('detailDialog.paidOff') : '—')}
                  hint={
                    loan.expected_payment != null
                      ? t('detailDialog.expectedPayment', { amount: amount(loan.expected_payment) })
                      : projection?.paymentDerivedFromTerm
                        ? t('detailDialog.paymentFromTerm', { amount: amount(projection.assumedPayment) })
                        : t('detailDialog.setExpectedPayment')
                  }
                />
                <Stat
                  label={t('detailDialog.statProjectedPayoff')}
                  value={
                    summary.isPaidOff
                      ? t('detailDialog.paidOff')
                      : projection
                        ? projection.neverPaysOff
                          ? t('detailDialog.neverAtThisPayment')
                          : projection.payoffDate ?? '—'
                        : '—'
                  }
                  hint={
                    projection && !projection.neverPaysOff
                      ? t('detailDialog.remainingHint', { payments: projection.monthsRemaining, amount: amount(projection.totalInterestRemaining) })
                      : projection?.neverPaysOff
                        ? t('detailDialog.paymentDoesNotCover')
                        : undefined
                  }
                />
              </Box>

              {deferred && (
                <Alert
                  severity={deferred.charged ? 'error' : deferred.onTrack ? 'success' : 'warning'}
                  sx={{ mb: 2 }}
                  data-testid="loan-deferred-panel"
                >
                  {deferred.charged ? (
                    <Trans
                      t={t}
                      i18nKey="detailDialog.deferredCharged"
                      values={{
                        date: deferred.promoEndDate,
                        balance: amount(deferred.projectedBalanceAtPromoEnd),
                        charged: amount(deferred.chargedAmount),
                        rate: rate(loan.deferred_interest_rate),
                      }}
                      components={{ strong: <strong /> }}
                    />
                  ) : summary.isPaidOff ? (
                    <>{t('detailDialog.deferredPaidInside')}</>
                  ) : (
                    <>
                      <Trans
                        t={t}
                        i18nKey="detailDialog.deferredPayBy"
                        values={{
                          date: deferred.promoEndDate,
                          days: daysLabel(t, deferred.daysUntilPromoEnd),
                          rate: rate(loan.deferred_interest_rate),
                          accrued: amount(deferred.deferredInterestAccrued),
                        }}
                        components={{ strong: <strong /> }}
                      />{' '}
                      {deferred.onTrack
                        ? t('detailDialog.deferredOnTrack')
                        : t('detailDialog.deferredAtRisk', {
                            remaining: amount(deferred.projectedBalanceAtPromoEnd),
                            atRisk: amount(deferred.deferredInterestAtRisk),
                          })}{' '}
                      {deferred.requiredMonthlyToAvoid != null &&
                        (deferred.paymentsRemainingInPromo > 0 ? (
                          <Trans
                            t={t}
                            i18nKey="detailDialog.deferredRequiredPayments"
                            count={deferred.paymentsRemainingInPromo}
                            values={{ amount: amount(deferred.requiredMonthlyToAvoid), count: deferred.paymentsRemainingInPromo }}
                            components={{ strong: <strong /> }}
                          />
                        ) : (
                          <Trans
                            t={t}
                            i18nKey="detailDialog.deferredRequiredNow"
                            values={{ amount: amount(deferred.requiredMonthlyToAvoid) }}
                            components={{ strong: <strong /> }}
                          />
                        ))}
                    </>
                  )}
                </Alert>
              )}

              <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                <Typography variant="subtitle1" gutterBottom>
                  {t('detailDialog.principalVsInterest')}
                </Typography>
                <LoanPrincipalInterestChart summary={summary} currency={currency} />
              </Paper>

              <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={1}>
                <Typography variant="subtitle1">{t('detailDialog.payments', { count: summary.paymentCount })}</Typography>
                <Stack direction="row" spacing={1}>
                  <Button size="small" startIcon={<LinkIcon />} onClick={() => setLinkOpen(true)} data-testid="loan-link-transaction">
                    {t('detailDialog.linkTransaction')}
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
                    {t('detailDialog.recordPayment')}
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
                  emptyMessage={t('detailDialog.noPayments')}
                  disableVirtualization={process.env.NODE_ENV === 'test'}
                />
              </Box>

              <Divider sx={{ my: 3 }} />

              <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={1}>
                <Box>
                  <Typography variant="subtitle1">{t('detailDialog.paymentRules', { count: rules.length })}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('detailDialog.rulesHelp')}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={1}>
                  <Button
                    size="small"
                    startIcon={scanning ? <CircularProgress size={16} color="inherit" /> : <ScanIcon />}
                    onClick={handleApplyRules}
                    disabled={scanning || rules.length === 0}
                  >
                    {t('detailDialog.applyRulesNow')}
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
                    {t('detailDialog.addRule')}
                  </Button>
                </Stack>
              </Box>
              {rules.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('detailDialog.noRules')}
                </Typography>
              ) : (
                <Stack spacing={1} data-testid="loan-rules-list">
                  {rules.map((rule) => (
                    <Paper key={rule.id} variant="outlined" sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="body2" fontFamily="monospace" sx={{ flex: '1 1 200px' }}>
                        {rule.pattern}
                      </Typography>
                      <Chip size="small" variant="outlined" label={t(`matchType.${rule.match_type}`)} />
                      <Chip size="small" variant="outlined" label={rule.account_name ? t('detailDialog.fromAccount', { name: rule.account_name }) : t('detailDialog.anyAccount')} />
                      {!rule.enabled && <Chip size="small" label={t('detailDialog.disabled')} />}
                      <Box flex={1} />
                      <IconButton
                        size="small"
                        aria-label={t('detailDialog.editRuleAria')}
                        onClick={() => {
                          setEditingRule(rule);
                          setRuleEditorOpen(true);
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" aria-label={t('detailDialog.deleteRuleAria')} onClick={() => handleDeleteRule(rule)}>
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
                    {t('detailDialog.notes')}
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
            {t('detailDialog.close')}
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
        currency={currency}
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
          setNotice(mine > 0 ? t('detailDialog.ruleCreatedLinked', { count: mine }) : t('detailDialog.ruleCreatedFuture'));
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
