'use client';

import React, { useEffect, useMemo, useState } from 'react';
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

import { normalizeDescription } from '@/lib/merchantMatchingService';
import type {
  Account,
  ClassificationRule,
  ClassificationRuleInput,
  MerchantRuleMatchType,
  TransactionType,
} from '@/types/database';

export interface ClassificationRulePrefill {
  pattern?: string;
  type?: TransactionType;
  account_id?: number | null;
  counterpart_account_id?: number | null;
}

interface ClassificationRuleEditorDialogProps {
  open: boolean;
  /** null = create mode */
  editingRule: ClassificationRule | null;
  prefill?: ClassificationRulePrefill | null;
  accounts: Account[];
  onClose: () => void;
  onCreate: (rule: ClassificationRuleInput) => Promise<void>;
  onUpdate: (id: number, rule: ClassificationRuleInput) => Promise<void>;
  previewMatches: (rule: {
    pattern: string;
    match_type: MerchantRuleMatchType;
    type: TransactionType;
    account_id?: number | null;
  }) => Promise<number>;
}

const ANY_ACCOUNT = 'any';

const TYPE_OPTIONS: Array<{ value: TransactionType; label: string; hint: string }> = [
  { value: 'transfer', label: 'Transfer', hint: 'Between your own accounts: card payments, savings moves. Counts as neither income nor spending.' },
  { value: 'refund', label: 'Refund', hint: 'Money back from a merchant; nets against spending in its category.' },
  { value: 'income', label: 'Income', hint: 'Earnings arriving in an account.' },
  { value: 'expense', label: 'Expense', hint: 'Spending.' },
];

/**
 * Create / edit one classification rule: a description pattern that decides
 * the type of every matching row (and, for transfers, which account the
 * money goes to or comes from).
 */
