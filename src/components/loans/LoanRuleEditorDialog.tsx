'use client';

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { Account, Loan, LoanMatchRule, LoanMatchRuleInput, MerchantRuleMatchType } from '@/types/database';
import type { LoanLinkCandidate } from '@/types/loans';

export interface LoanRulePrefill {
  loan_id?: number | null;
  pattern?: string;
  match_type?: MerchantRuleMatchType;
  account_id?: number | null;
}

interface LoanRuleEditorDialogProps {
  open: boolean;
  /** Fixed loan (detail view) or null to let the user pick one (Subscriptions page). */
  loan: Loan | null;
  loans: Loan[];
  accounts: Account[];
  editingRule: LoanMatchRule | null;
  prefill?: LoanRulePrefill | null;
  onClose: () => void;
  onCreate: (input: LoanMatchRuleInput) => Promise<void>;
  onUpdate: (id: number, input: Omit<LoanMatchRuleInput, 'loan_id'>) => Promise<void>;
  previewMatches: (rule: { pattern: string; match_type: MerchantRuleMatchType; account_id?: number | null }) => Promise<LoanLinkCandidate[]>;
}

const MATCH_TYPES: ReadonlyArray<MerchantRuleMatchType> = ['contains', 'prefix', 'exact'];

export default function LoanRuleEditorDialog({
  open,
  loan,
  loans,
  accounts,
  editingRule,
  prefill,
  onClose,
  onCreate,
  onUpdate,
  previewMatches,
}: LoanRuleEditorDialogProps) {
  const { t } = useTranslation('loans');
  const { money } = useFormatters();
  const [loanId, setLoanId] = useState('');
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState<MerchantRuleMatchType>('contains');
  const [accountId, setAccountId] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<LoanLinkCandidate[] | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (editingRule) {
      setLoanId(String(editingRule.loan_id));
      setPattern(editingRule.pattern);
      setMatchType(editingRule.match_type);
      setAccountId(editingRule.account_id != null ? String(editingRule.account_id) : '');
      setEnabled(Boolean(editingRule.enabled));
      setNotes(editingRule.notes ?? '');
    } else {
      setLoanId(loan ? String(loan.id) : prefill?.loan_id != null ? String(prefill.loan_id) : '');
      setPattern(prefill?.pattern ?? '');
      setMatchType(prefill?.match_type ?? 'contains');
      setAccountId(prefill?.account_id != null ? String(prefill.account_id) : '');
      setEnabled(true);
      setNotes('');
    }
    setPreview(null);
    setError(null);
  }, [editingRule, loan, open, prefill]);

  // Preview matches as the pattern settles.
  useEffect(() => {
    if (!open || !pattern.trim()) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewing(true);
    const timer = setTimeout(() => {
      previewMatches({ pattern, match_type: matchType, account_id: accountId ? Number(accountId) : null })
        .then((rows) => {
          if (!cancelled) setPreview(rows);
        })
        .catch(() => {
          if (!cancelled) setPreview(null);
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [accountId, matchType, open, pattern, previewMatches]);

  const handleSave = async () => {
    setError(null);
    if (!pattern.trim()) {
      setError(t('ruleEditorDialog.patternRequired'));
      return;
    }
    if (!editingRule && !loanId) {
      setError(t('ruleEditorDialog.loanRequired'));
      return;
    }
    setSaving(true);
    try {
      const base = {
        pattern: pattern.trim(),
        match_type: matchType,
        account_id: accountId ? Number(accountId) : null,
        enabled,
        notes: notes.trim() || null,
      };
      if (editingRule) {
        await onUpdate(editingRule.id, base);
      } else {
        await onCreate({ ...base, loan_id: Number(loanId) });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ruleEditorDialog.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const title = editingRule
    ? t('ruleEditorDialog.editTitle')
    : loan
      ? t('ruleEditorDialog.trackForTitle', { name: loan.name })
      : t('ruleEditorDialog.trackTitle');

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, mt: 1 }}>
          {t('ruleEditorDialog.intro')}
        </Typography>
        <Box display="flex" flexDirection="column" gap={2}>
          {!loan && !editingRule && (
            <TextField select label={t('ruleEditorDialog.loan')} value={loanId} onChange={(event) => setLoanId(event.target.value)} size="small" required>
              {loans.map((candidate) => (
                <MenuItem key={candidate.id} value={String(candidate.id)}>
                  {candidate.name}
                  {candidate.lender ? ` — ${candidate.lender}` : ''}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            label={t('ruleEditorDialog.pattern')}
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            size="small"
            required
            autoFocus
            helperText={t('ruleEditorDialog.patternHelp')}
            slotProps={{ htmlInput: { 'data-testid': 'loan-rule-pattern' } }}
          />
          <Box display="flex" gap={2} flexWrap="wrap">
            <TextField
              select
              label={t('ruleEditorDialog.match')}
              value={matchType}
              onChange={(event) => setMatchType(event.target.value as MerchantRuleMatchType)}
              size="small"
              sx={{ flex: '1 1 140px' }}
            >
              {MATCH_TYPES.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(`matchType.${value}`)}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('ruleEditorDialog.paidFrom')}
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              size="small"
              sx={{ flex: '2 1 200px' }}
              helperText={t('ruleEditorDialog.paidFromHelp')}
            >
              <MenuItem value="">{t('ruleEditorDialog.anyAccount')}</MenuItem>
              {accounts.map((account) => (
                <MenuItem key={account.id} value={String(account.id)}>
                  {account.name}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <TextField label={t('ruleEditorDialog.notes')} value={notes} onChange={(event) => setNotes(event.target.value)} size="small" />
          {editingRule && (
            <FormControlLabel
              control={<Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />}
              label={t('ruleEditorDialog.enabled')}
            />
          )}
          <Box>
            <Typography variant="subtitle2" gutterBottom>
              {t('ruleEditorDialog.wouldMatch')}
            </Typography>
            {previewing ? (
              <Typography variant="body2" color="text.secondary">
                {t('ruleEditorDialog.checking')}
              </Typography>
            ) : preview == null ? (
              <Typography variant="body2" color="text.secondary">
                {t('ruleEditorDialog.enterPattern')}
              </Typography>
            ) : preview.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                {t('ruleEditorDialog.noMatches')}
              </Typography>
            ) : (
              <Box component="ul" sx={{ m: 0, pl: 2, maxHeight: 160, overflowY: 'auto' }} data-testid="loan-rule-preview">
                {preview.slice(0, 8).map((row) => (
                  <Typography component="li" variant="body2" key={row.id}>
                    {[row.date, row.description, money(Math.abs(row.amount), row.account_currency)].join(' · ')}
                    {row.account_name ? ` · ${row.account_name}` : ''}
                  </Typography>
                ))}
                {preview.length > 8 && (
                  <Typography component="li" variant="body2" color="text.secondary">
                    {t('ruleEditorDialog.andMore', { count: preview.length - 8 })}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('ruleEditorDialog.cancel')}
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving} data-testid="loan-rule-save">
          {saving ? t('ruleEditorDialog.saving') : editingRule ? t('ruleEditorDialog.save') : t('ruleEditorDialog.createRule')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
