'use client';

import { Savings } from '@mui/icons-material';
import { Box, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { BudgetFundStatus } from '@/types/budgetCarry';

interface BudgetFundSummaryProps {
  fund: BudgetFundStatus;
}

/** Compact fund line for a project or trip card: progress bar plus saved / balance figures. */
export function BudgetFundSummary({ fund }: BudgetFundSummaryProps) {
  const { t } = useTranslation('budget');
  // Fund amounts are in the default currency.
  const { money } = useFormatters();
  const percent = fund.progress == null ? 0 : Math.round(fund.progress * 100);
  const detail = fund.remainingToGoal == null
    ? t('fundSummary.noEstimate')
    : fund.remainingToGoal <= 0
      ? t('fundSummary.goalReached')
      : t('fundSummary.toGoal', { amount: money(fund.remainingToGoal) });
  const headline = [
    t('fundSummary.fund'),
    fund.category_name || null,
    fund.monthly_contribution ? t('fundSummary.perMonth', { amount: money(fund.monthly_contribution) }) : null,
  ].filter((part): part is string => !!part).join(' · ');
  return (
    <Box data-testid={`fund-summary-${fund.entity_type}-${fund.entity_id}`} sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Savings fontSize="small" color="primary" />
        <Typography variant="body2" color="text.secondary">
          {headline}
        </Typography>
      </Stack>
      <Tooltip title={t('fundSummary.tooltip', { contributed: money(fund.contributed), spent: money(fund.spent), detail })}>
        <LinearProgress variant="determinate" value={percent} color={fund.balance < 0 ? 'error' : 'primary'} sx={{ height: 6, borderRadius: 1, mb: 0.5 }} />
      </Tooltip>
      <Typography variant="body2">
        {t('fundSummary.saved', { amount: money(fund.contributed) })} ·{' '}
        <Box component="span" fontWeight={600} color={fund.balance < 0 ? 'error.main' : 'text.primary'} data-testid="fund-summary-balance">
          {t('fundSummary.balance', { amount: money(fund.balance) })}
        </Box>
        {' '}· {detail}
      </Typography>
    </Box>
  );
}
