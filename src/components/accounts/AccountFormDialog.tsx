'use client';

import React, { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Typography,
} from '@mui/material';
import { Account, User } from '@/types/database';
import { AccountCardFormFields, AccountFormFields, AccountOwnerField } from './AccountFormFields';
import {
  buildAccountCardInput,
  buildAccountFormValues,
  createAccountCardFormState,
  createAccountFormState,
  type AccountCardInput,
  type AccountFormPrefill,
  type AccountFormValues,
} from './accountFormModel';
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

interface AccountFormDialogProps {
  open: boolean;
  editingAccount: Account | null; // null = add mode
  defaultOwnerUserId?: number | null;
  users: User[];
  /** Prefilled fields for add mode (e.g. CSV import passes the account number and institution). */
  initialValues?: AccountFormPrefill;
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
  initialValues,
  onClose,
  onAdd,
  onUpdate,
  onCreated,
  onAddUser,
}: AccountFormDialogProps) {
  // Read through a ref so an inline `initialValues` literal never re-runs the
  // reset effect while the user is typing; the form is (re)filled when it opens.
  const initialValuesRef = useRef(initialValues);
  initialValuesRef.current = initialValues;

  const [form, setForm] = useState(() => createAccountFormState(editingAccount, initialValues));
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

    setForm(createAccountFormState(editingAccount, initialValuesRef.current));
    if (!editingAccount) {
      setOwnerUserId(defaultOwnerUserId ?? null);
      setCard(createAccountCardFormState(initialValuesRef.current));
    }
    setError(null);
    setNewPersonOpen(false);
    setNewPersonName('');
  }, [open, editingAccount, defaultOwnerUserId]);

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
      setError('Display name is required');
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
      setError(err instanceof Error ? err.message : 'Failed to add person');
    } finally {
      setNewPersonSaving(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const built = buildAccountFormValues(form);
    if (!built.ok) {
      setError(built.error);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      if (editingAccount) {
        await onUpdate(editingAccount.id, built.value);
      } else {
        if (!ownerUserId) {
          throw new Error('Owner is required');
        }
        const cardInput = buildAccountCardInput(card, ownerUserId);
        if (!cardInput.ok) {
          throw new Error(cardInput.error);
        }
        const result = toCreatedResult(await onAdd(built.value, ownerUserId, cardInput.value));
        if (result && onCreated) {
          await onCreated(result);
        }
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save account');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editingAccount ? 'Edit Account' : 'Add New Account'}</DialogTitle>
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
                  + New person…
                </MenuItem>
              ) : null
            }
          />
        )}
        <AccountFormFields state={form} onChange={setForm} autoFocus />
        {!editingAccount && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>First Card</Typography>
            <AccountCardFormFields state={card} onChange={setCard} users={users} />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} variant="contained" disabled={saving}>
          {saving ? 'Saving...' : editingAccount ? 'Update' : 'Add'}
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
