'use client';

import { FlightTakeoff, Home, Savings } from '@mui/icons-material';
import { Box, Chip, LinearProgress, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { BudgetFundStatus } from '@/types/budgetCarry';

interface BudgetFundsCardProps {
  funds: BudgetFundStatus[];
  loading?: boolean;
  asOfMonth: string;
}

export function fundTestId(fund: Pick<BudgetFundStatus, 'entity_type' | 'entity_id'>) {
  return `budget-fund-${fund.entity_type}-${fund.entity_id}`;
}

export function BudgetFundsCard({ funds, loading, asOfMonth }: BudgetFundsCardProps) {
  const { t } = useTranslation('budget');
  // Fund amounts are in the default currency.
  const { money, month } = useFormatters();

  const goalText = (fund: BudgetFundStatus): string => {
    if (fund.remainingToGoal == null) return t('fundsCard.noEstimatedCost');
    if (fund.remainingToGoal <= 0) return t('fundsCard.goalReached');
    const goal = t('fundsCard.toGoal', { amount: money(fund.remainingToGoal) });
    return fund.monthsToGoal == null ? goal : `${goal} · ${t('fundsCard.monthsToGo', { count: fund.monthsToGoal })}`;
  };

  return (
    <Paper sx={{ p: 3 }} data-testid="budget-funds-card">
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Savings color="primary" fontSize="small" />
        <Typography variant="h6">{t('fundsCard.title')}</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('fundsCard.subtitle', { month: month(asOfMonth) })}
      </Typography>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {!loading && funds.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          {t('fundsCard.empty')}
        </Typography>
      )}

      <Stack spacing={2}>
        {funds.map((fund) => {
          const Icon = fund.entity_type === 'project' ? Home : FlightTakeoff;
          const percent = fund.progress == null ? 0 : Math.round(fund.progress * 100);
          const contributionsTooltip = fund.startMonth
            ? fund.endMonth
              ? t('fundsCard.contributionsFromTo', { start: month(fund.startMonth), end: month(fund.endMonth) })
              : t('fundsCard.contributionsFrom', { start: month(fund.startMonth) })
            : t('fundsCard.setStartMonth');
          return (
            <Box key={fundTestId(fund)} data-testid={fundTestId(fund)}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                <Icon fontSize="small" color="action" />
                <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 120 }}>{fund.name}</Typography>
                {fund.category_name && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={fund.category_name}
                    sx={fund.category_color ? { borderColor: fund.category_color, color: fund.category_color } : undefined}
                  />
                )}
                {!fund.isContributing && (
                  <Tooltip title={contributionsTooltip}>
                    <Chip size="small" label={t('fundsCard.notContributing')} />
                  </Tooltip>
                )}
              </Stack>
              <Tooltip
                title={fund.estimated_cost != null
                  ? t('fundsCard.savedOfEstimated', { contributed: money(fund.contributed), estimated: money(fund.estimated_cost) })
                  : t('fundsCard.setEstimatedCost')}
              >
                <LinearProgress
                  variant="determinate"
                  value={percent}
                  color={fund.balance < 0 ? 'error' : 'primary'}
                  sx={{ height: 8, borderRadius: 1, mb: 0.75 }}
                  aria-label={t('fundsCard.progressAria', { name: fund.name })}
                />
              </Tooltip>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.25, sm: 2 }} justifyContent="space-between">
                <Typography variant="body2" data-testid="budget-fund-contributed">
                  {t('fundsCard.saved', { amount: money(fund.contributed) })}
                  {fund.monthly_contribution ? ` · ${t('fundsCard.perMonth', { amount: money(fund.monthly_contribution) })}` : ''}
                </Typography>
                <Typography variant="body2" color={fund.balance < 0 ? 'error.main' : 'text.primary'} fontWeight={600} data-testid="budget-fund-balance">
                  {t('fundsCard.balance', { amount: money(fund.balance) })}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" data-testid="budget-fund-goal">
                {goalText(fund)}{fund.spent ? ` · ${t('fundsCard.spent', { amount: money(fund.spent) })}` : ''}
              </Typography>
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}
