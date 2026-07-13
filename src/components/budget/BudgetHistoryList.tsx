'use client';

import { Chip, Paper, Stack, Typography } from '@mui/material';

import type { BudgetPeriod, BudgetStatus } from '@/types/database';

interface BudgetHistoryListProps {
  statuses: BudgetStatus[];
  onSelect: (period: BudgetPeriod) => void;
}

const formatCurrency = (value: number | null | undefined) =>
  value == null ? 'Not set' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

export function BudgetHistoryList({ statuses, onSelect }: BudgetHistoryListProps) {
  return (
    <Paper sx={{ p: 3 }}>
      <Typography variant="h6" gutterBottom>History</Typography>
      <Stack spacing={1}>
        {statuses.map((status) => (
          <Chip
            key={status.period.key}
            label={`${status.period.key}: ${status.budgetedTotal == null ? 'No plan' : status.isOverBudget ? `${formatCurrency(Math.abs(status.remaining ?? 0))} over` : `${formatCurrency(status.remaining)} under`}`}
            color={status.budgetedTotal == null ? 'default' : status.isOverBudget ? 'error' : 'success'}
            variant="outlined"
            onClick={() => onSelect(status.period)}
          />
        ))}
      </Stack>
    </Paper>
  );
}