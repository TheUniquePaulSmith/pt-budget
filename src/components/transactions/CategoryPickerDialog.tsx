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
} from '@mui/material';
import {
  Category as CategoryIcon,
  Clear as ClearIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useTransactionQuickActionsSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { Category, Transaction } from '@/types/database';

interface CategoryPickerDialogProps {
  open: boolean;
  transaction: Transaction | null;
  onClose: () => void;
}

export default function CategoryPickerDialog({
  open,
  transaction,
  onClose,
}: CategoryPickerDialogProps) {
  const { t } = useTranslation(['transactions', 'common']);
  const { money, date, locale } = useFormatters();
  const { categories, setTransactionCategory } = useTransactionQuickActionsSlice();

  const [selected, setSelected] = useState<Category | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo(
    () => categories.filter((category) => !transaction || category.type === transaction.type),
    [categories, transaction]
  );

  useEffect(() => {
    if (open && transaction) {
      setSelected(categories.find((category) => category.id === transaction.category_id) ?? null);
      setError(null);
    }
  }, [open, transaction, categories]);

  const apply = async (categoryId: number | null) => {
    if (!transaction) return;
    setLoading(true);
    setError(null);
    try {
      await setTransactionCategory(transaction.id, categoryId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('categoryPicker.setFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (!transaction) return null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <CategoryIcon />
          {t('categoryPicker.title')}
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            {t('categoryPicker.transaction')}
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
            {t('categoryPicker.currentCategory')}
          </Typography>
          <Chip
            label={transaction.category_name || t('categoryPicker.noCategory')}
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
          getOptionLabel={(option) => option.name}
          value={selected}
          onChange={(_, value) => setSelected(value)}
          renderInput={(params) => (
            <TextField
              {...params}
              label={t('common:fields.category')}
              placeholder={t('categoryPicker.searchPlaceholder')}
              autoFocus
              helperText={t('categoryPicker.showingCategories', {
                type: t(`common:transactionType.${transaction.type}`).toLocaleLowerCase(locale),
              })}
              fullWidth
            />
          )}
          renderOption={(props, option) => {
            const { key, ...otherProps } = props;
            return (
              <Box component="li" key={key} {...otherProps}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      bgcolor: option.color || 'text.disabled',
                      flexShrink: 0,
                    }}
                  />
                  <Typography variant="body1">{option.name}</Typography>
                </Box>
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
          disabled={loading || transaction.category_id == null}
        >
          {t('common:actions.clear')}
        </Button>
        <Button
          variant="contained"
          onClick={() => void apply(selected?.id ?? null)}
          disabled={loading || !selected}
        >
          {loading ? t('common:status.saving') : t('common:actions.apply')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
