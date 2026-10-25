'use client';

import React, { useMemo } from 'react';
import { Box, Chip, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import { CheckCircleOutline, CreditCard as CardIcon, RemoveCircleOutline, Star as StarIcon } from '@mui/icons-material';
import type { GridColDef, GridRowParams } from '@mui/x-data-grid';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import type { Account, AccountCard, User } from '@/types/database';
import {
  accountInstitutionDisplay,
  accountTypeLabel,
  compareInstitutions,
  formatCurrency,
  ownerDisplayName,
} from './accountDisplay';

export interface AccountsGridRow {
  id: number;
  name: string;
  type: Account['type'];
  typeLabel: string;
  institution: string;
  owner: string;
  ownership: Account['ownership'];
  cards: AccountCard[];
  openingBalance: number;
  isActive: boolean;
  includeInNetWorth: boolean;
  account: Account;
}

export interface AccountsGridProps {
  accounts: Account[];
  users: User[];
  cardsByAccountId: Record<number, AccountCard[]>;
  selectedAccountId: number | null;
  onSelect: (accountId: number) => void;
  /** `grid` is the desktop DataGrid; `list` is the phone list. */
  variant?: 'grid' | 'list';
  height?: number | string;
}

export function buildAccountsGridRows(
  accounts: Account[],
  users: User[],
  cardsByAccountId: Record<number, AccountCard[]>
): AccountsGridRow[] {
  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    typeLabel: accountTypeLabel(account.type),
    institution: accountInstitutionDisplay(account),
    owner: ownerDisplayName(account, users),
    ownership: account.ownership,
    cards: cardsByAccountId[account.id] ?? [],
    openingBalance: Number(account.opening_balance ?? 0),
    isActive: (account.is_active ?? 1) === 1,
    includeInNetWorth: (account.include_in_net_worth ?? 1) === 1,
    account,
  }));
}

function CardChips({ cards }: { cards: AccountCard[] }) {
  if (cards.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        No cards
      </Typography>
    );
  }
  return (
    <Stack direction="row" spacing={0.5} sx={{ overflow: 'hidden' }}>
      {cards.map((card) => (
        <Chip
          key={card.id}
          size="small"
          variant="outlined"
          icon={<CardIcon />}
          label={`••${card.last_four}`}
          title={card.nickname ?? undefined}
        />
      ))}
    </Stack>
  );
}

const COLUMNS: GridColDef<AccountsGridRow>[] = [
  { field: 'name', headerName: 'Account', flex: 1.2, minWidth: 160 },
  {
    field: 'typeLabel',
    headerName: 'Type',
    minWidth: 120,
    renderCell: (params) => (
      <Chip size="small" label={params.row.typeLabel} color={params.row.type === 'credit' ? 'secondary' : 'default'} variant="outlined" />
    ),
  },
  {
    field: 'institution',
    headerName: 'Institution',
    flex: 0.9,
    minWidth: 130,
    sortComparator: (a, b) => compareInstitutions(String(a), String(b)),
  },
  {
    field: 'owner',
    headerName: 'Owner',
    flex: 0.8,
    minWidth: 120,
    renderCell: (params) => (
      <Typography variant="body2" noWrap>
        {params.row.owner}
        {params.row.ownership === 'joint' ? ' (joint)' : ''}
      </Typography>
    ),
  },
  {
    field: 'cards',
    headerName: 'Cards',
    sortable: false,
    filterable: false,
    flex: 1,
    minWidth: 140,
    renderCell: (params) => <CardChips cards={params.row.cards} />,
  },
  {
    field: 'openingBalance',
    headerName: 'Opening',
    type: 'number',
    align: 'right',
    headerAlign: 'right',
    minWidth: 110,
    valueFormatter: (value) => formatCurrency(Number(value)),
  },
  {
    field: 'isActive',
    headerName: 'Active',
    type: 'boolean',
    width: 90,
    renderCell: (params) =>
      params.row.isActive ? (
        <CheckCircleOutline fontSize="small" color="success" titleAccess="Active" />
      ) : (
        <RemoveCircleOutline fontSize="small" color="disabled" titleAccess="Closed" />
      ),
  },
  {
    field: 'includeInNetWorth',
    headerName: 'Net worth',
    type: 'boolean',
    width: 100,
    renderCell: (params) =>
      params.row.includeInNetWorth ? (
        <StarIcon fontSize="small" color="warning" titleAccess="Counted in net worth" />
      ) : (
        <Typography variant="caption" color="text.secondary">
          Excluded
        </Typography>
      ),
  },
];

export default function AccountsGrid({
  accounts,
  users,
  cardsByAccountId,
  selectedAccountId,
  onSelect,
  variant = 'grid',
  height = '100%',
}: AccountsGridProps) {
  const rows = useMemo(() => buildAccountsGridRows(accounts, users, cardsByAccountId), [accounts, users, cardsByAccountId]);

  if (variant === 'list') {
    return (
      <List dense disablePadding data-testid="accounts-list">
        {rows.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
            No accounts yet. Add your first account to get started.
          </Typography>
        )}
        {rows.map((row) => (
          <ListItemButton
            key={row.id}
            divider
            selected={row.id === selectedAccountId}
            onClick={() => onSelect(row.id)}
            data-testid={`account-row-${row.id}`}
            sx={{ alignItems: 'flex-start', py: 1 }}
          >
            <ListItemText
              primary={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2" noWrap sx={{ minWidth: 0 }}>
                    {row.name}
                  </Typography>
                  {!row.isActive && <Chip size="small" label="Closed" />}
                </Box>
              }
              secondary={
                <Box component="span" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', mt: 0.25 }}>
                  <Chip size="small" variant="outlined" label={row.typeLabel} />
                  <Typography variant="caption" color="text.secondary" component="span">
                    {row.institution !== '—' ? `${row.institution} • ` : ''}
                    {row.owner}
                    {row.cards.length > 0 ? ` • ${row.cards.map((card) => `••${card.last_four}`).join(', ')}` : ''}
                  </Typography>
                </Box>
              }
              slotProps={{ secondary: { component: 'div' } }}
            />
          </ListItemButton>
        ))}
      </List>
    );
  }

  return (
    <AppDataGrid<AccountsGridRow>
      rows={rows}
      columns={COLUMNS}
      height={height}
      emptyMessage="No accounts yet. Add your first account to get started."
      hideFooter={rows.length <= 25}
      disableRowSelectionOnClick={false}
      rowSelectionModel={selectedAccountId == null ? { type: 'include', ids: new Set() } : { type: 'include', ids: new Set([selectedAccountId]) }}
      onRowClick={(params: GridRowParams<AccountsGridRow>) => onSelect(params.row.id)}
      initialState={{ sorting: { sortModel: [{ field: 'name', sort: 'asc' }] } }}
      sx={{
        '& .MuiDataGrid-row': { cursor: 'pointer' },
        '& .MuiDataGrid-row.Mui-selected': { bgcolor: 'action.selected' },
      }}
    />
  );
}
