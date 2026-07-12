'use client';

import React, { useState } from 'react';
import {
  Box,
  Chip,
  Collapse,
  Button,
  IconButton,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
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
  return series.next_expected_date < new Date().toISOString().split('T')[0];
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
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Merchant</TableCell>
                <TableCell>Cadence</TableCell>
                <TableCell align="right">Amount</TableCell>
                <TableCell>Last Paid</TableCell>
                <TableCell>Next Expected</TableCell>
                <TableCell align="right">Charges</TableCell>
                <TableCell align="right">Total Spent</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {series.map((item) => (
                <TableRow key={item.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {item.name}
                    </Typography>
                  </TableCell>
                  <TableCell>{item.company_name || '—'}</TableCell>
                  <TableCell>
                    <Chip
                      label={CADENCE_LABELS[item.cadence]}
                      size="small"
                      color={item.cadence === 'irregular' ? 'default' : 'primary'}
                      variant="outlined"
                    />
                  </TableCell>
                  <TableCell align="right">{formatAmount(item)}</TableCell>
                  <TableCell>{item.last_seen_date || '—'}</TableCell>
                  <TableCell>
                    <Box display="flex" alignItems="center" gap={1}>
                      {item.next_expected_date || '—'}
                      {isOverdue(item) && (
                        <Chip label="Overdue" size="small" color="warning" />
                      )}
                    </Box>
                  </TableCell>
                  <TableCell align="right">{item.transaction_count ?? 0}</TableCell>
                  <TableCell align="right">
                    {item.total_spent != null ? CURRENCY.format(item.total_spent) : '—'}
                  </TableCell>
                  <TableCell align="right">
                    <Box display="flex" justifyContent="flex-end">
                      {onConfirm && (
                        <Tooltip title="Confirm as active">
                          <IconButton size="small" color="success" onClick={() => onConfirm(item)}>
                            <ConfirmIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {onIgnore && (
                        <Tooltip title="Ignore (hide from this page)">
                          <IconButton size="small" onClick={() => onIgnore(item)}>
                            <IgnoreIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {onRestore && (
                        <Tooltip title="Restore to active">
                          <IconButton size="small" color="primary" onClick={() => onRestore(item)}>
                            <RestoreIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => onEdit(item)}>
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="View transactions">
                        <IconButton size="small" onClick={() => onViewTransactions(item)}>
                          <ViewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        )}
      </Collapse>
    </Box>
  );
};

export default SeriesTable;
