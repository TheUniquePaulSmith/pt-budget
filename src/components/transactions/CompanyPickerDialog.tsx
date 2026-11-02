'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  createFilterOptions,
} from '@mui/material';
import {
  Business as BusinessIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useTransactionQuickActionsSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { Transaction } from '@/types/database';

interface CompanyPickerDialogProps {
  open: boolean;
  transaction: Transaction | null;
  onClose: () => void;
}

interface CompanyOption {
  id: number;
  name: string;
  isNew?: boolean;
}

const filter = createFilterOptions<CompanyOption>();

export default function CompanyPickerDialog({
  open,
  transaction,
  onClose,
}: CompanyPickerDialogProps) {
  const { t } = useTranslation(['transactions', 'common']);
  const { money, date } = useFormatters();
  const { companies, setTransactionCompany } = useTransactionQuickActionsSlice();

  const [selected, setSelected] = useState<CompanyOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo<CompanyOption[]>(
    () => companies.map((company) => ({ id: company.id, name: company.name })),
    [companies]
  );

  useEffect(() => {
    if (open && transaction) {
      const current = companies.find((company) => company.id === transaction.company_id);
      setSelected(current ? { id: current.id, name: current.name } : null);
      setError(null);
    }
  }, [open, transaction, companies]);

  const apply = async (option: CompanyOption | null) => {
    if (!transaction) return;
    setLoading(true);
    setError(null);
    try {
      if (option?.isNew) {
        await setTransactionCompany(transaction.id, { companyName: option.name });
      } else {
        await setTransactionCompany(transaction.id, { companyId: option?.id ?? null });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('companyPicker.setFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (!transaction) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <BusinessIcon />
          {t('companyPicker.title')}
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            {t('companyPicker.transaction')}
          </Typography>
          <Typography variant="body1" fontWeight="medium">
            {transaction.description}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {money(Math.abs(transaction.amount), transaction.account_currency)} • {date(transaction.date)}
          </Typography>
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            {t('companyPicker.currentCompany')}
          </Typography>
          <Chip
            label={transaction.company_name || t('companyPicker.noCompany')}
            variant="outlined"
            size="small"
          />
        </Box>

        {error && (
          <Box sx={{ mb: 2, p: 2, bgcolor: 'error.light', borderRadius: 1 }}>
            <Typography color="error.dark" variant="body2">
              {error}
            </Typography>
          </Box>
        )}

        <Autocomplete
          options={options}
          value={selected}
          onChange={(_, value) => {
            if (typeof value === 'string') {
              const name = value.trim();
              setSelected(name ? { id: -1, name, isNew: true } : null);
            } else {
              setSelected(value);
            }
          }}
          filterOptions={(candidates, params) => {
            const filtered = filter(candidates, params);
            const inputValue = params.inputValue.trim();
            const exists = candidates.some(
              (candidate) => candidate.name.toLowerCase() === inputValue.toLowerCase()
            );
            if (inputValue && !exists) {
              filtered.push({ id: -1, name: inputValue, isNew: true });
            }
            return filtered;
          }}
          getOptionLabel={(option) =>
            typeof option === 'string' ? option : option.name
          }
          isOptionEqualToValue={(option, value) =>
            option.id === value.id && option.name === value.name
          }
          freeSolo
          selectOnFocus
          clearOnBlur
          handleHomeEndKeys
          renderInput={(params) => (
            <TextField
              {...params}
              label={t('common:fields.company')}
              placeholder={t('companyPicker.searchPlaceholder')}
              autoFocus
              helperText={t('companyPicker.createHelp')}
              fullWidth
            />
          )}
          renderOption={(props, option) => {
            const { key, ...otherProps } = props;
            return (
              <Box component="li" key={key} {...otherProps}>
                <Typography variant="body1">
                  {option.isNew ? t('companyPicker.createOption', { name: option.name }) : option.name}
                </Typography>
              </Box>
            );
          }}
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button
          color="inherit"
          startIcon={<ClearIcon />}
          onClick={() => void apply(null)}
          disabled={loading || transaction.company_id == null}
        >
          {t('common:actions.clear')}
        </Button>
        <Button
          variant="contained"
          onClick={() => void apply(selected)}
          disabled={loading || !selected}
        >
          {loading ? t('common:status.saving') : selected?.isNew ? t('companyPicker.createAndApply') : t('common:actions.apply')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
