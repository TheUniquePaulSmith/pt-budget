'use client';

import React from 'react';
import { Box } from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AccountBalanceWallet,
  DateRange,
} from '@mui/icons-material';
import StatCard from '@/components/common/Charts/StatCard';
import type { DashboardSummary } from '@/types/database';

interface SummaryStatsProps {
  summary: DashboardSummary | null;
  timeRangeLabel: string;
}

const SummaryStats: React.FC<SummaryStatsProps> = ({ summary, timeRangeLabel }) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const totalIncome = summary?.totalIncome ?? 0;
  const totalExpenses = summary?.totalExpenses ?? 0;
  const netIncome = summary?.netIncome ?? 0;
  const transactionCount = summary?.transactionCount ?? 0;

  return (
    <Box display="flex" flexWrap="wrap" gap={3} mb={4}>
      <Box flex="1 1 300px">
        <StatCard
          title="Total Income"
          value={formatCurrency(totalIncome)}
          icon={<TrendingUp />}
          color="success"
          subtitle={timeRangeLabel}
        />
      </Box>
      <Box flex="1 1 300px">
        <StatCard
          title="Total Expenses"
          value={formatCurrency(totalExpenses)}
          icon={<TrendingDown />}
          color="error"
          subtitle={timeRangeLabel}
        />
      </Box>
      <Box flex="1 1 300px">
        <StatCard
          title="Net Income"
          value={formatCurrency(netIncome)}
          icon={<AccountBalanceWallet />}
          color={netIncome >= 0 ? 'success' : 'error'}
          subtitle={timeRangeLabel}
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
    </Box>
  );
};

export default SummaryStats;
