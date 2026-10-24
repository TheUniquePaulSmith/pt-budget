'use client';

/**
 * The account field set, rendered from `AccountFormState`. Used by the
 * Add/Edit dialog and by the inline detail form on the Accounts page so the
 * two never drift. Layout (one column vs two) is the caller's choice.
 */

import React from 'react';
import {
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
} from '@mui/material';

import type { AccountOwnership, AccountType, User } from '@/types/database';
import { ACCOUNT_TYPE_OPTIONS, type AccountCardFormState, type AccountFormState } from './accountFormModel';

export interface AccountFormFieldsProps {
  state: AccountFormState;
  onChange: (next: AccountFormState) => void;
  /** Focus the name field on mount (dialogs). */
  autoFocus?: boolean;
  /** `dense` matches the dialog; `small` suits an inline two-column form. */
  size?: 'dense' | 'small';
}

export function AccountFormFields({ state, onChange, autoFocus = false, size = 'dense' }: AccountFormFieldsProps) {
  const update = (patch: Partial<AccountFormState>) => onChange({ ...state, ...patch });
  const margin = size === 'dense' ? 'dense' : 'none';
  const fieldSize = size === 'small' ? 'small' : 'medium';

  return (
    <>
      <TextField
        autoFocus={autoFocus}
        margin={margin}
        size={fieldSize}
        label="Account Name"
        fullWidth
        value={state.name}
        onChange={(e) => update({ name: e.target.value })}
        required
      />
      <FormControl fullWidth margin={margin} size={fieldSize}>
        <InputLabel>Account Type</InputLabel>
        <Select
          value={state.type}
          label="Account Type"
          onChange={(e) => update({ type: e.target.value as AccountType })}
        >
          {ACCOUNT_TYPE_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <FormControl fullWidth margin={margin} size={fieldSize}>
        <InputLabel>Ownership</InputLabel>
        <Select
          value={state.ownership}
          label="Ownership"
          onChange={(e) => update({ ownership: e.target.value as AccountOwnership })}
        >
          <MenuItem value="individual">Individual</MenuItem>
          <MenuItem value="joint">Joint (shared by the household)</MenuItem>
        </Select>
      </FormControl>
      <TextField
        margin={margin}
        size={fieldSize}
        label="Institution (Optional)"
        fullWidth
        value={state.institution}
        onChange={(e) => update({ institution: e.target.value })}
        placeholder="Bank or brokerage name"
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          margin={margin}
          size={fieldSize}
          label="Opening Balance"
          type="number"
          fullWidth
          value={state.openingBalance}
          onChange={(e) => update({ openingBalance: e.target.value })}
          inputProps={{ step: 0.01 }}
          helperText="Balance before the first tracked transaction"
        />
        <TextField
          margin={margin}
          size={fieldSize}
          label="As Of"
          type="date"
          fullWidth
          value={state.openingBalanceDate}
          onChange={(e) => update({ openingBalanceDate: e.target.value })}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Stack>
      {state.type === 'credit' && (
        <TextField
          margin={margin}
          size={fieldSize}
          label="Credit Limit"
          type="number"
          fullWidth
          value={state.creditLimit}
          onChange={(e) => update({ creditLimit: e.target.value })}
          inputProps={{ step: 1, min: 0 }}
          helperText="Used to show how much of the limit is in use"
        />
      )}
      <FormControlLabel
        sx={{ mt: 1 }}
        control={<Switch checked={state.isActive} onChange={(e) => update({ isActive: e.target.checked })} />}
        label={state.isActive ? 'Active' : 'Closed (kept for history)'}
      />
    </>
  );
}

export interface AccountOwnerFieldProps {
  value: number | null;
  onChange: (userId: number | null) => void;
  users: User[];
  size?: 'dense' | 'small';
  /** Extra menu items appended after the users (e.g. "+ New person…"). */
  extraItems?: React.ReactNode;
}

export function AccountOwnerField({ value, onChange, users, size = 'dense', extraItems }: AccountOwnerFieldProps) {
  return (
    <FormControl fullWidth margin={size === 'dense' ? 'dense' : 'none'} size={size === 'small' ? 'small' : 'medium'}>
      <InputLabel>Owner</InputLabel>
      <Select
        value={value ?? ''}
        label="Owner"
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        required
      >
        <MenuItem value="" disabled>Select Owner</MenuItem>
        {users.map((user) => (
          <MenuItem key={user.id} value={user.id}>{user.display_name}</MenuItem>
        ))}
        {extraItems}
      </Select>
    </FormControl>
  );
}

export interface AccountCardFormFieldsProps {
  state: AccountCardFormState;
  onChange: (next: AccountCardFormState) => void;
  users: User[];
  size?: 'dense' | 'small';
}

export function AccountCardFormFields({ state, onChange, users, size = 'dense' }: AccountCardFormFieldsProps) {
  const update = (patch: Partial<AccountCardFormState>) => onChange({ ...state, ...patch });
  const margin = size === 'dense' ? 'dense' : 'none';
  const fieldSize = size === 'small' ? 'small' : 'medium';

  return (
    <>
      <TextField
        margin={margin}
        size={fieldSize}
        label="Card / Account Number"
        fullWidth
        value={state.cardNumberInput}
        onChange={(e) => update({ cardNumberInput: e.target.value })}
        helperText="Enter the full number or just the last 4 digits — only the last 4 are shown elsewhere"
        required
      />
      <TextField
        margin={margin}
        size={fieldSize}
        label="Nickname (Optional)"
        fullWidth
        value={state.cardNickname}
        onChange={(e) => update({ cardNickname: e.target.value })}
      />
      <FormControl fullWidth margin={margin} size={fieldSize}>
        <InputLabel>Cardholder</InputLabel>
        <Select
          value={state.cardUserId ?? ''}
          label="Cardholder"
          onChange={(e) => update({ cardUserId: e.target.value ? Number(e.target.value) : null })}
        >
          <MenuItem value="">Account owner</MenuItem>
          {users.map((user) => (
            <MenuItem key={user.id} value={user.id}>{user.display_name}</MenuItem>
          ))}
        </Select>
      </FormControl>
    </>
  );
}
