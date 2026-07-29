'use client';

import React, { useState } from 'react';
import { Box, Paper, Typography, Tabs, Tab, Chip, Stack, Divider, Button, useMediaQuery, useTheme } from '@mui/material';
import { PieChart } from '@mui/x-charts/PieChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import { Gauge, gaugeClasses } from '@mui/x-charts/Gauge';
import type { ChartData, ChartCategoryData, Account, BudgetStatus, User } from '@/types/database';

const PIE_CHART_TOP_N = 10;
const OTHER_SLICE_COLOR = '#9e9e9e';
// Keeps the budget and delta bar charts to a readable height on a phone.
const BUDGET_CHART_TOP_N = 12;
const DELTA_CHART_TOP_N = 10;

const COMMITTED_COLOR = '#5c6bc0';
const DISCRETIONARY_COLOR = '#ffb74d';
const UPCOMING_COLOR = '#7e57c2';
const BUDGETED_COLOR = '#90a4ae';
const ACTUAL_COLOR = '#1976d2';
const SPENT_LESS_COLOR = '#2e7d32';
const SPENT_MORE_COLOR = '#d32f2f';

function topNWithOther(data: ChartCategoryData[], limit = PIE_CHART_TOP_N): ChartCategoryData[] {
  if (data.length <= limit) return data;
  const top = data.slice(0, limit - 1);
  const otherValue = data.slice(limit - 1).reduce((sum, item) => sum + item.value, 0);
  return [...top, { id: 'other', label: 'Other', value: otherValue, color: OTHER_SLICE_COLOR }];
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

const percentLabel = (value: number, total: number) => {
  if (total <= 0) return '0%';
  const percent = (value / total) * 100;
  return `${percent.toFixed(percent >= 10 ? 0 : 1)}%`;
};

// Formats 'yyyy-MM' as 'MMM yy' for the denser month-axis charts.
const shortMonth = (month: string) => {
  const [year, monthNumber] = month.split('-');
  if (!year || !monthNumber) return month;
  const date = new Date(Date.UTC(Number(year), Number(monthNumber) - 1, 1));
  return `${date.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${year.slice(2)}`;
};

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`charts-tabpanel-${index}`}
      aria-labelledby={`charts-tab-${index}`}
    >
      {value === index && children}
    </div>
  );
}

const tabA11yProps = (index: number) => ({
  id: `charts-tab-${index}`,
  'aria-controls': `charts-tabpanel-${index}`,
});

function EmptyPanel({ message, height = 200, children }: { message: string; height?: number; children?: React.ReactNode }) {
  return (
    <Box display="flex" flexDirection="column" justifyContent="center" alignItems="center" gap={1} height={height}>
      <Typography color="text.secondary">{message}</Typography>
      {children}
    </Box>
  );
}

interface ChartsSectionProps {
  chartData: ChartData | null;
  accounts: Account[];
  users: User[];
  timeRangeLabel: string;
  budgetStatus: BudgetStatus | null;
  onManageBudget?: () => void;
}

