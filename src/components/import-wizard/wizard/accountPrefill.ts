/**
 * The starting point for "Create a new account…" during an import: what the
 * file itself says about the account. The digits of the value become the card
 * / account number, its words the name, and the reader's hints fill in the
 * bank, the account type and the currency. Only a prefill: every field can be
 * changed. Pure.
 */

import type { AccountFormPrefill } from '@/components/accounts/accountFormModel';
import type { AccountHint } from '@/lib/statementImport';
import type { AccountType } from '@/types/database';

const ACCOUNT_TYPES: readonly AccountType[] = ['checking', 'savings', 'credit', 'loan', 'investment', 'retirement'];

/** Words of an account label that say nothing about the account itself. */
const NAME_FILLER = new Set(['ending', 'number', 'no', 'acct']);

function nameFrom(value: string): string {
  return value
    .replace(/\d+/g, ' ')
    .split(/[^\p{L}]+/u)
    .filter((word) => word && !NAME_FILLER.has(word.toLowerCase()) && !/^x+$/i.test(word))
    .join(' ')
    .trim();
}

/**
 * @param value The value the file uses for the account ('' when it names none).
 * @param hints `StatementMeta.accountHints` of the statement.
 */
export function accountPrefillFrom(value: string, hints: AccountHint[]): AccountFormPrefill {
  const hint = (kind: AccountHint['kind']) => hints.find((entry) => entry.kind === kind)?.value.trim() ?? '';
  const digits = value.replace(/\D/g, '');
  const type = hint('accountType') as AccountType;
  const currency = hint('currency').toUpperCase();
  return {
    name: nameFrom(value) || nameFrom(hint('label')),
    institution: hint('institution'),
    cardNumberInput: digits.length >= 4 ? digits : '',
    ...(ACCOUNT_TYPES.includes(type) ? { type } : {}),
    ...(/^[A-Z]{3}$/.test(currency) ? { currency } : {}),
  };
}
