'use client';

import React, { useState, useMemo, useRef } from 'react';
import {
  Box,
  Grid,
  Card,
  CardContent,
  Typography,
  Paper,
  Tab,
  Tabs,
  IconButton,
  Chip,
  Stack,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import {
  TrendingUp,
  TrendingDown,
  AccountBalanceWallet,
  DateRange,
  Add,
  Upload,
  Download,
  Settings,
  Save,
  Close,
} from '@mui/icons-material';
import { PieChart } from '@mui/x-charts/PieChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import { useDatabaseContext } from '@/contexts/DatabaseContext';
import { format, subDays, subMonths, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import AddTransaction from './AddTransaction';
import CSVImport from './CSVImport';
import { ANALYTICS_QUERIES } from '@/lib/sqlQueries';
import { databaseWorkerService } from '@/lib/databaseWorkerService';

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

interface StatCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: 'primary' | 'success' | 'error' | 'warning';
  subtitle?: string;
}

const StatCard: React.FC<StatCardProps> = ({ title, value, icon, color, subtitle }) => (
  <Card sx={{ height: '100%' }}>
    <CardContent>
      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Box>
          <Typography variant="h4" color={`${color}.main`} fontWeight="bold">
            {value}
          </Typography>
          <Typography variant="h6" color="text.primary" gutterBottom>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        <Box
          sx={{
            backgroundColor: `${color}.light`,
            borderRadius: 2,
            p: 1.5,
            color: `${color}.main`,
          }}
        >
          {icon}
        </Box>
      </Box>
    </CardContent>
  </Card>
);

const Dashboard: React.FC = () => {  
  const {
    transactions,
    categories,
    accounts,
    exportDatabase,
    refreshTransactions,
    isDatabaseLoaded,
  } = useDatabaseContext();
  
  const [tabValue, setTabValue] = useState(0);
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'year' | 'custom'>('month');  
  const [addTransactionOpen, setAddTransactionOpen] = useState(false);  
  const [csvImportOpen, setCsvImportOpen] = useState(false);  
  const [recentTransactionsLimit, setRecentTransactionsLimit] = useState(10);
  const [customDateRangeOpen, setCustomDateRangeOpen] = useState(false);
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

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    // Filter transactions by date range
    const startDate = new Date(dateRanges.start);
    const endDate = new Date(dateRanges.end);
    
    const periodTransactions = transactions.filter(t => {
      const transactionDate = new Date(t.date);
      return transactionDate >= startDate && transactionDate <= endDate;
    });
    
    const totalIncome = periodTransactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
    
    const totalExpenses = periodTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + t.amount, 0);
    
    const netIncome = totalIncome - totalExpenses;
    
    return {
      totalIncome,
      totalExpenses,
      netIncome,
      transactionCount: periodTransactions.length,
    };
  }, [transactions, dateRanges]);

  // Chart data - Load ALL data from database once, then filter in memory
  const [allSpendingData, setAllSpendingData] = useState<any[]>([]);
  const [allIncomeData, setAllIncomeData] = useState<any[]>([]);
  const [allTrendsData, setAllTrendsData] = useState<{ xAxis: string[], income: number[], expenses: number[] }>({
    xAxis: [],
    income: [],
    expenses: [],
  });
  const [chartsLoading, setChartsLoading] = useState(false);

  // Load ALL chart data once when database loads (no date filters)
  React.useEffect(() => {
    if (!isDatabaseLoaded) return;

    const loadChartData = async () => {
      setChartsLoading(true);
      try {
        // Load ALL spending by category (no date filter - use '1900-01-01' to '2100-12-31')
        const spendingResults = await databaseWorkerService.query(
          ANALYTICS_QUERIES.SPENDING_BY_CATEGORY,
          ['1900-01-01', '2100-12-31']
        );
        const formattedSpending = spendingResults.map((row: any) => ({
          id: row.category_id,
          label: row.category_name,
          value: Math.abs(row.total),
          color: row.color,
          // Store raw transaction data for filtering
          category_id: row.category_id,
          category_name: row.category_name,
        }));
        setAllSpendingData(formattedSpending);

        // Load ALL income by category
        const incomeResults = await databaseWorkerService.query(
          ANALYTICS_QUERIES.INCOME_BY_CATEGORY,
          ['1900-01-01', '2100-12-31']
        );
        const formattedIncome = incomeResults.map((row: any) => ({
          id: row.category_id,
          label: row.category_name,
          value: row.total,
          color: row.color,
          category_id: row.category_id,
          category_name: row.category_name,
        }));
        setAllIncomeData(formattedIncome);

        // Load monthly trends (last 12 months for more data)
        const trendsResults = await databaseWorkerService.query(
          ANALYTICS_QUERIES.MONTHLY_TRENDS,
          ['-12']
        );
        // Reverse to show oldest to newest
        const reversedTrends = trendsResults.reverse();
        setAllTrendsData({
          xAxis: reversedTrends.map((row: any) => row.month),
          income: reversedTrends.map((row: any) => row.income || 0),
          expenses: reversedTrends.map((row: any) => row.expense || 0),
        });
      } catch (error) {
        console.error('Failed to load chart data:', error);
      } finally {
        setChartsLoading(false);
      }
    };

    loadChartData();
  }, [isDatabaseLoaded]);
  
  // Filter chart data in memory based on selected date range
  const spendingData = useMemo(() => {
    const startDate = new Date(dateRanges.start);
    const endDate = new Date(dateRanges.end);
    
    // Group transactions by category for the selected period
    const categoryTotals = new Map<number, { label: string; value: number; color: string }>();
    
    transactions
      .filter(t => {
        const tDate = new Date(t.date);
        return t.type === 'expense' && tDate >= startDate && tDate <= endDate;
      })
      .forEach(t => {
        if (!t.category_id) return;
        const categoryId = Number(t.category_id);
        const category = categories.find(c => Number(c.id) === categoryId);
        const existing = categoryTotals.get(categoryId);
        if (existing) {
          categoryTotals.set(categoryId, {
            ...existing,
            value: existing.value + Math.abs(t.amount),
          });
        } else {
          categoryTotals.set(categoryId, {
            label: category?.name || t.category_name || 'Unknown',
            value: Math.abs(t.amount),
            color: category?.color || '#999',
          });
        }
      });
    
    return Array.from(categoryTotals.entries()).map(([id, data]) => ({
      id,
      ...data,
    }));
  }, [transactions, dateRanges, categories]);

  const incomeData = useMemo(() => {
    const startDate = new Date(dateRanges.start);
    const endDate = new Date(dateRanges.end);
    
    const categoryTotals = new Map<number, { label: string; value: number; color: string }>();
    
    transactions
      .filter(t => {
        const tDate = new Date(t.date);
        return t.type === 'income' && tDate >= startDate && tDate <= endDate;
      })
      .forEach(t => {
        if (!t.category_id) return;
        const categoryId = Number(t.category_id);
        const category = categories.find(c => Number(c.id) === categoryId);
        const existing = categoryTotals.get(categoryId);
        if (existing) {
          categoryTotals.set(categoryId, {
            ...existing,
            value: existing.value + t.amount,
          });
        } else {
          categoryTotals.set(categoryId, {
            label: category?.name || t.category_name || 'Unknown',
            value: t.amount,
            color: category?.color || '#999',
          });
        }
      });
    
    return Array.from(categoryTotals.entries()).map(([id, data]) => ({
      id,
      ...data,
    }));
  }, [transactions, dateRanges, categories]);

  const trendsData = useMemo(() => {
    // For trends, show last 6 months from the end date
    const endDate = new Date(dateRanges.end);
    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - 6);
    
    // Group by month
    const monthlyData = new Map<string, { income: number; expenses: number }>();
    
    transactions
      .filter(t => {
        const tDate = new Date(t.date);
        return tDate >= startDate && tDate <= endDate;
      })
      .forEach(t => {
        const monthKey = format(new Date(t.date), 'yyyy-MM');
        const existing = monthlyData.get(monthKey) || { income: 0, expenses: 0 };
        if (t.type === 'income') {
          existing.income += t.amount;
        } else {
          existing.expenses += Math.abs(t.amount);
        }
        monthlyData.set(monthKey, existing);
      });
    
    // Sort by month and create arrays
    const sortedMonths = Array.from(monthlyData.keys()).sort();
    
    return {
      xAxis: sortedMonths,
      income: sortedMonths.map(m => monthlyData.get(m)?.income || 0),
      expenses: sortedMonths.map(m => monthlyData.get(m)?.expenses || 0),
    };
  }, [transactions, dateRanges]);

  const handleExportDatabase = async () => {
    const dbData = await exportDatabase();
    if (dbData) {
      // Create blob from Uint8Array - cast to any to work around TypeScript strictness
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

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
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

  const handleTimeRangeChange = (range: 'week' | 'month' | 'year' | 'custom') => {
    setTimeRange(range);
    if (range === 'custom') {
      setCustomDateRangeOpen(true);
    }
  };

  const handleCustomDateApply = () => {
    if (customStartDate && customEndDate) {
      setCustomDateRangeOpen(false);
    }
  };

  return (
    <Box sx={{ flexGrow: 1, p: { xs: 2, sm: 3 } }}>
      {/* Header */}
      <Box 
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: { xs: 'stretch', sm: 'center' },
          mb: 3,
          gap: { xs: 2, sm: 0 }
        }}
      >
        <Box>
          <Typography 
            variant="h4" 
            component="h1" 
            fontWeight="bold"
            sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}
          >
            Budget Insights
          </Typography>
        </Box>
          <Stack 
          direction={{ xs: 'column', sm: 'row' }} 
          spacing={{ xs: 1, sm: 2 }}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          <Button
            variant="outlined"
            startIcon={<Download />}
            onClick={handleExportDatabase}
            size="small"
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            Export Data
          </Button>
          <Button
            variant="outlined"
            startIcon={<Upload />}
            onClick={() => setCsvImportOpen(true)}
            size="small"
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            Import CSV
          </Button>
          <Button 
            variant="contained" 
            startIcon={<Add />}
            onClick={() => setAddTransactionOpen(true)}
            size="small"
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            Add Transaction
          </Button>
        </Stack>
      </Box>      {/* Time Range Selector */}
      <Box mb={3}>
        <Stack 
          direction={{ xs: 'column', sm: 'row' }} 
          spacing={{ xs: 1, sm: 1 }} 
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          sx={{ gap: { xs: 1, sm: 2 } }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <DateRange color="action" />
            <Typography variant="body1" color="text.secondary">
              Time Period:
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {(['week', 'month', 'year', 'custom'] as const).map((range) => (
              <Chip
                key={range}
                label={range === 'week' ? 'Week' : range === 'month' ? 'Month' : range === 'year' ? 'Year' : 'Custom'}
                variant={timeRange === range ? 'filled' : 'outlined'}
                color={timeRange === range ? 'primary' : 'default'}
                onClick={() => handleTimeRangeChange(range)}
                size="small"
              />
            ))}
          </Box>
        </Stack>
      </Box>{/* Summary Stats */}
      <Box display="flex" flexWrap="wrap" gap={3} mb={4}>
        <Box flex="1 1 300px">
          <StatCard
            title="Total Income"
            value={formatCurrency(summaryStats.totalIncome)}
            icon={<TrendingUp />}
            color="success"
            subtitle={getTimeRangeLabel()}
          />
        </Box>
        <Box flex="1 1 300px">
          <StatCard
            title="Total Expenses"
            value={formatCurrency(summaryStats.totalExpenses)}
            icon={<TrendingDown />}
            color="error"
            subtitle={getTimeRangeLabel()}
          />
        </Box>
        <Box flex="1 1 300px">
          <StatCard
            title="Net Income"
            value={formatCurrency(summaryStats.netIncome)}
            icon={<AccountBalanceWallet />}
            color={summaryStats.netIncome >= 0 ? 'success' : 'error'}
            subtitle={getTimeRangeLabel()}
          />
        </Box>        <Box flex="1 1 300px">
          <StatCard
            title="Transactions"
            value={summaryStats.transactionCount.toString()}
            icon={<DateRange />}
            color="primary"
            subtitle={getTimeRangeLabel()}
          />
        </Box>
      </Box>

      {/* Charts Section */}
      <Paper sx={{ width: '100%', mb: 4 }}>
        <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
            <Tab label="Spending Breakdown" />
            <Tab label="Income Sources" />
            <Tab label="Trends" />
          </Tabs>
        </Box>

        <TabPanel value={tabValue} index={0}>
          <Box p={3}>
            <Typography variant="h6" gutterBottom>
              Spending by Category - {getTimeRangeLabel()}
            </Typography>
            {chartsLoading ? (
              <Box display="flex" justifyContent="center" alignItems="center" height={400}>
                <Typography color="text.secondary">Loading chart data...</Typography>
              </Box>
            ) : spendingData.length > 0 ? (
              <Box height={400} display="flex" justifyContent="center">
                <PieChart
                  series={[                    {
                      data: spendingData,
                      highlightScope: { fade: 'global', highlight: 'item' },
                      faded: { innerRadius: 30, additionalRadius: -30, color: 'gray' },
                    },
                  ]}
                  width={600}
                  height={400}
                />
              </Box>
            ) : (
              <Box display="flex" justifyContent="center" alignItems="center" height={200}>
                <Typography color="text.secondary">
                  No spending data for this period
                </Typography>
              </Box>
            )}
          </Box>
        </TabPanel>

        <TabPanel value={tabValue} index={1}>
          <Box p={3}>
            <Typography variant="h6" gutterBottom>
              Income by Source - {getTimeRangeLabel()}
            </Typography>
            {chartsLoading ? (
              <Box display="flex" justifyContent="center" alignItems="center" height={400}>
                <Typography color="text.secondary">Loading chart data...</Typography>
              </Box>
            ) : incomeData.length > 0 ? (
              <Box height={400} display="flex" justifyContent="center">
                <PieChart
                  series={[                    {
                      data: incomeData,
                      highlightScope: { fade: 'global', highlight: 'item' },
                      faded: { innerRadius: 30, additionalRadius: -30, color: 'gray' },
                    },
                  ]}
                  width={600}
                  height={400}
                />
              </Box>
            ) : (
              <Box display="flex" justifyContent="center" alignItems="center" height={200}>
                <Typography color="text.secondary">
                  No income data for this period
                </Typography>
              </Box>
            )}
          </Box>
        </TabPanel>

        <TabPanel value={tabValue} index={2}>
          <Box p={3}>
            <Typography variant="h6" gutterBottom>
              Income vs Expenses Trend (Last 6 Months)
            </Typography>
            {chartsLoading ? (
              <Box display="flex" justifyContent="center" alignItems="center" height={400}>
                <Typography color="text.secondary">Loading chart data...</Typography>
              </Box>
            ) : trendsData.xAxis.length > 0 ? (
              <Box height={400}>
                <LineChart
                  width={800}
                  height={400}
                  series={[
                    {
                      data: trendsData.income,
                      label: 'Income',
                      color: '#4caf50',
                    },
                    {
                      data: trendsData.expenses,
                      label: 'Expenses',
                      color: '#f44336',
                    },
                  ]}
                  xAxis={[{ 
                    scaleType: 'point', 
                    data: trendsData.xAxis,
                  }]}
                  margin={{ top: 20, right: 20, bottom: 20, left: 60 }}
                />
              </Box>
            ) : (
              <Box display="flex" justifyContent="center" alignItems="center" height={200}>
                <Typography color="text.secondary">
                  No trend data available
                </Typography>
              </Box>
            )}
          </Box>
        </TabPanel>
      </Paper>      {/* Recent Transactions */}
      <Paper sx={{ p: 3 }}>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6">
            Recent Transactions
          </Typography>
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Show</InputLabel>
            <Select
              value={recentTransactionsLimit}
              label="Show"
              onChange={(e) => setRecentTransactionsLimit(Number(e.target.value))}
            >
              <MenuItem value={10}>Last 10</MenuItem>
              <MenuItem value={25}>Last 25</MenuItem>
              <MenuItem value={50}>Last 50</MenuItem>
              <MenuItem value={100}>Last 100</MenuItem>
            </Select>
          </FormControl>
        </Box>
        {transactions.length > 0 ? (
          <Box>
            {transactions.slice(0, recentTransactionsLimit).map((transaction) => {
              return (
                <Box
                  key={transaction.id}
                  display="flex"
                  justifyContent="space-between"
                  alignItems="center"
                  py={2}
                  borderBottom={1}
                  borderColor="divider"
                >
                  <Box>
                    <Typography variant="body1" fontWeight="medium">
                      {transaction.description}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {format(parseISO(transaction.date), 'MMM dd, yyyy')} • {transaction.category_name || 'Uncategorized'} • {transaction.account_name || 'Unknown Account'}
                    </Typography>
                  </Box>
                  <Typography
                    variant="h6"
                    color={transaction.type === 'income' ? 'success.main' : 'error.main'}
                    fontWeight="bold"
                  >
                    {formatCurrency(transaction.amount)}
                  </Typography>
                </Box>
              );
            })}
            {transactions.length > recentTransactionsLimit && (
              <Box mt={2}>                <Typography variant="body2" color="text.secondary" textAlign="center">
                  Showing {recentTransactionsLimit} of {transactions.length} transactions. 
                  Use the &quot;Transaction Report&quot; tab for advanced filtering and search.
                </Typography>
              </Box>
            )}
          </Box>
        ) : (
          <Box display="flex" justifyContent="center" alignItems="center" height={200}>
            <Typography color="text.secondary">
              No transactions found. Add your first transaction to get started!
            </Typography>
          </Box>
        )}</Paper>

      {/* Add Transaction Modal */}
      <AddTransaction
        open={addTransactionOpen}
        onClose={() => setAddTransactionOpen(false)}
        onSuccess={() => {
          refreshTransactions();
          setAddTransactionOpen(false);
        }}
      />      {/* CSV Import Modal */}
      <CSVImport
        open={csvImportOpen}
        onClose={() => setCsvImportOpen(false)}
        onSuccess={() => {
          refreshTransactions();
          setCsvImportOpen(false);
        }}
      />

      {/* Custom Date Range Picker Dialog */}
      <Dialog open={customDateRangeOpen} onClose={() => setCustomDateRangeOpen(false)}>
        <DialogTitle>Select Custom Date Range</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2, minWidth: 300 }}>
            <TextField
              label="Start Date"
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="End Date"
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomDateRangeOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleCustomDateApply} 
            variant="contained"
            disabled={!customStartDate || !customEndDate}
          >
            Apply
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default Dashboard;
