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
import { useTranslation } from 'react-i18next';

import CurrencySelect from '@/components/common/CurrencySelect';
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
  const { t } = useTranslation(['accounts', 'common']);
  const update = (patch: Partial<AccountFormState>) => onChange({ ...state, ...patch });
  const margin = size === 'dense' ? 'dense' : 'none';
  const fieldSize = size === 'small' ? 'small' : 'medium';

  return (
    <>
      <TextField
        autoFocus={autoFocus}
        margin={margin}
        size={fieldSize}
        label={t('formFields.nameLabel')}
        fullWidth
        value={state.name}
        onChange={(e) => update({ name: e.target.value })}
        required
      />
      <FormControl fullWidth margin={margin} size={fieldSize}>
        <InputLabel>{t('formFields.typeLabel')}</InputLabel>
        <Select
          value={state.type}
          label={t('formFields.typeLabel')}
          onChange={(e) => update({ type: e.target.value as AccountType })}
        >
          {ACCOUNT_TYPE_OPTIONS.map((option) => (
            <MenuItem key={option.value} value={option.value}>{t(`common:accountType.${option.value}`)}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <CurrencySelect
        id="account-currency"
        label={t('formFields.currencyLabel')}
        value={state.currency}
        onChange={(currency) => update({ currency })}
        margin={margin}
        size={fieldSize}
        testId="account-currency"
      />
      <FormControl fullWidth margin={margin} size={fieldSize}>
        <InputLabel>{t('formFields.ownershipLabel')}</InputLabel>
        <Select
          value={state.ownership}
          label={t('formFields.ownershipLabel')}
          onChange={(e) => update({ ownership: e.target.value as AccountOwnership })}
        >
          <MenuItem value="individual">{t('common:accountOwnership.individual')}</MenuItem>
          <MenuItem value="joint">{t('formFields.ownershipJoint')}</MenuItem>
        </Select>
      </FormControl>
      <TextField
        margin={margin}
        size={fieldSize}
        label={t('formFields.institutionLabel')}
        fullWidth
        value={state.institution}
        onChange={(e) => update({ institution: e.target.value })}
        placeholder={t('formFields.institutionPlaceholder')}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <TextField
          margin={margin}
          size={fieldSize}
          label={t('formFields.openingBalanceLabel')}
          type="number"
          fullWidth
          value={state.openingBalance}
          onChange={(e) => update({ openingBalance: e.target.value })}
          inputProps={{ step: 0.01 }}
          helperText={t('formFields.openingBalanceHelp')}
        />
        <TextField
          margin={margin}
          size={fieldSize}
          label={t('formFields.asOfLabel')}
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
          label={t('formFields.creditLimitLabel')}
          type="number"
          fullWidth
          value={state.creditLimit}
          onChange={(e) => update({ creditLimit: e.target.value })}
          inputProps={{ step: 1, min: 0 }}
          helperText={t('formFields.creditLimitHelp')}
        />
      )}
      <FormControlLabel
        sx={{ mt: 1 }}
        control={<Switch checked={state.isActive} onChange={(e) => update({ isActive: e.target.checked })} />}
        label={state.isActive ? t('formFields.activeLabel') : t('formFields.closedLabel')}
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
  const { t } = useTranslation(['accounts', 'common']);
  return (
    <FormControl fullWidth margin={size === 'dense' ? 'dense' : 'none'} size={size === 'small' ? 'small' : 'medium'}>
      <InputLabel>{t('formFields.ownerLabel')}</InputLabel>
      <Select
        value={value ?? ''}
        label={t('formFields.ownerLabel')}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        required
      >
        <MenuItem value="" disabled>{t('formFields.selectOwner')}</MenuItem>
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
  const { t } = useTranslation(['accounts', 'common']);
  const update = (patch: Partial<AccountCardFormState>) => onChange({ ...state, ...patch });
  const margin = size === 'dense' ? 'dense' : 'none';
  const fieldSize = size === 'small' ? 'small' : 'medium';

  return (
    <>
      <TextField
        margin={margin}
        size={fieldSize}
        label={t('formFields.cardNumberLabel')}
        fullWidth
        value={state.cardNumberInput}
        onChange={(e) => update({ cardNumberInput: e.target.value })}
        helperText={t('formFields.cardNumberHelp')}
        required
      />
      <TextField
        margin={margin}
        size={fieldSize}
        label={t('formFields.cardNicknameLabel')}
        fullWidth
        value={state.cardNickname}
        onChange={(e) => update({ cardNickname: e.target.value })}
      />
      <FormControl fullWidth margin={margin} size={fieldSize}>
        <InputLabel>{t('formFields.cardholderLabel')}</InputLabel>
        <Select
          value={state.cardUserId ?? ''}
          label={t('formFields.cardholderLabel')}
          onChange={(e) => update({ cardUserId: e.target.value ? Number(e.target.value) : null })}
        >
          <MenuItem value="">{t('formFields.cardholderOwner')}</MenuItem>
          {users.map((user) => (
            <MenuItem key={user.id} value={user.id}>{user.display_name}</MenuItem>
          ))}
        </Select>
      </FormControl>
    </>
  );
}
