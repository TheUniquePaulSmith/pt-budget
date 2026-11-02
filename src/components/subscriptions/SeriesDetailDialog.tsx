'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography,
  createFilterOptions,
} from '@mui/material';
import type { GridColDef } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { accountColumn, cardColumn, userColumn } from '@/components/common/DataGrid/columns';
import { useFormatters } from '@/contexts/useFormatters';
import type {
  Company,
  RecurringSeries,
  RecurringSeriesCadence,
  RecurringSeriesKind,
  RecurringSeriesStatus,
  Transaction,
} from '@/types/database';
import type {
  RecurringSeriesCompanyInput,
  RecurringSeriesUpdate,
} from '@/contexts/useDatabaseSubscriptionsSlice';

interface CompanyOption {
  id: number;
  name: string;
  isNew?: boolean;
}

const companyFilter = createFilterOptions<CompanyOption>();

const KIND_VALUES: ReadonlyArray<RecurringSeriesKind> = ['subscription', 'bill'];
const CADENCE_VALUES: ReadonlyArray<RecurringSeriesCadence> = ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'irregular'];
const STATUS_VALUES: ReadonlyArray<RecurringSeriesStatus> = ['candidate', 'active', 'inactive', 'ignored'];

interface SeriesDetailDialogProps {
  open: boolean;
  series: RecurringSeries | null;
  companies: Company[];
  onClose: () => void;
  onSave: (id: number, updates: RecurringSeriesUpdate) => Promise<void>;
  onSetCompany: (id: number, input: RecurringSeriesCompanyInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  getSeriesTransactions: (seriesId: number) => Promise<Transaction[]>;
}

const SeriesDetailDialog: React.FC<SeriesDetailDialogProps> = ({
  open,
  series,
  companies,
  onClose,
  onSave,
  onSetCompany,
  onDelete,
  getSeriesTransactions,
}) => {
  const { t } = useTranslation('subscriptions');
  const { money } = useFormatters();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<RecurringSeries['kind']>('subscription');
  const [cadence, setCadence] = useState<RecurringSeries['cadence']>('monthly');
  const [expectedAmount, setExpectedAmount] = useState('');
  const [status, setStatus] = useState<RecurringSeriesStatus>('active');
  const [notes, setNotes] = useState('');
  const [isAutopay, setIsAutopay] = useState(false);
  const [dueDay, setDueDay] = useState('');
  const [companyOption, setCompanyOption] = useState<CompanyOption | null>(null);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingTransactions, setLoadingTransactions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const companyOptions = useMemo<CompanyOption[]>(
    () => companies.map((company) => ({ id: company.id, name: company.name })),
    [companies]
  );

  const transactionColumns = useMemo<GridColDef<Transaction>[]>(() => [
    { field: 'date', headerName: t('seriesDetailDialog.columnDate'), width: 110 },
    { field: 'description', headerName: t('seriesDetailDialog.columnDescription'), flex: 1.4, minWidth: 200 },
    userColumn<Transaction>({
      headerName: t('columns.user'),
      owner: t('columns.owner'),
      effectiveUser: t('columns.effectiveUser'),
      unassigned: t('columns.unassigned'),
    }),
    accountColumn<Transaction>({ headerName: t('columns.account'), owner: t('columns.owner'), unknownAccount: t('columns.unknownAccount') }),
    cardColumn<Transaction>({ headerName: t('columns.card'), noCard: t('columns.noCard') }),
    {
      field: 'amount',
      headerName: t('seriesDetailDialog.columnAmount'),
      width: 120,
      align: 'right',
      headerAlign: 'right',
      // A transaction's amount is in its account's currency.
      renderCell: (params) => money(Math.abs(params.row.amount), params.row.account_currency),
    },
  ], [money, t]);

  useEffect(() => {
    if (!open || !series) return;

    setName(series.name);
    setKind(series.kind);
    setCadence(series.cadence);
    setExpectedAmount(series.expected_amount != null ? String(series.expected_amount) : '');
    setStatus(series.status);
    setNotes(series.notes || '');
    setIsAutopay(Boolean(series.is_autopay));
    setDueDay(series.due_day != null ? String(series.due_day) : '');
    setCompanyOption(
      series.company_id != null ? { id: series.company_id, name: series.company_name || '' } : null
    );
    setError(null);

    setLoadingTransactions(true);
    getSeriesTransactions(series.id)
      .then(setTransactions)
      .catch((err) => {
        console.error('Failed to load series transactions:', err);
        setTransactions([]);
      })
      .finally(() => setLoadingTransactions(false));
  }, [open, series, getSeriesTransactions]);

  const handleSave = async () => {
    if (!series) return;
    if (!name.trim()) {
      setError(t('seriesDetailDialog.nameRequired'));
      return;
    }

    const parsedAmount = expectedAmount.trim() === '' ? null : Number(expectedAmount);
    if (parsedAmount !== null && Number.isNaN(parsedAmount)) {
      setError(t('seriesDetailDialog.amountMustBeNumber'));
      return;
    }

    const parsedDueDay = dueDay.trim() === '' ? null : Number(dueDay);
    if (parsedDueDay !== null && (!Number.isInteger(parsedDueDay) || parsedDueDay < 1 || parsedDueDay > 31)) {
      setError(t('seriesDetailDialog.dueDayRange'));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(series.id, {
        name: name.trim(),
        kind,
        cadence,
        expected_amount: parsedAmount,
        status,
        notes: notes.trim() || null,
        is_autopay: isAutopay,
        due_day: parsedDueDay,
      });
      await onSetCompany(
        series.id,
        companyOption?.isNew
          ? { companyName: companyOption.name }
          : { companyId: companyOption?.id ?? null }
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('seriesDetailDialog.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!series) return;
    setSaving(true);
    setError(null);
    try {
      await onDelete(series.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('seriesDetailDialog.deleteFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (!series) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{series.name}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box display="flex" flexWrap="wrap" gap={2} mt={1} mb={3}>
          <TextField
            label={t('seriesDetailDialog.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            sx={{ flex: '2 1 240px' }}
            size="small"
          />
          <Autocomplete
            options={companyOptions}
            value={companyOption}
            onChange={(_, value) => {
              if (typeof value === 'string') {
                const trimmed = value.trim();
                setCompanyOption(trimmed ? { id: -1, name: trimmed, isNew: true } : null);
              } else {
                setCompanyOption(value);
              }
            }}
            filterOptions={(candidates, params) => {
              const filtered = companyFilter(candidates, params);
              const inputValue = params.inputValue.trim();
              const exists = candidates.some(
                (candidate) => candidate.name.toLowerCase() === inputValue.toLowerCase()
              );
              if (inputValue && !exists) {
                filtered.push({ id: -1, name: inputValue, isNew: true });
              }
              return filtered;
            }}
            getOptionLabel={(option) => (typeof option === 'string' ? option : option.name)}
            isOptionEqualToValue={(option, value) => option.id === value.id && option.name === value.name}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box component="li" key={key} {...otherProps}>
                  <Typography variant="body2">
                    {option.isNew ? t('seriesDetailDialog.createCompany', { name: option.name }) : option.name}
                  </Typography>
                </Box>
              );
            }}
            freeSolo
            selectOnFocus
            clearOnBlur
            handleHomeEndKeys
            sx={{ flex: '1 1 200px' }}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t('seriesDetailDialog.company')}
                size="small"
                helperText={t('seriesDetailDialog.companyHelp')}
              />
            )}
          />
          <TextField
            select
            label={t('seriesDetailDialog.type')}
            value={kind}
            onChange={(event) => setKind(event.target.value as RecurringSeries['kind'])}
            sx={{ flex: '1 1 140px' }}
            size="small"
          >
            {KIND_VALUES.map((value) => (
              <MenuItem key={value} value={value}>
                {t(`kind.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('seriesDetailDialog.cadence')}
            value={cadence}
            onChange={(event) => setCadence(event.target.value as RecurringSeries['cadence'])}
            sx={{ flex: '1 1 140px' }}
            size="small"
          >
            {CADENCE_VALUES.map((value) => (
              <MenuItem key={value} value={value}>
                {t(`cadence.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('seriesDetailDialog.expectedAmount')}
            value={expectedAmount}
            onChange={(event) => setExpectedAmount(event.target.value)}
            sx={{ flex: '1 1 140px' }}
            size="small"
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          <TextField
            select
            label={t('seriesDetailDialog.status')}
            value={status}
            onChange={(event) => setStatus(event.target.value as RecurringSeriesStatus)}
            sx={{ flex: '1 1 140px' }}
            size="small"
          >
            {STATUS_VALUES.map((value) => (
              <MenuItem key={value} value={value}>
                {t(`status.${value}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('seriesDetailDialog.notes')}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            fullWidth
            size="small"
            multiline
            minRows={2}
          />
          <Box sx={{ flex: '1 1 100%', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <FormControlLabel
              control={
                <Switch
                  checked={isAutopay}
                  onChange={(event) => setIsAutopay(event.target.checked)}
                  slotProps={{ input: { 'data-testid': 'series-autopay-switch' } as React.InputHTMLAttributes<HTMLInputElement> }}
                />
              }
              label={t('seriesDetailDialog.autopay')}
            />
            <TextField
              label={t('seriesDetailDialog.dueDay')}
              type="number"
              value={dueDay}
              onChange={(event) => setDueDay(event.target.value)}
              size="small"
              sx={{ width: 170 }}
              slotProps={{ htmlInput: { min: 1, max: 31, 'data-testid': 'series-due-day' } }}
              helperText={isAutopay ? t('seriesDetailDialog.optional') : t('seriesDetailDialog.dueDayHelp')}
            />
            <Typography variant="body2" color="text.secondary" sx={{ flex: '1 1 240px' }}>
              {isAutopay ? t('seriesDetailDialog.autopayHelp') : t('seriesDetailDialog.manualHelp')}
            </Typography>
          </Box>
        </Box>

        <Typography variant="subtitle1" gutterBottom>
          {t('seriesDetailDialog.matchedTransactions')}
        </Typography>
        {loadingTransactions ? (
          <Box display="flex" justifyContent="center" py={3}>
            <CircularProgress size={28} />
          </Box>
        ) : transactions.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('seriesDetailDialog.noTransactions')}
          </Typography>
        ) : (
          <AppDataGrid
            rows={transactions}
            columns={transactionColumns}
            height={Math.min(transactions.length * 52 + 72, 340)}
            hideFooter
            disableVirtualization={process.env.NODE_ENV === 'test'}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button color="error" onClick={handleDelete} disabled={saving}>
          {t('seriesDetailDialog.deleteSeries')}
        </Button>
        <Box flex={1} />
        <Button onClick={onClose} disabled={saving}>
          {t('seriesDetailDialog.cancel')}
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? t('seriesDetailDialog.saving') : t('seriesDetailDialog.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default SeriesDetailDialog;
