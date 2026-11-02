'use client';

import React from 'react';
import type { ReactNode } from 'react';

import { Box, Chip, Tooltip, Typography } from '@mui/material';
import { CalendarMonth, CreditCard, Flag, Savings, SwapHoriz, Undo, VisibilityOff, Work } from '@mui/icons-material';
import type { GridColDef, GridValidRowModel } from '@mui/x-data-grid';

import type { Transaction } from '@/types/database';
import { describeTypeDecision, needsTypeReview } from '@/components/transactions/typeSourcePresentation';

/** Formats an amount in a currency; callers pass `useFormatters().money`. */
export type MoneyFormatter = (amount: number | null | undefined, currency?: string | null) => string;

export interface CurrencyColumnOptions<R> {
  headerName?: string;
  /** The currency a row's amount is in (an account's currency); defaults to the default currency. */
  currencyOf?: (row: R) => string | null | undefined;
}

export function currencyColumn<R extends { amount?: number }>(
  field: keyof R & string,
  formatMoney: MoneyFormatter,
  { headerName = 'Amount', currencyOf }: CurrencyColumnOptions<R> = {}
): GridColDef<R> {
  return {
    field,
    headerName,
    type: 'number',
    align: 'right',
    headerAlign: 'right',
    minWidth: 120,
    valueFormatter: (value, row) => formatMoney(Number(value || 0), currencyOf?.(row)),
    renderCell: (params) => {
      const amount = Number(params.value || 0);
      return (
        <Typography variant="body2" color={amount < 0 ? 'error.main' : 'success.main'} fontWeight={600}>
          {formatMoney(amount, currencyOf?.(params.row))}
        </Typography>
      );
    },
  };
}

export function dateColumn<R extends GridValidRowModel>(
  field: keyof R & string,
  headerName = 'Date',
  formatDate?: (value: string) => string
): GridColDef<R> {
  return {
    field,
    headerName,
    minWidth: 120,
    valueFormatter: (value) => {
      const raw = String(value || '');
      return raw && formatDate ? formatDate(raw) : raw;
    },
  };
}

export function categoryChipColumn<R extends { category_name?: string; category_color?: string }>(
  field = 'category_name',
  { headerName = 'Category', uncategorized = 'Uncategorized' }: { headerName?: string; uncategorized?: string } = {}
): GridColDef<R> {
  return {
    field,
    headerName,
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
        <Typography variant="body2" color="text.secondary">{uncategorized}</Typography>
      );
    },
  };
}

export interface UserColumnLabels {
  headerName?: string;
  owner?: string;
  effectiveUser?: string;
  unassigned?: string;
}

export function userColumn<R extends Partial<Transaction>>({
  headerName = 'User',
  owner = 'Owner',
  effectiveUser = 'Effective user',
  unassigned = 'Unassigned',
}: UserColumnLabels = {}): GridColDef<R> {
  return {
    field: 'effective_user_name',
    headerName,
    minWidth: 140,
    flex: 0.7,
    renderCell: (params) => {
      const row = params.row;
      const tooltip = [
        row.account_owner_name ? `${owner}: ${row.account_owner_name}` : null,
        row.effective_user_name ? `${effectiveUser}: ${row.effective_user_name}` : null,
      ].filter(Boolean).join('\n');

      return (
        <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{tooltip}</span>}>
          <Typography variant="body2" noWrap fontWeight={600} sx={{ minWidth: 0 }}>
            {row.effective_user_name || unassigned}
          </Typography>
        </Tooltip>
      );
    },
  };
}

export function accountColumn<R extends Partial<Transaction>>({
  headerName = 'Account',
  owner = 'Owner',
  unknownAccount = 'Unknown Account',
}: { headerName?: string; owner?: string; unknownAccount?: string } = {}): GridColDef<R> {
  return {
    field: 'account_name',
    headerName,
    minWidth: 160,
    flex: 0.8,
    renderCell: (params) => (
      <Tooltip title={params.row.account_owner_name ? `${owner}: ${params.row.account_owner_name}` : ''}>
        <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
          {params.row.account_name || unknownAccount}
        </Typography>
      </Tooltip>
    ),
  };
}

