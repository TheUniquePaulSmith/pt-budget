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

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { cardColumn } from '@/components/common/DataGrid/columns';
import { todayLocalISO } from '@/lib/dateOnly';
import type { RecurringSeries } from '@/types/database';

const CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

const CADENCE_LABELS: Record<RecurringSeries['cadence'], string> = {
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
  irregular: 'Irregular',
};

function formatAmount(series: RecurringSeries): string {
  if (series.expected_amount == null) return '—';
  const formatted = CURRENCY.format(series.expected_amount);
  return series.amount_is_variable ? `~${formatted} (varies)` : formatted;
}

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
  const [expanded, setExpanded] = useState(defaultExpanded);

  const columns = useMemo<GridColDef<RecurringSeries>[]>(() => [
    {
      field: 'name',
      headerName: 'Name',
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
      headerName: 'Merchant',
      flex: 1,
      minWidth: 140,
      valueGetter: (_, row) => row.company_name || '—',
    },
    cardColumn<RecurringSeries>(),
    {
      field: 'cadence',
      headerName: 'Cadence',
      width: 150,
      renderCell: (params) => (
        <Chip
          label={CADENCE_LABELS[params.row.cadence]}
          size="small"
          color={params.row.cadence === 'irregular' ? 'default' : 'primary'}
          variant="outlined"
        />
      ),
    },
    {
      field: 'expected_amount',
      headerName: 'Amount',
      width: 150,
      align: 'right',
      headerAlign: 'right',
      renderCell: (params) => formatAmount(params.row),
    },
    {
      field: 'last_seen_date',
      headerName: 'Last Paid',
      width: 115,
      valueGetter: (_, row) => row.last_seen_date || '—',
    },
    {
      field: 'next_expected_date',
      headerName: 'Next Expected',
      width: 165,
      renderCell: (params) => (
        <Box display="flex" alignItems="center" gap={1}>
          {params.row.next_expected_date || '—'}
          {isOverdue(params.row) && (
            <Chip label="Overdue" size="small" color="warning" />
          )}
        </Box>
      ),
    },
    {
      field: 'transaction_count',
      headerName: 'Charges',
      width: 100,
      align: 'right',
      headerAlign: 'right',
      valueGetter: (_, row) => row.transaction_count ?? 0,
    },
    {
      field: 'total_spent',
      headerName: 'Total Spent',
      width: 130,
      align: 'right',
      headerAlign: 'right',
      renderCell: (params) =>
        params.row.total_spent != null ? CURRENCY.format(params.row.total_spent) : '—',
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 180,
      align: 'right',
      headerAlign: 'right',
      sortable: false,
      filterable: false,
      renderCell: (params) => (
        <Box display="flex" justifyContent="flex-end">
          {onConfirm && (
            <Tooltip title="Confirm as active">
              <IconButton size="small" color="success" onClick={() => onConfirm(params.row)}>
                <ConfirmIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {onIgnore && (
            <Tooltip title="Ignore (hide from this page)">
              <IconButton size="small" onClick={() => onIgnore(params.row)}>
                <IgnoreIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {onRestore && (
            <Tooltip title="Restore to active">
              <IconButton size="small" color="primary" onClick={() => onRestore(params.row)}>
                <RestoreIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Edit">
            <IconButton size="small" onClick={() => onEdit(params.row)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="View transactions">
            <IconButton size="small" onClick={() => onViewTransactions(params.row)}>
              <ViewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    },
  ], [onConfirm, onIgnore, onRestore, onEdit, onViewTransactions]);

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
