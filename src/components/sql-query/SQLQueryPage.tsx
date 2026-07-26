'use client';

import React, { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Box,
  Typography,
  Paper,
  Button,
  Alert,
  CircularProgress,
  Chip,
  Stack,
  Tooltip,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  MenuItem,
  TextField,
  Skeleton,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  PlayArrow,
  Clear,
  Storage,
  ExpandMore,
  History,
  ListAlt,
  AutoFixHigh,
} from '@mui/icons-material';
import type { GridColDef } from '@mui/x-data-grid';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { useSqlQuerySlice } from '@/contexts/useDatabaseSlices';

import { useSqlSchema } from './useSqlSchema';
import SampleQueriesDrawer from './SampleQueriesDrawer';
import type { SqlQueryAnalysis } from './sqlQueryAnalysis';
import { GridToolbar } from '@mui/x-data-grid/internals';

// CodeMirror + the local SQL parser used for linting are a few hundred KB;
// loaded only when this page is actually opened, not with the main bundle.
const SqlEditor = dynamic(() => import('./SqlEditor'), {
  ssr: false,
  loading: () => <Skeleton variant="rectangular" height={160} sx={{ borderRadius: 1 }} />,
});

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

const EMPTY_ANALYSIS: SqlQueryAnalysis = { issues: [], blockingReason: null };
const MAX_VISIBLE_ISSUES = 5;

