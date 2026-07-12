'use client';

import React, { useState } from 'react';
import {
  Box,
  Stack,
  Chip,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import {
  DateRange,
  Add,
  Upload,
  Download,
} from '@mui/icons-material';
import { format } from 'date-fns';
import type { Account, TransactionScopeFilters, User } from '@/types/database';

interface DateRangeSelectorProps {
  timeRange: 'week' | 'month' | 'year' | 'custom';
  onTimeRangeChange: (range: 'week' | 'month' | 'year' | 'custom') => void;
  customStartDate?: string;
  customEndDate?: string;
  onCustomDateChange?: (start: string, end: string) => void;
  onExport?: () => void;
  onAddTransaction?: () => void;
  onCsvImport?: () => void;
  accounts?: Account[];
  users?: User[];
  scopeFilters?: TransactionScopeFilters;
  onScopeFiltersChange?: (filters: TransactionScopeFilters) => void;
}

const DateRangeSelector: React.FC<DateRangeSelectorProps> = ({
  timeRange,
  onTimeRangeChange,
  customStartDate = '',
  customEndDate = '',
  onCustomDateChange,
  onExport,
  onAddTransaction,
  onCsvImport,
  accounts = [],
  users = [],
  scopeFilters = {},
  onScopeFiltersChange,
}) => {
  const [customDialogOpen, setCustomDialogOpen] = useState(false);
  const [tempStartDate, setTempStartDate] = useState(customStartDate);
  const [tempEndDate, setTempEndDate] = useState(customEndDate);

  const handleTimeRangeClick = (range: 'week' | 'month' | 'year' | 'custom') => {
    if (range === 'custom') {
      setTempStartDate(customStartDate);
      setTempEndDate(customEndDate);
      setCustomDialogOpen(true);
    } else {
      onTimeRangeChange(range);
    }
  };

  const handleCustomApply = () => {
    if (tempStartDate && tempEndDate && onCustomDateChange) {
      onCustomDateChange(tempStartDate, tempEndDate);
      onTimeRangeChange('custom');
      setCustomDialogOpen(false);
    }
  };

  const getTimeRangeLabel = () => {
    switch (timeRange) {
      case 'week': return 'This Week';
      case 'month': return 'This Month';
      case 'year': return 'This Year';
      case 'custom':
        if (customStartDate && customEndDate) {
          return `${format(new Date(customStartDate), 'MMM dd, yyyy')} - ${format(new Date(customEndDate), 'MMM dd, yyyy')}`;
        }
        return 'Custom Range';
      default: return 'This Month';
    }
  };

  return (
    <>
      {/* Header with Actions */}
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
          {onExport && (
            <Button
              variant="outlined"
              startIcon={<Download />}
              onClick={onExport}
              size="small"
              sx={{ width: { xs: '100%', sm: 'auto' } }}
            >
              Export Data
            </Button>
          )}
          {onCsvImport && (
            <Button
              variant="outlined"
              startIcon={<Upload />}
              onClick={onCsvImport}
              size="small"
              sx={{ width: { xs: '100%', sm: 'auto' } }}
            >
              Import CSV
            </Button>
          )}
          {onAddTransaction && (
            <Button 
              variant="contained" 
              startIcon={<Add />}
              onClick={onAddTransaction}
              size="small"
              sx={{ width: { xs: '100%', sm: 'auto' } }}
            >
              Add Transaction
            </Button>
          )}
        </Stack>
      </Box>

      {/* Time Range Selector */}
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
                onClick={() => handleTimeRangeClick(range)}
                size="small"
              />
            ))}
          </Box>
          {timeRange === 'custom' && customStartDate && customEndDate && (
            <Typography variant="body2" color="text.secondary">
              {getTimeRangeLabel()}
            </Typography>
          )}
        </Stack>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2 }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>Accounts</InputLabel>
            <Select
              multiple
              value={scopeFilters.accountIds ?? []}
              label="Accounts"
              onChange={(event) => onScopeFiltersChange?.({
                ...scopeFilters,
                accountIds: (event.target.value as number[]),
              })}
              renderValue={(selected) => selected.length === 0 ? 'All' : `${selected.length} selected`}
            >
              {accounts.map((account) => (
                <MenuItem key={account.id} value={account.id}>{account.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>Users</InputLabel>
            <Select
              multiple
              value={scopeFilters.userIds ?? []}
              label="Users"
              onChange={(event) => onScopeFiltersChange?.({
                ...scopeFilters,
                userIds: (event.target.value as number[]),
              })}
              renderValue={(selected) => selected.length === 0 ? 'All' : `${selected.length} selected`}
            >
              {users.map((user) => (
                <MenuItem key={user.id} value={user.id}>{user.display_name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Box>

      {/* Custom Date Range Dialog */}
      <Dialog open={customDialogOpen} onClose={() => setCustomDialogOpen(false)}>
        <DialogTitle>Select Custom Date Range</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2, minWidth: 300 }}>
            <TextField
              label="Start Date"
              type="date"
              value={tempStartDate}
              onChange={(e) => setTempStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label="End Date"
              type="date"
              value={tempEndDate}
              onChange={(e) => setTempEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleCustomApply} 
            variant="contained"
            disabled={!tempStartDate || !tempEndDate}
          >
            Apply
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default DateRangeSelector;