export function cardColumn<R extends Partial<Transaction>>({
  headerName = 'Card',
  noCard = 'No card',
}: { headerName?: string; noCard?: string } = {}): GridColDef<R> {
  return {
    field: 'card_last_four',
    headerName,
    minWidth: 110,
    flex: 0.45,
    renderCell: (params) => {
      const row = params.row;
      const label = row.card_last_four ? `••${row.card_last_four}` : noCard;
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

export interface IndicatorLabels {
  headerName?: string;
  flagged?: string;
  excluded?: string;
  refund?: string;
  refundUnconfirmed?: string;
  transfer?: string;
  transferUnconfirmed?: string;
  budget?: string;
  trip?: string;
  project?: string;
  series?: string;
  card?: string;
}

export function indicatorsColumn(
  budgetedCategoryIds: Set<number>,
  labels: IndicatorLabels = {}
): GridColDef<Transaction> {
  const text = {
    headerName: 'Indicators',
    flagged: 'Flagged',
    excluded: 'Excluded',
    refund: 'Refund',
    refundUnconfirmed: 'Refund?',
    transfer: 'Transfer',
    transferUnconfirmed: 'Transfer?',
    budget: 'Budget',
    trip: 'Trip',
    project: 'Project',
    series: 'Series',
    card: 'Card',
    ...labels,
  };
  return {
    field: 'indicators',
    headerName: text.headerName,
    sortable: false,
    filterable: false,
    width: 150,
    renderCell: (params) => {
      const chips: ReactNode[] = [];
      // Review and reporting state first: these change what the totals mean.
      if (params.row.is_flagged) chips.push(<Chip key="flagged" size="small" color="warning" icon={<Flag />} label={text.flagged} />);
      if (params.row.is_excluded) chips.push(<Chip key="excluded" size="small" icon={<VisibilityOff />} label={text.excluded} />);
      // Refund / transfer chips say how the type was decided; an automatic,
      // unconfirmed type is dashed so the user knows it can still be reviewed.
      const unconfirmed = needsTypeReview(params.row);
      const autoChipSx = unconfirmed ? { borderStyle: 'dashed' } : undefined;
      if (params.row.type === 'refund') {
        chips.push(
          <Tooltip key="refund" title={describeTypeDecision(params.row)}>
            <Chip size="small" color="success" variant="outlined" icon={<Undo />} label={unconfirmed ? text.refundUnconfirmed : text.refund} sx={autoChipSx} data-testid="indicator-refund" />
          </Tooltip>
        );
      }
      if (params.row.type === 'transfer') {
        chips.push(
          <Tooltip key="transfer" title={describeTypeDecision(params.row)}>
            <Chip size="small" color="info" variant="outlined" icon={<SwapHoriz />} label={unconfirmed ? text.transferUnconfirmed : text.transfer} sx={autoChipSx} data-testid="indicator-transfer" />
          </Tooltip>
        );
      }
      if (params.row.category_id && budgetedCategoryIds.has(params.row.category_id)) chips.push(<Chip key="budget" size="small" icon={<Savings />} label={text.budget} />);
      if (params.row.trip_id) chips.push(<Chip key="trip" size="small" icon={<CalendarMonth />} label={text.trip} />);
      if (params.row.project_id) chips.push(<Chip key="project" size="small" icon={<Work />} label={text.project} />);
      if (params.row.series_id) chips.push(<Chip key="series" size="small" icon={<CalendarMonth />} label={text.series} />);
      if (params.row.card_id) chips.push(<Chip key="card" size="small" icon={<CreditCard />} label={text.card} />);
      return <Box sx={{ display: 'flex', gap: 0.5, overflow: 'hidden' }}>{chips}</Box>;
    },
  };
}
