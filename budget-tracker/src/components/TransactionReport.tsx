'use client';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TableSortLabel,
  Button,
  Card,
  CardContent,
  IconButton,
  Autocomplete,} from '@mui/material';
import {
  FilterList,
  ClearAll,
  Download,
  Receipt,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { useDatabaseContext } from '../contexts/DatabaseContext';
import { Transaction } from '../lib/database';
import { format, parseISO } from 'date-fns';

type Order = 'asc' | 'desc';

interface TransactionWithDetails extends Transaction {
  category_name?: string;
  company_name?: string;
  project_name?: string;
}

export default function TransactionReport() {
  const {
    transactions,
    categories,
    companies,
    projects,
    refreshTransactions,
  } = useDatabaseContext();

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');

  // Table state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [orderBy, setOrderBy] = useState<keyof Transaction>('date');
  const [order, setOrder] = useState<Order>('desc');

  useEffect(() => {
    refreshTransactions();
  }, [refreshTransactions]);

  // Enhanced transactions with related data
  const enhancedTransactions = useMemo(() => {
    return transactions.map(transaction => {
      const category = categories.find(c => c.id === transaction.category_id);
      const company = companies.find(c => c.id === transaction.company_id);
      const project = projects.find(p => p.id === transaction.project_id);

      return {
        ...transaction,
        category_name: category?.name || 'Unknown',
        company_name: company?.name || '',
        project_name: project?.name || '',
      } as TransactionWithDetails;
    });
  }, [transactions, categories, companies, projects]);

  // Filtered and sorted transactions
  const filteredTransactions = useMemo(() => {
    return enhancedTransactions.filter(transaction => {
      // Search term filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const matchesSearch = 
          transaction.description.toLowerCase().includes(searchLower) ||
          transaction.category_name?.toLowerCase().includes(searchLower) ||
          transaction.company_name?.toLowerCase().includes(searchLower) ||
          transaction.project_name?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      // Type filter
      if (typeFilter !== 'all' && transaction.type !== typeFilter) return false;

      // Category filter
      if (categoryFilter.length > 0 && !categoryFilter.includes(transaction.category_id)) return false;

      // Company filter
      if (companyFilter.length > 0 && transaction.company_id && !companyFilter.includes(transaction.company_id)) return false;

      // Project filter
      if (projectFilter.length > 0 && transaction.project_id && !projectFilter.includes(transaction.project_id)) return false;

      // Date range filter
      if (startDate && new Date(transaction.date) < startDate) return false;
      if (endDate && new Date(transaction.date) > endDate) return false;

      // Amount range filter
      const absAmount = Math.abs(transaction.amount);
      if (minAmount && absAmount < parseFloat(minAmount)) return false;
      if (maxAmount && absAmount > parseFloat(maxAmount)) return false;

      return true;
    }).sort((a, b) => {
      let aValue: any = a[orderBy];
      let bValue: any = b[orderBy];

      // Handle sorting for different data types
      if (orderBy === 'date') {
        aValue = new Date(aValue);
        bValue = new Date(bValue);
      } else if (orderBy === 'amount') {
        aValue = Math.abs(aValue);
        bValue = Math.abs(bValue);
      } else if (typeof aValue === 'string') {
        aValue = aValue.toLowerCase();
        bValue = bValue.toLowerCase();
      }

      if (bValue < aValue) {
        return order === 'desc' ? -1 : 1;
      }
      if (bValue > aValue) {
        return order === 'desc' ? 1 : -1;
      }
      return 0;
    });
  }, [enhancedTransactions, searchTerm, typeFilter, categoryFilter, companyFilter, projectFilter, startDate, endDate, minAmount, maxAmount, orderBy, order]);

  // Summary statistics for filtered data
  const summaryStats = useMemo(() => {
    const totalIncome = filteredTransactions
      .filter(t => t.type === 'income')
      .reduce((sum, t) => sum + t.amount, 0);
    
    const totalExpenses = filteredTransactions
      .filter(t => t.type === 'expense')
      .reduce((sum, t) => sum + Math.abs(t.amount), 0);
    
    return {
      totalIncome,
      totalExpenses,
      netIncome: totalIncome - totalExpenses,
      transactionCount: filteredTransactions.length,
    };
  }, [filteredTransactions]);

  const handleRequestSort = (property: keyof Transaction) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
  };

  const handleChangePage = (_: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleClearFilters = () => {
    setSearchTerm('');
    setTypeFilter('all');
    setCategoryFilter([]);
    setCompanyFilter([]);
    setProjectFilter([]);
    setStartDate(null);
    setEndDate(null);
    setMinAmount('');
    setMaxAmount('');
    setPage(0);
  };

  const handleExportCSV = () => {
    const headers = ['Date', 'Description', 'Type', 'Category', 'Company', 'Project', 'Amount', 'Account'];
    const csvData = filteredTransactions.map(transaction => [
      transaction.date,
      transaction.description,
      transaction.type,
      transaction.category_name,
      transaction.company_name || '',
      transaction.project_name || '',
      Math.abs(transaction.amount),
      transaction.account_last_four,
    ]);

    const csvContent = [headers, ...csvData]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transaction-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const paginatedTransactions = filteredTransactions.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );
  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        {/* Header */}
        <Box sx={{ 
          display: 'flex', 
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between', 
          alignItems: { xs: 'stretch', sm: 'center' }, 
          mb: 3,
          gap: { xs: 2, sm: 0 }
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Receipt color="primary" />
            <Typography 
              variant="h4" 
              component="h1"
              sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}
            >
              Transaction Report
            </Typography>
          </Box>
          <Stack 
            direction={{ xs: 'column', sm: 'row' }} 
            spacing={2}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            <Button
              variant="outlined"
              startIcon={<ClearAll />}
              onClick={handleClearFilters}
              size="small"
              sx={{ width: { xs: '100%', sm: 'auto' } }}
            >
              Clear Filters
            </Button>
            <Button
              variant="contained"
              startIcon={<Download />}
              onClick={handleExportCSV}
              disabled={filteredTransactions.length === 0}
              size="small"
              sx={{ width: { xs: '100%', sm: 'auto' } }}
            >
              Export CSV
            </Button>
          </Stack>
        </Box>        {/* Summary Stats */}
        <Box sx={{ 
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: { xs: 2, sm: 3 }, 
          mb: 3        }}>
          <Card>
            <CardContent>
              <Typography variant="h6" color="success.main">
                {formatCurrency(summaryStats.totalIncome)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Total Income
              </Typography>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Typography variant="h6" color="error.main">
                {formatCurrency(summaryStats.totalExpenses)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Total Expenses
              </Typography>
            </CardContent>
          </Card>          <Card>
            <CardContent>
              <Typography 
                variant="h6" 
                color={summaryStats.netIncome >= 0 ? 'success.main' : 'error.main'}
              >
                {formatCurrency(summaryStats.netIncome)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Net Income
              </Typography>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <Typography variant="h6" color="primary.main">
                {summaryStats.transactionCount}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Transactions
              </Typography>
            </CardContent>
          </Card>
        </Box>        {/* Filters */}
        <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <FilterList />
            <Typography variant="h6">Filters</Typography>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* First Row */}
            <Box sx={{ 
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' },
              gap: 2 
            }}>
              {/* Search */}
              <TextField
                fullWidth
                label="Search"
                placeholder="Description, category, company, project..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />

              {/* Type Filter */}
              <FormControl fullWidth>
                <InputLabel>Type</InputLabel>
                <Select
                  value={typeFilter}
                  label="Type"
                  onChange={(e) => setTypeFilter(e.target.value as any)}
                >
                  <MenuItem value="all">All</MenuItem>
                  <MenuItem value="income">Income</MenuItem>
                  <MenuItem value="expense">Expense</MenuItem>
                </Select>
              </FormControl>
            </Box>

            {/* Second Row - Date Range */}
            <Box sx={{ 
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
              gap: 2 
            }}>
              <DatePicker
                label="Start Date"
                value={startDate}
                onChange={setStartDate}
                slotProps={{ textField: { fullWidth: true } }}
              />
              <DatePicker
                label="End Date"
                value={endDate}
                onChange={setEndDate}                slotProps={{ textField: { fullWidth: true } }}
              />
            </Box>

            {/* Third Row - Amount Range */}
            <Box sx={{ 
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' },
              gap: 2 
            }}>
              <TextField
                fullWidth
                label="Min Amount"
                type="number"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                inputProps={{ min: 0, step: 0.01 }}
              />
              <TextField
                fullWidth
                label="Max Amount"
                type="number"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                inputProps={{ min: 0, step: 0.01 }}
              />
            </Box>

            {/* Fourth Row - Category and Company Filters */}
            <Box sx={{ 
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' },
              gap: 2 
            }}>
              {/* Category Filter */}
              <Autocomplete
                multiple
                options={categories}
                getOptionLabel={(option) => option.name}
                value={categories.filter(cat => categoryFilter.includes(cat.id))}
                onChange={(_, value) => setCategoryFilter(value.map(v => v.id))}
                renderInput={(params) => (
                  <TextField {...params} label="Categories" />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => {
                    const { key, ...chipProps } = getTagProps({ index });
                    return (
                      <Chip
                        key={key}
                        label={option.name}
                        size="small"
                        {...chipProps}
                      />
                    );
                  })
                }
              />

              {/* Company Filter */}
              <Autocomplete
                multiple
                options={companies}
                getOptionLabel={(option) => option.name}
                value={companies.filter(comp => companyFilter.includes(comp.id))}
                onChange={(_, value) => setCompanyFilter(value.map(v => v.id))}
                renderInput={(params) => (
                  <TextField {...params} label="Companies" />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => {
                    const { key, ...chipProps } = getTagProps({ index });
                    return (
                      <Chip
                        key={key}
                        label={option.name}
                        size="small"
                        {...chipProps}
                      />
                    );
                  })
                }
              />
            </Box>
          </Box>
        </Paper>        {/* Results Table */}
        <Paper>
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table sx={{ minWidth: { xs: 800, sm: 'auto' } }}>
              <TableHead>
                <TableRow>
                  <TableCell>
                    <TableSortLabel
                      active={orderBy === 'date'}
                      direction={orderBy === 'date' ? order : 'asc'}
                      onClick={() => handleRequestSort('date')}
                    >
                      Date
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>
                    <TableSortLabel
                      active={orderBy === 'description'}
                      direction={orderBy === 'description' ? order : 'asc'}
                      onClick={() => handleRequestSort('description')}
                    >
                      Description
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Category</TableCell>
                  <TableCell>Company</TableCell>
                  <TableCell>Project</TableCell>
                  <TableCell align="right">
                    <TableSortLabel
                      active={orderBy === 'amount'}
                      direction={orderBy === 'amount' ? order : 'asc'}
                      onClick={() => handleRequestSort('amount')}
                    >
                      Amount
                    </TableSortLabel>
                  </TableCell>
                  <TableCell>Account</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedTransactions.map((transaction) => (
                  <TableRow key={transaction.id} hover>
                    <TableCell>
                      {format(parseISO(transaction.date), 'MMM dd, yyyy')}
                    </TableCell>
                    <TableCell>{transaction.description}</TableCell>
                    <TableCell>
                      <Chip
                        label={transaction.type}
                        size="small"
                        color={transaction.type === 'income' ? 'success' : 'error'}
                      />
                    </TableCell>
                    <TableCell>{transaction.category_name}</TableCell>
                    <TableCell>{transaction.company_name || '-'}</TableCell>
                    <TableCell>{transaction.project_name || '-'}</TableCell>
                    <TableCell align="right">
                      <Typography
                        color={transaction.type === 'income' ? 'success.main' : 'error.main'}
                        fontWeight="medium"
                      >
                        {transaction.type === 'income' ? '+' : '-'}
                        {formatCurrency(Math.abs(transaction.amount))}
                      </Typography>
                    </TableCell>
                    <TableCell>****{transaction.account_last_four}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            rowsPerPageOptions={[10, 25, 50, 100]}
            component="div"
            count={filteredTransactions.length}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={handleChangePage}
            onRowsPerPageChange={handleChangeRowsPerPage}
          />
        </Paper>

        {filteredTransactions.length === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="h6" color="text.secondary">
              No transactions found matching your filters
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Try adjusting your search criteria or clearing the filters
            </Typography>
          </Box>
        )}
      </Box>
    </LocalizationProvider>
  );
}
