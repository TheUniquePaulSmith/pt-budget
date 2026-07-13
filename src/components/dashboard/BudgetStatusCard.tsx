'use client';

import { Box, Button, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { Savings } from '@mui/icons-material';

import type { BudgetStatus } from '@/types/database';

interface BudgetStatusCardProps {
  status: BudgetStatus | null;
  onManageBudget: () => void;
}

const formatCurrency = (value: number | null | undefined) =>
  value == null ? 'Not set' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export function BudgetStatusCard({ status, onManageBudget }: BudgetStatusCardProps) {
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
            <Typography variant="h6">Current Month Budget</Typography>
            {hasPlan && (
              <Chip size="small" color={status.isOverBudget ? 'error' : 'success'} label={status.isOverBudget ? 'Over budget' : 'On track'} />
            )}
          </Stack>
          {hasPlan ? (
            <Typography variant="body2" color="text.secondary">
              {formatCurrency(status.actualExpenses)} spent of {formatCurrency(status.budgetedTotal)} budgeted. {formatCurrency(status.remaining)} remaining.
            </Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">No budget plan is active for this month.</Typography>
          )}
        </Box>
        <Button variant={hasPlan ? 'outlined' : 'contained'} onClick={onManageBudget}>Manage budget</Button>
      </Stack>
      {hasPlan && <LinearProgress variant="determinate" value={usedPercent} color={status.isOverBudget ? 'error' : 'primary'} sx={{ mt: 2, height: 8, borderRadius: 1 }} />}
    </Paper>
  );
}