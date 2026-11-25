'use client';

/**
 * Creating an account without leaving the import: the shared account field
 * set (the same one the Accounts page uses), prefilled from what the file
 * says about the account.
 */

import React, { useMemo, useState, type FormEvent } from 'react';
import { Alert, Box, Button, MenuItem, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { AccountCardFormFields, AccountFormFields, AccountOwnerField } from '@/components/accounts/AccountFormFields';
import {
  buildAccountCardInput,
  buildAccountDraft,
  buildAccountFormValues,
  createAccountCardFormState,
  createAccountFormState,
  draftCardsFromInput,
  type AccountCardInput,
  type AccountFormPrefill,
  type AccountFormValues,
} from '@/components/accounts/accountFormModel';
import AccountLabelPreview from '@/components/accounts/AccountLabelPreview';
import { useAccountLabelWords, useSuggestedAccountName } from '@/components/accounts/useAccountLabels';
import { UserFormDialog } from '@/components/accounts/UserFormDialog';
import { accountNameKey, suggestAccountName } from '@/lib/accountLabels';
import type { Account, User } from '@/types/database';

/** Owner menu value of "+ New person…"; negative, so it never collides with a user id. */
const NEW_PERSON_VALUE = -1;

export interface CreatedAccount {
  accountId: number;
  cardId: number;
}

interface InlineAccountFormProps {
  users: User[];
  /** The existing accounts: the preview says when another one already has this name. */
  accounts: readonly Account[];
  defaultCurrency: string;
  prefill: AccountFormPrefill;
  onAdd: (account: AccountFormValues, ownerUserId: number, card: AccountCardInput) => Promise<CreatedAccount>;
  /** Resolves with the new person's id once the people list has refreshed. */
  onAddUser: (displayName: string) => Promise<number>;
  onCreated: (created: CreatedAccount) => void | Promise<void>;
  onCancel?: () => void;
}

function defaultOwner(users: User[]): number | null {
  if (users.length === 1) return users[0].id;
  return users.find((user) => user.is_primary === 1)?.id ?? null;
}

export default function InlineAccountForm({
  users,
  accounts,
  defaultCurrency,
  prefill,
  onAdd,
  onAddUser,
  onCreated,
  onCancel,
}: InlineAccountFormProps) {
  const { t } = useTranslation(['importWizard', 'accounts', 'common']);
  const words = useAccountLabelWords();
  const [form, setForm] = useState(() => {
    const initial = createAccountFormState(null, prefill, defaultCurrency);
    // A name from the file that only repeats the suggestion ("Checking") leaves the field to the suggestion.
    const suggestion = suggestAccountName({ institution: initial.institution, type: initial.type }, words.typeLabel);
    return accountNameKey(initial.name) === accountNameKey(suggestion) ? { ...initial, name: '' } : initial;
  });
  const [card, setCard] = useState(() => createAccountCardFormState(prefill));
  const [ownerUserId, setOwnerUserId] = useState<number | null>(() => defaultOwner(users));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newPersonOpen, setNewPersonOpen] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonSaving, setNewPersonSaving] = useState(false);

  // An empty Account Name is saved as the suggestion; the preview shows the label either way.
  const suggestedName = useSuggestedAccountName(form.institution, form.type);
  const draft = useMemo(
    () =>
      buildAccountDraft(form, suggestedName, {
        ownerUserId,
        ownerDisplayName: users.find((user) => user.id === ownerUserId)?.display_name,
        cards: draftCardsFromInput(card),
      }),
    [card, form, ownerUserId, suggestedName, users]
  );

  const handleNewPerson = async (event: FormEvent) => {
    event.preventDefault();
    const displayName = newPersonName.trim();
    if (!displayName) {
      setError(t('accounts:formDialog.displayNameRequired'));
      return;
    }
    setNewPersonSaving(true);
    try {
      setOwnerUserId(await onAddUser(displayName));
      setNewPersonOpen(false);
      setNewPersonName('');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('accounts:formDialog.addPersonFailed'));
    } finally {
      setNewPersonSaving(false);
    }
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const values = buildAccountFormValues(form, suggestedName);
    if (!values.ok) {
      setError(t(`accounts:validation.${values.error}`));
      return;
    }
    if (!ownerUserId) {
      setError(t('accounts:formDialog.ownerRequired'));
      return;
    }
    const cardInput = buildAccountCardInput(card, ownerUserId);
    if (!cardInput.ok) {
      setError(t(`accounts:validation.${cardInput.error}`));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onCreated(await onAdd(values.value, ownerUserId, cardInput.value));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('accounts:formDialog.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box component="form" onSubmit={handleSubmit} noValidate data-testid="import-account-form" sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2" gutterBottom>
        {t('account.createTitle')}
      </Typography>
      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }}>
          {error}
        </Alert>
      )}
      <Stack spacing={1.5}>
        <AccountOwnerField
          value={ownerUserId}
          onChange={(userId) => (userId === NEW_PERSON_VALUE ? setNewPersonOpen(true) : setOwnerUserId(userId))}
          users={users}
          size="small"
          extraItems={
            <MenuItem value={NEW_PERSON_VALUE} sx={{ fontStyle: 'italic' }}>
              {t('accounts:formDialog.newPerson')}
            </MenuItem>
          }
        />
        <AccountFormFields
          state={form}
          onChange={setForm}
          size="small"
          afterName={<AccountLabelPreview draft={draft} accounts={accounts} users={users} />}
        />
        <Typography variant="subtitle2">{t('accounts:formDialog.firstCard')}</Typography>
        <AccountCardFormFields state={card} onChange={setCard} users={users} size="small" />
      </Stack>
      <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
        <Button type="submit" variant="contained" disabled={saving} data-testid="import-account-create">
          {saving ? t('common:status.saving') : t('account.createSubmit')}
        </Button>
        {onCancel && (
          <Button onClick={onCancel} disabled={saving}>
            {t('common:actions.cancel')}
          </Button>
        )}
      </Box>

      <UserFormDialog
        open={newPersonOpen}
        editing={false}
        displayName={newPersonName}
        loading={newPersonSaving}
        onDisplayNameChange={setNewPersonName}
        onClose={() => {
          setNewPersonOpen(false);
          setNewPersonName('');
        }}
        onSubmit={handleNewPerson}
      />
    </Box>
  );
}
