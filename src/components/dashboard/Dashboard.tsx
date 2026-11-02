'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useDashboardSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { format, parseISO, subDays, subMonths, startOfMonth, endOfMonth, differenceInCalendarDays } from 'date-fns';
import { accountCurrencies } from '@/lib/currencies';
import { todayLocalISO } from '@/lib/dateOnly';
import NotificationsDashboardCard from '@/components/notifications/NotificationsDashboardCard';
import DateRangeSelector from './DateRangeSelector';
import SummaryStats from './SummaryStats';
import ChartsSection from './ChartsSection';
import RecentTransactions from './RecentTransactions';
import { BudgetStatusCard } from './BudgetStatusCard';
import MissingRatesNotice from './MissingRatesNotice';
import type { Transaction, DashboardSummary, ChartData, BudgetStatus, TransactionScopeFilters } from '@/types/database';

interface DashboardProps {
  onNavigateToBudget?: () => void;
  onNavigateToSettings?: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigateToBudget, onNavigateToSettings }) => {
  const { t } = useTranslation('dashboard');
  const { date } = useFormatters();
  const {
    transactionVersion,
    budgetVersion,
    accounts,
    users,
    defaultCurrency,
    getRecentTransactions,
    getDashboardSummary,
    getChartData,
    setTransactionComment,
    getBudgetStatus,
  } = useDashboardSlice();

  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'year' | 'custom'>('month');
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

  // Days of the selected range that have actually elapsed. The Month range runs
  // to month end, and dividing spend by days that have not happened yet would
  // understate the daily average for most of the month.
  const elapsedDayCount = useMemo(() => {
    const today = todayLocalISO();
    const effectiveEnd = dateRanges.end < today ? dateRanges.end : today;
    const days = differenceInCalendarDays(parseISO(effectiveEnd), parseISO(dateRanges.start)) + 1;
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

  const getTimeRangeLabel = () => {
    switch (timeRange) {
      case 'week': return t('timeRangeLabel.week');
      case 'month': return t('timeRangeLabel.month');
      case 'year': return t('timeRangeLabel.year');
      case 'custom': return t('timeRangeLabel.customRange', { start: date(dateRanges.start), end: date(dateRanges.end) });
      default: return t('timeRangeLabel.month');
    }
  };

  // More than one account currency means the summary figures were converted
  // into the default currency; say so once above the stat cards.
  const showTotalsIn = useMemo(() => accountCurrencies(accounts).length > 1, [accounts]);

  const handleCustomDateChange = (start: string, end: string) => {
    setCustomStartDate(start);
    setCustomEndDate(end);
  };

  // Categories with a threshold in this month's effective budget plan —
  // drives the Budget chip in the Recent Transactions indicators column.
  const budgetedCategoryIds = useMemo(
    () => new Set((budgetStatus?.categories ?? []).map((category) => category.category_id)),
    [budgetStatus]
  );

  return (
    <Box sx={{ flexGrow: 1, p: { xs: 1.5, sm: 2, md: 2.5 } }}>
      <DateRangeSelector
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        customStartDate={customStartDate}
        customEndDate={customEndDate}
        onCustomDateChange={handleCustomDateChange}
        accounts={accounts}
        users={users}
        scopeFilters={scopeFilters}
        onScopeFiltersChange={setScopeFilters}
      />

      <MissingRatesNotice onOpenPreferences={onNavigateToSettings} />

      {showTotalsIn && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }} data-testid="dashboard-totals-in">
          {t('totalsIn', { code: defaultCurrency })}
        </Typography>
      )}

      <SummaryStats
        summary={dashboardSummary}
        chartData={chartData}
        timeRangeLabel={getTimeRangeLabel()}
        dayCount={elapsedDayCount}
      />

      {/* Slot owned by the notifications feature; renders nothing while there is nothing due. */}
      <NotificationsDashboardCard />

      {(!budgetStatus || budgetStatus.budgetedTotal == null) && (
        <BudgetStatusCard
          status={budgetStatus}
          onManageBudget={() => onNavigateToBudget?.()}
        />
      )}

      <ChartsSection
        chartData={chartData}
        accounts={accounts}
        users={users}
        timeRangeLabel={getTimeRangeLabel()}
        budgetStatus={budgetStatus}
        onManageBudget={() => onNavigateToBudget?.()}
      />

      <RecentTransactions
        transactions={recentTransactions}
        limit={recentTransactionsLimit}
        onLimitChange={setRecentTransactionsLimit}
        onSetComment={setTransactionComment}
        budgetedCategoryIds={budgetedCategoryIds}
      />
    </Box>
  );
};

export default Dashboard;
