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
import { useTransactionQuickActionsSlice } from '@/contexts/useDatabaseSlices';
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
      setError(err instanceof Error ? err.message : 'Failed to set company');
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
          Set Company
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Transaction
          </Typography>
          <Typography variant="body1" fontWeight="medium">
            {transaction.description}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            ${Math.abs(transaction.amount).toFixed(2)} • {new Date(transaction.date).toLocaleDateString()}
          </Typography>
        </Box>

        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" color="text.secondary" gutterBottom>
            Current Company
          </Typography>
          <Chip
            label={transaction.company_name || 'No company'}
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
              label="Company"
              placeholder="Search or create a company..."
              autoFocus
              helperText="Type a new name to create it"
              fullWidth
            />
          )}
          renderOption={(props, option) => {
            const { key, ...otherProps } = props;
            return (
              <Box component="li" key={key} {...otherProps}>
                <Typography variant="body1">
                  {option.isNew ? `Create "${option.name}"` : option.name}
                </Typography>
              </Box>
            );
          }}
        />
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          color="inherit"
          startIcon={<ClearIcon />}
          onClick={() => void apply(null)}
          disabled={loading || transaction.company_id == null}
        >
          Clear
        </Button>
        <Button
          variant="contained"
          onClick={() => void apply(selected)}
          disabled={loading || !selected}
        >
          {loading ? 'Saving…' : selected?.isNew ? 'Create & Apply' : 'Apply'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
