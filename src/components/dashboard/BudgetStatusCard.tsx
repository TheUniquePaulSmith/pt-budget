'use client';

import { Box, Button, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { Savings } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { BudgetStatus } from '@/types/database';

interface BudgetStatusCardProps {
  status: BudgetStatus | null;
  onManageBudget: () => void;
}

export function BudgetStatusCard({ status, onManageBudget }: BudgetStatusCardProps) {
  const { t } = useTranslation('dashboard');
  const { money } = useFormatters();
  // Budget figures are in the default currency.
  const formatCurrency = (value: number | null | undefined) =>
    value == null ? t('budgetStatusCard.notSet') : money(value);

  const hasPlan = status?.budgetedTotal != null;
  const usedPercent = hasPlan && status.budgetedTotal && status.budgetedTotal > 0
    ? Math.min((status.actualExpenses / status.budgetedTotal) * 100, 100)
    : 0;

  return (
    <Paper sx={{ p: 3, mb: 4 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }}>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Savings color="primary" />
            <Typography variant="h6">{t('budgetStatusCard.title')}</Typography>
            {hasPlan && (
              <Chip
                size="small"
                color={status.isOverBudget ? 'error' : 'success'}
                label={status.isOverBudget ? t('budgetStatusCard.overBudget') : t('budgetStatusCard.onTrack')}
              />
            )}
          </Stack>
          {hasPlan ? (
            <Typography variant="body2" color="text.secondary">
              {t('budgetStatusCard.progress', {
                spent: formatCurrency(status.actualExpenses),
                budgeted: formatCurrency(status.budgetedTotal),
                remaining: formatCurrency(status.remaining),
              })}
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">{t('budgetStatusCard.noPlan')}</Typography>
          )}
        </Box>
        <Button variant={hasPlan ? 'outlined' : 'contained'} onClick={onManageBudget}>{t('budgetStatusCard.manageBudget')}</Button>
      </Stack>
      {hasPlan && <LinearProgress variant="determinate" value={usedPercent} color={status.isOverBudget ? 'error' : 'primary'} sx={{ mt: 2, height: 8, borderRadius: 1 }} />}
    </Paper>
  );
}
