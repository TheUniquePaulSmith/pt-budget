'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
  type AccountFormValues,
} from './accountFormModel';

export type { AccountFormValues } from './accountFormModel';

interface AccountFormDialogProps {
  open: boolean;
  editingAccount: Account | null; // null = add mode
  defaultOwnerUserId?: number | null;
  users: User[];
  onClose: () => void;
  onAdd: (
    account: AccountFormValues,
    ownerUserId: number,
    card: AccountCardInput
  ) => Promise<unknown>;
  onUpdate: (id: number, updates: AccountFormValues) => Promise<void>;
}

export function AccountFormDialog({
  open,
  editingAccount,
  defaultOwnerUserId,
  users,
  onClose,
  onAdd,
  onUpdate,
}: AccountFormDialogProps) {
  const [form, setForm] = useState(() => createAccountFormState(editingAccount));
  const [card, setCard] = useState(() => createAccountCardFormState());
  const [ownerUserId, setOwnerUserId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setForm(createAccountFormState(editingAccount));
    if (!editingAccount) {
      setOwnerUserId(defaultOwnerUserId ?? null);
      setCard(createAccountCardFormState());
    }
    setError(null);
  }, [open, editingAccount, defaultOwnerUserId]);

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
        await onAdd(built.value, ownerUserId, cardInput.value);
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
          <AccountOwnerField value={ownerUserId} onChange={setOwnerUserId} users={users} />
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
    </Dialog>
  );
}
