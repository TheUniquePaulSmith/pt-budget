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
  FormControlLabel,
  Switch,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { CheckCircle, Cancel } from '@mui/icons-material';
import type { GridColDef } from '@mui/x-data-grid';
import { Trans, useTranslation } from 'react-i18next';
import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { useFormatters } from '@/contexts/useFormatters';
import { Account, Transaction } from '@/types/database';

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
  /** The user's accounts, so each amount is shown in its account's currency. */
  accounts?: Account[];
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
  currency: string | undefined;
  type: Transaction['type'];
}

export default function InternalDuplicatesResolver({
  open,
  onClose,
  duplicateGroups,
  accounts,
  onResolve,
}: InternalDuplicatesResolverProps) {
  const { t } = useTranslation(['csvImport', 'common']);
  const { money, date } = useFormatters();

  // Track which transaction indices should be included. Every copy starts
  // included, matching the analysis (repeats are staged with their own seeds).
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    () => new Set(duplicateGroups.flatMap(group => group.transactions.map(item => item.index)))
  );

  // When on, every row in every set is imported (each gets its own variation seed).
  // The manual selection is kept untouched underneath so turning this off restores it.
  const [includeAll, setIncludeAll] = useState(false);

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

  const effectiveIndices = useMemo(() => {
    if (!includeAll) {
      return selectedIndices;
    }
    return new Set(duplicateGroups.flatMap(group => group.transactions.map(item => item.index)));
  }, [includeAll, selectedIndices, duplicateGroups]);

  const handleOk = () => {
    onResolve(effectiveIndices);
  };

  const handleCancel = () => {
    onClose();
  };

  const totalDuplicates = useMemo(() => {
    return duplicateGroups.reduce((sum, group) => sum + group.transactions.length, 0);
  }, [duplicateGroups]);

  const selectedCount = effectiveIndices.size;
  const excludedCount = totalDuplicates - selectedCount;

  const columns = useMemo<GridColDef<DuplicateRow>[]>(() => [
    {
      field: 'isSelected',
      headerName: t('duplicatesResolver.include'),
      width: 90,
      align: 'center',
      headerAlign: 'center',
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <IconButton
          size="small"
          onClick={() => toggleSelection(params.row.index)}
          disabled={includeAll}
          color={params.row.isSelected ? 'success' : 'error'}
          title={params.row.isSelected ? t('duplicatesResolver.excludeFromImport') : t('duplicatesResolver.includeInImport')}
        >
          {params.row.isSelected ? <CheckCircle /> : <Cancel />}
        </IconButton>
      ),
    },
    {
      field: 'variationSeed',
      headerName: t('duplicatesResolver.variation'),
      width: 110,
      align: 'center',
      headerAlign: 'center',
      sortable: false,
      filterable: false,
      renderCell: (params) =>
        params.row.isSelected && params.row.variationSeed !== null ? (
          <Chip
            label={
              params.row.variationSeed === 0
                ? t('duplicatesResolver.original')
                : t('duplicatesResolver.seed', { seed: params.row.variationSeed })
            }
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
      headerName: t('common:fields.date'),
      width: 125,
      valueFormatter: (value) => (value ? date(String(value)) : ''),
    },
    { field: 'description', headerName: t('common:fields.description'), flex: 1.4, minWidth: 200 },
    {
      field: 'csvAccountValue',
      headerName: t('common:fields.account'),
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
      headerName: t('common:fields.amount'),
      width: 120,
      align: 'right',
      headerAlign: 'right',
      renderCell: (params) => (
        <Typography
          variant="body2"
          color={params.row.type === 'income' ? 'success.main' : 'error.main'}
          fontWeight="medium"
        >
          {money(params.row.amount, params.row.currency)}
        </Typography>
      ),
    },
    {
      field: 'type',
      headerName: t('common:fields.type'),
      width: 110,
      renderCell: (params) => (
        <Chip
          label={t(`common:transactionType.${params.row.type}`)}
          size="small"
          color={params.row.type === 'income' ? 'success' : 'error'}
          variant="outlined"
        />
      ),
    },
  ], [toggleSelection, includeAll, t, money, date]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle>
        <Box>
          <Typography variant="h6" component="div">
            {t('duplicatesResolver.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('duplicatesResolver.found', { count: duplicateGroups.length })}
          </Typography>
          <Box sx={{ mt: 2, display: 'flex', gap: 2 }}>
            <Chip
              label={t('duplicatesResolver.selected', { count: selectedCount })}
              color="success"
              size="small"
            />
            <Chip
              label={t('duplicatesResolver.excluded', { count: excludedCount })}
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
              <Trans i18nKey="duplicatesResolver.howItWorks" ns="csvImport" components={{ strong: <strong /> }} />
            </Typography>
          </Alert>

          <Box sx={{ mb: 3 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={includeAll}
                  onChange={(event) => setIncludeAll(event.target.checked)}
                />
              }
              label={t('duplicatesResolver.includeAll')}
            />
            <Typography variant="body2" color="text.secondary">
              {t('duplicatesResolver.includeAllHelp')}
            </Typography>
          </Box>

          {duplicateGroups.map((group, groupIndex) => {
            const rows: DuplicateRow[] = group.transactions.map((item, idx) => {
              const isSelected = effectiveIndices.has(item.index);
              // Calculate what variation seed this transaction would get
              const selectedBeforeThis = group.transactions
                .slice(0, idx + 1)
                .filter((t, i) => i <= idx && effectiveIndices.has(t.index))
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
                currency: accounts?.find((account) => account.id === item.transaction.account_id)?.currency,
                type: item.transaction.type,
              };
            });

            return (
              <Box key={group.hash} sx={{ mb: 4 }}>
                <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
                  {t('duplicatesResolver.setTitle', { number: groupIndex + 1, count: group.transactions.length })}
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
          {t('common:actions.cancel')}
        </Button>
        <Button onClick={handleOk} variant="contained" color="primary">
          {t('duplicatesResolver.continueWith', { count: selectedCount })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
