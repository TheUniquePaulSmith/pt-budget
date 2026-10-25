'use client';

import {
  Box,
  Chip,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';

import type { BudgetCategoryCarryStatus, BudgetStatusWithCarry } from '@/types/budgetCarry';

import { CARRY_MODE_CHIP_COLORS, CARRY_MODE_LABELS, formatBudgetCurrency, formatMonthKey, formatSignedCurrency } from './budgetFormat';

interface BudgetStatusPanelProps {
  status: BudgetStatusWithCarry | null;
  loading?: boolean;
}

function spentTooltip(category: BudgetCategoryCarryStatus): string {
  const parts: string[] = [`Spent ${formatBudgetCurrency(category.actualExpenses)} in this category.`];
  if (category.fundSpend) parts.push(`${formatBudgetCurrency(category.fundSpend)} of it was paid by a linked fund and is left out.`);
  if (category.fundContributions) parts.push(`${formatBudgetCurrency(category.fundContributions)} is reserved as fund contributions.`);
  return parts.join(' ');
}

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
  const effectiveTotal = status.effectiveBudgetTotal ?? budgetedTotal;
  const committedTotal = status.actualExpenses - status.fundSpendTotal + status.fundContributionsTotal;
  const usedPercent = effectiveTotal != null && effectiveTotal > 0
    ? Math.min((committedTotal / effectiveTotal) * 100, 100)
    : 0;
  const showCarry = status.carriedInTotal !== 0 || status.categories.some((category) => category.carryMode !== 'none');
  const showFunds = status.fundContributionsTotal !== 0 || status.fundSpendTotal !== 0;

  return (
    <Paper sx={{ p: 3 }} data-testid="budget-status-panel">
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" sx={{ mb: 2 }}>
        <Box>
          <Typography variant="h6">Budget Status</Typography>
          <Typography variant="body2" color="text.secondary">
            {status.monthsWithPlan.length} of {status.months.length} month{status.months.length === 1 ? '' : 's'} covered
          </Typography>
        </Box>
        {hasBudget ? (
          <Chip
            data-testid="budget-remaining-chip"
            color={status.isOverBudget ? 'error' : 'success'}
            label={status.isOverBudget
              ? `${formatBudgetCurrency(Math.abs(status.effectiveRemaining ?? 0))} over`
              : `${formatBudgetCurrency(status.effectiveRemaining)} left`}
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

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap flexWrap="wrap" sx={{ mb: 3 }}>
        <Box flex={1} minWidth={120}><Typography variant="caption">Budgeted</Typography><Typography fontWeight={700}>{formatBudgetCurrency(status.budgetedTotal)}</Typography></Box>
        {showCarry && (
          <Box flex={1} minWidth={120} data-testid="budget-carried-in-total">
            <Typography variant="caption">Carried in</Typography>
            <Typography fontWeight={700} color={status.carriedInTotal < 0 ? 'error.main' : status.carriedInTotal > 0 ? 'success.main' : 'text.primary'}>
              {formatSignedCurrency(status.carriedInTotal)}
            </Typography>
          </Box>
        )}
        {(showCarry || showFunds) && (
          <Box flex={1} minWidth={120} data-testid="budget-effective-total">
            <Typography variant="caption">Effective budget</Typography>
            <Typography fontWeight={700}>{formatBudgetCurrency(status.effectiveBudgetTotal)}</Typography>
          </Box>
        )}
        <Box flex={1} minWidth={120}><Typography variant="caption">Actual expenses</Typography><Typography fontWeight={700}>{formatBudgetCurrency(status.actualExpenses)}</Typography></Box>
        {showFunds && (
          <Box flex={1} minWidth={120} data-testid="budget-fund-contributions-total">
            <Typography variant="caption">Fund contributions</Typography>
            <Typography fontWeight={700}>{formatBudgetCurrency(status.fundContributionsTotal)}</Typography>
          </Box>
        )}
        <Box flex={1} minWidth={120}><Typography variant="caption">Expected income</Typography><Typography fontWeight={700}>{formatBudgetCurrency(status.expectedIncome)}</Typography></Box>
        <Box flex={1} minWidth={120}><Typography variant="caption">Linked income</Typography><Typography fontWeight={700}>{formatBudgetCurrency(status.actualLinkedIncome)}</Typography></Box>
      </Stack>

      {hasBudget && status.categories.length > 0 && (
        <>
          <Typography variant="subtitle2" gutterBottom>Categories</Typography>
          <TableContainer>
            <Table size="small" aria-label="Budget categories" data-testid="budget-category-table">
              <TableHead>
                <TableRow>
                  <TableCell>Category</TableCell>
                  <TableCell align="right">Budget</TableCell>
                  <TableCell align="right">Carried in</TableCell>
                  <TableCell align="right">Effective</TableCell>
                  <TableCell align="right">Spent</TableCell>
                  <TableCell align="right">Remaining</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {status.categories.map((category) => {
                  const percent = category.effectiveBudget > 0
                    ? Math.min((category.committedSpend / category.effectiveBudget) * 100, 100)
                    : category.committedSpend > 0 ? 100 : 0;
                  const name = category.category_name || `Category ${category.category_id}`;
                  return (
                    <TableRow key={category.category_id} data-testid={`budget-category-row-${category.category_id}`} data-category-name={name}>
                      <TableCell sx={{ minWidth: 200 }}>
                        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mb: 0.5 }}>
                          <Typography variant="body2" data-testid="budget-category-name">{name}</Typography>
                          {category.carryMode !== 'none' && (
                            <Chip
                              size="small"
                              variant="outlined"
                              color={CARRY_MODE_CHIP_COLORS[category.carryMode]}
                              label={CARRY_MODE_LABELS[category.carryMode]}
                              data-testid="budget-category-carry-badge"
                            />
                          )}
                          {category.carryResetMonth && (
                            <Tooltip title={`Carried balance reset from ${formatMonthKey(category.carryResetMonth)}`}>
                              <Chip size="small" variant="outlined" label="Reset" data-testid="budget-category-reset-badge" />
                            </Tooltip>
                          )}
                          {category.fundContributions > 0 && (
                            <Tooltip title={`${formatBudgetCurrency(category.fundContributions)} reserved for linked project or trip funds`}>
                              <Chip size="small" variant="outlined" color="secondary" label="Fund" data-testid="budget-category-fund-badge" />
                            </Tooltip>
                          )}
                        </Stack>
                        <LinearProgress
                          variant="determinate"
                          value={percent}
                          color={category.isOverBudget ? 'error' : 'primary'}
                          sx={{ height: 6, borderRadius: 1 }}
                        />
                      </TableCell>
                      <TableCell align="right" data-testid="budget-category-budgeted">{formatBudgetCurrency(category.budgetedAmount)}</TableCell>
                      <TableCell
                        align="right"
                        data-testid="budget-category-carried-in"
                        sx={{ color: category.carriedIn < 0 ? 'error.main' : category.carriedIn > 0 ? 'success.main' : 'text.secondary' }}
                      >
                        {category.carryMode === 'none' && category.carriedIn === 0 ? '—' : formatSignedCurrency(category.carriedIn)}
                      </TableCell>
                      <TableCell align="right" data-testid="budget-category-effective" sx={{ fontWeight: 600 }}>
                        {formatBudgetCurrency(category.effectiveBudget)}
                      </TableCell>
                      <TableCell align="right" data-testid="budget-category-spent">
                        <Tooltip title={spentTooltip(category)}>
                          <span>{formatBudgetCurrency(category.committedSpend)}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell
                        align="right"
                        data-testid="budget-category-remaining"
                        sx={{ color: category.isOverBudget ? 'error.main' : 'text.primary', fontWeight: 600 }}
                      >
                        {category.isOverBudget
                          ? `${formatBudgetCurrency(Math.abs(category.effectiveRemaining))} over`
                          : formatBudgetCurrency(category.effectiveRemaining)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </>
      )}

      {status.unbudgetedSpend > 0 && (
        <Typography variant="body2" color="warning.main" sx={{ mt: 2 }}>
          Unbudgeted spend: {formatBudgetCurrency(status.unbudgetedSpend)}
        </Typography>
      )}
    </Paper>
  );
}
