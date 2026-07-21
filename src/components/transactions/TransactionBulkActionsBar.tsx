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
  if (selectedCount === 0) return null;

  return (
    <Paper sx={{ p: 2, mb: 3, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
      <Chip label={`${selectedCount} selected`} color="primary" />
      <Box sx={{ flexGrow: 1 }} />
      <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
        <Button size="small" startIcon={<CategoryIcon />} onClick={() => onOpenAction('category')}>
          Set Category
        </Button>
        <Button size="small" startIcon={<BusinessIcon />} onClick={() => onOpenAction('company')}>
          Set Company
        </Button>
        <Button size="small" startIcon={<ProjectIcon />} onClick={() => onOpenAction('project')}>
          Set Project
        </Button>
        <Button size="small" startIcon={<AutorenewIcon />} onClick={() => onOpenAction('series')}>
          Subscription Link
        </Button>
        <Button size="small" color="inherit" startIcon={<CloseIcon />} onClick={onClearSelection}>
          Clear Selection
        </Button>
      </Stack>
    </Paper>
  );
}
