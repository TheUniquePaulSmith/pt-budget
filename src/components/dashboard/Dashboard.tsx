'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Box } from '@mui/material';
import { useDashboardSlice } from '@/contexts/useDatabaseSlices';
import { format, subDays, subMonths, startOfMonth, endOfMonth, differenceInCalendarDays } from 'date-fns';
import AddTransaction from '@/components/transactions/AddTransaction';
import CSVImport from '@/components/csv-import/CSVImport';
import DateRangeSelector from './DateRangeSelector';
import SummaryStats from './SummaryStats';
import ChartsSection from './ChartsSection';
import RecentTransactions from './RecentTransactions';
import { BudgetStatusCard } from './BudgetStatusCard';
import type { Transaction, DashboardSummary, ChartData, BudgetStatus, TransactionScopeFilters } from '@/types/database';

interface DashboardProps {
  onNavigateToBudget?: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigateToBudget }) => {
  const {
    transactionVersion,
    budgetVersion,
    accounts,
    users,
    exportDatabase,
    getRecentTransactions,
    getDashboardSummary,
    getChartData,
    setTransactionComment,
    getBudgetStatus,
  } = useDashboardSlice();

  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'year' | 'custom'>('month');
  const [addTransactionOpen, setAddTransactionOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [recentTransactionsLimit, setRecentTransactionsLimit] = useState(10);
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const [scopeFilters, setScopeFilters] = useState<TransactionScopeFilters>({});

  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus | null>(null);

  const dateRanges = useMemo(() => {
    const now = new Date();
    switch (timeRange) {
      case 'week':
        return {
          start: format(subDays(now, 7), 'yyyy-MM-dd'),
          end: format(now, 'yyyy-MM-dd'),
        };
      case 'month':
        return {
          start: format(startOfMonth(now), 'yyyy-MM-dd'),
          end: format(endOfMonth(now), 'yyyy-MM-dd'),
        };
      case 'year':
        return {
          start: format(subMonths(now, 12), 'yyyy-MM-dd'),
          end: format(now, 'yyyy-MM-dd'),
        };
      case 'custom':
        return {
          start: customStartDate || format(startOfMonth(now), 'yyyy-MM-dd'),
          end: customEndDate || format(now, 'yyyy-MM-dd'),
        };
      default:
        return {
          start: format(startOfMonth(now), 'yyyy-MM-dd'),
          end: format(endOfMonth(now), 'yyyy-MM-dd'),
        };
    }
  }, [timeRange, customStartDate, customEndDate]);

  const selectedRangeDayCount = useMemo(() => {
    const start = new Date(dateRanges.start);
    const end = new Date(dateRanges.end);
    const days = differenceInCalendarDays(end, start) + 1;
    return Number.isFinite(days) && days > 0 ? days : 1;
  }, [dateRanges.end, dateRanges.start]);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const [recent, summary, charts] = await Promise.all([
          getRecentTransactions(recentTransactionsLimit, scopeFilters),
          getDashboardSummary(dateRanges.start, dateRanges.end, scopeFilters),
          getChartData(dateRanges.start, dateRanges.end, scopeFilters),
        ]);
        if (!cancelled) {
          setRecentTransactions(recent);
          setDashboardSummary(summary);
          setChartData(charts);
        }
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, [transactionVersion, dateRanges, recentTransactionsLimit, scopeFilters, getRecentTransactions, getDashboardSummary, getChartData]);

  useEffect(() => {
    let cancelled = false;
    getBudgetStatus({ type: 'month', key: format(new Date(), 'yyyy-MM') })
      .then((nextStatus) => {
        if (!cancelled) setBudgetStatus(nextStatus);
      })
      .catch((err) => console.error('Failed to load budget status:', err));
    return () => { cancelled = true; };
  }, [budgetVersion, transactionVersion, getBudgetStatus]);

  const handleExportDatabase = async () => {
    const dbData = await exportDatabase();
    if (dbData) {
      const blob = new Blob([dbData as any], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `budget-tracker-${format(new Date(), 'yyyy-MM-dd')}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const getTimeRangeLabel = () => {
    switch (timeRange) {
      case 'week': return 'This Week';
      case 'month': return 'This Month';
      case 'year': return 'This Year';
      case 'custom': return `${format(new Date(dateRanges.start), 'MMM dd, yyyy')} - ${format(new Date(dateRanges.end), 'MMM dd, yyyy')}`;
      default: return 'This Month';
    }
  };

  const handleCustomDateChange = (start: string, end: string) => {
    setCustomStartDate(start);
    setCustomEndDate(end);
  };

  return (
    <Box sx={{ flexGrow: 1, p: { xs: 2, sm: 3 } }}>
      <DateRangeSelector
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        customStartDate={customStartDate}
        customEndDate={customEndDate}
        onCustomDateChange={handleCustomDateChange}
        onExport={handleExportDatabase}
        onAddTransaction={() => setAddTransactionOpen(true)}
        onCsvImport={() => setCsvImportOpen(true)}
        accounts={accounts}
        users={users}
        scopeFilters={scopeFilters}
        onScopeFiltersChange={setScopeFilters}
      />

      <SummaryStats
        summary={dashboardSummary}
        chartData={chartData}
        timeRangeLabel={getTimeRangeLabel()}
        dayCount={selectedRangeDayCount}
      />

      <BudgetStatusCard
        status={budgetStatus}
        onManageBudget={() => onNavigateToBudget?.()}
      />

      <ChartsSection
        chartData={chartData}
        accounts={accounts}
        users={users}
        timeRangeLabel={getTimeRangeLabel()}
      />

      <RecentTransactions
        transactions={recentTransactions}
        limit={recentTransactionsLimit}
        onLimitChange={setRecentTransactionsLimit}
        onSetComment={setTransactionComment}
      />

      <AddTransaction
        open={addTransactionOpen}
        onClose={() => setAddTransactionOpen(false)}
        onSuccess={() => setAddTransactionOpen(false)}
      />

      <CSVImport
        open={csvImportOpen}
        onClose={() => setCsvImportOpen(false)}
        onSuccess={() => setCsvImportOpen(false)}
      />
    </Box>
  );
};

export default Dashboard;