export default function SQLQueryPage() {
  const { executeCustomQuery, isDatabaseLoaded } = useSqlQuerySlice();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const { schema, schemaError, schemaLoading } = useSqlSchema(executeCustomQuery, isDatabaseLoaded);

  const [query, setQuery] = useState('');
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [queryHistory, setQueryHistory] = useState<QueryHistory[]>([]);
  const [queryTimeout, setQueryTimeout] = useState(10000);
  const [analysis, setAnalysis] = useState<SqlQueryAnalysis>(EMPTY_ANALYSIS);
  const [formatting, setFormatting] = useState(false);
  const [sampleQueriesOpen, setSampleQueriesOpen] = useState(false);

  const executeQuery = useCallback(async () => {
    if (!query.trim()) {
      setError('Please enter a SQL query');
      return;
    }

    if (analysis.blockingReason) {
      setError(analysis.blockingReason);
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

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
      const rows: any[] = await executeCustomQuery(query.trim(), queryTimeout);
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
  }, [query, executeCustomQuery, isDatabaseLoaded, queryTimeout, analysis.blockingReason]);

  const handleFormat = useCallback(async () => {
    if (!query.trim()) {
      return;
    }
    setFormatting(true);
    try {
      const { formatDialect, sqlite } = await import('sql-formatter');
      setQuery(formatDialect(query, { dialect: sqlite, keywordCase: 'upper' }));
    } catch (err) {
      setError(err instanceof Error ? `Failed to format query: ${err.message}` : 'Failed to format query');
    } finally {
      setFormatting(false);
    }
  }, [query]);

  const handleHistorySelect = (historicalQuery: string) => {
    setQuery(historicalQuery);
  };

  const clearQuery = () => {
    setQuery('');
    setResult(null);
    setError(null);
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'string') return value;
    if (typeof value === 'number') return value.toString();
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return JSON.stringify(value);
  };

  const resultGridRows = result?.rows.map((row, rowIndex) => {
    const gridRow: Record<string, any> = { __idx: rowIndex };
    result.columns.forEach((column, columnIndex) => {
      gridRow[column] = row[columnIndex];
    });
    return gridRow;
  }) ?? [];

  const resultGridColumns: GridColDef[] = result?.columns.map((column) => ({
    field: column,
    headerName: column,
    minWidth: 120,
    flex: 1,
    renderCell: (params) => (
      <Tooltip title={formatValue(params.value)}>
        <Typography
          variant="body2"
          sx={{
            fontFamily: params.value == null ? 'inherit' : 'monospace',
            fontStyle: params.value == null ? 'italic' : 'normal',
            color: params.value == null ? 'text.secondary' : 'inherit',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {formatValue(params.value)}
        </Typography>
      </Tooltip>
    ),
  })) ?? [];

  const visibleIssues = analysis.issues.slice(0, MAX_VISIBLE_ISSUES);
  const hiddenIssueCount = analysis.issues.length - visibleIssues.length;

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
        <Button
          variant="outlined"
          startIcon={<ListAlt />}
          onClick={() => setSampleQueriesOpen(true)}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          Sample Queries
        </Button>
      </Box>

      {/* Query Input */}
      <Paper sx={{ p: { xs: 2, sm: 3 }, mb: 3 }}>
        <Typography variant="h6" sx={{ mb: 2 }}>
          SQL Query
        </Typography>

        <Box sx={{ mb: 1 }}>
          <SqlEditor
            value={query}
            onChange={setQuery}
            schema={schema}
            onExecute={executeQuery}
            onAnalysis={setAnalysis}
            data-testid="sql-query-input"
          />
        </Box>

        {schemaError && (
          <Typography variant="caption" color="warning.main" sx={{ display: 'block', mb: 1 }}>
            Autocomplete and schema checks are unavailable: {schemaError}
          </Typography>
        )}

        {visibleIssues.length > 0 && (
          <Stack spacing={0.5} sx={{ mb: 2 }}>
            {visibleIssues.map((issue, index) => (
              <Alert key={index} severity={issue.severity} sx={{ py: 0 }}>
                {issue.message}
              </Alert>
            ))}
            {hiddenIssueCount > 0 && (
              <Typography variant="caption" color="text.secondary">
                +{hiddenIssueCount} more issue{hiddenIssueCount === 1 ? '' : 's'}
              </Typography>
            )}
          </Stack>
        )}

        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          <TextField
            select
            label="Time Limit"
            value={queryTimeout}
            onChange={(e) => setQueryTimeout(Number(e.target.value))}
            size="small"
            sx={{ minWidth: 130 }}
          >
            <MenuItem value={5000}>5 seconds</MenuItem>
            <MenuItem value={10000}>10 seconds</MenuItem>
            <MenuItem value={30000}>30 seconds</MenuItem>
            <MenuItem value={60000}>1 minute</MenuItem>
            <MenuItem value={120000}>2 minutes</MenuItem>
            <MenuItem value={300000}>5 minutes</MenuItem>
            <MenuItem value={Number.MAX_VALUE}>No limit</MenuItem>
          </TextField>
          <Button
            variant="contained"
            startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <PlayArrow />}
            onClick={executeQuery}
            disabled={loading || !query.trim() || Boolean(analysis.blockingReason)}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            {loading ? 'Executing...' : 'Execute Query'}
          </Button>
          <Button
            variant="outlined"
            startIcon={formatting ? <CircularProgress size={16} /> : <AutoFixHigh />}
            onClick={handleFormat}
            disabled={formatting || !query.trim()}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            Format
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
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Ctrl+Enter (Cmd+Enter on Mac) runs the query. Syntax, schema, and SELECT-only checks run locally, before anything is sent to the database.
        </Typography>
      </Paper>

      <SampleQueriesDrawer
        open={sampleQueriesOpen}
        onClose={() => setSampleQueriesOpen(false)}
        onSelectQuery={setQuery}
      />

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
            <Box sx={{ p: 2 }}>
              <AppDataGrid
                rows={resultGridRows}
                columns={resultGridColumns}
                getRowId={(row) => row.__idx}
                height={isMobile ? 420 : 620}
                initialState={{ pagination: { paginationModel: { pageSize: 25, page: 0 } } }}
                pageSizeOptions={[10, 25, 50, 100]}
                disableVirtualization={process.env.NODE_ENV === 'test'}
                slotProps={{
                  toolbar: {
                    csvOptions: { fileName: 'query_results', utf8WithBom: true },
                    showQuickFilter: true,
                  }
                }}
              />
            </Box>
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
