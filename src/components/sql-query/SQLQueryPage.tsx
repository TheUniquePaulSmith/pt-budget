'use client';

import React, { useState, useCallback } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Alert,
  CircularProgress,
  Chip,
  Stack,
  TablePagination,
  Card,
  CardContent,
  IconButton,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  PlayArrow,
  Clear,
  Storage,
  ExpandMore,
  ContentCopy,
  History,
} from '@mui/icons-material';
import { useSqlQuerySlice } from '@/contexts/useDatabaseSlices';

interface QueryResult {
  columns: string[];
  rows: any[][];
  rowCount: number;
  executionTime: number;
}

interface QueryHistory {
  id: string;
  query: string;
  timestamp: Date;
  success: boolean;
  rowCount?: number;
  error?: string;
}

export default function SQLQueryPage() {
  const { executeCustomQuery, isDatabaseLoaded } = useSqlQuerySlice();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [query, setQuery] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [queryHistory, setQueryHistory] = useState<QueryHistory[]>([]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);

  // Sample queries for reference
  const sampleQueries = [
    {
      title: 'All Transactions',
      query: 'SELECT * FROM transactions ORDER BY date DESC LIMIT 10;'
    },
    {
      title: 'Transaction Summary by Category',
      query: `SELECT 
  c.name as category,
  t.type,
  COUNT(*) as transaction_count,
  SUM(ABS(t.amount)) as total_amount
FROM transactions t
LEFT JOIN categories c ON t.category_id = c.id
GROUP BY c.name, t.type
ORDER BY total_amount DESC;`
    },
    {
      title: 'Monthly Spending Totals',
      query: `SELECT 
  strftime('%Y-%m', date) as month,
  SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as income,
  SUM(CASE WHEN type = 'expense' THEN ABS(amount) ELSE 0 END) as expenses
FROM transactions
GROUP BY strftime('%Y-%m', date)
ORDER BY month DESC;`
    },
    {
      title: 'Top 10 Expense Categories',
      query: `SELECT 
  c.name as category,
  COUNT(*) as transaction_count,
  SUM(ABS(t.amount)) as total_spent
FROM transactions t
LEFT JOIN categories c ON t.category_id = c.id
WHERE t.type = 'expense'
GROUP BY c.id, c.name
ORDER BY total_spent DESC
LIMIT 10;`
    },
    {
      title: 'Database Schema - Tables',
      query: `SELECT 
  name as table_name,
  type
FROM sqlite_master 
WHERE type IN ('table', 'view')
ORDER BY name;`
    },
    {
      title: 'Database Schema - Columns',
      query: `SELECT 
  m.name as table_name,
  p.name as column_name,
  p.type as data_type,
  p.[notnull] as not_null,
  p.pk as primary_key
FROM sqlite_master m
LEFT OUTER JOIN pragma_table_info(m.name) p
WHERE m.type = 'table'
ORDER BY m.name, p.cid;`
    }
  ];

  const executeQuery = useCallback(async () => {
    if (!query.trim()) {
      setError('Please enter a SQL query');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setPage(0);

    const startTime = performance.now();
    const historyEntry: QueryHistory = {
      id: Date.now().toString(),
      query: query.trim(),
      timestamp: new Date(),
      success: false,
    };

    try {
      // Check if database is loaded
      if (!isDatabaseLoaded) {
        throw new Error('Database not loaded');
      }

      // Execute the custom query
      const rows: any[] = await executeCustomQuery(query.trim());
      const endTime = performance.now();
      
      let columns: string[] = [];
      let resultRows: any[][] = [];

      if (rows.length > 0) {
        // Get column names from the first row
        columns = Object.keys(rows[0]);
        
        // Convert rows to array format
        resultRows = rows.map((row: any) => columns.map(col => row[col]));
      }

      const queryResult: QueryResult = {
        columns,
        rows: resultRows,
        rowCount: rows.length,
        executionTime: endTime - startTime,
      };

      setResult(queryResult);
      
      // Update history
      historyEntry.success = true;
      historyEntry.rowCount = rows.length;
      setQueryHistory(prev => [historyEntry, ...prev.slice(0, 19)]); // Keep last 20 queries

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      
      // Update history with error
      historyEntry.error = errorMessage;
      setQueryHistory(prev => [historyEntry, ...prev.slice(0, 19)]);
    } finally {
      setLoading(false);
    }
  }, [query, executeCustomQuery, isDatabaseLoaded]);

  const handleQuerySelect = (selectedQuery: string) => {
    setQuery(selectedQuery);
  };

  const handleHistorySelect = (historicalQuery: string) => {
    setQuery(historicalQuery);
  };

  const clearQuery = () => {
    setQuery('');
    setResult(null);
    setError(null);
    setPage(0);
  };

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
    }
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return JSON.stringify(value);
  };

  return (
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
          <Storage color="primary" />
          <Typography 
            variant="h4" 
            component="h1"
            sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}
          >
            SQL Query Console
          </Typography>
        </Box>
      </Box>

      {/* Query Input */}
      <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          SQL Query
        </Typography>
        
        <TextField
          fullWidth
          multiline
          rows={isMobile ? 6 : 8}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Enter your SQL query here..."
          variant="outlined"
          inputProps={{
            'data-testid': 'sql-query-input',
          }}
          sx={{ 
            mb: 2,
            '& .MuiInputBase-input': {
              fontFamily: 'monospace',
              fontSize: '0.875rem',
            }
          }}
        />

        <Stack 
          direction={{ xs: 'column', sm: 'row' }} 
          spacing={2}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          <Button
            variant="contained"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />}
            onClick={executeQuery}
            disabled={loading || !query.trim()}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            {loading ? 'Executing...' : 'Execute Query'}
          </Button>
          <Button
            variant="outlined"
            startIcon={<Clear />}
            onClick={clearQuery}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            Clear
          </Button>
        </Stack>
      </Paper>

      {/* Sample Queries */}
      <Accordion sx={{ mb: 3 }}>
        <AccordionSummary expandIcon={<ExpandMore />}>
          <Typography variant="h6">Sample Queries</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {sampleQueries.map((sample, index) => (
              <Card key={index} variant="outlined">
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                    <Typography variant="subtitle2" color="primary">
                      {sample.title}
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Tooltip title="Copy to clipboard">
                        <IconButton 
                          size="small" 
                          onClick={() => copyToClipboard(sample.query)}
                        >
                          <ContentCopy fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Button 
                        size="small" 
                        onClick={() => handleQuerySelect(sample.query)}
                      >
                        Use Query
                      </Button>
                    </Stack>
                  </Box>
                  <Typography 
                    variant="body2" 
                    sx={{ 
                      fontFamily: 'monospace',
                      fontSize: '0.75rem',
                      bgcolor: 'grey.100',
                      p: 1,
                      borderRadius: 1,
                      whiteSpace: 'pre-wrap',
                      overflow: 'auto'
                    }}
                  >
                    {sample.query}
                  </Typography>
                </CardContent>
              </Card>
            ))}
          </Box>
        </AccordionDetails>
      </Accordion>

      {/* Query History */}
      {queryHistory.length > 0 && (
        <Accordion sx={{ mb: 3 }}>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <History />
              <Typography variant="h6">Query History ({queryHistory.length})</Typography>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <List dense>
              {queryHistory.map((entry) => (
                <ListItem 
                  key={entry.id}
                  sx={{ 
                    border: 1, 
                    borderColor: 'divider', 
                    borderRadius: 1, 
                    mb: 1,
                    flexDirection: 'column',
                    alignItems: 'stretch'
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', width: '100%' }}>
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <Chip 
                          label={entry.success ? 'Success' : 'Error'} 
                          color={entry.success ? 'success' : 'error'}
                          size="small"
                        />
                        <Typography variant="caption" color="text.secondary">
                          {entry.timestamp.toLocaleString()}
                        </Typography>
                        {entry.success && entry.rowCount !== undefined && (
                          <Typography variant="caption" color="text.secondary">
                            ({entry.rowCount} rows)
                          </Typography>
                        )}
                      </Box>
                      <Typography 
                        variant="body2" 
                        sx={{ 
                          fontFamily: 'monospace',
                          fontSize: '0.75rem',
                          maxHeight: '3em',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical'
                        }}
                      >
                        {entry.query}
                      </Typography>
                      {!entry.success && entry.error && (
                        <Typography variant="caption" color="error.main" sx={{ mt: 1, display: 'block' }}>
                          Error: {entry.error}
                        </Typography>
                      )}
                    </Box>
                    <Button 
                      size="small" 
                      onClick={() => handleHistorySelect(entry.query)}
                      sx={{ ml: 1, flexShrink: 0 }}
                    >
                      Use
                    </Button>
                  </Box>
                </ListItem>
              ))}
            </List>
          </AccordionDetails>
        </Accordion>
      )}

      {/* Error Display */}
      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          <Typography variant="body2" component="pre" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
            {error}
          </Typography>
        </Alert>
      )}

      {/* Results */}
      {result && (
        <Paper sx={{ mb: 3 }} data-testid="sql-query-results">
          <Box sx={{ p: { xs: 2, sm: 3 }, borderBottom: 1, borderColor: 'divider' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="h6">Query Results</Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                <Chip 
                  label={`${result.rowCount} rows`} 
                  size="small" 
                  color="primary" 
                />
                <Chip 
                  label={`${result.executionTime.toFixed(2)}ms`} 
                  size="small" 
                  variant="outlined" 
                />
              </Box>
            </Box>
          </Box>

          {result.rows.length > 0 ? (
            <>
              <TableContainer sx={{ maxHeight: isMobile ? 400 : 600, overflowX: 'auto' }}>
                <Table stickyHeader>
                  <TableHead>
                    <TableRow>
                      {result.columns.map((column, index) => (
                        <TableCell 
                          key={index}
                          sx={{ 
                            fontWeight: 'bold',
                            minWidth: 100,
                            bgcolor: 'grey.50'
                          }}
                        >
                          {column}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.rows
                      .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                      .map((row, rowIndex) => (
                        <TableRow key={page * rowsPerPage + rowIndex} hover>
                          {row.map((cell, cellIndex) => (
                            <TableCell 
                              key={cellIndex}
                              sx={{
                                fontFamily: cell === null ? 'inherit' : 'monospace',
                                fontSize: '0.875rem',
                                fontStyle: cell === null ? 'italic' : 'normal',
                                color: cell === null ? 'text.secondary' : 'inherit',
                                maxWidth: 300,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                              title={formatValue(cell)}
                            >
                              {formatValue(cell)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <TablePagination
                rowsPerPageOptions={[10, 25, 50, 100, 250, 500]}
                component="div"
                count={result.rows.length}
                rowsPerPage={rowsPerPage}
                page={page}
                onPageChange={handleChangePage}
                onRowsPerPageChange={handleChangeRowsPerPage}
                sx={{ borderTop: 1, borderColor: 'divider' }}
              />
            </>
          ) : (
            <Box sx={{ p: 3, textAlign: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                Query executed successfully but returned no rows.
              </Typography>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
}
