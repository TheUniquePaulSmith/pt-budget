'use client';

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import type { GridColDef } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import type { Account, ClassificationRule, ClassificationRuleInput, MerchantRuleMatchType, TransactionType } from '@/types/database';
import ClassificationRuleEditorDialog from './ClassificationRuleEditorDialog';

interface ClassificationRulesDialogProps {
  open: boolean;
  rules: ClassificationRule[];
  accounts: Account[];
  onClose: () => void;
  onCreate: (rule: ClassificationRuleInput) => Promise<void>;
  onUpdate: (id: number, rule: ClassificationRuleInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
  previewMatches: (rule: {
    pattern: string;
    match_type: MerchantRuleMatchType;
    type: TransactionType;
    account_id?: number | null;
  }) => Promise<number>;
}

/** Lists the household's type rules with add / edit / delete. */
export default function ClassificationRulesDialog({
  open,
  rules,
  accounts,
  onClose,
  onCreate,
  onUpdate,
  onDelete,
  previewMatches,
}: ClassificationRulesDialogProps) {
  const { t } = useTranslation(['transactions', 'common']);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ClassificationRule | null>(null);
  const [error, setError] = useState<string | null>(null);

  const columns = useMemo<GridColDef<ClassificationRule>[]>(
    () => [
      {
        field: 'pattern',
        headerName: t('common:fields.description'),
        flex: 1.4,
        minWidth: 220,
        valueGetter: (_, row) => t('rules.patternCell', { match: t(`matchType.${row.match_type}`), pattern: row.pattern }),
      },
      {
        field: 'type',
        headerName: t('rules.columns.markAs'),
        width: 110,
        renderCell: (params) => <Chip label={t(`common:transactionType.${params.row.type}`)} size="small" variant="outlined" />,
      },
      {
        field: 'account_name',
        headerName: t('common:fields.account'),
        flex: 0.8,
        minWidth: 140,
        valueGetter: (_, row) => row.account_name || t('rules.anyAccount'),
      },
      {
        field: 'counterpart_account_name',
        headerName: t('rules.columns.otherSide'),
        flex: 0.8,
        minWidth: 140,
        valueGetter: (_, row) => (row.type === 'transfer' ? row.counterpart_account_name || '—' : ''),
      },
      { field: 'priority', headerName: t('rules.columns.priority'), width: 95, align: 'right', headerAlign: 'right' },
      {
        field: 'enabled',
        headerName: t('rules.columns.enabled'),
        width: 100,
        renderCell: (params) => (
          <Chip
            label={params.row.enabled ? t('common:status.enabled') : t('common:status.disabled')}
            size="small"
            color={params.row.enabled ? 'success' : 'default'}
          />
        ),
      },
      {
        field: 'actions',
        headerName: t('common:fields.actions'),
        width: 150,
        align: 'right',
        headerAlign: 'right',
        sortable: false,
        filterable: false,
        renderCell: (params) => (
          <Stack direction="row" spacing={0.5} justifyContent="flex-end">
            <Button
              size="small"
              onClick={() => {
                setEditingRule(params.row);
                setEditorOpen(true);
              }}
            >
              {t('common:actions.edit')}
            </Button>
            <Button
              size="small"
              color="error"
              onClick={() => {
                onDelete(params.row.id).catch((err) =>
                  setError(err instanceof Error ? err.message : t('rules.deleteFailed'))
                );
              }}
            >
              {t('common:actions.delete')}
            </Button>
          </Stack>
        ),
      },
    ],
    [onDelete, t]
  );

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle>{t('rules.title')}</DialogTitle>
        <DialogContent>
          <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={2}>
            <Typography variant="body2" color="text.secondary">
              {t('rules.intro')}
            </Typography>
            <Button
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => {
                setEditingRule(null);
                setEditorOpen(true);
              }}
              data-testid="type-rules-add"
            >
              {t('rules.addRule')}
            </Button>
          </Box>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {rules.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
              {t('rules.empty')}
            </Typography>
          ) : (
            <AppDataGrid
              rows={rules}
              columns={columns}
              height={Math.min(rules.length * 52 + 130, 520)}
              hideFooter={rules.length <= 25}
              disableVirtualization={process.env.NODE_ENV === 'test'}
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common:actions.close')}</Button>
        </DialogActions>
      </Dialog>

      <ClassificationRuleEditorDialog
        open={editorOpen}
        editingRule={editingRule}
        accounts={accounts}
        onClose={() => setEditorOpen(false)}
        onCreate={onCreate}
        onUpdate={onUpdate}
        previewMatches={previewMatches}
      />
    </>
  );
}
