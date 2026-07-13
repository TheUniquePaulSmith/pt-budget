'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  IconButton,
  Chip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { CheckCircle, Cancel } from '@mui/icons-material';
import type { GridColDef } from '@mui/x-data-grid';
import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { Transaction } from '@/types/database';
import { format, parseISO } from 'date-fns';

interface DuplicateGroup {
  hash: string;
  transactions: Array<{
    index: number;
    transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>;
    csvAccountValue: string;
    tempId: number;
  }>;
}

interface InternalDuplicatesResolverProps {
  open: boolean;
  onClose: () => void;
  duplicateGroups: DuplicateGroup[];
  onResolve: (selectedIndices: Set<number>) => void;
}

interface DuplicateRow {
  id: number;
  index: number;
  isSelected: boolean;
  variationSeed: number | null;
  date: string;
  description: string;
  csvAccountValue: string;
  amount: number;
  type: Transaction['type'];
}

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

export default function InternalDuplicatesResolver({
  open,
  onClose,
  duplicateGroups,
  onResolve,
}: InternalDuplicatesResolverProps) {
  // Track which transaction indices should be included (by default, keep first of each group)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    duplicateGroups.forEach(group => {
      if (group.transactions.length > 0) {
        initial.add(group.transactions[0].index);
      }
    });
    return initial;
  });

  const toggleSelection = useCallback((index: number) => {
    setSelectedIndices(prev => {
      const newSet = new Set(prev);
      if (newSet.has(index)) {
        newSet.delete(index);
      } else {
        newSet.add(index);
      }
      return newSet;
    });
  }, []);

  const handleOk = () => {
    onResolve(selectedIndices);
  };

  const handleCancel = () => {
    onClose();
  };

  const totalDuplicates = useMemo(() => {
    return duplicateGroups.reduce((sum, group) => sum + group.transactions.length, 0);
  }, [duplicateGroups]);

  const selectedCount = selectedIndices.size;
  const excludedCount = totalDuplicates - selectedCount;

  const columns = useMemo<GridColDef<DuplicateRow>[]>(() => [
    {
      field: 'isSelected',
      headerName: 'Include',
      width: 90,
      align: 'center',
      headerAlign: 'center',
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <IconButton
          size="small"
          onClick={() => toggleSelection(params.row.index)}
          color={params.row.isSelected ? 'success' : 'error'}
          title={params.row.isSelected ? 'Exclude from import' : 'Include in import'}
        >
          {params.row.isSelected ? <CheckCircle /> : <Cancel />}
        </IconButton>
      ),
    },
    {
      field: 'variationSeed',
      headerName: 'Variation',
      width: 110,
      align: 'center',
      headerAlign: 'center',
      sortable: false,
      filterable: false,
      renderCell: (params) =>
        params.row.isSelected && params.row.variationSeed !== null ? (
          <Chip
            label={params.row.variationSeed === 0 ? 'Original' : `Seed ${params.row.variationSeed}`}
            size="small"
            color={params.row.variationSeed === 0 ? 'default' : 'primary'}
            variant="outlined"
          />
        ) : (
          <Typography variant="body2" color="text.disabled">
            -
          </Typography>
        ),
    },
    {
      field: 'date',
      headerName: 'Date',
      width: 125,
      valueFormatter: (value) => (value ? format(parseISO(String(value)), 'MMM dd, yyyy') : ''),
    },
    { field: 'description', headerName: 'Description', flex: 1.4, minWidth: 200 },
    {
      field: 'csvAccountValue',
      headerName: 'Account',
      flex: 0.8,
      minWidth: 140,
      renderCell: (params) => (
        <Typography variant="body2" noWrap>
          {params.row.csvAccountValue}
        </Typography>
      ),
    },
    {
      field: 'amount',
      headerName: 'Amount',
      width: 120,
      align: 'right',
      headerAlign: 'right',
      renderCell: (params) => (
        <Typography
          variant="body2"
          color={params.row.type === 'income' ? 'success.main' : 'error.main'}
          fontWeight="medium"
        >
          {formatCurrency(params.row.amount)}
        </Typography>
      ),
    },
    {
      field: 'type',
      headerName: 'Type',
      width: 110,
      renderCell: (params) => (
        <Chip
          label={params.row.type}
          size="small"
          color={params.row.type === 'income' ? 'success' : 'error'}
          variant="outlined"
        />
      ),
    },
  ], [toggleSelection]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Box>
          <Typography variant="h6" component="div">
            Resolve Internal Duplicates
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Found {duplicateGroups.length} sets of duplicate transactions within your CSV.
            Select which records to include in the import.
          </Typography>
          <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
            <Chip
              label={`${selectedCount} Selected`}
              color="success"
              size="small"
            />
            <Chip
              label={`${excludedCount} Excluded`}
              color="error"
              size="small"
            />
          </Box>
        </Box>
      </DialogTitle>
      <DialogContent>
        <Box>
          <Alert severity="info" sx={{ mb: 3 }}>
            <Typography variant="body2">
              <strong>How duplicate resolution works:</strong> When you select multiple transactions from the same set,
              each will receive a unique variation seed. The first selected transaction keeps the original hash (seed 0),
              while subsequent selections get incrementing seeds (1, 2, etc.). This allows you to import legitimate duplicates
              while preventing re-imports of the same CSV file.
            </Typography>
          </Alert>

          {duplicateGroups.map((group, groupIndex) => {
            const rows: DuplicateRow[] = group.transactions.map((item, idx) => {
              const isSelected = selectedIndices.has(item.index);
              // Calculate what variation seed this transaction would get
              const selectedBeforeThis = group.transactions
                .slice(0, idx + 1)
                .filter((t, i) => i <= idx && selectedIndices.has(t.index))
                .length - 1;
              return {
                id: item.index,
                index: item.index,
                isSelected,
                variationSeed: isSelected ? selectedBeforeThis : null,
                date: item.transaction.date,
                description: item.transaction.description,
                csvAccountValue: item.csvAccountValue,
                amount: item.transaction.amount,
                type: item.transaction.type,
              };
            });

            return (
              <Box key={group.hash} sx={{ mb: 4 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                  Duplicate Set {groupIndex + 1} ({group.transactions.length} records)
                </Typography>
                <AppDataGrid
                  rows={rows}
                  columns={columns}
                  height={rows.length * 52 + 72}
                  hideFooter
                  disableVirtualization={process.env.NODE_ENV === 'test'}
                  getRowClassName={(params) =>
                    params.row.isSelected ? 'duplicate-row--included' : 'duplicate-row--excluded'
                  }
                  sx={(theme) => ({
                    '& .duplicate-row--included': {
                      backgroundColor: alpha(theme.palette.success.main, 0.08),
                    },
                    '& .duplicate-row--excluded': {
                      backgroundColor: alpha(theme.palette.error.main, 0.08),
                      opacity: 0.6,
                    },
                  })}
                />
              </Box>
            );
          })}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleCancel}>
          Cancel
        </Button>
        <Button onClick={handleOk} variant="contained" color="primary">
          Continue with {selectedCount} Transaction{selectedCount !== 1 ? 's' : ''}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
