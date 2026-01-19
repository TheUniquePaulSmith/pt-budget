'use client';

import React, { useState, useMemo, useRef } from 'react';
import { Box } from '@mui/material';
import { useDatabaseContext } from '@/contexts/DatabaseContext';
import { format, subDays, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import AddTransaction from '@/components/transactions/AddTransaction';
import CSVImport from '@/components/csv-import/CSVImport';
import DateRangeSelector from './DateRangeSelector';
import SummaryStats from './SummaryStats';
import ChartsSection from './ChartsSection';
import RecentTransactions from './RecentTransactions';

const Dashboard: React.FC = () => {  
  const {
    transactions,
    categories,
    accounts,
    users,
    exportDatabase,
    refreshTransactions,
    isDatabaseLoaded,
  } = useDatabaseContext();
  
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'year' | 'custom'>('month');  
  const [addTransactionOpen, setAddTransactionOpen] = useState(false);  
  const [csvImportOpen, setCsvImportOpen] = useState(false);  
  const [recentTransactionsLimit, setRecentTransactionsLimit] = useState(10);
  const [customStartDate, setCustomStartDate] = useState<string>('');
  const [customEndDate, setCustomEndDate] = useState<string>('');
  const loadingRef = useRef(false);

  // Refresh transactions when database is loaded
  React.useEffect(() => {
    if (isDatabaseLoaded && !loadingRef.current) {
      loadingRef.current = true;
      console.debug('Database loaded, refreshing transactions');
      refreshTransactions();
    }
  }, [isDatabaseLoaded, refreshTransactions]);

  // Calculate date ranges
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

  const handleExportDatabase = async () => {
    const dbData = await exportDatabase();
    if (dbData) {
      const blob = new Blob([dbData as any], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `budget-tracker-${format(new Date(), 'yyyy-MM-dd')}.db`;
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
      {/* Header & Time Range Selector */}
      <DateRangeSelector
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        customStartDate={customStartDate}
        customEndDate={customEndDate}
        onCustomDateChange={handleCustomDateChange}
        onExport={handleExportDatabase}
        onAddTransaction={() => setAddTransactionOpen(true)}
        onCsvImport={() => setCsvImportOpen(true)}
      />

      {/* Summary Stats */}
      <SummaryStats
        transactions={transactions}
        dateRanges={dateRanges}
        timeRangeLabel={getTimeRangeLabel()}
      />

      {/* Charts Section */}
      <ChartsSection
        transactions={transactions}
        categories={categories}
        accounts={accounts}
        users={users}
        dateRanges={dateRanges}
        timeRangeLabel={getTimeRangeLabel()}
      />

      {/* Recent Transactions */}
      <RecentTransactions
        transactions={transactions}
        limit={recentTransactionsLimit}
        onLimitChange={setRecentTransactionsLimit}
      />

      {/* Add Transaction Modal */}
      <AddTransaction
        open={addTransactionOpen}
        onClose={() => setAddTransactionOpen(false)}
        onSuccess={() => {
          refreshTransactions();
          setAddTransactionOpen(false);
        }}
      />

      {/* CSV Import Modal */}
      <CSVImport
        open={csvImportOpen}
        onClose={() => setCsvImportOpen(false)}
        onSuccess={() => {
          refreshTransactions();
          setCsvImportOpen(false);
        }}
      />
    </Box>
  );
};

export default Dashboard;
