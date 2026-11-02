'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Stack, Tooltip, Typography } from '@mui/material';
import { Radar as ScanIcon, Rule as RuleIcon } from '@mui/icons-material';
import type { GridColDef } from '@mui/x-data-grid';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { useSubscriptionsLoansSlice } from '@/contexts/useDatabaseSlices';
import type { Loan, LoanMatchRule } from '@/types/database';
import LoanRuleEditorDialog, { type LoanRulePrefill } from './LoanRuleEditorDialog';
import { formatCurrency, loanStatusOption } from './loanPresentation';

export interface LoansSubscriptionsSectionHandle {
  /** Opens the rule editor with the loan picker, prefilled from an unmatched cluster. */
  trackAsLoanPayment: (prefill: LoanRulePrefill) => void;
}

interface LoansSubscriptionsSectionProps {
  /** Lets the Subscriptions page open the editor from its unmatched-cluster actions. */
  onReady?: (handle: LoansSubscriptionsSectionHandle) => void;
  onNavigateToLoans?: () => void;
  /** Re-fetch rules when this changes (the page's transactionVersion). */
  refreshToken?: number;
}

/**
 * "Loans" section of the Subscriptions page: every loan with its payment
 * rules and matched payments, plus rule creation. Loans themselves are
 * created on the Loans page; this section only manages how their payments
 * are recognized.
 */
