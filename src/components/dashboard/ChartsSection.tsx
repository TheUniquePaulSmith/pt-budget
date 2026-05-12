'use client';

import React, { useState } from 'react';
import { Box, Paper, Typography, Tabs, Tab } from '@mui/material';
import { PieChart } from '@mui/x-charts/PieChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import type { ChartData, Account, User } from '@/types/database';

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
  chartData: ChartData | null;
  accounts: Account[];
  users: User[];
  timeRangeLabel: string;
}

const ChartsSection: React.FC<ChartsSectionProps> = ({ chartData, timeRangeLabel }) => {
  const [tabValue, setTabValue] = useState(0);

  const spendingData = chartData?.spendingByCategory ?? [];
  const incomeData = chartData?.incomeBySource ?? [];
  const trendsData = chartData?.trends ?? { months: [], income: [], expenses: [] };
  const accountData = chartData?.accountAnalysis ?? { accountNames: [], income: [], expenses: [] };

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
                series={[{
                  data: spendingData,
                  highlightScope: { fade: 'global', highlight: 'item' },
                  faded: { innerRadius: 30, additionalRadius: -30, color: 'gray' },
                }]}
                width={600}
                height={400}
              />
            </Box>
          ) : (
            <Box display="flex" justifyContent="center" alignItems="center" height={200}>
              <Typography color="text.secondary">No spending data for this period</Typography>
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
                series={[{
                  data: incomeData,
                  highlightScope: { fade: 'global', highlight: 'item' },
                  faded: { innerRadius: 30, additionalRadius: -30, color: 'gray' },
                }]}
                width={600}
                height={400}
              />
            </Box>
          ) : (
            <Box display="flex" justifyContent="center" alignItems="center" height={200}>
              <Typography color="text.secondary">No income data for this period</Typography>
            </Box>
          )}
        </Box>
      </TabPanel>

      <TabPanel value={tabValue} index={2}>
        <Box p={3}>
          <Typography variant="h6" gutterBottom>Income vs Expenses Trend</Typography>
          {trendsData.months.length > 0 ? (
            <Box height={400}>
              <LineChart
                series={[
                  { data: trendsData.income, label: 'Income', color: '#4caf50' },
                  { data: trendsData.expenses, label: 'Expenses', color: '#f44336' },
                ]}
                xAxis={[{ scaleType: 'point', data: trendsData.months }]}
                yAxis={[{ width: 80 }]}
              />
            </Box>
          ) : (
            <Box display="flex" justifyContent="center" alignItems="center" height={200}>
              <Typography color="text.secondary">No trend data available</Typography>
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
                series={[
                  { data: accountData.income, label: 'Income', color: '#4caf50' },
                  { data: accountData.expenses, label: 'Expenses', color: '#f44336' },
                ]}
                xAxis={[{ scaleType: 'band', data: accountData.accountNames }]}
                yAxis={[{
                  width: 80,
                  valueFormatter: (value: string) => `$${value.toLocaleString()}`,
                }]}
                margin={{ top: 20, right: 20, bottom: 60, left: 80 }}
              />
            </Box>
          ) : (
            <Box display="flex" justifyContent="center" alignItems="center" height={200}>
              <Typography color="text.secondary">No account data for this period</Typography>
            </Box>
          )}
        </Box>
      </TabPanel>
    </Paper>
  );
};

export default ChartsSection;
