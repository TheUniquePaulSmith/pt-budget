'use client';

import React, { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Account, User } from '@/types/database';
import { AccountCardFormFields, AccountFormFields, AccountOwnerField } from './AccountFormFields';
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
} from './accountFormModel';
import AccountLabelPreview from './AccountLabelPreview';
import { useSuggestedAccountName } from './useAccountLabels';
import { UserFormDialog } from './UserFormDialog';

export type { AccountFormValues } from './accountFormModel';

/** Ids returned by `addAccountWithCard`; surfaced to callers through `onCreated`. */
export interface AccountCreatedResult {
  accountId: number;
  cardId: number;
}

/**
 * Sentinel value of the "+ New person…" owner item. Negative so it can never
 * collide with a real user id, and never stored as the selected owner.
 */
const NEW_PERSON_VALUE = -1;

const NO_ACCOUNTS: readonly Account[] = [];

interface AccountFormDialogProps {
  open: boolean;
  editingAccount: Account | null; // null = add mode
  defaultOwnerUserId?: number | null;
  users: User[];
  /** The existing accounts: the preview says when another one already has this name. */
  accounts?: readonly Account[];
  /** Prefilled fields for add mode (e.g. CSV import passes the account number and institution). */
  initialValues?: AccountFormPrefill;
  /** The household's default currency; a new account starts with it. */
  defaultCurrency?: string;
  onClose: () => void;
  onAdd: (
    account: AccountFormValues,
    ownerUserId: number,
    card: AccountCardInput
  ) => Promise<unknown>;
  onUpdate: (id: number, updates: AccountFormValues) => Promise<void>;
  /**
   * Called after a successful add with the ids `onAdd` resolved to (when it
   * resolves to `{ accountId, cardId }`), right before the dialog closes.
   */
  onCreated?: (result: AccountCreatedResult) => void | Promise<void>;
  /**
   * Enables the "+ New person…" item in the Owner select. Resolves to the new
   * user's id; the caller is expected to refresh `users` before resolving.
   */
  onAddUser?: (displayName: string) => Promise<number>;
}

function toCreatedResult(value: unknown): AccountCreatedResult | null {
  if (!value || typeof value !== 'object') return null;
  const { accountId, cardId } = value as Partial<AccountCreatedResult>;
  if (typeof accountId !== 'number' || typeof cardId !== 'number') return null;
  return { accountId, cardId };
}

export function AccountFormDialog({
  open,
  editingAccount,
  defaultOwnerUserId,
  users,
  accounts = NO_ACCOUNTS,
  initialValues,
  defaultCurrency,
  onClose,
  onAdd,
  onUpdate,
  onCreated,
  onAddUser,
}: AccountFormDialogProps) {
  const { t } = useTranslation(['accounts', 'common']);
  // Read through a ref so an inline `initialValues` literal never re-runs the
  // reset effect while the user is typing; the form is (re)filled when it opens.
  const initialValuesRef = useRef(initialValues);
  initialValuesRef.current = initialValues;

  const [form, setForm] = useState(() => createAccountFormState(editingAccount, initialValues, defaultCurrency));
  const [card, setCard] = useState(() => createAccountCardFormState(initialValues));
  const [ownerUserId, setOwnerUserId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline "+ New person…" flow.
  const [newPersonOpen, setNewPersonOpen] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonSaving, setNewPersonSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setForm(createAccountFormState(editingAccount, initialValuesRef.current, defaultCurrency));
    if (!editingAccount) {
      setOwnerUserId(defaultOwnerUserId ?? null);
      setCard(createAccountCardFormState(initialValuesRef.current));
    }
    setError(null);
    setNewPersonOpen(false);
    setNewPersonName('');
  }, [open, editingAccount, defaultOwnerUserId, defaultCurrency]);

  // An empty Account Name is saved as the suggestion; the preview shows the label either way.
  const suggestedName = useSuggestedAccountName(form.institution, form.type);
  const draft = useMemo(
    () =>
      editingAccount
        ? buildAccountDraft(form, suggestedName, {
            id: editingAccount.id,
            ownerUserId: editingAccount.owner_user_id,
            ownerDisplayName: editingAccount.owner_display_name,
            cards: editingAccount.cards,
          })
        : buildAccountDraft(form, suggestedName, {
            ownerUserId,
            ownerDisplayName: users.find((user) => user.id === ownerUserId)?.display_name,
            cards: draftCardsFromInput(card),
          }),
    [card, editingAccount, form, ownerUserId, suggestedName, users]
  );

  const handleOwnerChange = (userId: number | null) => {
    if (userId === NEW_PERSON_VALUE) {
      setNewPersonOpen(true);
      return;
    }
    setOwnerUserId(userId);
  };

  const handleNewPersonSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!onAddUser) return;
    const displayName = newPersonName.trim();
    if (!displayName) {
      setError(t('formDialog.displayNameRequired'));
      return;
    }
    setNewPersonSaving(true);
    try {
      const userId = await onAddUser(displayName);
      setOwnerUserId(userId);
      setNewPersonOpen(false);
      setNewPersonName('');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('formDialog.addPersonFailed'));
    } finally {
      setNewPersonSaving(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const built = buildAccountFormValues(form, suggestedName);
    if (!built.ok) {
      setError(t(`validation.${built.error}`));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingAccount) {
        await onUpdate(editingAccount.id, built.value);
      } else {
        if (!ownerUserId) {
          setError(t('formDialog.ownerRequired'));
          return;
        }
        const cardInput = buildAccountCardInput(card, ownerUserId);
        if (!cardInput.ok) {
          setError(t(`validation.${cardInput.error}`));
          return;
        }
        const result = toCreatedResult(await onAdd(built.value, ownerUserId, cardInput.value));
        if (result && onCreated) {
          await onCreated(result);
        }
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('formDialog.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editingAccount ? t('formDialog.editTitle') : t('formDialog.addTitle')}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        {!editingAccount && (
          <AccountOwnerField
            value={ownerUserId}
            onChange={handleOwnerChange}
            users={users}
            extraItems={
              onAddUser ? (
                <MenuItem value={NEW_PERSON_VALUE} sx={{ fontStyle: 'italic' }}>
                  {t('formDialog.newPerson')}
                </MenuItem>
              ) : null
            }
          />
        )}
        <AccountFormFields
          state={form}
          onChange={setForm}
          autoFocus
          afterName={
            <Box sx={{ mt: 0.5, mb: 1 }}>
              <AccountLabelPreview draft={draft} accounts={accounts} users={users} />
            </Box>
          }
        />
        {!editingAccount && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>{t('formDialog.firstCard')}</Typography>
            <AccountCardFormFields state={card} onChange={setCard} users={users} />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving}>
          {saving ? t('formDialog.saving') : editingAccount ? t('common:actions.update') : t('common:actions.add')}
        </Button>
      </DialogActions>

      {onAddUser && (
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
          onSubmit={handleNewPersonSubmit}
        />
      )}
    </Dialog>
  );
}