export default function LoansSubscriptionsSection({ onReady, onNavigateToLoans, refreshToken = 0 }: LoansSubscriptionsSectionProps) {
  const { loans, accounts, getLoanRules, addLoanRule, updateLoanRule, previewLoanRuleMatches, applyLoanRules } = useSubscriptionsLoansSlice();

  const [rules, setRules] = useState<LoanMatchRule[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorLoan, setEditorLoan] = useState<Loan | null>(null);
  const [editingRule, setEditingRule] = useState<LoanMatchRule | null>(null);
  const [prefill, setPrefill] = useState<LoanRulePrefill | null>(null);
  const [scanning, setScanning] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRules = useCallback(async () => {
    try {
      setRules(await getLoanRules());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load loan rules');
    }
  }, [getLoanRules]);

  useEffect(() => {
    void loadRules();
  }, [loadRules, loans, refreshToken]);

  useEffect(() => {
    onReady?.({
      trackAsLoanPayment: (next) => {
        setEditorLoan(null);
        setEditingRule(null);
        setPrefill(next);
        setEditorOpen(true);
      },
    });
  }, [onReady]);

  const rulesByLoan = useMemo(() => {
    const map = new Map<number, LoanMatchRule[]>();
    for (const rule of rules) {
      const list = map.get(rule.loan_id) ?? [];
      list.push(rule);
      map.set(rule.loan_id, list);
    }
    return map;
  }, [rules]);

  const handleScan = async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await applyLoanRules();
      setNotice(result.linked > 0 ? `Linked ${result.linked} payment${result.linked === 1 ? '' : 's'} to loans.` : 'No new loan payments matched.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply loan rules');
    } finally {
      setScanning(false);
    }
  };

  const columns = useMemo<GridColDef<Loan>[]>(
    () => [
      {
        field: 'name',
        headerName: 'Loan',
        flex: 1.2,
        minWidth: 180,
        renderCell: (params) => (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap>
              {params.row.name}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap display="block">
              {[params.row.lender, params.row.owner_display_name].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        ),
      },
      {
        field: 'rules',
        headerName: 'Payment rules',
        flex: 1.4,
        minWidth: 220,
        sortable: false,
        renderCell: (params) => {
          const loanRules = rulesByLoan.get(params.row.id) ?? [];
          if (loanRules.length === 0) {
            return (
              <Typography variant="body2" color="text.secondary">
                No rule yet
              </Typography>
            );
          }
          return (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ py: 0.5 }}>
              {loanRules.map((rule) => (
                <Tooltip key={rule.id} title={`${rule.match_type} · ${rule.account_name ? `from ${rule.account_name}` : 'any account'}${rule.enabled ? '' : ' · disabled'}`}>
                  <Chip
                    size="small"
                    variant="outlined"
                    label={rule.pattern}
                    color={rule.enabled ? 'default' : 'warning'}
                    onClick={() => {
                      setEditorLoan(params.row);
                      setEditingRule(rule);
                      setPrefill(null);
                      setEditorOpen(true);
                    }}
                  />
                </Tooltip>
              ))}
            </Stack>
          );
        },
      },
      {
        field: 'expected_payment',
        headerName: 'Expected',
        width: 110,
        align: 'right',
        headerAlign: 'right',
        valueFormatter: (value: number | null) => (value == null ? '—' : formatCurrency(value)),
      },
      {
        field: 'payment_count',
        headerName: 'Matched',
        width: 100,
        align: 'right',
        headerAlign: 'right',
        renderCell: (params) => <Chip size="small" label={params.row.payment_count ?? 0} />,
      },
      {
        field: 'last_payment_date',
        headerName: 'Last payment',
        width: 120,
        valueGetter: (_, row) => row.last_payment_date ?? '—',
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 100,
        renderCell: (params) => {
          const option = loanStatusOption(params.row.status);
          return <Chip size="small" label={option.label} color={option.color} />;
        },
      },
      {
        field: 'actions',
        headerName: '',
        width: 120,
        sortable: false,
        filterable: false,
        align: 'right',
        renderCell: (params) => (
          <Button
            size="small"
            startIcon={<RuleIcon />}
            onClick={() => {
              setEditorLoan(params.row);
              setEditingRule(null);
              setPrefill(null);
              setEditorOpen(true);
            }}
          >
            Add Rule
          </Button>
        ),
      },
    ],
    [rulesByLoan]
  );

  return (
    <Box mb={4} data-testid="subscriptions-loans-section">
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={1}>
        <Box>
          <Typography variant="h6">Loans ({loans.length})</Typography>
          <Typography variant="body2" color="text.secondary">
            Loan payment rules take precedence: a matched transaction is a loan payment, never a subscription or bill.
            {onNavigateToLoans && (
              <>
                {' '}
                <Button size="small" onClick={onNavigateToLoans} sx={{ p: 0, minWidth: 0, verticalAlign: 'baseline' }}>
                  Manage loans
                </Button>
              </>
            )}
          </Typography>
        </Box>
        <Button
          size="small"
          startIcon={scanning ? <CircularProgress size={16} color="inherit" /> : <ScanIcon />}
          onClick={handleScan}
          disabled={scanning || rules.length === 0}
        >
          Apply Loan Rules
        </Button>
      </Box>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="info" sx={{ mb: 1 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}
      {loans.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No loans yet. Create one on the Loans page, then add a rule here or use &quot;Track as loan payment&quot; on an unmatched charge.
        </Typography>
      ) : (
        <AppDataGrid
          rows={loans}
          columns={columns}
          height={Math.min(loans.length * 60 + 72, 420)}
          hideFooter
          getRowHeight={() => 'auto'}
          disableVirtualization={process.env.NODE_ENV === 'test'}
        />
      )}

      <LoanRuleEditorDialog
        open={editorOpen}
        loan={editorLoan}
        loans={loans.filter((loan) => loan.status !== 'closed')}
        accounts={accounts}
        editingRule={editingRule}
        prefill={prefill}
        onClose={() => setEditorOpen(false)}
        onCreate={async (input) => {
          await addLoanRule(input);
          const result = await applyLoanRules();
          const loanName = loans.find((loan) => loan.id === input.loan_id)?.name ?? 'the loan';
          const linked = result.byLoan[input.loan_id] ?? 0;
          setNotice(linked > 0 ? `Rule created: ${linked} payment${linked === 1 ? '' : 's'} linked to ${loanName}.` : `Rule created for ${loanName}; it applies to future transactions.`);
          await loadRules();
        }}
        onUpdate={async (id, input) => {
          await updateLoanRule(id, input);
          await applyLoanRules();
          await loadRules();
        }}
        previewMatches={previewLoanRuleMatches}
      />
    </Box>
  );
}
