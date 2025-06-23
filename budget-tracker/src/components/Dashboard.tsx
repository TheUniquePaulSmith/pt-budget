'use client';

import React, { useState, useMemo } from 'react';
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
} from '@mui/icons-material';
import { PieChart } from '@mui/x-charts/PieChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import { useDatabaseContext } from '../contexts/DatabaseContext';
import { format, subDays, subMonths, startOfMonth, endOfMonth, parseISO } from 'date-fns';
import AddTransaction from './AddTransaction';
import CSVImport from './CSVImport';
import ManageData from './ManageData';

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
    getTransactionsByDateRange,
    getSpendingByCategory,
    getIncomeByCategory,
    getMonthlyTrends,
    exportDatabase,
    refreshTransactions,
  } = useDatabaseContext();
  const [tabValue, setTabValue] = useState(0);
  const [timeRange, setTimeRange] = useState<'week' | 'month' | 'year'>('month');  const [addTransactionOpen, setAddTransactionOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [manageDataOpen, setManageDataOpen] = useState(false);

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
      default:
        return {
          start: format(startOfMonth(now), 'yyyy-MM-dd'),
          end: format(endOfMonth(now), 'yyyy-MM-dd'),
        };
    }
  }, [timeRange]);

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const periodTransactions = getTransactionsByDateRange(dateRanges.start, dateRanges.end);
    
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
  }, [getTransactionsByDateRange, dateRanges]);

  // Chart data
  const spendingData = useMemo(() => {
    const data = getSpendingByCategory(dateRanges.start, dateRanges.end);
    return data.map((item, index) => ({
      id: index,
      value: item.total,
      label: item.category_name,
      color: item.color,
    }));
  }, [getSpendingByCategory, dateRanges]);

  const incomeData = useMemo(() => {
    const data = getIncomeByCategory(dateRanges.start, dateRanges.end);
    return data.map((item, index) => ({
      id: index,
      value: item.total,
      label: item.category_name,
      color: item.color,
    }));
  }, [getIncomeByCategory, dateRanges]);

  const trendsData = useMemo(() => {
    const data = getMonthlyTrends(6);
    return {
      xAxis: data.map(item => item.month),
      income: data.map(item => item.income),
      expenses: data.map(item => item.expense),
    };
  }, [getMonthlyTrends]);

  const handleExportDatabase = () => {
    const dbData = exportDatabase();
    if (dbData) {
      const blob = new Blob([dbData], { type: 'application/octet-stream' });
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
      default: return 'This Month';
    }
  };

  return (
    <Box sx={{ flexGrow: 1, p: 3 }}>
      {/* Header */}
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={3}>
        <Typography variant="h4" component="h1" fontWeight="bold">
          Financial Dashboard
        </Typography>        <Stack direction="row" spacing={2}>
          <Button
            variant="outlined"
            startIcon={<Settings />}
            onClick={() => setManageDataOpen(true)}
          >
            Manage Data
          </Button>
          <Button
            variant="outlined"
            startIcon={<Download />}
            onClick={handleExportDatabase}
          >
            Export Data
          </Button>
          <Button
            variant="outlined"
            startIcon={<Upload />}
            onClick={() => setCsvImportOpen(true)}
          >
            Import CSV
          </Button>
          <Button 
            variant="contained" 
            startIcon={<Add />}
            onClick={() => setAddTransactionOpen(true)}
          >
            Add Transaction
          </Button>
        </Stack>
      </Box>

      {/* Time Range Selector */}
      <Box mb={3}>
        <Stack direction="row" spacing={1} alignItems="center">
          <DateRange color="action" />
          <Typography variant="body1" color="text.secondary" mr={2}>
            Time Period:
          </Typography>
          {(['week', 'month', 'year'] as const).map((range) => (
            <Chip
              key={range}
              label={range === 'week' ? 'Week' : range === 'month' ? 'Month' : 'Year'}
              variant={timeRange === range ? 'filled' : 'outlined'}
              color={timeRange === range ? 'primary' : 'default'}
              onClick={() => setTimeRange(range)}
            />
          ))}
        </Stack>
      </Box>      {/* Summary Stats */}
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
        </Box>
        <Box flex="1 1 300px">
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
            {spendingData.length > 0 ? (
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
            {incomeData.length > 0 ? (
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
            {trendsData.xAxis.length > 0 ? (
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
      </Paper>

      {/* Recent Transactions */}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" gutterBottom>
          Recent Transactions
        </Typography>
        {transactions.length > 0 ? (
          <Box>
            {transactions.slice(0, 5).map((transaction) => {
              const category = categories.find(c => c.id === transaction.category_id);
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
                      {format(parseISO(transaction.date), 'MMM dd, yyyy')} • {category?.name}
                    </Typography>
                  </Box>
                  <Typography
                    variant="h6"
                    color={transaction.type === 'income' ? 'success.main' : 'error.main'}
                    fontWeight="bold"
                  >
                    {transaction.type === 'income' ? '+' : '-'}{formatCurrency(transaction.amount)}
                  </Typography>
                </Box>
              );
            })}
            <Box mt={2}>
              <Button variant="outlined" fullWidth>
                View All Transactions
              </Button>
            </Box>
          </Box>
        ) : (
          <Box display="flex" justifyContent="center" alignItems="center" height={200}>
            <Typography color="text.secondary">
              No transactions found. Add your first transaction to get started!
            </Typography>
          </Box>
        )}      </Paper>

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

      {/* Manage Data Modal */}
      <ManageData
        open={manageDataOpen}
        onClose={() => setManageDataOpen(false)}
      />
    </Box>
  );
};

export default Dashboard;
