'use client';

/**
 * "How it will appear": the label the account in the form would get next to
 * the existing accounts, so the user sees what the name is for and that the
 * bank, owner and card numbers are shown with it. Says so when another
 * account already has the name; it never blocks saving.
 */

import React, { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { labelForDraft, type AccountLabelSource } from '@/lib/accountLabels';
import type { User } from '@/types/database';

import AccountOptionContent from './AccountOptionContent';
import { useAccountLabelWords } from './useAccountLabels';

export interface AccountLabelPreviewProps {
  /** The account as the form would save it. A new account uses an id no saved account has (0). */
  draft: AccountLabelSource;
  accounts: readonly AccountLabelSource[];
  users?: readonly Pick<User, 'id' | 'display_name'>[];
}

export default function AccountLabelPreview({ draft, accounts, users }: AccountLabelPreviewProps) {
  const { t } = useTranslation(['accounts', 'common']);
  const words = useAccountLabelWords();
  const label = useMemo(() => labelForDraft(draft, accounts, words, users), [draft, accounts, words, users]);

  return (
    <Box
      data-testid="account-label-preview"
      sx={{ px: 1.5, py: 1, borderRadius: 1, bgcolor: 'action.hover', minWidth: 0, gridColumn: '1 / -1' }}
    >
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.25 }}>
        {t('preview.title')}
      </Typography>
      <Typography variant="body2" component="div">
        <AccountOptionContent label={label} />
      </Typography>
      {label.clashes && (
        <Typography variant="caption" color="warning.main" component="p" sx={{ mt: 0.5 }} data-testid="account-label-same-name">
          {t('preview.sameName', { name: label.name })}
        </Typography>
      )}
    </Box>
  );
}
