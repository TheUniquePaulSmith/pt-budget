/** Small display helpers shared by the wizard steps. Pure. */

import type { Account } from '@/types/database';

/** "Alex - Household Checking": the owner tells apart two accounts with one name. */
export function accountDisplayName(account: Pick<Account, 'name' | 'owner_display_name'>): string {
  return account.owner_display_name ? `${account.owner_display_name} - ${account.name}` : account.name;
}

export function findAccount(accounts: Account[], accountId: number | null | undefined): Account | undefined {
  return accountId == null ? undefined : accounts.find((account) => account.id === accountId);
}

/**
 * The currency to print a total in: the accounts' own when they all share
 * one, otherwise none (the total is then shown as a plain number).
 */
export function sharedCurrency(accounts: Account[], accountIds: number[]): string | null {
  const currencies = new Set(accountIds.map((id) => findAccount(accounts, id)?.currency ?? null));
  if (currencies.size !== 1) return null;
  return [...currencies][0];
}

/** A file size for the file card ("12 KB"); `number` formats in the user's locale. */
export function fileSizeParts(bytes: number): { value: number; unit: 'B' | 'KB' | 'MB' } {
  if (bytes < 1024) return { value: bytes, unit: 'B' };
  if (bytes < 1024 * 1024) return { value: Math.round(bytes / 1024), unit: 'KB' };
  return { value: Math.round((bytes / (1024 * 1024)) * 10) / 10, unit: 'MB' };
}
