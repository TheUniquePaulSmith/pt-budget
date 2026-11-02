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
import { DateRange } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useFormatters } from '@/contexts/useFormatters';
import type { Account, TransactionScopeFilters, User } from '@/types/database';

interface DateRangeSelectorProps {
  timeRange: 'week' | 'month' | 'year' | 'custom';
  onTimeRangeChange: (range: 'week' | 'month' | 'year' | 'custom') => void;
  customStartDate?: string;
  customEndDate?: string;
  onCustomDateChange?: (start: string, end: string) => void;
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
  accounts = [],
  users = [],
  scopeFilters = {},
  onScopeFiltersChange,
}) => {
  const { t } = useTranslation(['dashboard', 'common']);
  const { date } = useFormatters();
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
      case 'week': return t('timeRangeLabel.week');
      case 'month': return t('timeRangeLabel.month');
      case 'year': return t('timeRangeLabel.year');
      case 'custom':
        if (customStartDate && customEndDate) {
          return t('timeRangeLabel.customRange', { start: date(customStartDate), end: date(customEndDate) });
        }
        return t('dateRangeSelector.customRange');
      default: return t('timeRangeLabel.month');
    }
  };

  const rangeChipLabel = (range: 'week' | 'month' | 'year' | 'custom') => {
    switch (range) {
      case 'week': return t('dateRangeSelector.week');
      case 'month': return t('common:fields.month');
      case 'year': return t('common:fields.year');
      default: return t('dateRangeSelector.custom');
    }
  };

  const renderSelectedCount = (selected: number[]) =>
    selected.length === 0 ? t('common:fields.all') : t('dateRangeSelector.selectedCount', { count: selected.length });

  return (
    <>
      <Box sx={{ mb: 3 }}>
        <Typography
          variant="h4"
          component="h1"
          fontWeight="bold"
          sx={{ fontSize: { xs: '1.75rem', sm: '2.125rem' } }}
        >
          {t('dateRangeSelector.title')}
        </Typography>
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
              {t('dateRangeSelector.timePeriod')}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {(['week', 'month', 'year', 'custom'] as const).map((range) => (
              <Chip
                key={range}
                label={rangeChipLabel(range)}
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
            <InputLabel>{t('dateRangeSelector.accounts')}</InputLabel>
            <Select
              multiple
              value={scopeFilters.accountIds ?? []}
              label={t('dateRangeSelector.accounts')}
              onChange={(event) => onScopeFiltersChange?.({
                ...scopeFilters,
                accountIds: (event.target.value as number[]),
              })}
              renderValue={renderSelectedCount}
            >
              {accounts.map((account) => (
                <MenuItem key={account.id} value={account.id}>{account.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>{t('dateRangeSelector.users')}</InputLabel>
            <Select
              multiple
              value={scopeFilters.userIds ?? []}
              label={t('dateRangeSelector.users')}
              onChange={(event) => onScopeFiltersChange?.({
                ...scopeFilters,
                userIds: (event.target.value as number[]),
              })}
              renderValue={renderSelectedCount}
            >
              {users.map((user) => (
                <MenuItem key={user.id} value={user.id}>{user.display_name}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>
      </Box>

      {/* Custom Date Range Dialog */}
      <Dialog open={customDialogOpen} onClose={() => setCustomDialogOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>{t('dateRangeSelector.dialogTitle')}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <TextField
              label={t('dateRangeSelector.startDate')}
              type="date"
              value={tempStartDate}
              onChange={(e) => setTempStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label={t('dateRangeSelector.endDate')}
              type="date"
              value={tempEndDate}
              onChange={(e) => setTempEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomDialogOpen(false)}>{t('common:actions.cancel')}</Button>
          <Button
            onClick={handleCustomApply}
            variant="contained"
            disabled={!tempStartDate || !tempEndDate}
          >
            {t('common:actions.apply')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default DateRangeSelector;
