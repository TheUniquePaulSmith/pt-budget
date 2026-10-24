'use client';

import { Savings } from '@mui/icons-material';
import { Box, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';

import type { BudgetFundStatus } from '@/types/budgetCarry';

import { formatBudgetCurrency } from './budgetFormat';

interface BudgetFundSummaryProps {
  fund: BudgetFundStatus;
}

/** Compact fund line for a project or trip card: progress bar plus saved / balance figures. */
export function BudgetFundSummary({ fund }: BudgetFundSummaryProps) {
  const percent = fund.progress == null ? 0 : Math.round(fund.progress * 100);
  const detail = fund.remainingToGoal == null
    ? 'no estimate'
    : fund.remainingToGoal <= 0
      ? 'goal reached'
      : `${formatBudgetCurrency(fund.remainingToGoal)} to goal`;
  return (
    <Box data-testid={`fund-summary-${fund.entity_type}-${fund.entity_id}`} sx={{ mb: 2 }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Savings fontSize="small" color="primary" />
        <Typography variant="body2" color="text.secondary">
          Fund{fund.category_name ? ` · ${fund.category_name}` : ''}
          {fund.monthly_contribution ? ` · ${formatBudgetCurrency(fund.monthly_contribution)}/month` : ''}
        </Typography>
      </Stack>
      <Tooltip title={`${formatBudgetCurrency(fund.contributed)} contributed, ${formatBudgetCurrency(fund.spent)} spent, ${detail}`}>
        <LinearProgress variant="determinate" value={percent} color={fund.balance < 0 ? 'error' : 'primary'} sx={{ height: 6, borderRadius: 1, mb: 0.5 }} />
      </Tooltip>
      <Typography variant="body2">
        Saved {formatBudgetCurrency(fund.contributed)} ·{' '}
        <Box component="span" fontWeight={600} color={fund.balance < 0 ? 'error.main' : 'text.primary'} data-testid="fund-summary-balance">
          balance {formatBudgetCurrency(fund.balance)}
        </Box>
        {' '}· {detail}
      </Typography>
    </Box>
  );
}
