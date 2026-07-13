'use client';

import { Box, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material';

import type { BudgetStatus } from '@/types/database';

interface BudgetStatusPanelProps {
  status: BudgetStatus | null;
  loading?: boolean;
}

const formatCurrency = (value: number | null | undefined) =>
  value == null ? 'Not set' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export function BudgetStatusPanel({ status, loading }: BudgetStatusPanelProps) {
  if (loading) {
    return <LinearProgress />;
  }

  if (!status) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>No budget set</Typography>
        <Typography variant="body2" color="text.secondary">
          Create a budget plan for this month. Plans carry forward until a later effective month supersedes them.
        </Typography>
      </Paper>
    );
  }

  const budgetedTotal = status.budgetedTotal;
  const hasBudget = budgetedTotal != null;
  const usedPercent = budgetedTotal != null && budgetedTotal > 0
    ? Math.min((status.actualExpenses / budgetedTotal) * 100, 100)
    : 0;

  return (
    <Paper sx={{ p: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6">Budget Status</Typography>
          <Typography variant="body2" color="text.secondary">
            {status.monthsWithPlan.length} of {status.months.length} month{status.months.length === 1 ? '' : 's'} covered
          </Typography>
        </Box>
        {hasBudget ? (
          <Chip
            color={status.isOverBudget ? 'error' : 'success'}
            label={status.isOverBudget ? `${formatCurrency(Math.abs(status.remaining ?? 0))} over` : `${formatCurrency(status.remaining)} left`}
          />
        ) : (
          <Chip label="No budget set" />
        )}
      </Stack>

      {hasBudget ? (
        <LinearProgress
          variant="determinate"
          color={status.isOverBudget ? 'error' : 'primary'}
          value={usedPercent}
          sx={{ height: 10, borderRadius: 1, mb: 2 }}
        />
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Create a budget plan for spending thresholds. Income sources are still included below.
        </Typography>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
        <Box flex={1}><Typography variant="caption">Budgeted</Typography><Typography fontWeight={700}>{formatCurrency(status.budgetedTotal)}</Typography></Box>
        <Box flex={1}><Typography variant="caption">Actual expenses</Typography><Typography fontWeight={700}>{formatCurrency(status.actualExpenses)}</Typography></Box>
        <Box flex={1}><Typography variant="caption">Expected income</Typography><Typography fontWeight={700}>{formatCurrency(status.expectedIncome)}</Typography></Box>
        <Box flex={1}><Typography variant="caption">Linked income</Typography><Typography fontWeight={700}>{formatCurrency(status.actualLinkedIncome)}</Typography></Box>
      </Stack>

      {hasBudget && (
        <>
          <Typography variant="subtitle2" gutterBottom>Categories</Typography>
          <Stack spacing={1.25}>
            {status.categories.map((category) => {
              const percent = category.budgetedAmount > 0
                ? Math.min((category.actualExpenses / category.budgetedAmount) * 100, 100)
                : 0;
              return (
                <Box key={category.category_id}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
                    <Typography variant="body2">{category.category_name || `Category ${category.category_id}`}</Typography>
                    <Typography variant="body2" color={category.isOverBudget ? 'error.main' : 'text.secondary'}>
                      {formatCurrency(category.actualExpenses)} / {formatCurrency(category.budgetedAmount)}
                    </Typography>
                  </Box>
                  <LinearProgress variant="determinate" value={percent} color={category.isOverBudget ? 'error' : 'primary'} sx={{ height: 6, borderRadius: 1 }} />
                </Box>
              );
            })}
          </Stack>
        </>
      )}

      {status.unbudgetedSpend > 0 && (
        <Typography variant="body2" color="warning.main" sx={{ mt: 2 }}>
          Unbudgeted spend: {formatCurrency(status.unbudgetedSpend)}
        </Typography>
      )}
    </Paper>
  );
}