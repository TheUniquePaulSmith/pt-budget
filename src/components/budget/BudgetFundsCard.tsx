'use client';

import { FlightTakeoff, Home, Savings } from '@mui/icons-material';
import { Box, Chip, LinearProgress, Paper, Stack, Tooltip, Typography } from '@mui/material';

import type { BudgetFundStatus } from '@/types/budgetCarry';

import { formatBudgetCurrency, formatMonthKey } from './budgetFormat';

interface BudgetFundsCardProps {
  funds: BudgetFundStatus[];
  loading?: boolean;
  asOfMonth: string;
}

export function fundTestId(fund: Pick<BudgetFundStatus, 'entity_type' | 'entity_id'>) {
  return `budget-fund-${fund.entity_type}-${fund.entity_id}`;
}

function goalText(fund: BudgetFundStatus): string {
  if (fund.remainingToGoal == null) return 'No estimated cost set';
  if (fund.remainingToGoal <= 0) return 'Goal reached';
  const months = fund.monthsToGoal == null ? null : `${fund.monthsToGoal} month${fund.monthsToGoal === 1 ? '' : 's'} to go`;
  return `${formatBudgetCurrency(fund.remainingToGoal)} to goal${months ? ` · ${months}` : ''}`;
}

export function BudgetFundsCard({ funds, loading, asOfMonth }: BudgetFundsCardProps) {
  return (
    <Paper sx={{ p: 3 }} data-testid="budget-funds-card">
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
        <Savings color="primary" fontSize="small" />
        <Typography variant="h6">Funds</Typography>
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Projects and trips saving through a budget category, as of {formatMonthKey(asOfMonth)}.
      </Typography>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {!loading && funds.length === 0 && (
        <Typography variant="body2" color="text.secondary">
          Link a project or trip to a budget category with a monthly contribution to start a fund.
        </Typography>
      )}

      <Stack spacing={2}>
        {funds.map((fund) => {
          const Icon = fund.entity_type === 'project' ? Home : FlightTakeoff;
          const percent = fund.progress == null ? 0 : Math.round(fund.progress * 100);
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
                  <Tooltip title={fund.startMonth ? `Contributions run from ${formatMonthKey(fund.startMonth)}${fund.endMonth ? ` to ${formatMonthKey(fund.endMonth)}` : ''}` : 'Set a start month or start date to accrue contributions'}>
                    <Chip size="small" label="Not contributing" />
                  </Tooltip>
                )}
              </Stack>
              <Tooltip title={fund.estimated_cost != null ? `${formatBudgetCurrency(fund.contributed)} of ${formatBudgetCurrency(fund.estimated_cost)} saved` : 'Set an estimated cost to track progress'}>
                <LinearProgress
                  variant="determinate"
                  value={percent}
                  color={fund.balance < 0 ? 'error' : 'primary'}
                  sx={{ height: 8, borderRadius: 1, mb: 0.75 }}
                  aria-label={`${fund.name} progress`}
                />
              </Tooltip>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.25, sm: 2 }} justifyContent="space-between">
                <Typography variant="body2" data-testid="budget-fund-contributed">
                  Saved {formatBudgetCurrency(fund.contributed)}
                  {fund.monthly_contribution ? ` · ${formatBudgetCurrency(fund.monthly_contribution)}/month` : ''}
                </Typography>
                <Typography variant="body2" color={fund.balance < 0 ? 'error.main' : 'text.primary'} fontWeight={600} data-testid="budget-fund-balance">
                  Balance {formatBudgetCurrency(fund.balance)}
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary" data-testid="budget-fund-goal">
                {goalText(fund)}{fund.spent ? ` · spent ${formatBudgetCurrency(fund.spent)}` : ''}
              </Typography>
            </Box>
          );
        })}
      </Stack>
    </Paper>
  );
}
