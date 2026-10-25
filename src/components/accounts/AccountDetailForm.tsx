'use client';

/**
 * The detail pane of the Accounts page: the shared account field set laid
 * out two-up, explicit Save / Reset, and the Cards sub-grid underneath.
 * Remounted per account (`key={account.id}`) so the draft always starts
 * from the selected record.
 */

import React, { useMemo, useState } from 'react';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import { Delete as DeleteIcon, RestartAlt as ResetIcon, Save as SaveIcon } from '@mui/icons-material';

import { FormGrid, FormSection } from '@/components/common/Form';
import type { Account, AccountCard, User } from '@/types/database';
import { AccountFormFields } from './AccountFormFields';
import {
  buildAccountFormValues,
  createAccountFormState,
  type AccountFormState,
  type AccountFormValues,
} from './accountFormModel';
import { accountTypeLabel, ownerDisplayName } from './accountDisplay';
import AccountCardsTable, { type AccountCardsTableProps } from './AccountCardsTable';

export interface AccountDetailFormProps {
  account: Account;
  users: User[];
  cards: AccountCard[];
  onSave: (accountId: number, values: AccountFormValues) => Promise<void>;
  onRequestDelete: (account: Account) => void;
  onAddCard: AccountCardsTableProps['onAddCard'];
  onUpdateCard: AccountCardsTableProps['onUpdateCard'];
  onRequestDeleteCard: AccountCardsTableProps['onRequestDeleteCard'];
}

function isSameState(a: AccountFormState, b: AccountFormState): boolean {
  return (Object.keys(a) as (keyof AccountFormState)[]).every((key) => a[key] === b[key]);
}

export default function AccountDetailForm({
  account,
  users,
  cards,
  onSave,
  onRequestDelete,
  onAddCard,
  onUpdateCard,
  onRequestDeleteCard,
}: AccountDetailFormProps) {
  const initial = useMemo(() => createAccountFormState(account), [account]);
  const [form, setForm] = useState<AccountFormState>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const dirty = !isSameState(form, initial);

  const handleSave = async () => {
    const built = buildAccountFormValues(form);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(account.id, built.value);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save account');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setForm(initial);
    setError(null);
  };

  return (
    <Box
      component="form"
      data-testid="account-detail-form"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
      sx={{ p: { xs: 1.5, md: 2 }, display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h6" component="h2" noWrap data-testid="account-detail-title">
            {account.name}
          </Typography>
          <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
            <Chip size="small" variant="outlined" label={accountTypeLabel(account.type)} />
            <Chip size="small" variant="outlined" label={`Owner: ${ownerDisplayName(account, users)}`} />
            {account.ownership === 'joint' && <Chip size="small" label="Joint" />}
            {(account.is_active ?? 1) === 0 && <Chip size="small" label="Closed" />}
          </Stack>
        </Box>
        <Stack direction="row" spacing={1} sx={{ flexShrink: 0 }}>
          <Button size="small" startIcon={<ResetIcon />} onClick={handleReset} disabled={!dirty || saving}>
            Reset
          </Button>
          <Button
            size="small"
            variant="contained"
            type="submit"
            startIcon={<SaveIcon />}
            disabled={!dirty || saving}
            data-testid="account-save-button"
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </Stack>
      </Box>

      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {savedAt && !dirty && !error && (
        <Alert severity="success" variant="outlined" sx={{ py: 0 }} data-testid="account-saved-alert">
          Saved.
        </Alert>
      )}

      <FormSection title="Account" description="Changes apply when you press Save.">
        <FormGrid
          columns={2}
          // The shared field set returns a flat fragment: let its balance
          // pair (a Stack) and the Active switch take the full row.
          sx={{ '& > .MuiStack-root, & > .MuiFormControlLabel-root': { gridColumn: '1 / -1' } }}
        >
          <AccountFormFields state={form} onChange={setForm} size="small" />
        </FormGrid>
      </FormSection>

      <FormSection
        title="Cards"
        description="Cards and account numbers that CSV imports match on. Each account keeps at least one."
        divider
      >
        <AccountCardsTable
          cards={cards}
          users={users}
          ownerUserId={account.owner_user_id}
          onAddCard={onAddCard}
          onUpdateCard={onUpdateCard}
          onRequestDeleteCard={onRequestDeleteCard}
        />
      </FormSection>

      <FormSection title="Danger zone" divider>
        <Button
          size="small"
          color="error"
          variant="outlined"
          startIcon={<DeleteIcon />}
          onClick={() => onRequestDelete(account)}
          data-testid="account-delete-button"
        >
          Delete account
        </Button>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
          Transactions already recorded against this account are kept.
        </Typography>
      </FormSection>
    </Box>
  );
}
