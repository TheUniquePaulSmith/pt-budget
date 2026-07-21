'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
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
import { useTransactionReportSlice } from '@/contexts/useDatabaseSlices';

interface BulkSetCompanyDialogProps {
  open: boolean;
  transactionIds: number[];
  onClose: () => void;
}

interface CompanyOption {
  id: number;
  name: string;
  isNew?: boolean;
}

const filter = createFilterOptions<CompanyOption>();

export default function BulkSetCompanyDialog({
  open,
  transactionIds,
  onClose,
}: BulkSetCompanyDialogProps) {
  const { companies, applyTransactionClassifications } = useTransactionReportSlice();

  const [selected, setSelected] = useState<CompanyOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = useMemo<CompanyOption[]>(
    () => companies.map((company) => ({ id: company.id, name: company.name })),
    [companies]
  );

  useEffect(() => {
    if (open) {
      setSelected(null);
      setError(null);
    }
  }, [open]);

  const apply = async (option: CompanyOption | null) => {
    if (transactionIds.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      await applyTransactionClassifications(
        transactionIds.map((transactionId) =>
          option?.isNew
            ? { transactionId, companyName: option.name }
            : { transactionId, companyId: option?.id ?? null }
        )
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set company');
    } finally {
      setLoading(false);
    }
  };

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
          <Typography variant="body2" color="text.secondary">
            Apply to {transactionIds.length} selected transaction{transactionIds.length === 1 ? '' : 's'}
          </Typography>
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
          disabled={loading}
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
