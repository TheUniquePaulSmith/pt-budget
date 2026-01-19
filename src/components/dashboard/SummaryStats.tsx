'use client';

import React, { useMemo } from 'react';
import { Box } from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AccountBalanceWallet,
  DateRange,
} from '@mui/icons-material';
import StatCard from '@/components/common/Charts/StatCard';
import { Transaction, Account } from '@/types/database';

interface SummaryStatsProps {
  transactions: Transaction[];
  accounts: Account[];
  dateRanges: { start: string; end: string };
  timeRangeLabel: string;
}

const SummaryStats: React.FC<SummaryStatsProps> = ({
  transactions,
  accounts,
  dateRanges,
  timeRangeLabel,
}) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const getAccountType = (accountId: number): 'checking' | 'savings' | 'credit' | 'joint' | undefined => {
    const account = accounts.find(acc => acc.id === accountId);
    return account?.type;
  };

  const summaryStats = useMemo(() => {
    const startDate = new Date(dateRanges.start);
    const endDate = new Date(dateRanges.end);
    
    const periodTransactions = transactions.filter(t => {
      const transactionDate = new Date(t.date);
      return transactionDate >= startDate && transactionDate <= endDate;
    });
    
    /* Don't count credit card payments as income */
    const totalIncome = periodTransactions
      .filter(t => t.type === 'income' && getAccountType(t.account_id) !== 'credit')
      .reduce((sum, t) => sum + t.amount, 0);
    
    const totalExpenses = periodTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
    
    const netIncome = totalIncome - (totalExpenses * -1);
    
    return {
      totalIncome,
      totalExpenses,
      netIncome,
      transactionCount: periodTransactions.length,
    };
  }, [transactions, dateRanges]);

  return (
    <Box display="flex" flexWrap="wrap" gap={3} mb={4}>
      <Box flex="1 1 300px">
        <StatCard
          title="Total Income"
          value={formatCurrency(summaryStats.totalIncome)}
          icon={<TrendingUp />}
          color="success"
          subtitle={timeRangeLabel}
        />
      </Box>
      <Box flex="1 1 300px">
        <StatCard
          title="Total Expenses"
          value={formatCurrency(summaryStats.totalExpenses)}
          icon={<TrendingDown />}
          color="error"
          subtitle={timeRangeLabel}
        />
      </Box>
      <Box flex="1 1 300px">
        <StatCard
          title="Net Income"
          value={formatCurrency(summaryStats.netIncome)}
          icon={<AccountBalanceWallet />}
          color={summaryStats.netIncome >= 0 ? 'success' : 'error'}
          subtitle={timeRangeLabel}
        />
      </Box>
      <Box flex="1 1 300px">
        <StatCard
          title="Transactions"
          value={summaryStats.transactionCount.toString()}
          icon={<DateRange />}
          color="primary"
          subtitle={timeRangeLabel}
        />
      </Box>
    </Box>
  );
};

export default SummaryStats;
