/**
 * Account form model shared by the Add/Edit dialog (CSV import reuses it
 * with prefilled values) and the inline detail form on the Accounts page.
 * Pure state + validation; no React.
 *
 * The Account Name is optional: it is a short name for lists, and the bank,
 * owner and card numbers are always shown with it (`src/lib/accountLabels.ts`).
 * Left empty, the account is saved under the suggested name, bank + type.
 */

import type { AccountLabelCard, AccountLabelSource } from '@/lib/accountLabels';
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from '@/lib/currencies';
import type { Account, AccountOwnership, AccountType } from '@/types/database';
import { parseCardNumberInput, type CardNumberErrorCode } from './accountCardNumber';

export interface AccountFormValues {
  name: string;
  type: AccountType;
  ownership: AccountOwnership;
  institution: string | null;
  opening_balance: number;
  opening_balance_date: string | null;
  credit_limit: number | null;
  is_active: number;
  /** ISO 4217 code the account's amounts are in. */
  currency: string;
}

/**
 * The selectable account types in display order. Labels are resolved at
 * render time with `t(\`common:accountType.${value}\`)`.
 */
export const ACCOUNT_TYPE_OPTIONS: ReadonlyArray<{ value: AccountType }> = [
  { value: 'checking' },
  { value: 'savings' },
  { value: 'credit' },
  { value: 'loan' },
  { value: 'investment' },
  { value: 'retirement' },
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
  currency: string;
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

export type AccountFormPrefill = Partial<Pick<AccountFormState, 'name' | 'type' | 'ownership' | 'institution' | 'currency'>> & {
  cardNumberInput?: string;
};

export function createAccountFormState(
  account?: Account | null,
  prefill: AccountFormPrefill = {},
  /** The household's default currency: what a new account starts with. */
  defaultCurrency: string = DEFAULT_CURRENCY
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
      currency: normalizeCurrencyCode(account.currency, defaultCurrency),
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
    currency: normalizeCurrencyCode(prefill.currency, defaultCurrency),
  };
}

export function createAccountCardFormState(prefill: AccountFormPrefill = {}): AccountCardFormState {
  return {
    cardNumberInput: prefill.cardNumberInput ?? '',
    cardNickname: '',
    cardUserId: null,
  };
}

/** Validation error codes; components map them through `t('accounts:validation.<code>')`. */
export type AccountFormErrorCode = 'nameRequired' | 'numbersInvalid' | CardNumberErrorCode;

export type AccountFormResult<T> = { ok: true; value: T } | { ok: false; error: AccountFormErrorCode };

/**
 * The account as the form would save it, for the "How it will appear"
 * preview. `suggestedName` is what an empty Account Name becomes
 * (`useSuggestedAccountName`). A new account gets id 0, which no saved
 * account has.
 */
export function buildAccountDraft(
  state: AccountFormState,
  suggestedName: string,
  context: {
    id?: number;
    ownerUserId?: number | null;
    ownerDisplayName?: string;
    cards?: readonly AccountLabelCard[];
  } = {}
): AccountLabelSource {
  return {
    id: context.id ?? 0,
    name: state.name.trim() || suggestedName.trim(),
    type: state.type,
    ownership: state.ownership,
    institution: state.institution.trim() || null,
    owner_user_id: context.ownerUserId ?? undefined,
    owner_display_name: context.ownerDisplayName,
    is_active: state.isActive ? 1 : 0,
    currency: normalizeCurrencyCode(state.currency),
    cards: context.cards ?? [],
  };
}

/** The first card as typed so far, for the preview: empty until the number has four digits. */
export function draftCardsFromInput(state: AccountCardFormState): AccountLabelCard[] {
  const parsed = parseCardNumberInput(state.cardNumberInput);
  return parsed.ok ? [{ last_four: parsed.last_four, nickname: state.cardNickname.trim() || null, user_id: state.cardUserId }] : [];
}

/**
 * Validates the raw state and produces the values the service expects. The
 * name is optional: left empty, the account is saved as `suggestedName`.
 */
export function buildAccountFormValues(
  state: AccountFormState,
  suggestedName = ''
): AccountFormResult<AccountFormValues> {
  const name = state.name.trim() || suggestedName.trim();
  if (!name) {
    return { ok: false, error: 'nameRequired' };
  }

  const parsedOpeningBalance = state.openingBalance.trim() === '' ? 0 : Number(state.openingBalance);
  const parsedCreditLimit = state.creditLimit.trim() === '' ? null : Number(state.creditLimit);
  if (!Number.isFinite(parsedOpeningBalance) || (parsedCreditLimit != null && !Number.isFinite(parsedCreditLimit))) {
    return { ok: false, error: 'numbersInvalid' };
  }

  return {
    ok: true,
    value: {
      name,
      type: state.type,
      ownership: state.ownership,
      institution: state.institution.trim() || null,
      opening_balance: parsedOpeningBalance,
      opening_balance_date: state.openingBalanceDate || null,
      credit_limit: state.type === 'credit' ? parsedCreditLimit : null,
      is_active: state.isActive ? 1 : 0,
      currency: normalizeCurrencyCode(state.currency),
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
