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

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import type { Account, ClassificationRule, ClassificationRuleInput, MerchantRuleMatchType, TransactionType } from '@/types/database';
import ClassificationRuleEditorDialog from './ClassificationRuleEditorDialog';
import { TYPE_LABELS } from './typeSourcePresentation';

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

const MATCH_LABELS: Record<MerchantRuleMatchType, string> = {
  contains: 'contains',
  prefix: 'starts with',
  exact: 'is exactly',
};

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
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<ClassificationRule | null>(null);
  const [error, setError] = useState<string | null>(null);

  const columns = useMemo<GridColDef<ClassificationRule>[]>(
    () => [
      {
        field: 'pattern',
        headerName: 'Description',
        flex: 1.4,
        minWidth: 220,
        valueGetter: (_, row) => `${MATCH_LABELS[row.match_type]} "${row.pattern}"`,
      },
      {
        field: 'type',
        headerName: 'Mark as',
        width: 110,
        renderCell: (params) => <Chip label={TYPE_LABELS[params.row.type]} size="small" variant="outlined" />,
      },
      {
        field: 'account_name',
        headerName: 'Account',
        flex: 0.8,
        minWidth: 140,
        valueGetter: (_, row) => row.account_name || 'Any',
      },
      {
        field: 'counterpart_account_name',
        headerName: 'Other side',
        flex: 0.8,
        minWidth: 140,
        valueGetter: (_, row) => (row.type === 'transfer' ? row.counterpart_account_name || '—' : ''),
      },
      { field: 'priority', headerName: 'Priority', width: 95, align: 'right', headerAlign: 'right' },
      {
        field: 'enabled',
        headerName: 'Enabled',
        width: 100,
        renderCell: (params) => (
          <Chip
            label={params.row.enabled ? 'Enabled' : 'Disabled'}
            size="small"
            color={params.row.enabled ? 'success' : 'default'}
          />
        ),
      },
      {
        field: 'actions',
        headerName: 'Actions',
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
              Edit
            </Button>
            <Button
              size="small"
              color="error"
              onClick={() => {
                onDelete(params.row.id).catch((err) =>
                  setError(err instanceof Error ? err.message : 'Failed to delete rule')
                );
              }}
            >
              Delete
            </Button>
          </Stack>
        ),
      },
    ],
    [onDelete]
  );

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle>Type Rules</DialogTitle>
        <DialogContent>
          <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={2}>
            <Typography variant="body2" color="text.secondary">
              A rule decides the type of every transaction whose description matches it: card payments and
              moves between your own accounts become transfers, merchant credits become refunds. Rules win
              over automatic detection; a type you set by hand always wins over a rule.
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
              Add Rule
            </Button>
          </Box>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          {rules.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
              No type rules yet. Add one here, or pick &quot;Create type rule…&quot; from a transaction&apos;s menu to
              start from its description.
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
          <Button onClick={onClose}>Close</Button>
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
