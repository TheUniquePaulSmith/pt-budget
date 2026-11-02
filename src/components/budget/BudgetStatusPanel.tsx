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
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { BudgetCategoryCarryStatus, BudgetStatusWithCarry } from '@/types/budgetCarry';

import { CARRY_MODE_CHIP_COLORS } from './budgetFormat';

interface BudgetStatusPanelProps {
  status: BudgetStatusWithCarry | null;
  loading?: boolean;
}

export function BudgetStatusPanel({ status, loading }: BudgetStatusPanelProps) {
  const { t } = useTranslation(['budget', 'common']);
  // Budget figures are in the default currency.
  const { money, month } = useFormatters();
  const formatCurrency = (value: number | null | undefined) => (value == null ? t('statusPanel.notSet') : money(value));
  const formatSignedCurrency = (value: number) => money(value, undefined, { signed: true });

  const spentTooltip = (category: BudgetCategoryCarryStatus): string => {
    const parts: string[] = [t('statusPanel.spentTooltip', { amount: money(category.actualExpenses) })];
    if (category.fundSpend) parts.push(t('statusPanel.fundSpendTooltip', { amount: money(category.fundSpend) }));
    if (category.fundContributions) parts.push(t('statusPanel.fundContributionsTooltip', { amount: money(category.fundContributions) }));
    return parts.join(' ');
  };

  if (loading) {
    return <LinearProgress />;
  }

  if (!status) {
    return (
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>{t('statusPanel.noBudgetSet')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('statusPanel.noBudgetHelp')}
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
          <Typography variant="h6">{t('statusPanel.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('statusPanel.monthsCovered', { covered: status.monthsWithPlan.length, count: status.months.length })}
          </Typography>
        </Box>
        {hasBudget ? (
          <Chip
            data-testid="budget-remaining-chip"
            color={status.isOverBudget ? 'error' : 'success'}
            label={status.isOverBudget
              ? t('statusPanel.over', { amount: formatCurrency(Math.abs(status.effectiveRemaining ?? 0)) })
              : t('statusPanel.left', { amount: formatCurrency(status.effectiveRemaining) })}
          />
        ) : (
          <Chip label={t('statusPanel.noBudgetSet')} />
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
          {t('statusPanel.noThresholdsHelp')}
        </Typography>
      )}

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} useFlexGap flexWrap="wrap" sx={{ mb: 3 }}>
        <Box flex={1} minWidth={120}><Typography variant="caption">{t('statusPanel.budgeted')}</Typography><Typography fontWeight={700}>{formatCurrency(status.budgetedTotal)}</Typography></Box>
        {showCarry && (
          <Box flex={1} minWidth={120} data-testid="budget-carried-in-total">
            <Typography variant="caption">{t('statusPanel.carriedIn')}</Typography>
            <Typography fontWeight={700} color={status.carriedInTotal < 0 ? 'error.main' : status.carriedInTotal > 0 ? 'success.main' : 'text.primary'}>
              {formatSignedCurrency(status.carriedInTotal)}
            </Typography>
          </Box>
        )}
        {(showCarry || showFunds) && (
          <Box flex={1} minWidth={120} data-testid="budget-effective-total">
            <Typography variant="caption">{t('statusPanel.effectiveBudget')}</Typography>
            <Typography fontWeight={700}>{formatCurrency(status.effectiveBudgetTotal)}</Typography>
          </Box>
        )}
        <Box flex={1} minWidth={120}><Typography variant="caption">{t('statusPanel.actualExpenses')}</Typography><Typography fontWeight={700}>{formatCurrency(status.actualExpenses)}</Typography></Box>
        {showFunds && (
          <Box flex={1} minWidth={120} data-testid="budget-fund-contributions-total">
            <Typography variant="caption">{t('statusPanel.fundContributions')}</Typography>
            <Typography fontWeight={700}>{formatCurrency(status.fundContributionsTotal)}</Typography>
          </Box>
        )}
        <Box flex={1} minWidth={120}><Typography variant="caption">{t('statusPanel.expectedIncome')}</Typography><Typography fontWeight={700}>{formatCurrency(status.expectedIncome)}</Typography></Box>
        <Box flex={1} minWidth={120}><Typography variant="caption">{t('statusPanel.linkedIncome')}</Typography><Typography fontWeight={700}>{formatCurrency(status.actualLinkedIncome)}</Typography></Box>
      </Stack>

      {hasBudget && status.categories.length > 0 && (
        <>
          <Typography variant="subtitle2" gutterBottom>{t('statusPanel.categories')}</Typography>
          <TableContainer>
            <Table size="small" aria-label={t('statusPanel.categoriesTable')} data-testid="budget-category-table">
              <TableHead>
                <TableRow>
                  <TableCell>{t('common:fields.category')}</TableCell>
                  <TableCell align="right">{t('statusPanel.columnBudget')}</TableCell>
                  <TableCell align="right">{t('statusPanel.carriedIn')}</TableCell>
                  <TableCell align="right">{t('statusPanel.columnEffective')}</TableCell>
                  <TableCell align="right">{t('statusPanel.columnSpent')}</TableCell>
                  <TableCell align="right">{t('statusPanel.columnRemaining')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {status.categories.map((category) => {
                  const percent = category.effectiveBudget > 0
                    ? Math.min((category.committedSpend / category.effectiveBudget) * 100, 100)
                    : category.committedSpend > 0 ? 100 : 0;
                  const name = category.category_name || t('statusPanel.categoryFallback', { id: category.category_id });
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
                              label={t(`carryBadge.${category.carryMode}`)}
                              data-testid="budget-category-carry-badge"
                            />
                          )}
                          {category.carryResetMonth && (
                            <Tooltip title={t('statusPanel.resetTooltip', { month: month(category.carryResetMonth) })}>
                              <Chip size="small" variant="outlined" label={t('common:actions.reset')} data-testid="budget-category-reset-badge" />
                            </Tooltip>
                          )}
                          {category.fundContributions > 0 && (
                            <Tooltip title={t('statusPanel.fundTooltip', { amount: money(category.fundContributions) })}>
                              <Chip size="small" variant="outlined" color="secondary" label={t('statusPanel.fundBadge')} data-testid="budget-category-fund-badge" />
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
                      <TableCell align="right" data-testid="budget-category-budgeted">{formatCurrency(category.budgetedAmount)}</TableCell>
                      <TableCell
                        align="right"
                        data-testid="budget-category-carried-in"
                        sx={{ color: category.carriedIn < 0 ? 'error.main' : category.carriedIn > 0 ? 'success.main' : 'text.secondary' }}
                      >
                        {category.carryMode === 'none' && category.carriedIn === 0 ? '—' : formatSignedCurrency(category.carriedIn)}
                      </TableCell>
                      <TableCell align="right" data-testid="budget-category-effective" sx={{ fontWeight: 600 }}>
                        {formatCurrency(category.effectiveBudget)}
                      </TableCell>
                      <TableCell align="right" data-testid="budget-category-spent">
                        <Tooltip title={spentTooltip(category)}>
                          <span>{formatCurrency(category.committedSpend)}</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell
                        align="right"
                        data-testid="budget-category-remaining"
                        sx={{ color: category.isOverBudget ? 'error.main' : 'text.primary', fontWeight: 600 }}
                      >
                        {category.isOverBudget
                          ? t('statusPanel.over', { amount: formatCurrency(Math.abs(category.effectiveRemaining)) })
                          : formatCurrency(category.effectiveRemaining)}
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
          {t('statusPanel.unbudgetedSpend', { amount: formatCurrency(status.unbudgetedSpend) })}
        </Typography>
      )}
    </Paper>
  );
}
