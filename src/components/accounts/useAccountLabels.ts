'use client';

/**
 * Account labels for a component that already has the account list (every
 * page gets `accounts` from its slice). Takes the arrays as arguments and
 * never reads the database, so it works under any slice mock.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildAccountLabels,
  suggestAccountName,
  type AccountLabelSource,
  type AccountLabelWords,
  type AccountLabels,
} from '@/lib/accountLabels';
import type { AccountType, User } from '@/types/database';

import { accountLabelWords } from './accountDisplay';

export function useAccountLabelWords(): AccountLabelWords {
  const { t } = useTranslation(['accounts', 'common']);
  return useMemo(() => accountLabelWords(t), [t]);
}

/** The name an account form saves when its Account Name field is empty ("Huntington Checking"). */
export function useSuggestedAccountName(institution: string | null | undefined, type: AccountType): string {
  const words = useAccountLabelWords();
  return useMemo(() => suggestAccountName({ institution, type }, words.typeLabel), [institution, type, words]);
}

const NO_ACCOUNTS: readonly AccountLabelSource[] = [];

/** One label per account id; call it once per page and hand the map down. */
export function useAccountLabels(
  accounts: readonly AccountLabelSource[] | null | undefined,
  users?: readonly Pick<User, 'id' | 'display_name'>[] | null
): AccountLabels {
  const words = useAccountLabelWords();
  return useMemo(() => buildAccountLabels(accounts ?? NO_ACCOUNTS, words, users ?? undefined), [accounts, words, users]);
}
