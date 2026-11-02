'use client';

import React, { useMemo, useState } from 'react';
import {
  Box,
  Chip,
  Collapse,
  Button,
  IconButton,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  CheckCircleOutline as ConfirmIcon,
  Edit as EditIcon,
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon,
  ReceiptLong as ViewIcon,
  Restore as RestoreIcon,
  VisibilityOff as IgnoreIcon,
} from '@mui/icons-material';
import type { GridColDef } from '@mui/x-data-grid';
import { useTranslation } from 'react-i18next';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { cardColumn } from '@/components/common/DataGrid/columns';
import { useFormatters } from '@/contexts/useFormatters';
import { todayLocalISO } from '@/lib/dateOnly';
import type { RecurringSeries } from '@/types/database';

function isOverdue(series: RecurringSeries): boolean {
  if (!series.next_expected_date || series.status !== 'active') return false;
  return series.next_expected_date < todayLocalISO();
}

interface SeriesTableProps {
  title: string;
  series: RecurringSeries[];
  emptyMessage?: string;
  onConfirm?: (series: RecurringSeries) => void;
  onIgnore?: (series: RecurringSeries) => void;
  onRestore?: (series: RecurringSeries) => void;
  onEdit: (series: RecurringSeries) => void;
  onViewTransactions: (series: RecurringSeries) => void;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

const SeriesTable: React.FC<SeriesTableProps> = ({
  title,
  series,
  emptyMessage,
  onConfirm,
  onIgnore,
  onRestore,
  onEdit,
  onViewTransactions,
  collapsible = true,
  defaultExpanded = true,
}) => {
  const { t } = useTranslation('subscriptions');
  const { money } = useFormatters();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const columns = useMemo<GridColDef<RecurringSeries>[]>(() => {
    // A series' expected amount and total are cross-transaction figures: default currency.
    const formatAmount = (row: RecurringSeries): string => {
      if (row.expected_amount == null) return '—';
      const formatted = money(row.expected_amount);
      return row.amount_is_variable ? t('seriesTable.variesAmount', { amount: formatted }) : formatted;
    };

    return [
      {
        field: 'name',
        headerName: t('seriesTable.columnName'),
        flex: 1.2,
        minWidth: 170,
        renderCell: (params) => (
          <Typography variant="body2" fontWeight={600} noWrap>
            {params.row.name}
          </Typography>
        ),
      },
      {
        field: 'company_name',
        headerName: t('seriesTable.columnMerchant'),
        flex: 1,
        minWidth: 140,
        valueGetter: (_, row) => row.company_name || '—',
      },
      cardColumn<RecurringSeries>({ headerName: t('columns.card'), noCard: t('columns.noCard') }),
      {
        field: 'cadence',
        headerName: t('seriesTable.columnCadence'),
        width: 150,
        renderCell: (params) => (
          <Chip
            label={t(`cadence.${params.row.cadence}`)}
            size="small"
            color={params.row.cadence === 'irregular' ? 'default' : 'primary'}
            variant="outlined"
          />
        ),
      },
      {
        field: 'expected_amount',
        headerName: t('seriesTable.columnAmount'),
        width: 150,
        align: 'right',
        headerAlign: 'right',
        renderCell: (params) => formatAmount(params.row),
      },
      {
        field: 'last_seen_date',
        headerName: t('seriesTable.columnLastPaid'),
        width: 115,
        valueGetter: (_, row) => row.last_seen_date || '—',
      },
      {
        field: 'next_expected_date',
        headerName: t('seriesTable.columnNextExpected'),
        width: 165,
        renderCell: (params) => (
          <Box display="flex" alignItems="center" gap={1}>
            {params.row.next_expected_date || '—'}
            {isOverdue(params.row) && (
              <Chip label={t('seriesTable.overdue')} size="small" color="warning" />
            )}
          </Box>
        ),
      },
      {
        field: 'is_autopay',
        headerName: t('seriesTable.columnPayment'),
        width: 130,
        valueGetter: (_, row) =>
          row.is_autopay ? t('seriesTable.autopay') : row.due_day ? t('seriesTable.manualDayValue', { day: row.due_day }) : t('seriesTable.manual'),
        renderCell: (params) => (
          <Chip
            label={
              params.row.is_autopay
                ? t('seriesTable.autopay')
                : params.row.due_day
                  ? t('seriesTable.manualDay', { day: params.row.due_day })
                  : t('seriesTable.manual')
            }
            size="small"
            color={params.row.is_autopay ? 'success' : 'default'}
            variant="outlined"
            data-testid={`series-payment-${params.row.id}`}
          />
        ),
      },
      {
        field: 'transaction_count',
        headerName: t('seriesTable.columnCharges'),
        width: 100,
        align: 'right',
        headerAlign: 'right',
        valueGetter: (_, row) => row.transaction_count ?? 0,
      },
      {
        field: 'total_spent',
        headerName: t('seriesTable.columnTotalSpent'),
        width: 130,
        align: 'right',
        headerAlign: 'right',
        renderCell: (params) =>
          params.row.total_spent != null ? money(params.row.total_spent) : '—',
      },
      {
        field: 'actions',
        headerName: t('seriesTable.columnActions'),
        width: 180,
        align: 'right',
        headerAlign: 'right',
        sortable: false,
        filterable: false,
        renderCell: (params) => (
          <Box display="flex" justifyContent="flex-end">
            {onConfirm && (
              <Tooltip title={t('seriesTable.confirmTooltip')}>
                <IconButton size="small" color="success" onClick={() => onConfirm(params.row)}>
                  <ConfirmIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {onIgnore && (
              <Tooltip title={t('seriesTable.ignoreTooltip')}>
                <IconButton size="small" onClick={() => onIgnore(params.row)}>
                  <IgnoreIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            {onRestore && (
              <Tooltip title={t('seriesTable.restoreTooltip')}>
                <IconButton size="small" color="primary" onClick={() => onRestore(params.row)}>
                  <RestoreIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title={t('seriesTable.editTooltip')}>
              <IconButton size="small" onClick={() => onEdit(params.row)}>
                <EditIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('seriesTable.viewTransactionsTooltip')}>
              <IconButton size="small" onClick={() => onViewTransactions(params.row)}>
                <ViewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        ),
      },
    ];
  }, [money, onConfirm, onIgnore, onRestore, onEdit, onViewTransactions, t]);

  if (series.length === 0 && !emptyMessage) {
    return null;
  }

  const hasTitle = title.trim().length > 0;

  return (
    <Box mb={4}>
      {hasTitle && (
        collapsible ? (
          <Button
            size="small"
            onClick={() => setExpanded((value) => !value)}
            endIcon={expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            sx={{ mb: 1, px: 0, justifyContent: 'flex-start' }}
          >
            <Typography variant="h6" component="span">
              {title}
            </Typography>
          </Button>
        ) : (
          <Typography variant="h6" gutterBottom>
            {title}
          </Typography>
        )
      )}
      <Collapse in={!collapsible || expanded}>
        {series.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {emptyMessage}
          </Typography>
        ) : (
          <AppDataGrid
            rows={series}
            columns={columns}
            height={Math.min(series.length * 52 + 72, 560)}
            hideFooter
            disableVirtualization={process.env.NODE_ENV === 'test'}
          />
        )}
      </Collapse>
    </Box>
  );
};

export default SeriesTable;
