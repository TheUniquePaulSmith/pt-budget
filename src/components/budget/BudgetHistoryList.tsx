'use client';

import { Chip, Paper, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { BudgetPeriod, BudgetStatus } from '@/types/database';

interface BudgetHistoryListProps {
  statuses: BudgetStatus[];
  onSelect: (period: BudgetPeriod) => void;
}

export function BudgetHistoryList({ statuses, onSelect }: BudgetHistoryListProps) {
  const { t } = useTranslation('budget');
  const { money } = useFormatters();
  // Budget totals are in the default currency; the history chips drop the cents.
  const formatCurrency = (value: number | null | undefined) => money(value ?? 0, undefined, { whole: true });

  const chipLabel = (status: BudgetStatus) => {
    const period = status.period.key;
    if (status.budgetedTotal == null) return t('historyList.noPlan', { period });
    if (status.isOverBudget) return t('historyList.over', { period, amount: formatCurrency(Math.abs(status.remaining ?? 0)) });
    return t('historyList.under', { period, amount: formatCurrency(status.remaining) });
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>{t('historyList.title')}</Typography>
      <Stack spacing={1}>
        {statuses.map((status) => (
          <Chip
            key={status.period.key}
            label={chipLabel(status)}
            color={status.budgetedTotal == null ? 'default' : status.isOverBudget ? 'error' : 'success'}
            variant="outlined"
            onClick={() => onSelect(status.period)}
          />
        ))}
      </Stack>
    </Paper>
  );
}
