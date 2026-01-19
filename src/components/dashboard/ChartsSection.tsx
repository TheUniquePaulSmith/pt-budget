'use client';

import React, { useState, useMemo } from 'react';
import { Box, Paper, Typography, Tabs, Tab } from '@mui/material';
import { PieChart } from '@mui/x-charts/PieChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import { Transaction, Category, User, Account } from '@/types/database';
import { format } from 'date-fns';

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
  transactions: Transaction[];
  categories: Category[];
  accounts: Account[];
  users: User[];
  dateRanges: { start: string; end: string };
  timeRangeLabel: string;
}

const ChartsSection: React.FC<ChartsSectionProps> = ({
  transactions,
  categories,
  accounts,
  users,
  dateRanges,
  timeRangeLabel,
}) => {
  const [tabValue, setTabValue] = useState(0);

  // Helper function to get user display name from account_id
  const getUserDisplayName = (accountId: number): string => {
    const account = accounts.find(a => a.id === accountId);
    if (!account) return 'Unknown User';
    
    const user = users.find(u => u.id === account.user_id);
    return user?.display_name || 'Unknown User';
  };

  // Spending by Category
  const spendingData = useMemo(() => {
    const startDate = new Date(dateRanges.start);
    const endDate = new Date(dateRanges.end);
    
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

  // Income by Source
  const incomeData = useMemo(() => {
    const startDate = new Date(dateRanges.start);
    const endDate = new Date(dateRanges.end);
    
    const incomeTotals = new Map<string, { label: string; value: number; color: string }>();
    
    transactions
      .filter(t => {
        const tDate = new Date(t.date);
        return t.type === 'income' && tDate >= startDate && tDate <= endDate;
      })
      .forEach(t => {
        const userName = getUserDisplayName(t.account_id);
        const accountName = t.account_name || 'Unknown Account';
        const categoryId = t.category_id ? Number(t.category_id) : null;
        const category = categoryId ? categories.find(c => Number(c.id) === categoryId) : null;
        const categoryName = category?.name || t.category_name || 'Not Defined';
        const categoryColor = category?.color || '#9E9E9E';
        
        const key = `${t.account_id}-${categoryId || 'undefined'}`;
        const label = `${userName} - ${accountName} - ${categoryName}`;
        
        const existing = incomeTotals.get(key);
        if (existing) {
          incomeTotals.set(key, {
            ...existing,
            value: existing.value + t.amount,
          });
        } else {
          incomeTotals.set(key, {
            label: label,
            value: t.amount,
            color: categoryColor,
          });
        }
      });
    
    return Array.from(incomeTotals.entries()).map(([key, data]) => ({
      id: key,
      ...data,
    }));
  }, [transactions, dateRanges, categories, accounts, users]);

  // Trends Data (Last 6 months from end date)
  const trendsData = useMemo(() => {
    const endDate = new Date(dateRanges.end);
    const startDate = new Date(endDate);
    startDate.setMonth(startDate.getMonth() - 6);
    
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
    
    const sortedMonths = Array.from(monthlyData.keys()).sort();
    
    return {
      xAxis: sortedMonths,
      income: sortedMonths.map(m => monthlyData.get(m)?.income || 0),
      expenses: sortedMonths.map(m => monthlyData.get(m)?.expenses || 0),
    };
  }, [transactions, dateRanges]);

  // Account Analysis
  const accountData = useMemo(() => {
    const startDate = new Date(dateRanges.start);
    const endDate = new Date(dateRanges.end);
    
    const accountTotals = new Map<string, { accountName: string; income: number; expenses: number }>();
    
    transactions
      .filter(t => {
        const tDate = new Date(t.date);
        return tDate >= startDate && tDate <= endDate;
      })
      .forEach(t => {
        const accountId = String(t.account_id);
        const existing = accountTotals.get(accountId) || { 
          accountName: t.account_name || 'Unknown Account', 
          income: 0, 
          expenses: 0 
        };
        
        if (t.type === 'income') {
          existing.income += t.amount;
        } else {
          existing.expenses += Math.abs(t.amount);
        }
        
        accountTotals.set(accountId, existing);
      });
    
    const accountNames = Array.from(accountTotals.values()).map(a => a.accountName);
    const incomeByAccount = Array.from(accountTotals.values()).map(a => a.income);
    const expensesByAccount = Array.from(accountTotals.values()).map(a => a.expenses);
    
    return {
      accountNames,
      income: incomeByAccount,
      expenses: expensesByAccount,
    };
  }, [transactions, dateRanges]);

  return (
    <Paper sx={{ width: '100%', mb: 4 }}>
      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tabValue} onChange={(_, newValue) => setTabValue(newValue)}>
          <Tab label="Spending Breakdown" />
          <Tab label="Income Sources" />
          <Tab label="Trends" />
          <Tab label="Account Analysis" />
        </Tabs>
      </Box>

      <TabPanel value={tabValue} index={0}>
        <Box p={3}>
          <Typography variant="h6" gutterBottom>
            Spending by Category - {timeRangeLabel}
          </Typography>
          {spendingData.length > 0 ? (
            <Box height={400} display="flex" justifyContent="center">
              <PieChart
                series={[
                  {
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
            Income by Source - {timeRangeLabel}
          </Typography>
          {incomeData.length > 0 ? (
            <Box height={400} display="flex" justifyContent="center">
              <PieChart
                series={[
                  {
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

      <TabPanel value={tabValue} index={3}>
        <Box p={3}>
          <Typography variant="h6" gutterBottom>
            Income and Expenses by Account - {timeRangeLabel}
          </Typography>
          {accountData.accountNames.length > 0 ? (
            <Box height={400}>
              <BarChart
                width={800}
                height={400}
                series={[
                  {
                    data: accountData.income,
                    label: 'Income',
                    color: '#4caf50',
                    stack: 'total',
                  },
                  {
                    data: accountData.expenses,
                    label: 'Expenses',
                    color: '#f44336',
                    stack: 'total',
                  },
                ]}
                xAxis={[{ 
                  scaleType: 'band', 
                  data: accountData.accountNames,
                }]}
                margin={{ top: 20, right: 20, bottom: 60, left: 80 }}
              />
            </Box>
          ) : (
            <Box display="flex" justifyContent="center" alignItems="center" height={200}>
              <Typography color="text.secondary">
                No account data for this period
              </Typography>
            </Box>
          )}
        </Box>
      </TabPanel>
    </Paper>
  );
};

export default ChartsSection;