export default function ClassificationRuleEditorDialog({
  open,
  editingRule,
  prefill,
  accounts,
  onClose,
  onCreate,
  onUpdate,
  previewMatches,
}: ClassificationRuleEditorDialogProps) {
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState<MerchantRuleMatchType>('contains');
  const [type, setType] = useState<TransactionType>('transfer');
  const [accountId, setAccountId] = useState<string>(ANY_ACCOUNT);
  const [counterpartId, setCounterpartId] = useState<string>(ANY_ACCOUNT);
  const [priority, setPriority] = useState('100');
  const [enabled, setEnabled] = useState(true);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedPattern = useMemo(() => normalizeDescription(pattern), [pattern]);

  useEffect(() => {
    if (!open) return;
    if (editingRule) {
      setPattern(editingRule.pattern);
      setMatchType(editingRule.match_type);
      setType(editingRule.type);
      setAccountId(editingRule.account_id == null ? ANY_ACCOUNT : String(editingRule.account_id));
      setCounterpartId(editingRule.counterpart_account_id == null ? ANY_ACCOUNT : String(editingRule.counterpart_account_id));
      setPriority(String(editingRule.priority));
      setEnabled(Boolean(editingRule.enabled));
    } else {
      setPattern(prefill?.pattern ?? '');
      setMatchType('contains');
      setType(prefill?.type ?? 'transfer');
      setAccountId(prefill?.account_id == null ? ANY_ACCOUNT : String(prefill.account_id));
      setCounterpartId(prefill?.counterpart_account_id == null ? ANY_ACCOUNT : String(prefill.counterpart_account_id));
      setPriority('100');
      setEnabled(true);
    }
    setError(null);
    setPreviewCount(null);
  }, [open, editingRule, prefill]);

  // Live "would type N transactions" preview, debounced.
  useEffect(() => {
    if (!open || !normalizedPattern) {
      setPreviewCount(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      previewMatches({
        pattern: normalizedPattern,
        match_type: matchType,
        type,
        account_id: accountId === ANY_ACCOUNT ? null : Number(accountId),
      })
        .then((count) => {
          if (!cancelled) setPreviewCount(count);
        })
        .catch(() => {
          if (!cancelled) setPreviewCount(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, normalizedPattern, matchType, type, accountId, previewMatches]);

  const handleSave = async () => {
    if (!normalizedPattern) {
      setError('Pattern is required');
      return;
    }
    const parsedPriority = Number(priority);
    if (!Number.isInteger(parsedPriority)) {
      setError('Priority must be a whole number');
      return;
    }
    const input: ClassificationRuleInput = {
      pattern: normalizedPattern,
      match_type: matchType,
      type,
      priority: parsedPriority,
      account_id: accountId === ANY_ACCOUNT ? null : Number(accountId),
      counterpart_account_id: type === 'transfer' && counterpartId !== ANY_ACCOUNT ? Number(counterpartId) : null,
      enabled,
      notes: editingRule?.notes ?? null,
    };
    setSaving(true);
    setError(null);
    try {
      if (editingRule) {
        await onUpdate(editingRule.id, input);
      } else {
        await onCreate(input);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setSaving(false);
    }
  };

  const accountLabel = (account: Account) =>
    account.owner_display_name ? `${account.owner_display_name} - ${account.name}` : account.name;
  const typeOption = TYPE_OPTIONS.find((option) => option.value === type);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editingRule ? 'Edit Type Rule' : 'Create Type Rule'}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Box display="flex" flexDirection="column" gap={2} mt={1}>
          <TextField
            label="Description pattern"
            value={pattern}
            onChange={(event) => setPattern(event.target.value)}
            size="small"
            autoFocus
            helperText={
              normalizedPattern && normalizedPattern !== pattern
                ? `Will be saved as: ${normalizedPattern}`
                : 'Matched against cleaned-up descriptions (uppercase, reference codes removed)'
            }
          />
          <TextField
            select
            label="Match type"
            value={matchType}
            onChange={(event) => setMatchType(event.target.value as MerchantRuleMatchType)}
            size="small"
          >
            <MenuItem value="contains">Contains</MenuItem>
            <MenuItem value="prefix">Starts with</MenuItem>
            <MenuItem value="exact">Exact match</MenuItem>
          </TextField>
          <TextField
            select
            label="Mark matching transactions as"
            value={type}
            onChange={(event) => setType(event.target.value as TransactionType)}
            size="small"
            helperText={typeOption?.hint}
          >
            {TYPE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Only in account"
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            size="small"
            helperText="Leave on Any account unless the same wording means something else elsewhere"
          >
            <MenuItem value={ANY_ACCOUNT}>Any account</MenuItem>
            {accounts.map((account) => (
              <MenuItem key={account.id} value={String(account.id)}>
                {accountLabel(account)}
              </MenuItem>
            ))}
          </TextField>
          {type === 'transfer' && (
            <TextField
              select
              label="Other side of the transfer"
              value={counterpartId}
              onChange={(event) => setCounterpartId(event.target.value)}
              size="small"
              helperText="When you know which account the money goes to or comes from, matching finds the other leg more confidently"
            >
              <MenuItem value={ANY_ACCOUNT}>Unknown / not tracked here</MenuItem>
              {accounts
                .filter((account) => String(account.id) !== accountId)
                .map((account) => (
                  <MenuItem key={account.id} value={String(account.id)}>
                    {accountLabel(account)}
                  </MenuItem>
                ))}
            </TextField>
          )}
          <Box display="flex" gap={2} alignItems="center">
            <TextField
              label="Priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              size="small"
              sx={{ width: 140 }}
              helperText="Lower wins"
              slotProps={{ htmlInput: { inputMode: 'numeric' } }}
            />
            {editingRule && (
              <FormControlLabel
                control={<Switch checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />}
                label="Enabled"
              />
            )}
          </Box>
          <Typography variant="body2" color="text.secondary" data-testid="type-rule-preview">
            {previewCount === null
              ? 'Enter a pattern to preview matches.'
              : `This rule would apply to ${previewCount} existing transaction${previewCount === 1 ? '' : 's'}.`}
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving…' : editingRule ? 'Save Rule' : 'Create Rule'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
