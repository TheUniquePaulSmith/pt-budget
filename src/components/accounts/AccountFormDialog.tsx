'use client';

import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { Account, AccountOwnership, AccountType, User } from '@/types/database';
import { parseCardNumberInput } from './accountCardNumber';

export interface AccountFormValues {
  name: string;
  type: AccountType;
  ownership: AccountOwnership;
  institution: string | null;
  opening_balance: number;
  opening_balance_date: string | null;
  credit_limit: number | null;
  is_active: number;
}

const ACCOUNT_TYPE_OPTIONS: Array<{ value: AccountType; label: string }> = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit Card' },
  { value: 'loan', label: 'Loan / Mortgage' },
  { value: 'investment', label: 'Investment / Brokerage' },
  { value: 'retirement', label: 'Retirement (401k, IRA, Roth)' },
];

interface AccountFormDialogProps {
  open: boolean;
  editingAccount: Account | null; // null = add mode
  defaultOwnerUserId?: number | null;
  users: User[];
  onClose: () => void;
  onAdd: (
    account: AccountFormValues,
    ownerUserId: number,
    card: { last_four: string; full_number: string | null; nickname: string | null; user_id: number | null }
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
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('checking');
  const [ownership, setOwnership] = useState<AccountOwnership>('individual');
  const [institution, setInstitution] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [openingBalanceDate, setOpeningBalanceDate] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [ownerUserId, setOwnerUserId] = useState<number | null>(null);
  const [cardNumberInput, setCardNumberInput] = useState('');
  const [cardNickname, setCardNickname] = useState('');
  const [cardUserId, setCardUserId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    if (editingAccount) {
      setName(editingAccount.name);
      setType(editingAccount.type);
      setOwnership(editingAccount.ownership ?? 'individual');
      setInstitution(editingAccount.institution ?? '');
      setOpeningBalance(editingAccount.opening_balance ? String(editingAccount.opening_balance) : '');
      setOpeningBalanceDate(editingAccount.opening_balance_date ?? '');
      setCreditLimit(editingAccount.credit_limit != null ? String(editingAccount.credit_limit) : '');
      setIsActive((editingAccount.is_active ?? 1) === 1);
    } else {
      setName('');
      setType('checking');
      setOwnership('individual');
      setInstitution('');
      setOpeningBalance('');
      setOpeningBalanceDate('');
      setCreditLimit('');
      setIsActive(true);
      setOwnerUserId(defaultOwnerUserId ?? null);
      setCardNumberInput('');
      setCardNickname('');
      setCardUserId(null);
    }
    setError(null);
  }, [open, editingAccount, defaultOwnerUserId]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Account name is required');
      return;
    }

    const parsedOpeningBalance = openingBalance.trim() === '' ? 0 : Number(openingBalance);
    const parsedCreditLimit = creditLimit.trim() === '' ? null : Number(creditLimit);
    if (!Number.isFinite(parsedOpeningBalance) || (parsedCreditLimit != null && !Number.isFinite(parsedCreditLimit))) {
      setError('Opening balance and credit limit must be numbers');
      return;
    }
    const values: AccountFormValues = {
      name: name.trim(),
      type,
      ownership,
      institution: institution.trim() || null,
      opening_balance: parsedOpeningBalance,
      opening_balance_date: openingBalanceDate || null,
      credit_limit: type === 'credit' ? parsedCreditLimit : null,
      is_active: isActive ? 1 : 0,
    };

    setSaving(true);
    setError(null);
    try {
      if (editingAccount) {
        await onUpdate(editingAccount.id, values);
      } else {
        if (!ownerUserId) {
          throw new Error('Owner is required');
        }
        const parsed = parseCardNumberInput(cardNumberInput);
        if (!parsed.ok) {
          throw new Error(parsed.error);
        }
        await onAdd(
          values,
          ownerUserId,
          {
            last_four: parsed.last_four,
            full_number: parsed.full_number,
            nickname: cardNickname.trim() || null,
            user_id: cardUserId || ownerUserId,
          }
        );
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
          <FormControl fullWidth margin="dense">
            <InputLabel>Owner</InputLabel>
            <Select
              value={ownerUserId ?? ''}
              label="Owner"
              onChange={(e) => setOwnerUserId(e.target.value ? Number(e.target.value) : null)}
              required
            >
              <MenuItem value="" disabled>Select Owner</MenuItem>
              {users.map((user) => (
                <MenuItem key={user.id} value={user.id}>{user.display_name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        <TextField
          autoFocus
          margin="dense"
          label="Account Name"
          fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <FormControl fullWidth margin="dense">
          <InputLabel>Account Type</InputLabel>
          <Select
            value={type}
            label="Account Type"
            onChange={(e) => setType(e.target.value as AccountType)}
          >
            {ACCOUNT_TYPE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl fullWidth margin="dense">
          <InputLabel>Ownership</InputLabel>
          <Select
            value={ownership}
            label="Ownership"
            onChange={(e) => setOwnership(e.target.value as AccountOwnership)}
          >
            <MenuItem value="individual">Individual</MenuItem>
            <MenuItem value="joint">Joint (shared by the household)</MenuItem>
          </Select>
        </FormControl>
        <TextField
          margin="dense"
          label="Institution (Optional)"
          fullWidth
          value={institution}
          onChange={(e) => setInstitution(e.target.value)}
          placeholder="Bank or brokerage name"
        />
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
          <TextField
            margin="dense"
            label="Opening Balance"
            type="number"
            fullWidth
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
            inputProps={{ step: 0.01 }}
            helperText="Balance before the first tracked transaction"
          />
          <TextField
            margin="dense"
            label="As Of"
            type="date"
            fullWidth
            value={openingBalanceDate}
            onChange={(e) => setOpeningBalanceDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Stack>
        {type === 'credit' && (
          <TextField
            margin="dense"
            label="Credit Limit"
            type="number"
            fullWidth
            value={creditLimit}
            onChange={(e) => setCreditLimit(e.target.value)}
            inputProps={{ step: 1, min: 0 }}
            helperText="Used to show how much of the limit is in use"
          />
        )}
        <FormControlLabel
          sx={{ mt: 1 }}
          control={<Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />}
          label={isActive ? 'Active' : 'Closed (kept for history)'}
        />
        {!editingAccount && (
          <>
            <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>First Card</Typography>
            <TextField
              margin="dense"
              label="Card / Account Number"
              fullWidth
              value={cardNumberInput}
              onChange={(e) => setCardNumberInput(e.target.value)}
              helperText="Enter the full number or just the last 4 digits — only the last 4 are shown elsewhere"
              required
            />
            <TextField
              margin="dense"
              label="Nickname (Optional)"
              fullWidth
              value={cardNickname}
              onChange={(e) => setCardNickname(e.target.value)}
            />
            <FormControl fullWidth margin="dense">
              <InputLabel>Cardholder</InputLabel>
              <Select
                value={cardUserId ?? ''}
                label="Cardholder"
                onChange={(e) => setCardUserId(e.target.value ? Number(e.target.value) : null)}
              >
                <MenuItem value="">Account owner</MenuItem>
                {users.map((user) => (
                  <MenuItem key={user.id} value={user.id}>{user.display_name}</MenuItem>
                ))}
              </Select>
            </FormControl>
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
