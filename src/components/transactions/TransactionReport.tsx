'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  alpha,
  CircularProgress,
} from '@mui/material';
import {
  FilterList,
  ClearAll,
  Download,
  Receipt,
  ViewColumn,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { useTransactionReportSlice } from '@/contexts/useDatabaseSlices';
import TransactionLabelDialog from './TransactionLabelDialog';
import { Transaction, Category, Company, Account, TransactionsPaginatedResult } from '@/types/database';
import { format, parseISO } from 'date-fns';

type Order = 'asc' | 'desc';

export default function TransactionReport() {
  const {
    transactionVersion,
    categories,
    companies,
    projects,
    accounts,
    getTransactionsPaginated,
    getTransactionsForExport,
  } = useTransactionReportSlice();

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'income' | 'expense'>('all');
  const [categoryFilter, setCategoryFilter] = useState<number[]>([]);
  const [companyFilter, setCompanyFilter] = useState<number[]>([]);
  const [projectFilter, setProjectFilter] = useState<number[]>([]);
  const [accountFilter, setAccountFilter] = useState<number[]>([]);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [minAmount, setMinAmount] = useState<string>('');
  const [maxAmount, setMaxAmount] = useState<string>('');

  // Table state
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [orderBy, setOrderBy] = useState<string>('date');
  const [order, setOrder] = useState<Order>('desc');

  // Results
  const [result, setResult] = useState<TransactionsPaginatedResult | null>(null);
  const [loading, setLoading] = useState(false);

  // Dialog
  const [labelDialogOpen, setLabelDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  // Column visibility
  const [showColumnControls, setShowColumnControls] = useState(false);
  const [visibleColumns, setVisibleColumns] = useState({
    date: true,
    description: true,
    category: true,
    company: true,
    project: true,
    label: true,
    amount: true,
    account: true,
    actions: true,
  });

  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  useEffect(() => {
    if (isMobile) {
      setVisibleColumns(prev => ({ ...prev, category: false, company: false, project: false, label: false, account: false }));
    }
  }, [isMobile]);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Reset page when filters change
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) { isFirstRender.current = false; return; }
    setPage(0);
  }, [debouncedSearch, typeFilter, categoryFilter, companyFilter, projectFilter, accountFilter, startDate, endDate, minAmount, maxAmount, rowsPerPage]);

  // Fetch from DB whenever page/filters/sort/version change
  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      try {
        const data = await getTransactionsPaginated({
          page,
          pageSize: rowsPerPage,
          sortBy: orderBy,
          sortOrder: order,
          search: debouncedSearch || undefined,
          type: typeFilter === 'all' ? undefined : typeFilter,
          categoryIds: categoryFilter.length > 0 ? categoryFilter : undefined,
          companyIds: companyFilter.length > 0 ? companyFilter : undefined,
          projectIds: projectFilter.length > 0 ? projectFilter : undefined,
          accountIds: accountFilter.length > 0 ? accountFilter : undefined,
          startDate: startDate ? format(startDate, 'yyyy-MM-dd') : undefined,
          endDate: endDate ? format(endDate, 'yyyy-MM-dd') : undefined,
          minAmount: minAmount ? parseFloat(minAmount) : undefined,
          maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
        });
        if (!cancelled) setResult(data);
      } catch (err) {
        console.error('Failed to fetch transactions:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetch();
    return () => { cancelled = true; };
  }, [transactionVersion, page, rowsPerPage, orderBy, order, debouncedSearch, typeFilter, categoryFilter, companyFilter, projectFilter, accountFilter, startDate, endDate, minAmount, maxAmount, getTransactionsPaginated]);

  const columnLabels = {
    date: 'Date', description: 'Description', category: 'Category',
    company: 'Company', project: 'Project', label: 'Label',
    amount: 'Amount', account: 'Account', actions: 'Actions',
  };

  const handleColumnToggle = (column: keyof typeof visibleColumns) => {
    setVisibleColumns(prev => ({ ...prev, [column]: !prev[column] }));
  };

  const handleRequestSort = (property: string) => {
    const isAsc = orderBy === property && order === 'asc';
    setOrder(isAsc ? 'desc' : 'asc');
    setOrderBy(property);
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

  const handleLabelTransaction = (transaction: Transaction) => {
    setSelectedTransaction(transaction);
    setLabelDialogOpen(true);
  };

  const handleExportCSV = async () => {
    try {
      const rows = await getTransactionsForExport({
        sortBy: orderBy,
        sortOrder: order,
        search: debouncedSearch || undefined,
        type: typeFilter === 'all' ? undefined : typeFilter,
        categoryIds: categoryFilter.length > 0 ? categoryFilter : undefined,
        companyIds: companyFilter.length > 0 ? companyFilter : undefined,
        projectIds: projectFilter.length > 0 ? projectFilter : undefined,
        accountIds: accountFilter.length > 0 ? accountFilter : undefined,
        startDate: startDate ? format(startDate, 'yyyy-MM-dd') : undefined,
        endDate: endDate ? format(endDate, 'yyyy-MM-dd') : undefined,
        minAmount: minAmount ? parseFloat(minAmount) : undefined,
        maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
      });

      const headers = Object.entries(columnLabels)
        .filter(([key]) => visibleColumns[key as keyof typeof visibleColumns] && key !== 'actions' && key !== 'label')
        .map(([, label]) => label);

      const csvData = rows.map((t: Transaction) => {
        const row: string[] = [];
        if (visibleColumns.date) row.push(t.date);
        if (visibleColumns.description) row.push(t.description);
        if (visibleColumns.category) row.push(t.category_name || '');
        if (visibleColumns.company) row.push(t.company_name || '');
        if (visibleColumns.project) row.push(t.project_name || '');
        if (visibleColumns.amount) row.push(Math.abs(t.amount).toString());
        if (visibleColumns.account) row.push(t.account_name || '');
        return row;
      });

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
    } catch (err) {
      console.error('Failed to export CSV:', err);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const renderTransactionLabel = (transaction: Transaction) => {
    if (transaction.project_id && transaction.project_name) {
      return <Chip label={`Project: ${transaction.project_name}`} color="primary" size="small" variant="outlined" />;
    }
    if (transaction.trip_id && transaction.trip_name) {
      return <Chip label={`Trip: ${transaction.trip_name}`} color="secondary" size="small" variant="outlined" />;
    }
    return null;
  };

  const transactions = result?.data ?? [];
  const totalCount = result?.total ?? 0;
  const totalIncome = result?.totalIncome ?? 0;
  const totalExpenses = result?.totalExpenses ?? 0;
  const netIncome = totalIncome - totalExpenses;

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
            <Typography variant="h4" component="h1" sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}>
              Transaction Report
            </Typography>
          </Box>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ width: { xs: '100%', sm: 'auto' } }}>
            <Button variant="outlined" startIcon={<ClearAll />} onClick={handleClearFilters} size="small" sx={{ width: { xs: '100%', sm: 'auto' } }}>
              Clear Filters
            </Button>
            <Button variant="contained" startIcon={<Download />} onClick={handleExportCSV} disabled={totalCount === 0} size="small" sx={{ width: { xs: '100%', sm: 'auto' } }}>
              Export CSV
            </Button>
            <Button variant="outlined" startIcon={<ViewColumn />} onClick={() => setShowColumnControls(!showColumnControls)} size="small" sx={{ width: { xs: '100%', sm: 'auto' } }}>
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
              <Button variant="outlined" size="small" onClick={() => setVisibleColumns({ date: true, description: true, category: true, company: true, project: true, label: true, amount: true, account: true, actions: true })}>Show All</Button>
              <Button variant="outlined" size="small" onClick={() => setVisibleColumns({ date: true, description: true, category: false, company: false, project: false, label: false, amount: true, account: false, actions: true })}>Mobile View</Button>
            </Box>
            <FormGroup>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' }, gap: 1 }}>
                {Object.entries(columnLabels).map(([key, label]) => (
                  <FormControlLabel
                    key={key}
                    control={<Checkbox checked={visibleColumns[key as keyof typeof visibleColumns]} onChange={() => handleColumnToggle(key as keyof typeof visibleColumns)} size="small" />}
                    label={label}
                  />
                ))}
              </Box>
            </FormGroup>
          </Paper>
        </Collapse>

        {/* Summary Stats */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: { xs: 2, sm: 3 }, mb: 3 }}>
          <Card><CardContent>
            <Typography variant="h6" color="success.main">{formatCurrency(totalIncome)}</Typography>
            <Typography variant="body2" color="text.secondary">Total Income</Typography>
          </CardContent></Card>
          <Card><CardContent>
            <Typography variant="h6" color="error.main">{formatCurrency(totalExpenses)}</Typography>
            <Typography variant="body2" color="text.secondary">Total Expenses</Typography>
          </CardContent></Card>
          <Card><CardContent>
            <Typography variant="h6" color={netIncome >= 0 ? 'success.main' : 'error.main'}>{formatCurrency(netIncome)}</Typography>
            <Typography variant="body2" color="text.secondary">Net Income</Typography>
          </CardContent></Card>
          <Card><CardContent>
            <Typography variant="h6" color="primary.main">{totalCount.toLocaleString()}</Typography>
            <Typography variant="body2" color="text.secondary">Transactions</Typography>
          </CardContent></Card>
        </Box>

        {/* Filters */}
        <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <FilterList />
            <Typography variant="h6">Filters</Typography>
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' }, gap: 2 }}>
              <TextField fullWidth label="Search" placeholder="Description, category, company..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} />
              <FormControl fullWidth>
                <InputLabel>Type</InputLabel>
                <Select value={typeFilter} label="Type" onChange={(e) => setTypeFilter(e.target.value as any)}>
                  <MenuItem value="all">All</MenuItem>
                  <MenuItem value="income">Income</MenuItem>
                  <MenuItem value="expense">Expense</MenuItem>
                </Select>
              </FormControl>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
              <DatePicker label="Start Date" value={startDate} onChange={setStartDate} slotProps={{ textField: { fullWidth: true } }} />
              <DatePicker label="End Date" value={endDate} onChange={setEndDate} slotProps={{ textField: { fullWidth: true } }} />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: 2 }}>
              <TextField fullWidth label="Min Amount" type="number" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} inputProps={{ min: 0, step: 0.01 }} />
              <TextField fullWidth label="Max Amount" type="number" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} inputProps={{ min: 0, step: 0.01 }} />
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' }, gap: 2 }}>
              <Autocomplete multiple options={categories} getOptionLabel={(o) => o.name} value={categories.filter((c: Category) => categoryFilter.includes(c.id))} onChange={(_, v) => setCategoryFilter(v.map(x => x.id))}
                renderInput={(p) => <TextField {...p} label="Categories" />}
                renderTags={(v, gp) => v.map((o, i) => { const { key, ...cp } = gp({ index: i }); return <Chip key={key} label={o.name} size="small" {...cp} />; })} />
              <Autocomplete multiple options={companies} getOptionLabel={(o) => o.name} value={companies.filter((c: Company) => companyFilter.includes(c.id))} onChange={(_, v) => setCompanyFilter(v.map(x => x.id))}
                renderInput={(p) => <TextField {...p} label="Companies" />}
                renderTags={(v, gp) => v.map((o, i) => { const { key, ...cp } = gp({ index: i }); return <Chip key={key} label={o.name} size="small" {...cp} />; })} />
              <Autocomplete multiple options={projects} getOptionLabel={(o) => o.name} value={projects.filter((p: any) => projectFilter.includes(p.id))} onChange={(_, v) => setProjectFilter(v.map(x => x.id))}
                renderInput={(p) => <TextField {...p} label="Projects" />}
                renderTags={(v, gp) => v.map((o, i) => { const { key, ...cp } = gp({ index: i }); return <Chip key={key} label={o.name} size="small" {...cp} />; })} />
              <Autocomplete multiple options={accounts}
                getOptionLabel={(o) => o.owner_display_name ? `${o.owner_display_name} - ${o.name}` : o.name}
                isOptionEqualToValue={(o, v) => o.id === v.id}
                value={accounts.filter((a: Account) => accountFilter.includes(a.id))}
                onChange={(_, v) => setAccountFilter(v.map(x => x.id))}
                renderOption={(props, option) => { const { key, ...op } = props; return <li key={option.id} {...op}>{option.owner_display_name ? `${option.owner_display_name} - ${option.name}` : option.name}</li>; }}
                renderInput={(p) => <TextField {...p} label="Accounts" />}
                renderTags={(v, gp) => v.map((o, i) => { const { key, ...cp } = gp({ index: i }); return <Chip key={key} label={o.owner_display_name ? `${o.owner_display_name} - ${o.name}` : o.name} size="small" {...cp} />; })} />
            </Box>
          </Box>
        </Paper>

        {/* Results Table */}
        <Paper>
          {loading && (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
              <CircularProgress size={24} />
            </Box>
          )}
          <TableContainer sx={{ overflowX: 'auto' }}>
            <Table sx={{ minWidth: { xs: 300, sm: 800 } }}>
              <TableHead>
                <TableRow>
                  {visibleColumns.date && <TableCell><TableSortLabel active={orderBy === 'date'} direction={orderBy === 'date' ? order : 'asc'} onClick={() => handleRequestSort('date')}>Date</TableSortLabel></TableCell>}
                  {visibleColumns.description && <TableCell><TableSortLabel active={orderBy === 'description'} direction={orderBy === 'description' ? order : 'asc'} onClick={() => handleRequestSort('description')}>Description</TableSortLabel></TableCell>}
                  {visibleColumns.category && <TableCell>Category</TableCell>}
                  {visibleColumns.company && <TableCell>Company</TableCell>}
                  {visibleColumns.project && <TableCell>Project</TableCell>}
                  {visibleColumns.label && <TableCell>Label</TableCell>}
                  {visibleColumns.amount && <TableCell align="right"><TableSortLabel active={orderBy === 'amount'} direction={orderBy === 'amount' ? order : 'asc'} onClick={() => handleRequestSort('amount')}>Amount</TableSortLabel></TableCell>}
                  {visibleColumns.account && <TableCell>Account</TableCell>}
                  {visibleColumns.actions && <TableCell align="center">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {transactions.map((transaction: Transaction) => (
                  <TableRow key={transaction.id} hover sx={{
                    backgroundColor: alpha(transaction.type === 'income' ? theme.palette.success.main : theme.palette.error.main, 0.1),
                    '&:hover': { backgroundColor: alpha(transaction.type === 'income' ? theme.palette.success.main : theme.palette.error.main, 0.2) + ' !important' }
                  }}>
                    {visibleColumns.date && <TableCell sx={{ minWidth: 100 }}>{format(parseISO(transaction.date), isMobile ? 'MM/dd/yy' : 'MMM dd, yyyy')}</TableCell>}
                    {visibleColumns.description && (
                      <TableCell sx={{ minWidth: { xs: 150, sm: 200 }, maxWidth: { xs: 200, sm: 300 }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        <Box component="div" title={transaction.description} sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{transaction.description}</Box>
                      </TableCell>
                    )}
                    {visibleColumns.category && <TableCell sx={{ minWidth: 120 }}>{transaction.category_name}</TableCell>}
                    {visibleColumns.company && <TableCell sx={{ minWidth: 120 }}>{transaction.company_name || '-'}</TableCell>}
                    {visibleColumns.project && <TableCell sx={{ minWidth: 120 }}>{transaction.project_name || '-'}</TableCell>}
                    {visibleColumns.label && <TableCell sx={{ minWidth: 120 }}>{renderTransactionLabel(transaction)}</TableCell>}
                    {visibleColumns.amount && (
                      <TableCell align="right" sx={{ minWidth: 100 }}>
                        <Typography color={transaction.type === 'income' ? 'success.main' : 'error.main'} fontWeight="medium" variant={isMobile ? 'body2' : 'body1'}>
                          {transaction.type === 'income' ? '+' : '-'}{formatCurrency(Math.abs(transaction.amount))}
                        </Typography>
                      </TableCell>
                    )}
                    {visibleColumns.account && (
                      <TableCell sx={{ minWidth: 120 }}>
                        {(() => {
                          const account = accounts.find((a: Account) => a.id === transaction.account_id);
                          return account?.owner_display_name ? `${account.owner_display_name} - ${transaction.account_name}` : transaction.account_name;
                        })()}
                      </TableCell>
                    )}
                    {visibleColumns.actions && (
                      <TableCell align="center" sx={{ minWidth: 80 }}>
                        <IconButton size="small" onClick={() => handleLabelTransaction(transaction)} title="Label Transaction">
                          <Receipt fontSize="small" />
                        </IconButton>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            rowsPerPageOptions={isMobile ? [10, 25] : [10, 25, 50, 100]}
            component="div"
            count={totalCount}
            rowsPerPage={rowsPerPage}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0); }}
            labelRowsPerPage={isMobile ? 'Rows:' : 'Rows per page:'}
            sx={{
              '& .MuiTablePagination-spacer': { display: { xs: 'none', sm: 'flex' } },
              '& .MuiTablePagination-selectLabel': { display: { xs: 'none', sm: 'block' } }
            }}
          />
        </Paper>

        {!loading && totalCount === 0 && (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="h6" color="text.secondary">No transactions found matching your filters</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Try adjusting your search criteria or clearing the filters</Typography>
          </Box>
        )}

        <TransactionLabelDialog
          open={labelDialogOpen}
          onClose={() => { setLabelDialogOpen(false); setSelectedTransaction(null); }}
          transaction={selectedTransaction}
          onSuccess={() => console.log('Transaction labeled successfully')}
        />
      </Box>
    </LocalizationProvider>
  );
}
