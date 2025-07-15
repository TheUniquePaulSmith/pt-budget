'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
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
  Autocomplete,
  Checkbox,
  FormControlLabel,
  FormGroup,
  Collapse,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  FilterList,
  ClearAll,
  Download,
  Receipt,
  ViewColumn,
  ExpandMore,
  ExpandLess,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { useDatabaseContext } from '@/contexts/DatabaseContext';
import { Transaction, Category, Company, Account } from '@/types/database';
import { format, parseISO } from 'date-fns';

type Order = 'asc' | 'desc';

export default function TransactionReport() {
  const {
    transactions,
    categories,
    companies,
    projects,
    accounts,
    isDatabaseLoaded,
    refreshTransactions,
  } = useDatabaseContext();

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [companyFilter, setCompanyFilter] = useState<string[]>([]);
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  const [accountFilter, setAccountFilter] = useState<string[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');
  // Table state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [orderBy, setOrderBy] = useState<keyof Transaction>('date');
  const [order, setOrder] = useState<Order>('desc');

  const loadingRef = useRef(false);
  
  // Column visibility state
  const [showColumnControls, setShowColumnControls] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState({
    date: true,
    description: true,
    type: true,
    category: true,
    company: true,
    project: true,
    amount: true,
    account: true,
  });
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Set mobile-friendly defaults on mount
  useEffect(() => {
    if (isMobile) {
      setVisibleColumns({
        date: true,
        description: true,
        type: false,
        category: false,
        company: false,
        project: false,
        amount: true,
        account: false,
      });
    }
  }, [isMobile]);

  const columnLabels = {
    date: 'Date',
    description: 'Description',
    type: 'Type',
    category: 'Category',
    company: 'Company',
    project: 'Project',
    amount: 'Amount',
    account: 'Account',
  };

  const handleColumnToggle = (column: keyof typeof visibleColumns) => {
    setVisibleColumns(prev => ({
      ...prev,
      [column]: !prev[column],
    }));
  };

  const handleShowAllColumns = () => {
    setVisibleColumns({
      date: true,
      description: true,
      type: true,
      category: true,
      company: true,
      project: true,
      amount: true,
      account: true,
    });
  };

  const handleMobilePreset = () => {
    setVisibleColumns({
      date: true,
      description: true,
      type: false,
      category: false,
      company: false,
      project: false,
      amount: true,
      account: false,
    });
  };

 useEffect(() => {
  if (isDatabaseLoaded && !loadingRef.current) {  // 👈 Guard check
    loadingRef.current = true;                     // 👈 Set guard
    console.debug('Database loaded, refreshing transactions');
    
    const loadData = async () => {
      try {
        await refreshTransactions();
      } catch (error) {
        console.error('Error loading transaction data:', error);
      } finally {
        loadingRef.current = false;               // 👈 Reset guard
      }
    };
    loadData();
  }
}, [isDatabaseLoaded, refreshTransactions]);

  // Enhanced transactions with related data
  const enhancedTransactions = useMemo(() => {
    // Since transactions already include joined data from SQL, we can use them directly
    return transactions;
  }, [transactions]);

  // Filtered and sorted transactions
  const filteredTransactions = useMemo(() => {
    return enhancedTransactions.filter((transaction: Transaction) => {
      // Search term filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const matchesSearch = 
          transaction.description.toLowerCase().includes(searchLower) ||
          transaction.category_name?.toLowerCase().includes(searchLower) ||
          transaction.company_name?.toLowerCase().includes(searchLower) ||
          transaction.project_name?.toLowerCase().includes(searchLower) ||
          transaction.account_name?.toLowerCase().includes(searchLower);
        if (!matchesSearch) return false;
      }

      // Type filter
      if (typeFilter !== 'all' && transaction.type !== typeFilter) return false;

      // Category filter
      if (categoryFilter.length > 0 && transaction.category_id && !categoryFilter.includes(transaction.category_id)) return false;

      // Company filter
      if (companyFilter.length > 0 && transaction.company_id && !companyFilter.includes(transaction.company_id)) return false;

      // Project filter
      if (projectFilter.length > 0 && transaction.project_id && !projectFilter.includes(transaction.project_id)) return false;

      // Account filter
      if (accountFilter.length > 0 && !accountFilter.includes(transaction.account_id)) return false;

      // Date range filter
      if (startDate && new Date(transaction.date) < startDate) return false;
      if (endDate && new Date(transaction.date) > endDate) return false;

      // Amount range filter
      const absAmount = Math.abs(transaction.amount);
      if (minAmount && absAmount < parseFloat(minAmount)) return false;
      if (maxAmount && absAmount > parseFloat(maxAmount)) return false;

      return true;
    }).sort((a: Transaction, b: Transaction) => {
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
  }, [enhancedTransactions, searchTerm, typeFilter, categoryFilter, companyFilter, projectFilter, accountFilter, startDate, endDate, minAmount, maxAmount, orderBy, order]);

  // Summary statistics for filtered data
  const summaryStats = useMemo(() => {
    const totalIncome = filteredTransactions
      .filter((t: Transaction) => t.type === 'income')
      .reduce((sum: number, t: Transaction) => sum + t.amount, 0);
    
    const totalExpenses = filteredTransactions
      .filter((t: Transaction) => t.type === 'expense')
      .reduce((sum: number, t: Transaction) => sum + Math.abs(t.amount), 0);
    
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
    setAccountFilter([]);
    setStartDate(null);
    setEndDate(null);
    setMinAmount('');
    setMaxAmount('');
    setPage(0);
  };
  const handleExportCSV = () => {
    // Build headers based on visible columns
    const headers: string[] = [];
    const columnMapping: { [key: string]: string } = {
      date: 'Date',
      description: 'Description',
      type: 'Type',
      category: 'Category',
      company: 'Company',
      project: 'Project',
      amount: 'Amount',
      account: 'Account',
    };

    Object.entries(visibleColumns).forEach(([key, visible]) => {
      if (visible) {
        headers.push(columnMapping[key]);
      }
    });

    // Build CSV data based on visible columns
    const csvData = filteredTransactions.map((transaction: Transaction) => {
      const row: string[] = [];
      
      if (visibleColumns.date) row.push(transaction.date);
      if (visibleColumns.description) row.push(transaction.description);
      if (visibleColumns.type) row.push(transaction.type);
      if (visibleColumns.category) row.push(transaction.category_name || '');
      if (visibleColumns.company) row.push(transaction.company_name || '');
      if (visibleColumns.project) row.push(transaction.project_name || '');
      if (visibleColumns.amount) row.push(Math.abs(transaction.amount).toString());
      if (visibleColumns.account) row.push(transaction.account_name || '');
      
      return row;
    });

    const csvContent = [headers, ...csvData]
      .map((row: any[]) => row.map((field: any) => `"${field}"`).join(','))
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
            >              Export CSV
            </Button>
            <Button
              variant="outlined"
              startIcon={<ViewColumn />}
              onClick={() => setShowColumnControls(!showColumnControls)}
              size="small"
              sx={{ width: { xs: '100%', sm: 'auto' } }}
            >
              Columns
            </Button>
          </Stack>
        </Box>

        {/* Column Visibility Controls */}
        <Collapse in={showColumnControls}>
          <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <ViewColumn />
              <Typography variant="h6">Column Visibility</Typography>
            </Box>
            
            <Box sx={{ mb: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="outlined"
                size="small"
                onClick={handleShowAllColumns}
              >
                Show All
              </Button>
              <Button
                variant="outlined"
                size="small"
                onClick={handleMobilePreset}
              >
                Mobile View
              </Button>
            </Box>

            <FormGroup>
              <Box sx={{ 
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' },
                gap: 1 
              }}>
                {Object.entries(columnLabels).map(([key, label]) => (
                  <FormControlLabel
                    key={key}
                    control={
                      <Checkbox
                        checked={visibleColumns[key as keyof typeof visibleColumns]}
                        onChange={() => handleColumnToggle(key as keyof typeof visibleColumns)}
                        size="small"
                      />
                    }
                    label={label}
                    sx={{ 
                      '& .MuiFormControlLabel-label': { 
                        fontSize: { xs: '0.875rem', sm: '1rem' } 
                      } 
                    }}
                  />
                ))}
              </Box>
            </FormGroup>
          </Paper>
        </Collapse>

        {/* Summary Stats */}
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

            {/* Fourth Row - Category, Company, and Account Filters */}
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
                value={categories.filter((cat: Category) => categoryFilter.includes(cat.id))}
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
                value={companies.filter((comp: Company) => companyFilter.includes(comp.id))}
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

              {/* Account Filter */}
              <Autocomplete
                multiple
                options={accounts}
                getOptionLabel={(option) => option.name}
                value={accounts.filter((acc: Account) => accountFilter.includes(acc.id))}
                onChange={(_, value) => setAccountFilter(value.map(v => v.id))}
                renderInput={(params) => (
                  <TextField {...params} label="Accounts" />
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
            <Table sx={{ minWidth: { xs: 300, sm: 800 } }}>
              <TableHead>
                <TableRow>
                  {visibleColumns.date && (
                    <TableCell>
                      <TableSortLabel
                        active={orderBy === 'date'}
                        direction={orderBy === 'date' ? order : 'asc'}
                        onClick={() => handleRequestSort('date')}
                      >
                        Date
                      </TableSortLabel>
                    </TableCell>
                  )}
                  {visibleColumns.description && (
                    <TableCell>
                      <TableSortLabel
                        active={orderBy === 'description'}
                        direction={orderBy === 'description' ? order : 'asc'}
                        onClick={() => handleRequestSort('description')}
                      >
                        Description
                      </TableSortLabel>
                    </TableCell>
                  )}
                  {visibleColumns.type && (
                    <TableCell>Type</TableCell>
                  )}
                  {visibleColumns.category && (
                    <TableCell>Category</TableCell>
                  )}
                  {visibleColumns.company && (
                    <TableCell>Company</TableCell>
                  )}
                  {visibleColumns.project && (
                    <TableCell>Project</TableCell>
                  )}
                  {visibleColumns.amount && (
                    <TableCell align="right">
                      <TableSortLabel
                        active={orderBy === 'amount'}
                        direction={orderBy === 'amount' ? order : 'asc'}
                        onClick={() => handleRequestSort('amount')}
                      >
                        Amount
                      </TableSortLabel>
                    </TableCell>
                  )}
                  {visibleColumns.account && (
                    <TableCell>Account</TableCell>
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedTransactions.map((transaction: Transaction) => (
                  <TableRow key={transaction.id} hover>
                    {visibleColumns.date && (
                      <TableCell sx={{ minWidth: 100 }}>
                        {format(parseISO(transaction.date), isMobile ? 'MM/dd/yy' : 'MMM dd, yyyy')}
                      </TableCell>
                    )}
                    {visibleColumns.description && (
                      <TableCell sx={{ 
                        minWidth: { xs: 150, sm: 200 },
                        maxWidth: { xs: 200, sm: 300 },
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        <Box
                          component="div"
                          title={transaction.description}
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {transaction.description}
                        </Box>
                      </TableCell>
                    )}
                    {visibleColumns.type && (
                      <TableCell>
                        <Chip
                          label={transaction.type}
                          size="small"
                          color={transaction.type === 'income' ? 'success' : 'error'}
                        />
                      </TableCell>
                    )}
                    {visibleColumns.category && (
                      <TableCell sx={{ minWidth: 120 }}>{transaction.category_name}</TableCell>
                    )}
                    {visibleColumns.company && (
                      <TableCell sx={{ minWidth: 120 }}>{transaction.company_name || '-'}</TableCell>
                    )}
                    {visibleColumns.project && (
                      <TableCell sx={{ minWidth: 120 }}>{transaction.project_name || '-'}</TableCell>
                    )}
                    {visibleColumns.amount && (
                      <TableCell align="right" sx={{ minWidth: 100 }}>
                        <Typography
                          color={transaction.type === 'income' ? 'success.main' : 'error.main'}
                          fontWeight="medium"
                          variant={isMobile ? 'body2' : 'body1'}
                        >
                          {transaction.type === 'income' ? '+' : '-'}
                          {formatCurrency(Math.abs(transaction.amount))}
                        </Typography>
                      </TableCell>
                    )}
                    {visibleColumns.account && (
                      <TableCell sx={{ minWidth: 120 }}>{transaction.account_name}</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>          <TablePagination
            rowsPerPageOptions={isMobile ? [10, 25] : [10, 25, 50, 100]}
            component="div"
            count={filteredTransactions.length}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={handleChangePage}
            onRowsPerPageChange={handleChangeRowsPerPage}
            labelRowsPerPage={isMobile ? "Rows:" : "Rows per page:"}
            sx={{
              '& .MuiTablePagination-spacer': {
                display: { xs: 'none', sm: 'flex' }
              },
              '& .MuiTablePagination-selectLabel': {
                display: { xs: 'none', sm: 'block' }
              }
            }}
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
