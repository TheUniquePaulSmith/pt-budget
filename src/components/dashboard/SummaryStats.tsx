'use client';

import React from 'react';
import { Box } from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AccountBalanceWallet,
  DateRange,
  Savings,
  Speed,
} from '@mui/icons-material';
import StatCard from '@/components/common/Charts/StatCard';
import type { ChartData, DashboardSummary } from '@/types/database';

interface SummaryStatsProps {
  summary: DashboardSummary | null;
  chartData: ChartData | null;
  timeRangeLabel: string;
  dayCount: number;
}

const SummaryStats: React.FC<SummaryStatsProps> = ({ summary, chartData, timeRangeLabel, dayCount }) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const formatPercent = (value: number) => `${value.toFixed(1)}%`;

  const totalIncome = summary?.totalIncome ?? 0;
  const totalExpenses = summary?.totalExpenses ?? 0;
  const netIncome = summary?.netIncome ?? 0;
  const transactionCount = summary?.transactionCount ?? 0;
  const savingsRate = totalIncome > 0 ? (netIncome / totalIncome) * 100 : 0;
  const spendingRate = totalIncome > 0 ? (totalExpenses / totalIncome) * 100 : 0;
  const averageDailySpend = dayCount > 0 ? totalExpenses / dayCount : 0;
  const topSpendingCategory = chartData?.spendingByCategory?.[0];

  // Sparkline history comes from the same 6-month trend window the Trends tab charts use.
  const incomeTrend = chartData?.trends?.income ?? [];
  const expensesTrend = chartData?.trends?.expenses ?? [];
  const netTrend = incomeTrend.map((income, index) => income - (expensesTrend[index] ?? 0));
  const savingsRateTrend = incomeTrend.map((income, index) =>
    income > 0 ? ((income - (expensesTrend[index] ?? 0)) / income) * 100 : 0
  );

  const formatTrendCurrency = (value: number | null) => (value == null ? '' : formatCurrency(value));
  const formatTrendPercent = (value: number | null) => (value == null ? '' : formatPercent(value));

  return (
    <Box display="flex" flexWrap="wrap" gap={3} mb={4}>
      <Box flex="1 1 300px">
        <StatCard
          title="Total Income"
          value={formatCurrency(totalIncome)}
          icon={<TrendingUp />}
          color="success"
          subtitle={timeRangeLabel}
          trend={incomeTrend}
          trendValueFormatter={formatTrendCurrency}
        />
      </Box>
      <Box flex="1 1 300px">
        <StatCard
          title="Total Expenses"
          value={formatCurrency(totalExpenses)}
          icon={<TrendingDown />}
          color="error"
          subtitle={timeRangeLabel}
          trend={expensesTrend}
          trendValueFormatter={formatTrendCurrency}
        />
      </Box>
      <Box flex="1 1 300px">
        <StatCard
          title="Net Income"
          value={formatCurrency(netIncome)}
          icon={<AccountBalanceWallet />}
          color={netIncome >= 0 ? 'success' : 'error'}
          subtitle={timeRangeLabel}
          trend={netTrend}
          trendValueFormatter={formatTrendCurrency}
        />
      </Box>
      <Box flex="1 1 300px">
        <StatCard
          title="Transactions"
          value={transactionCount.toString()}
          icon={<DateRange />}
          color="primary"
          subtitle={timeRangeLabel}
        />
      </Box>
      <Box flex="1 1 300px">
        <StatCard
          title="Savings Rate"
          value={formatPercent(savingsRate)}
          icon={<Savings />}
          color={savingsRate >= 20 ? 'success' : savingsRate >= 0 ? 'warning' : 'error'}
          subtitle={timeRangeLabel}
          trend={savingsRateTrend}
          trendValueFormatter={formatTrendPercent}
        />
      </Box>
      <Box flex="1 1 300px">
        <StatCard
          title="Spend vs Income"
          value={formatPercent(spendingRate)}
          icon={<Speed />}
          color={spendingRate <= 80 ? 'success' : spendingRate <= 100 ? 'warning' : 'error'}
          subtitle={timeRangeLabel}
        />
      </Box>
      <Box flex="1 1 300px">
        <StatCard
          title="Avg Daily Spend"
          value={formatCurrency(averageDailySpend)}
          icon={<TrendingDown />}
          color="warning"
          subtitle={`${dayCount} day${dayCount === 1 ? '' : 's'} elapsed`}
        />
      </Box>
      <Box flex="1 1 300px">
        <StatCard
          title="Top Expense Category"
          value={topSpendingCategory ? formatCurrency(topSpendingCategory.value) : '$0.00'}
          icon={<DateRange />}
          color="primary"
          subtitle={topSpendingCategory ? topSpendingCategory.label : 'No spending data'}
        />
      </Box>
    </Box>
  );
};

export default SummaryStats;
