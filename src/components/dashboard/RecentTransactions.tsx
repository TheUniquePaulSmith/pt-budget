'use client';

import React from 'react';
import {
  Box,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { Transaction } from '@/types/database';
import { format, parseISO } from 'date-fns';

interface RecentTransactionsProps {
  transactions: Transaction[];
  limit?: number;
  onLimitChange?: (limit: number) => void;
}

const RecentTransactions: React.FC<RecentTransactionsProps> = ({
  transactions,
  limit = 10,
  onLimitChange,
}) => {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography variant="h6">
          Recent Transactions
        </Typography>
        {onLimitChange && (
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Show</InputLabel>
            <Select
              value={limit}
              label="Show"
              onChange={(e) => onLimitChange(Number(e.target.value))}
            >
              <MenuItem value={10}>Last 10</MenuItem>
              <MenuItem value={25}>Last 25</MenuItem>
              <MenuItem value={50}>Last 50</MenuItem>
              <MenuItem value={100}>Last 100</MenuItem>
            </Select>
          </FormControl>
        )}
      </Box>
      {transactions.length > 0 ? (
        <Box>
          {transactions.slice(0, limit).map((transaction) => {
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
          {transactions.length > limit && (
            <Box mt={2}>
              <Typography variant="body2" color="text.secondary" textAlign="center">
                Showing {limit} of {transactions.length} transactions. 
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
      )}
    </Paper>
  );
};

export default RecentTransactions;
