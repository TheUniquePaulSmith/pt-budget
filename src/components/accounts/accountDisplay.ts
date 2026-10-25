import type { Account, AccountCard, User } from '@/types/database';
import { ACCOUNT_TYPE_OPTIONS } from './accountFormModel';

/** Short labels for the grid's Type chip (the form keeps the longer descriptions). */
export const ACCOUNT_TYPE_SHORT_LABELS: Record<Account['type'], string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit: 'Credit Card',
  loan: 'Loan',
  investment: 'Investment',
  retirement: 'Retirement',
};

export function accountTypeLabel(type: Account['type']): string {
  return ACCOUNT_TYPE_SHORT_LABELS[type] ?? ACCOUNT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

/** The institution shown in the grid: the stored name, or a placeholder that sorts last. */
export const UNKNOWN_INSTITUTION = '—';

export function accountInstitutionDisplay(account: Pick<Account, 'institution'>): string {
  const institution = account.institution?.trim();
  return institution ? institution : UNKNOWN_INSTITUTION;
}

/** Sorts institutions alphabetically, case-insensitively, with the placeholder last. */
export function compareInstitutions(a: string, b: string): number {
  if (a === b) return 0;
  if (a === UNKNOWN_INSTITUTION) return 1;
  if (b === UNKNOWN_INSTITUTION) return -1;
  return a.localeCompare(b, undefined, { sensitivity: 'base' });
}

export function ownerDisplayName(account: Account, users: User[]): string {
  return account.owner_display_name ?? users.find((user) => user.id === account.owner_user_id)?.display_name ?? 'Unknown';
}

export function cardholderName(card: AccountCard, users: User[], owner?: string): string {
  if (!card.user_id) return owner ?? 'Account owner';
  return card.user_display_name ?? users.find((user) => user.id === card.user_id)?.display_name ?? 'Unknown User';
}

export interface PersonCounts {
  owned: number;
  cardholder: number;
}

/** Accounts a person owns, and accounts they hold a card on without owning. */
export function countPersonAccounts(
  userId: number,
  accounts: Account[],
  cardsByAccountId: Record<number, AccountCard[]>
): PersonCounts {
  let owned = 0;
  let cardholder = 0;
  for (const account of accounts) {
    if (account.owner_user_id === userId) {
      owned += 1;
    } else if ((cardsByAccountId[account.id] ?? []).some((card) => card.user_id === userId)) {
      cardholder += 1;
    }
  }
  return { owned, cardholder };
}

export function formatCurrency(amount: number | null | undefined): string {
  return Number(amount ?? 0).toLocaleString(undefined, { style: 'currency', currency: 'USD' });
}
