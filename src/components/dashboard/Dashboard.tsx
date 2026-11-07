'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useDashboardSlice } from '@/contexts/useDatabaseSlices';
import { format, parseISO, differenceInCalendarDays } from 'date-fns';
import { accountCurrencies } from '@/lib/currencies';
import { todayLocalISO } from '@/lib/dateOnly';
import NotificationsDashboardCard from '@/components/notifications/NotificationsDashboardCard';
import PeriodFilter, { useCurrentPeriodLabel } from '@/components/common/Filters/PeriodFilter';
import {
  ScopeFilterChips,
  ScopeFilterSection,
  hasActiveScopeFilters,
  useScopeFilters,
} from '@/components/common/Filters/ScopeFilters';
import { periodDateRange, weekStartsOnFor, type BoundedPeriod, type Period } from '@/lib/periodRange';
import SummaryStats from './SummaryStats';
import ChartsSection from './ChartsSection';
import RecentTransactions from './RecentTransactions';
import { BudgetStatusCard } from './BudgetStatusCard';
import MissingRatesNotice from './MissingRatesNotice';
import type { Transaction, DashboardSummary, ChartData, BudgetStatus } from '@/types/database';

const DEFAULT_DASHBOARD_PERIOD: BoundedPeriod = 'thisMonth';

// Explicit px: in `sx`, a bare 1 means 100%.
const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  margin: '-1px',
  padding: 0,
  border: 0,
} as const;

interface DashboardProps {
  onNavigateToBudget?: () => void;
  onNavigateToSettings?: () => void;
}

const Dashboard: React.FC<DashboardProps> = ({ onNavigateToBudget, onNavigateToSettings }) => {
  const { t, i18n } = useTranslation('dashboard');
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

  const [timeRange, setTimeRange] = useState<BoundedPeriod>(DEFAULT_DASHBOARD_PERIOD);
  const [recentTransactionsLimit, setRecentTransactionsLimit] = useState(10);
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const { scopeFilters, setScopeFilters } = useScopeFilters();

  const [recentTransactions, setRecentTransactions] = useState<Transaction[]>([]);
  const [dashboardSummary, setDashboardSummary] = useState<DashboardSummary | null>(null);
  const [chartData, setChartData] = useState<ChartData | null>(null);
  const [budgetStatus, setBudgetStatus] = useState<BudgetStatus | null>(null);

  const weekStartsOn = useMemo(() => weekStartsOnFor(i18n.language), [i18n.language]);
  const dateRanges = useMemo(
    () => periodDateRange(timeRange, new Date(), { weekStartsOn, customStart: customStartDate, customEnd: customEndDate }),
    [timeRange, weekStartsOn, customStartDate, customEndDate]
  );

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

  const periodLabel = useCurrentPeriodLabel(timeRange, customStartDate, customEndDate);

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
      {/* The app bar shows the page name; this heading stays for screen readers only. */}
      <Typography component="h1" sx={visuallyHidden}>
        {t('dateRangeSelector.title')}
      </Typography>

      {/* Renders its Filter button into the app bar (page-actions slot). The
          account/user scope is shared with Subscriptions through the shell. */}
      <PeriodFilter
        period={timeRange}
        // The Dashboard offers no "All time", so only bounded periods come back.
        onPeriodChange={(next: Period) => setTimeRange(next === 'all' ? DEFAULT_DASHBOARD_PERIOD : next)}
        customStart={customStartDate}
        customEnd={customEndDate}
        onCustomDateChange={handleCustomDateChange}
        title={t('dateRangeSelector.filterTitle')}
        defaultPeriod={DEFAULT_DASHBOARD_PERIOD}
        hasOtherActiveFilters={hasActiveScopeFilters(scopeFilters)}
        onResetOther={() => setScopeFilters({})}
        testIdPrefix="dashboard-filter"
      >
        <ScopeFilterSection accounts={accounts} users={users} scopeFilters={scopeFilters} onChange={setScopeFilters} />
      </PeriodFilter>

      {/* While active, the account/user filters stay visible and removable in the status bar. */}
      <ScopeFilterChips scopeFilters={scopeFilters} onChange={setScopeFilters} />

      <MissingRatesNotice onOpenPreferences={onNavigateToSettings} />

      {showTotalsIn && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }} data-testid="dashboard-totals-in">
          {t('totalsIn', { code: defaultCurrency })}
        </Typography>
      )}

      <SummaryStats
        summary={dashboardSummary}
        chartData={chartData}
        timeRangeLabel={periodLabel}
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
        timeRangeLabel={periodLabel}
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
