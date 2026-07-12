'use client';

import React from 'react';
import type { ReactNode } from 'react';

import { Box, Chip, Tooltip, Typography } from '@mui/material';
import { CalendarMonth, CreditCard, Flag, Savings, Work } from '@mui/icons-material';
import type { GridColDef, GridValidRowModel } from '@mui/x-data-grid';

import type { Transaction } from '@/types/database';

export function currencyColumn<R extends { amount?: number }>(
  field: keyof R & string,
  headerName = 'Amount'
): GridColDef<R> {
  return {
    field,
    headerName,
    type: 'number',
    align: 'right',
    headerAlign: 'right',
    minWidth: 120,
    valueFormatter: (value) => {
      const amount = Number(value || 0);
      return amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' });
    },
    renderCell: (params) => {
      const amount = Number(params.value || 0);
      return (
        <Typography variant="body2" color={amount < 0 ? 'error.main' : 'success.main'} fontWeight={600}>
          {amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })}
        </Typography>
      );
    },
  };
}

export function dateColumn<R extends GridValidRowModel>(field: keyof R & string, headerName = 'Date'): GridColDef<R> {
  return {
    field,
    headerName,
    minWidth: 120,
    valueFormatter: (value) => String(value || ''),
  };
}

export function categoryChipColumn<R extends { category_name?: string; category_color?: string }>(
  field = 'category_name'
): GridColDef<R> {
  return {
    field,
    headerName: 'Category',
    minWidth: 160,
    renderCell: (params) => {
      const row = params.row;
      return row.category_name ? (
        <Chip
          label={row.category_name}
          size="small"
          sx={{ bgcolor: row.category_color || 'action.selected', color: 'common.white' }}
        />
      ) : (
        <Typography variant="body2" color="text.secondary">Uncategorized</Typography>
      );
    },
  };
}

export function userColumn<R extends Partial<Transaction>>(): GridColDef<R> {
  return {
    field: 'effective_user_name',
    headerName: 'User',
    minWidth: 140,
    flex: 0.7,
    renderCell: (params) => {
      const row = params.row;
      const tooltip = [
        row.account_owner_name ? `Owner: ${row.account_owner_name}` : null,
        row.effective_user_name ? `Effective user: ${row.effective_user_name}` : null,
      ].filter(Boolean).join('\n');

      return (
        <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltip}</span>}>
          <Typography variant="body2" noWrap fontWeight={600} sx={{ minWidth: 0 }}>
            {row.effective_user_name || 'Unassigned'}
          </Typography>
        </Tooltip>
      );
    },
  };
}

export function accountColumn<R extends Partial<Transaction>>(): GridColDef<R> {
  return {
    field: 'account_name',
    headerName: 'Account',
    minWidth: 160,
    flex: 0.8,
    renderCell: (params) => (
      <Tooltip title={params.row.account_owner_name ? `Owner: ${params.row.account_owner_name}` : ''}>
        <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
          {params.row.account_name || 'Unknown Account'}
        </Typography>
      </Tooltip>
    ),
  };
}

export function cardColumn<R extends Partial<Transaction>>(): GridColDef<R> {
  return {
    field: 'card_last_four',
    headerName: 'Card',
    minWidth: 110,
    flex: 0.45,
    renderCell: (params) => {
      const row = params.row;
      const label = row.card_last_four ? `••${row.card_last_four}` : 'No card';
      return (
        <Tooltip title={row.card_nickname || label}>
          <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
            {label}
          </Typography>
        </Tooltip>
      );
    },
  };
}

export function indicatorsColumn(budgetedCategoryIds: Set<number>): GridColDef<Transaction> {
  return {
    field: 'indicators',
    headerName: 'Indicators',
    sortable: false,
    filterable: false,
    width: 150,
    renderCell: (params) => {
      const chips: ReactNode[] = [];
      if (params.row.category_id && budgetedCategoryIds.has(params.row.category_id)) chips.push(<Chip key="budget" size="small" icon={<Savings />} label="Budget" />);
      if (params.row.trip_id) chips.push(<Chip key="trip" size="small" icon={<CalendarMonth />} label="Trip" />);
      if (params.row.project_id) chips.push(<Chip key="project" size="small" icon={<Work />} label="Project" />);
      if (params.row.series_id) chips.push(<Chip key="series" size="small" icon={<Flag />} label="Series" />);
      if (params.row.card_id) chips.push(<Chip key="card" size="small" icon={<CreditCard />} label="Card" />);
      return <Box sx={{ display: 'flex', gap: 0.5, overflow: 'hidden' }}>{chips}</Box>;
    },
  };
}