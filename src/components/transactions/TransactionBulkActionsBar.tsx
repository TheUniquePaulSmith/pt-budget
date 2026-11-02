'use client';

import React from 'react';
import { Box, Button, Chip, Paper, Stack } from '@mui/material';
import {
  Assignment as ProjectIcon,
  Autorenew as AutorenewIcon,
  Business as BusinessIcon,
  Category as CategoryIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

export type BulkActionKind = 'category' | 'company' | 'project' | 'series';

interface TransactionBulkActionsBarProps {
  selectedCount: number;
  onOpenAction: (kind: BulkActionKind) => void;
  onClearSelection: () => void;
}

export default function TransactionBulkActionsBar({
  selectedCount,
  onOpenAction,
  onClearSelection,
}: TransactionBulkActionsBarProps) {
  const { t } = useTranslation(['transactions', 'common']);
  if (selectedCount === 0) return null;

  return (
    <Paper sx={{ p: 2, mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
      <Chip label={t('bulkBar.selected', { count: selectedCount })} color="primary" />
      <Box sx={{ flexGrow: 1 }} />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button size="small" startIcon={<CategoryIcon />} onClick={() => onOpenAction('category')}>
          {t('bulkBar.setCategory')}
        </Button>
        <Button size="small" startIcon={<BusinessIcon />} onClick={() => onOpenAction('company')}>
          {t('bulkBar.setCompany')}
        </Button>
        <Button size="small" startIcon={<ProjectIcon />} onClick={() => onOpenAction('project')}>
          {t('bulkBar.setProject')}
        </Button>
        <Button size="small" startIcon={<AutorenewIcon />} onClick={() => onOpenAction('series')}>
          {t('bulkBar.subscriptionLink')}
        </Button>
        <Button size="small" color="inherit" startIcon={<CloseIcon />} onClick={onClearSelection}>
          {t('bulkBar.clearSelection')}
        </Button>
      </Stack>
    </Paper>
  );
}
