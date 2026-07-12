'use client';

import type { ReactNode } from 'react';

import { Box } from '@mui/material';
import { GridFooterContainer, GridPagination } from '@mui/x-data-grid';

interface AppDataGridFooterProps {
  summary?: ReactNode;
}

export function AppDataGridFooter({ summary }: AppDataGridFooterProps) {
  return (
    <GridFooterContainer>
      <Box sx={{ flex: 1, px: 2, minWidth: 0 }}>{summary}</Box>
      <GridPagination />
    </GridFooterContainer>
  );
}