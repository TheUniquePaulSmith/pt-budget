'use client';

import React, { useState } from 'react';
import { Box, Paper, Typography, Tabs, Tab, Chip, Stack, Divider } from '@mui/material';
import { PieChart } from '@mui/x-charts/PieChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import type { ChartData, ChartCategoryData, Account, User } from '@/types/database';

const PIE_CHART_TOP_N = 10;
const OTHER_SLICE_COLOR = '#9e9e9e';

function topNWithOther(data: ChartCategoryData[], limit = PIE_CHART_TOP_N): ChartCategoryData[] {
  if (data.length <= limit) return data;
  const top = data.slice(0, limit - 1);
  const otherValue = data.slice(limit - 1).reduce((sum, item) => sum + item.value, 0);
  return [...top, { id: 'other', label: 'Other', value: otherValue, color: OTHER_SLICE_COLOR }];
}

interface TabPanelProps {
  children?: React.ReactNode;
  index: number;
  value: number;
}

function TabPanel({ children, value, index }: TabPanelProps) {
  return (
    <div role="tabpanel" hidden={value !== index}>
      {value === index && children}
    </div>
  );
}

interface ChartsSectionProps {
  chartData: ChartData | null;
  accounts: Account[];
  users: User[];
  timeRangeLabel: string;
}

const ChartsSection: React.FC<ChartsSectionProps> = ({ chartData, timeRangeLabel }) => {
  const [tabValue, setTabValue] = useState(0);

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

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);

  const percentLabel = (value: number, total: number) => {
    if (total <= 0) return '0%';
    const percent = (value / total) * 100;
    return `${percent.toFixed(percent >= 10 ? 0 : 1)}%`;
  };

  const renderPiePanel = (title: string, data: typeof spendingData, emptyMessage: string) => (
    <Paper variant="outlined" sx={{ p: 2, height: '100%' }}>
      <Typography variant="subtitle1" fontWeight={700} gutterBottom>{title}</Typography>
      {data.length > 0 ? (
        <>
          <Box height={320} display="flex" justifyContent="center">
            <PieChart
              series={[{
                data,
                arcLabel: (item) => percentLabel(Number(item.value || 0), data.reduce((sum, row) => sum + row.value, 0)),
                arcLabelMinAngle: 14,
                outerRadius: 98,
                arcLabelRadius: 122,
                paddingAngle: 1,
                highlightScope: { fade: 'global', highlight: 'item' },
                faded: { innerRadius: 30, additionalRadius: -30, color: 'gray' },
              }]}
              width={380}
              height={320}
              margin={{ top: 38, bottom: 38, left: 38, right: 38 }}
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
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
          <Tab label="Spending Breakdown" />
          <Tab label="Income Sources" />
          <Tab label="Trends" />
          <Tab label="User Analysis" />
        </Tabs>
      </Box>

      <TabPanel value={tabValue} index={0}>
        <Box p={3}>
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
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={1}>
        <Box p={3}>
          <Typography variant="h6" gutterBottom>
            Income by Source - {timeRangeLabel}
          </Typography>
          {incomePieData.length > 0 ? (
            <Box height={400} display="flex" justifyContent="center">
              <PieChart
                series={[{
                  data: incomePieData,
                  arcLabel: (item) => percentLabel(Number(item.value || 0), incomePieData.reduce((sum, row) => sum + row.value, 0)),
                  arcLabelMinAngle: 12,
                  outerRadius: 140,
                  arcLabelRadius: 168,
                  paddingAngle: 1,
                  highlightScope: { fade: 'global', highlight: 'item' },
                  faded: { innerRadius: 30, additionalRadius: -30, color: 'gray' },
                }]}
                width={600}
                height={400}
                margin={{ top: 44, bottom: 44, left: 56, right: 56 }}
              />
            </Box>
          ) : (
            <Box display="flex" justifyContent="center" alignItems="center" height={200}>
              <Typography color="text.secondary">No income data for this period</Typography>
            </Box>
          )}
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <Box p={3}>
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
            <Box display="flex" justifyContent="center" alignItems="center" height={200}>
              <Typography color="text.secondary">No trend data available</Typography>
            </Box>
          )}
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={3}>
        <Box p={3}>
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
            <Box display="flex" justifyContent="center" alignItems="center" height={200}>
              <Typography color="text.secondary">No user data for this period</Typography>
            </Box>
          )}
        </Box>
      </TabPanel>
    </Paper>
  );
};

export default ChartsSection;
