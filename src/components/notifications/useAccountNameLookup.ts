'use client';

import { useCallback } from 'react';

import { useAccountLabels } from '@/components/accounts/useAccountLabels';
import { accountLabelText } from '@/lib/accountLabels';
import type { Account, User } from '@/types/database';

/**
 * `(accountId) => label` for `describeNotification`: an overdue payment that
 * is not confirmed yet names the account whose statement would confirm it.
 */
export function useAccountNameLookup(
  accounts: readonly Account[] | null | undefined,
  users: readonly User[] | null | undefined
): (accountId: number) => string | null {
  const labels = useAccountLabels(accounts, users);
  return useCallback((accountId: number) => accountLabelText(labels, accountId) || null, [labels]);
}