const ChartsSection: React.FC<ChartsSectionProps> = ({ chartData, timeRangeLabel, budgetStatus, onManageBudget }) => {
  const [tabValue, setTabValue] = useState(0);
  const theme = useTheme();
  // Charts drop their side legends below the sm breakpoint; the colored
  // value chips underneath each pie take over that role.
  const isCompact = useMediaQuery(theme.breakpoints.down('sm'));

  const spendingData = chartData?.spendingByCategory ?? [];
  const companySpendingData = chartData?.spendingByCompany ?? [];
  const recurringSpendingData = chartData?.spendingByRecurring ?? [];
  const incomeData = chartData?.incomeBySource ?? [];

  const spendingPieData = topNWithOther(spendingData);
  const companySpendingPieData = topNWithOther(companySpendingData);
  const recurringSpendingPieData = topNWithOther(recurringSpendingData);
  const incomePieData = topNWithOther(incomeData);
  const trendsData = chartData?.trends ?? { months: [], income: [], expenses: [] };
  const accountData = chartData?.accountAnalysis ?? { accountNames: [], income: [], expenses: [] };
  const categoryTrends = chartData?.categoryTrends ?? { months: [], series: [] };
  const committedSplit = chartData?.committedSplit ?? { months: [], committed: [], discretionary: [] };
  const upcomingCommitments = chartData?.upcomingCommitments ?? { months: [], amounts: [] };
  const categoryDeltas = chartData?.categoryDeltas ?? [];
  const comparisonPeriodLabel = chartData?.comparisonPeriodLabel ?? 'previous period';
  const totalSpending = spendingData.reduce((sum, category) => sum + category.value, 0);

  const netCashFlow = trendsData.income.map((income, idx) => income - (trendsData.expenses[idx] ?? 0));
  const spendingPressure = trendsData.income.map((income, idx) => {
    const expense = trendsData.expenses[idx] ?? 0;
    return income > 0 ? Number(((expense / income) * 100).toFixed(1)) : 0;
  });

  const topSpendingCategories = spendingData.slice(0, 5).map((category) => {
    const percent = totalSpending > 0 ? (category.value / totalSpending) * 100 : 0;
    return {
      ...category,
      percent,
    };
  });

  const avgMonthlyIncome = trendsData.income.length > 0
    ? trendsData.income.reduce((sum, value) => sum + value, 0) / trendsData.income.length
    : 0;
  const avgMonthlyExpenses = trendsData.expenses.length > 0
    ? trendsData.expenses.reduce((sum, value) => sum + value, 0) / trendsData.expenses.length
    : 0;
  const avgMonthlyNet = avgMonthlyIncome - avgMonthlyExpenses;

  // --- Budget Health ---------------------------------------------------------
  const budgetedTotal = budgetStatus?.budgetedTotal ?? null;
  const hasBudget = budgetedTotal != null && budgetedTotal > 0;
  const budgetPercent = hasBudget ? (budgetStatus!.actualExpenses / budgetedTotal!) * 100 : 0;
  // Pace: how far through the current month we are, as a percentage.
  const today = new Date();
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const monthElapsedPercent = (today.getDate() / daysInMonth) * 100;

  const budgetCategories = [...(budgetStatus?.categories ?? [])]
    .sort((a, b) => {
      const ratioA = a.budgetedAmount > 0 ? a.actualExpenses / a.budgetedAmount : 0;
      const ratioB = b.budgetedAmount > 0 ? b.actualExpenses / b.budgetedAmount : 0;
      return ratioB - ratioA;
    })
    .slice(0, BUDGET_CHART_TOP_N);
  const overBudgetCategories = (budgetStatus?.categories ?? []).filter((category) => category.isOverBudget);

  // --- Commitments -----------------------------------------------------------
  const latestCommittedIndex = committedSplit.months.length - 1;
  const latestCommitted = latestCommittedIndex >= 0 ? committedSplit.committed[latestCommittedIndex] ?? 0 : 0;
  const latestDiscretionary = latestCommittedIndex >= 0 ? committedSplit.discretionary[latestCommittedIndex] ?? 0 : 0;
  const latestCommittedTotal = latestCommitted + latestDiscretionary;
  const hasCommittedData = committedSplit.months.length > 0 && committedSplit.committed.some((value) => value > 0);
  const upcomingTotal = upcomingCommitments.amounts.reduce((sum, value) => sum + value, 0);

  // --- Period-over-period ----------------------------------------------------
  const topDeltas = categoryDeltas.filter((entry) => entry.delta !== 0).slice(0, DELTA_CHART_TOP_N);
  // Largest change at the top of a horizontal band axis, which renders bottom-up.
  const deltaRows = [...topDeltas].reverse();

  const renderPiePanel = (title: string, data: typeof spendingData, emptyMessage: string) => (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom>{title}</Typography>
      {data.length > 0 ? (
        <>
          <Box sx={{ height: 320, width: '100%' }}>
            <PieChart
              series={[{
                data,
                arcLabel: (item) => percentLabel(Number(item.value || 0), data.reduce((sum, row) => sum + row.value, 0)),
                arcLabelMinAngle: 14,
                outerRadius: '80%',
                arcLabelRadius: '100%',
                paddingAngle: 1,
                highlightScope: { fade: 'global', highlight: 'item' },
                faded: { innerRadius: 30, additionalRadius: -30, color: 'gray' },
              }]}
              height={320}
              hideLegend={isCompact}
              margin={{ top: 28, bottom: 28, left: 24, right: 24 }}
            />
          </Box>
          <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
            {data.slice(0, 5).map((item) => (
              <Chip
                key={String(item.id)}
                label={`${item.label}: ${formatCurrency(item.value)} (${percentLabel(item.value, data.reduce((sum, row) => sum + row.value, 0))})`}
                size="small"
                sx={{ borderLeft: `4px solid ${item.color}`, backgroundColor: 'background.default' }}
              />
            ))}
          </Stack>
        </>
      ) : (
        <Box display="flex" justifyContent="center" alignItems="center" height={300}>
          <Typography color="text.secondary">{emptyMessage}</Typography>
        </Box>
      )}
    </Paper>
  );

  return (
    <Paper sx={{ width: '100%', mb: 4 }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs
          value={tabValue}
          onChange={(_, newValue) => setTabValue(newValue)}
          variant="scrollable"
          scrollButtons="auto"
          allowScrollButtonsMobile
          aria-label="Dashboard chart sections"
        >
          <Tab label="Spending Breakdown" {...tabA11yProps(0)} />
          <Tab label="Budget Health" {...tabA11yProps(1)} />
          <Tab label="Trends" {...tabA11yProps(2)} />
          <Tab label="Commitments" {...tabA11yProps(3)} />
          <Tab label="Income Sources" {...tabA11yProps(4)} />
          <Tab label="User Analysis" {...tabA11yProps(5)} />
        </Tabs>
      </Box>

      <TabPanel value={tabValue} index={0}>
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" gutterBottom>
            Spending Breakdown - {timeRangeLabel}
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
            {renderPiePanel('Categories', spendingPieData, 'No category spending for this period')}
            {renderPiePanel('Companies / Services', companySpendingPieData, 'No company spending for this period')}
            {renderPiePanel('Subscriptions & Recurring Bills', recurringSpendingPieData, 'No recurring spending for this period')}
          </Box>

          {spendingData.length > 0 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                Top Expense Categories
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {topSpendingCategories.map((category) => (
                  <Chip
                    key={String(category.id)}
                    label={`${category.label}: ${formatCurrency(category.value)} (${category.percent.toFixed(1)}%)`}
                    sx={{ borderLeft: `4px solid ${category.color}`, backgroundColor: 'background.default' }}
                  />
                ))}
              </Stack>
            </>
          )}

          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle1" fontWeight={700}>
            What Changed
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Category spend versus the {comparisonPeriodLabel}. Red bars mean you spent more.
          </Typography>
          {deltaRows.length > 0 ? (
            <Box sx={{ height: Math.max(240, deltaRows.length * 38), width: '100%' }}>
              <BarChart
                layout="horizontal"
                series={[{
                  data: deltaRows.map((entry) => entry.delta),
                  label: 'Change vs previous period',
                  valueFormatter: (value: number | null) => (value == null ? '' : formatCurrency(value)),
                }]}
                yAxis={[{ scaleType: 'band', data: deltaRows.map((entry) => entry.label), width: 120 }]}
                xAxis={[{
                  valueFormatter: (value: number) => formatCurrency(value),
                  colorMap: {
                    type: 'piecewise',
                    thresholds: [0],
                    colors: [SPENT_LESS_COLOR, SPENT_MORE_COLOR],
                  },
                }]}
                hideLegend
                margin={{ top: 10, right: 20, bottom: 30, left: 10 }}
              />
            </Box>
          ) : (
            <EmptyPanel message="No category changes to compare for this period" height={140} />
          )}
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6">Budget Health</Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Current month · all accounts — this tab ignores the date range and scope filters above.
          </Typography>

          {hasBudget ? (
            <>
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={3}
                alignItems="center"
                sx={{ my: 2 }}
              >
                <Box sx={{ width: 180, height: 180, flexShrink: 0 }}>
                  <Gauge
                    value={Math.min(budgetPercent, 100)}
                    valueMax={100}
                    startAngle={-110}
                    endAngle={110}
                    text={`${budgetPercent.toFixed(0)}%`}
                    sx={{
                      [`& .${gaugeClasses.valueArc}`]: {
                        fill: budgetStatus?.isOverBudget ? theme.palette.error.main : theme.palette.primary.main,
                      },
                    }}
                  />
                </Box>
                <Stack spacing={1} sx={{ minWidth: 0 }}>
                  <Typography variant="body1">
                    <strong>{budgetPercent.toFixed(0)}%</strong> of budget spent ·{' '}
                    <strong>{monthElapsedPercent.toFixed(0)}%</strong> through the month
                  </Typography>
                  <Stack direction="row" flexWrap="wrap" gap={1}>
                    <Chip size="small" variant="outlined" label={`Budgeted: ${formatCurrency(budgetedTotal!)}`} />
                    <Chip size="small" variant="outlined" label={`Spent: ${formatCurrency(budgetStatus!.actualExpenses)}`} />
                    <Chip
                      size="small"
                      color={budgetStatus?.isOverBudget ? 'error' : 'success'}
                      label={
                        budgetStatus?.isOverBudget
                          ? `Over by ${formatCurrency(Math.abs(budgetStatus.remaining ?? 0))}`
                          : `${formatCurrency(budgetStatus?.remaining ?? 0)} remaining`
                      }
                    />
                    {budgetPercent > monthElapsedPercent && !budgetStatus?.isOverBudget && (
                      <Chip size="small" color="warning" variant="outlined" label="Ahead of pace" />
                    )}
                    {(budgetStatus?.unbudgetedSpend ?? 0) > 0 && (
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`Unbudgeted: ${formatCurrency(budgetStatus!.unbudgetedSpend)}`}
                      />
                    )}
                  </Stack>
                </Stack>
              </Stack>

              {overBudgetCategories.length > 0 && (
                <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mb: 2 }}>
                  {overBudgetCategories.map((category) => (
                    <Chip
                      key={category.category_id}
                      size="small"
                      color="error"
                      label={`${category.category_name ?? 'Category'} over by ${formatCurrency(Math.abs(category.remaining))}`}
                    />
                  ))}
                </Stack>
              )}

              <Divider sx={{ my: 2 }} />
              <Typography variant="subtitle1" fontWeight={700} gutterBottom>
                Budgeted vs Actual by Category
              </Typography>
              {budgetCategories.length > 0 ? (
                <Box sx={{ height: Math.max(280, budgetCategories.length * 42), width: '100%' }}>
                  <BarChart
                    layout="horizontal"
                    series={[
                      {
                        data: budgetCategories.map((category) => category.budgetedAmount),
                        label: 'Budgeted',
                        color: BUDGETED_COLOR,
                        valueFormatter: (value: number | null) => (value == null ? '' : formatCurrency(value)),
                      },
                      {
                        data: budgetCategories.map((category) => category.actualExpenses),
                        label: 'Actual',
                        color: ACTUAL_COLOR,
                        valueFormatter: (value: number | null) => (value == null ? '' : formatCurrency(value)),
                      },
                    ]}
                    yAxis={[{
                      scaleType: 'band',
                      data: budgetCategories.map((category) => category.category_name ?? 'Category'),
                      width: 120,
                    }]}
                    xAxis={[{ valueFormatter: (value: number) => formatCurrency(value) }]}
                    margin={{ top: 10, right: 20, bottom: 30, left: 10 }}
                  />
                </Box>
              ) : (
                <EmptyPanel message="This month's plan has no category thresholds" height={160} />
              )}
            </>
          ) : (
            <EmptyPanel message="No budget plan is in effect for this month" height={220}>
              {onManageBudget && (
                <Button variant="outlined" size="small" onClick={onManageBudget}>
                  Manage budget
                </Button>
              )}
            </EmptyPanel>
          )}
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" gutterBottom>Income vs Expenses Trend</Typography>
          {trendsData.months.length > 0 ? (
            <Box>
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} mb={2}>
                <Chip label={`Avg monthly income: ${formatCurrency(avgMonthlyIncome)}`} color="success" variant="outlined" />
                <Chip label={`Avg monthly expenses: ${formatCurrency(avgMonthlyExpenses)}`} color="error" variant="outlined" />
                <Chip label={`Avg monthly net: ${formatCurrency(avgMonthlyNet)}`} color={avgMonthlyNet >= 0 ? 'success' : 'warning'} variant="filled" />
              </Stack>

              <Box height={320}>
                <LineChart
                  series={[
                    { data: trendsData.income, label: 'Income', color: '#4caf50' },
                    { data: trendsData.expenses, label: 'Expenses', color: '#f44336' },
                  ]}
                  xAxis={[{ scaleType: 'point', data: trendsData.months }]}
                  yAxis={[{ width: 80 }]}
                />
              </Box>

              <Box height={280} mt={3}>
                <Typography variant="subtitle1" gutterBottom>
                  Net Cash Flow by Month
                </Typography>
                <BarChart
                  series={[{ data: netCashFlow, label: 'Net Cash Flow', color: '#1976d2' }]}
                  xAxis={[{ scaleType: 'band', data: trendsData.months }]}
                  yAxis={[{ width: 80 }]}
                  margin={{ top: 20, right: 20, bottom: 50, left: 80 }}
                />
              </Box>

              <Box mt={3}>
                <Typography variant="subtitle1">
                  Spending by Category over Time
                </Typography>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  What drove each month&apos;s total. Smaller categories are grouped into &quot;Other&quot;.
                </Typography>
                {categoryTrends.series.length > 0 ? (
                  <Box height={340}>
                    <BarChart
                      series={categoryTrends.series.map((series) => ({
                        data: series.data,
                        label: series.label,
                        color: series.color,
                        stack: 'total',
                        valueFormatter: (value: number | null) => (value == null ? '' : formatCurrency(value)),
                      }))}
                      xAxis={[{ scaleType: 'band', data: categoryTrends.months.map(shortMonth) }]}
                      yAxis={[{ width: 80, valueFormatter: (value: number) => formatCurrency(value) }]}
                      hideLegend={isCompact}
                      margin={{ top: 20, right: 20, bottom: 50, left: 80 }}
                    />
                  </Box>
                ) : (
                  <EmptyPanel message="No categorized spending in this window" height={160} />
                )}
              </Box>

              <Box height={260} mt={3}>
                <Typography variant="subtitle1" gutterBottom>
                  Spending Pressure (Expense/Income)
                </Typography>
                <LineChart
                  series={[{ data: spendingPressure, label: 'Expense Ratio %', color: '#ef6c00' }]}
                  xAxis={[{ scaleType: 'point', data: trendsData.months }]}
                  yAxis={[{ width: 80, valueFormatter: (value: number) => `${value}%` }]}
                />
              </Box>
            </Box>
          ) : (
            <EmptyPanel message="No trend data available" />
          )}
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={3}>
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6">Committed vs Discretionary Spending</Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            &quot;Committed&quot; is spending linked to a subscription or recurring bill — the part of each
            month that is already spoken for.
          </Typography>

          {hasCommittedData ? (
            <>
              <Stack direction="row" flexWrap="wrap" gap={1} mb={2}>
                <Chip
                  label={`Latest month committed: ${percentLabel(latestCommitted, latestCommittedTotal)}`}
                  sx={{ borderLeft: `4px solid ${COMMITTED_COLOR}`, backgroundColor: 'background.default' }}
                />
                <Chip
                  label={`Committed: ${formatCurrency(latestCommitted)}`}
                  size="small"
                  variant="outlined"
                />
                <Chip
                  label={`Discretionary: ${formatCurrency(latestDiscretionary)}`}
                  size="small"
                  variant="outlined"
                />
              </Stack>

              <Box height={340}>
                <BarChart
                  series={[
                    {
                      data: committedSplit.committed,
                      label: 'Committed (recurring & bills)',
                      color: COMMITTED_COLOR,
                      stack: 'total',
                      valueFormatter: (value: number | null) => (value == null ? '' : formatCurrency(value)),
                    },
                    {
                      data: committedSplit.discretionary,
                      label: 'Discretionary',
                      color: DISCRETIONARY_COLOR,
                      stack: 'total',
                      valueFormatter: (value: number | null) => (value == null ? '' : formatCurrency(value)),
                    },
                  ]}
                  xAxis={[{ scaleType: 'band', data: committedSplit.months.map(shortMonth) }]}
                  yAxis={[{ width: 80, valueFormatter: (value: number) => formatCurrency(value) }]}
                  hideLegend={isCompact}
                  margin={{ top: 20, right: 20, bottom: 50, left: 80 }}
                />
              </Box>
            </>
          ) : (
            <EmptyPanel message="No spending is linked to a recurring series yet" height={200} />
          )}

          <Divider sx={{ my: 3 }} />
          <Typography variant="subtitle1" fontWeight={700}>
            Upcoming Commitments
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Estimated from active series cadence and expected amounts. Not affected by the account or
            user filters above.
          </Typography>
          {upcomingTotal > 0 ? (
            <Box height={260}>
              <BarChart
                series={[{
                  data: upcomingCommitments.amounts,
                  label: 'Expected charges',
                  color: UPCOMING_COLOR,
                  valueFormatter: (value: number | null) => (value == null ? '' : formatCurrency(value)),
                }]}
                xAxis={[{ scaleType: 'band', data: upcomingCommitments.months.map(shortMonth) }]}
                yAxis={[{ width: 80, valueFormatter: (value: number) => formatCurrency(value) }]}
                hideLegend
                margin={{ top: 20, right: 20, bottom: 40, left: 80 }}
              />
            </Box>
          ) : (
            <EmptyPanel message="No active recurring series with an expected amount" height={160} />
          )}
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={4}>
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" gutterBottom>
            Income by Source - {timeRangeLabel}
          </Typography>
          {incomePieData.length > 0 ? (
            <>
              <Box sx={{ height: { xs: 320, sm: 400 }, width: '100%' }}>
                <PieChart
                  series={[{
                    data: incomePieData,
                    arcLabel: (item) => percentLabel(Number(item.value || 0), incomePieData.reduce((sum, row) => sum + row.value, 0)),
                    arcLabelMinAngle: 12,
                    outerRadius: '90%',
                    arcLabelRadius: '108%',
                    paddingAngle: 1,
                    highlightScope: { fade: 'global', highlight: 'item' },
                    faded: { innerRadius: 30, additionalRadius: -30, color: 'gray' },
                  }]}
                  height={isCompact ? 320 : 400}
                  hideLegend={isCompact}
                  margin={isCompact
                    ? { top: 32, bottom: 32, left: 32, right: 32 }
                    : { top: 44, bottom: 44, left: 56, right: 56 }}
                />
              </Box>
              <Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>
                {incomePieData.slice(0, 5).map((item) => (
                  <Chip
                    key={String(item.id)}
                    label={`${item.label}: ${formatCurrency(item.value)} (${percentLabel(item.value, incomePieData.reduce((sum, row) => sum + row.value, 0))})`}
                    size="small"
                    sx={{ borderLeft: `4px solid ${item.color}`, backgroundColor: 'background.default' }}
                  />
                ))}
              </Stack>
            </>
          ) : (
            <EmptyPanel message="No income data for this period" />
          )}
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={5}>
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <Typography variant="h6" gutterBottom>
            Income and Expenses by User - {timeRangeLabel}
          </Typography>
          {accountData.accountNames.length > 0 ? (
            <Box height={400}>
              <BarChart
                series={[
                  { data: accountData.income, label: 'Income', color: '#4caf50' },
                  { data: accountData.expenses, label: 'Expenses', color: '#f44336' },
                ]}
                xAxis={[{ scaleType: 'band', data: accountData.accountNames }]}
                yAxis={[{
                  width: 80,
                  valueFormatter: (value: string) => `$${value.toLocaleString()}`,
                }]}
                margin={{ top: 20, right: 20, bottom: 60, left: 80 }}
              />
            </Box>
          ) : (
            <EmptyPanel message="No user data for this period" />
          )}
        </Box>
      </TabPanel>
    </Paper>
  );
};

export default ChartsSection;
