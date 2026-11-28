'use client';

import React, { useMemo } from 'react';
import { Box, Chip, List, ListItemButton, ListItemText, Stack, Typography } from '@mui/material';
import { CheckCircleOutline, CreditCard as CardIcon, RemoveCircleOutline, Star as StarIcon } from '@mui/icons-material';
import type { GridColDef, GridRowParams } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { useFormatters } from '@/contexts/useFormatters';
import { storedTimestampToDate } from '@/lib/formatting';
import type { Account, AccountCard, AccountFreshness, User } from '@/types/database';
import {
  accountInstitutionDisplay,
  accountTypeLabel,
  compareInstitutions,
  ownerDisplayName,
  type AccountsT,
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
  currency: string;
  isActive: boolean;
  includeInNetWorth: boolean;
  /** Schema v8: the date the account's imported data is complete through; null when never imported. */
  dataThrough: string | null;
  /** When the account was last imported (UTC timestamp text). */
  lastImportAt: string | null;
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
  /** Schema v8: each account's last import and data-through date (`useAccountFreshness`). */
  freshness?: ReadonlyMap<number, AccountFreshness>;
}

export function buildAccountsGridRows(
  accounts: Account[],
  users: User[],
  cardsByAccountId: Record<number, AccountCard[]>,
  t: AccountsT,
  freshness?: ReadonlyMap<number, AccountFreshness>
): AccountsGridRow[] {
  return accounts.map((account) => ({
    id: account.id,
    name: account.name,
    type: account.type,
    typeLabel: accountTypeLabel(account.type, t),
    institution: accountInstitutionDisplay(account),
    owner: ownerDisplayName(account, users, t),
    ownership: account.ownership,
    cards: cardsByAccountId[account.id] ?? [],
    openingBalance: Number(account.opening_balance ?? 0),
    currency: account.currency ?? 'USD',
    isActive: (account.is_active ?? 1) === 1,
    includeInNetWorth: (account.include_in_net_worth ?? 1) === 1,
    dataThrough: freshness?.get(account.id)?.dataThrough ?? null,
    lastImportAt: freshness?.get(account.id)?.lastImportAt ?? null,
    account,
  }));
}

function CardChips({ cards }: { cards: AccountCard[] }) {
  const { t } = useTranslation(['accounts', 'common']);
  if (cards.length === 0) {
    return (
      <Typography variant="caption" color="text.secondary">
        {t('grid.noCards')}
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

type DateFormatter = (value: string | Date | null | undefined) => string;

function buildColumns(
  money: (amount: number, currency?: string | null) => string,
  date: DateFormatter,
  t: AccountsT
): GridColDef<AccountsGridRow>[] {
  return [
  { field: 'name', headerName: t('grid.columnAccount'), flex: 1.2, minWidth: 160 },
  {
    field: 'typeLabel',
    headerName: t('grid.columnType'),
    minWidth: 120,
    renderCell: (params) => (
      <Chip size="small" label={params.row.typeLabel} color={params.row.type === 'credit' ? 'secondary' : 'default'} variant="outlined" />
    ),
  },
  {
    field: 'institution',
    headerName: t('grid.columnInstitution'),
    flex: 0.9,
    minWidth: 130,
    sortComparator: (a, b) => compareInstitutions(String(a), String(b)),
  },
  {
    field: 'owner',
    headerName: t('grid.columnOwner'),
    flex: 0.8,
    minWidth: 120,
    renderCell: (params) => (
      <Typography variant="body2" noWrap>
        {params.row.ownership === 'joint' ? t('grid.ownerJoint', { owner: params.row.owner }) : params.row.owner}
      </Typography>
    ),
  },
  {
    field: 'cards',
    headerName: t('grid.columnCards'),
    sortable: false,
    filterable: false,
    flex: 1,
    minWidth: 140,
    renderCell: (params) => <CardChips cards={params.row.cards} />,
  },
  {
    field: 'currency',
    headerName: t('grid.columnCurrency'),
    width: 100,
    renderCell: (params) => <Chip size="small" variant="outlined" label={params.row.currency} />,
  },
  {
    field: 'openingBalance',
    headerName: t('grid.columnOpening'),
    type: 'number',
    align: 'right',
    headerAlign: 'right',
    minWidth: 110,
    valueFormatter: (value, row) => money(Number(value), row.currency),
  },
  {
    field: 'dataThrough',
    headerName: t('grid.columnDataThrough'),
    minWidth: 130,
    valueGetter: (_, row) => row.dataThrough ?? '',
    renderCell: (params) =>
      params.row.dataThrough ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {date(params.row.dataThrough)}
          </Typography>
          {params.row.lastImportAt && (
            <Typography variant="caption" color="text.secondary" noWrap>
              {t('grid.importedOn', { date: date(storedTimestampToDate(params.row.lastImportAt)) })}
            </Typography>
          )}
        </Box>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {t('grid.neverImported')}
        </Typography>
      ),
  },
  {
    field: 'isActive',
    headerName: t('grid.columnActive'),
    type: 'boolean',
    width: 90,
    renderCell: (params) =>
      params.row.isActive ? (
        <CheckCircleOutline fontSize="small" color="success" titleAccess={t('grid.activeTitle')} />
      ) : (
        <RemoveCircleOutline fontSize="small" color="disabled" titleAccess={t('grid.closedTitle')} />
      ),
  },
  {
    field: 'includeInNetWorth',
    headerName: t('grid.columnNetWorth'),
    type: 'boolean',
    width: 100,
    renderCell: (params) =>
      params.row.includeInNetWorth ? (
        <StarIcon fontSize="small" color="warning" titleAccess={t('grid.countedInNetWorth')} />
      ) : (
        <Typography variant="caption" color="text.secondary">
          {t('grid.excluded')}
        </Typography>
      ),
  },
  ];
}

export default function AccountsGrid({
  accounts,
  users,
  cardsByAccountId,
  selectedAccountId,
  onSelect,
  variant = 'grid',
  height = '100%',
  freshness,
}: AccountsGridProps) {
  const { t } = useTranslation(['accounts', 'common']);
  const { money, date } = useFormatters();
  const columns = useMemo(() => buildColumns(money, date, t), [date, money, t]);
  const rows = useMemo(
    () => buildAccountsGridRows(accounts, users, cardsByAccountId, t, freshness),
    [accounts, users, cardsByAccountId, t, freshness]
  );

  if (variant === 'list') {
    return (
      <List dense disablePadding data-testid="accounts-list">
        {rows.length === 0 && (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2, textAlign: 'center' }}>
            {t('grid.empty')}
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
                  {!row.isActive && <Chip size="small" label={t('common:status.closed')} />}
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
                  {row.dataThrough && (
                    <Typography variant="caption" color="text.secondary" component="span" sx={{ width: '100%' }}>
                      {t('grid.dataThroughLine', { date: date(row.dataThrough) })}
                    </Typography>
                  )}
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
      columns={columns}
      height={height}
      emptyMessage={t('grid.empty')}
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
