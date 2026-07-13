'use client';

import type { ReactNode } from 'react';

import { Box, Typography } from '@mui/material';
import {
  DataGrid,
  type DataGridProps,
  type GridValidRowModel,
} from '@mui/x-data-grid';

import { useOptionalThemePreferences } from '@/theme/theme';

import { AppDataGridFooter } from './AppDataGridFooter';

export interface AppDataGridProps<R extends GridValidRowModel = any>
  extends DataGridProps<R> {
  height?: number | string;
  footerSummary?: ReactNode;
  emptyMessage?: string;
}

export function AppDataGrid<R extends GridValidRowModel = any>({
  height = 520,
  footerSummary,
  emptyMessage = 'No rows to display',
  pageSizeOptions = [10, 25, 50, 100],
  disableRowSelectionOnClick = true,
  // Wide buffer so moderate grids render every column: off-screen action
  // buttons stay in the DOM (in-page find, tests) at a small rendering cost.
  columnBufferPx = 2400,
  density,
  slots,
  slotProps,
  sx,
  ...props
}: AppDataGridProps<R>) {
  const themePreferences = useOptionalThemePreferences();
  const resolvedDensity = density ?? (themePreferences?.selectedThemeId === 'compact' ? 'compact' : 'standard');

  return (
    <Box sx={{ height, width: '100%', minHeight: typeof height === 'number' ? Math.min(height, 240) : 240 }}>
      <DataGrid
        {...props}
        columnBufferPx={columnBufferPx}
        density={resolvedDensity}
        pageSizeOptions={pageSizeOptions}
        disableRowSelectionOnClick={disableRowSelectionOnClick}
        slots={{
          noRowsOverlay: () => (
            <Box sx={{ height: '100%', display: 'grid', placeItems: 'center', p: 2 }}>
              <Typography variant="body2" color="text.secondary">{emptyMessage}</Typography>
            </Box>
          ),
          footer: footerSummary
            ? () => <AppDataGridFooter summary={footerSummary} />
            : undefined,
          ...slots,
        }}
        slotProps={slotProps}
        sx={{
          '& .MuiDataGrid-cell:focus, & .MuiDataGrid-columnHeader:focus': {
            outline: 'none',
          },
          ...sx,
        }}
      />
    </Box>
  );
}