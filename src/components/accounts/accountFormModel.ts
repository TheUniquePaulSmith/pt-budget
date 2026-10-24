/**
 * Account form model shared by the Add/Edit dialog (CSV import reuses it
 * with prefilled values) and the inline detail form on the Accounts page.
 * Pure state + validation; no React.
 */

import type { Account, AccountOwnership, AccountType } from '@/types/database';
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

export const ACCOUNT_TYPE_OPTIONS: ReadonlyArray<{ value: AccountType; label: string }> = [
  { value: 'checking', label: 'Checking' },
  { value: 'savings', label: 'Savings' },
  { value: 'credit', label: 'Credit Card' },
  { value: 'loan', label: 'Loan / Mortgage' },
  { value: 'investment', label: 'Investment / Brokerage' },
  { value: 'retirement', label: 'Retirement (401k, IRA, Roth)' },
];

/** Raw field state (strings as typed) for the account itself. */
export interface AccountFormState {
  name: string;
  type: AccountType;
  ownership: AccountOwnership;
  institution: string;
  openingBalance: string;
  openingBalanceDate: string;
  creditLimit: string;
  isActive: boolean;
}

/** Raw field state for the first card captured when adding an account. */
export interface AccountCardFormState {
  cardNumberInput: string;
  cardNickname: string;
  cardUserId: number | null;
}

export interface AccountCardInput {
  last_four: string;
  full_number: string | null;
  nickname: string | null;
  user_id: number | null;
}

export type AccountFormPrefill = Partial<Pick<AccountFormState, 'name' | 'type' | 'ownership' | 'institution'>> & {
  cardNumberInput?: string;
};

export function createAccountFormState(
  account?: Account | null,
  prefill: AccountFormPrefill = {}
): AccountFormState {
  if (account) {
    return {
      name: account.name,
      type: account.type,
      ownership: account.ownership ?? 'individual',
      institution: account.institution ?? '',
      openingBalance: account.opening_balance ? String(account.opening_balance) : '',
      openingBalanceDate: account.opening_balance_date ?? '',
      creditLimit: account.credit_limit != null ? String(account.credit_limit) : '',
      isActive: (account.is_active ?? 1) === 1,
    };
  }
  return {
    name: prefill.name ?? '',
    type: prefill.type ?? 'checking',
    ownership: prefill.ownership ?? 'individual',
    institution: prefill.institution ?? '',
    openingBalance: '',
    openingBalanceDate: '',
    creditLimit: '',
    isActive: true,
  };
}

export function createAccountCardFormState(prefill: AccountFormPrefill = {}): AccountCardFormState {
  return {
    cardNumberInput: prefill.cardNumberInput ?? '',
    cardNickname: '',
    cardUserId: null,
  };
}

export type AccountFormResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validates the raw state and produces the values the service expects. */
export function buildAccountFormValues(state: AccountFormState): AccountFormResult<AccountFormValues> {
  if (!state.name.trim()) {
    return { ok: false, error: 'Account name is required' };
  }

  const parsedOpeningBalance = state.openingBalance.trim() === '' ? 0 : Number(state.openingBalance);
  const parsedCreditLimit = state.creditLimit.trim() === '' ? null : Number(state.creditLimit);
  if (!Number.isFinite(parsedOpeningBalance) || (parsedCreditLimit != null && !Number.isFinite(parsedCreditLimit))) {
    return { ok: false, error: 'Opening balance and credit limit must be numbers' };
  }

  return {
    ok: true,
    value: {
      name: state.name.trim(),
      type: state.type,
      ownership: state.ownership,
      institution: state.institution.trim() || null,
      opening_balance: parsedOpeningBalance,
      opening_balance_date: state.openingBalanceDate || null,
      credit_limit: state.type === 'credit' ? parsedCreditLimit : null,
      is_active: state.isActive ? 1 : 0,
    },
  };
}

/** Validates the first-card fields; the cardholder defaults to the owner. */
export function buildAccountCardInput(
  state: AccountCardFormState,
  ownerUserId: number
): AccountFormResult<AccountCardInput> {
  const parsed = parseCardNumberInput(state.cardNumberInput);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  return {
    ok: true,
    value: {
      last_four: parsed.last_four,
      full_number: parsed.full_number,
      nickname: state.cardNickname.trim() || null,
      user_id: state.cardUserId || ownerUserId,
    },
  };
}
