'use client';

/**
 * How recent an account's data is (schema v8): its last import, the date the
 * imported data is complete through, and its newest transaction. A payment is
 * reported overdue only once the data runs past its due date.
 */

import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import { storedTimestampToDate } from '@/lib/formatting';
import type { AccountFreshness } from '@/types/database';

export interface AccountImportStatusProps {
  freshness: AccountFreshness | undefined;
}

function Fact({ term, value, testId }: { term: string; value: string; testId: string }) {
  return (
    <Box sx={{ minWidth: 0 }} data-testid={testId}>
      <Typography variant="caption" color="text.secondary" component="div">
        {term}
      </Typography>
      <Typography variant="body2" component="div">
        {value}
      </Typography>
    </Box>
  );
}

export default function AccountImportStatus({ freshness }: AccountImportStatusProps) {
  const { t } = useTranslation('accounts');
  const { date } = useFormatters();
  const never = t('importStatus.never');

  return (
    <Box data-testid="account-import-status">
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 1.5 }}>
        <Fact
          term={t('importStatus.lastImport')}
          value={freshness?.lastImportAt ? date(storedTimestampToDate(freshness.lastImportAt)) : never}
          testId="account-import-status-last-import"
        />
        <Fact
          term={t('importStatus.dataThrough')}
          value={freshness?.dataThrough ? date(freshness.dataThrough) : never}
          testId="account-import-status-data-through"
        />
        <Fact
          term={t('importStatus.latestTransaction')}
          value={freshness?.latestTransactionDate ? date(freshness.latestTransactionDate) : t('importStatus.none')}
          testId="account-import-status-latest-transaction"
        />
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
        {freshness?.dataThrough ? t('importStatus.help') : t('importStatus.helpNever')}
      </Typography>
    </Box>
  );
}
