'use client';

/**
 * An info button that opens an account's details card, for places where the
 * account's name cannot be the trigger itself (next to a select, whose click
 * opens the menu).
 *
 * The only account-label file that imports an icon: the label components are
 * pulled into pages whose tests mock `@mui/icons-material` with a fixed list.
 */

import React from 'react';
import { IconButton } from '@mui/material';
import { InfoOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import type { AccountLabelSource } from '@/lib/accountLabels';
import type { User } from '@/types/database';

import AccountDetailsTooltip from './AccountDetailsTooltip';

export interface AccountDetailsButtonProps {
  account: AccountLabelSource;
  users?: readonly Pick<User, 'id' | 'display_name'>[];
  'data-testid'?: string;
}

export default function AccountDetailsButton({ account, users, 'data-testid': testId }: AccountDetailsButtonProps) {
  const { t } = useTranslation(['accounts', 'common']);
  return (
    <AccountDetailsTooltip account={account} users={users} placement="bottom-end">
      <IconButton size="small" aria-label={t('label.details', { name: account.name })} data-testid={testId}>
        <InfoOutlined fontSize="small" />
      </IconButton>
    </AccountDetailsTooltip>
  );
}
