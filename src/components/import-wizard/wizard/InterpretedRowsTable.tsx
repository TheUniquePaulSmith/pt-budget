'use client';

/**
 * The first rows of the file *as interpreted*: date, description, money in,
 * money out. A cell that could not be read shows what the file says, in red.
 */

import React from 'react';
import { Box, Chip, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';

import { rawAmountCell, rawDateCell } from './layoutExamples';
import type { StatementSession } from './wizardModel';

interface InterpretedRowsTableProps {
  statement: StatementSession;
  /** The currency the amounts are in (the chosen account's), when there is one account. */
  currency?: string | null;
  limit?: number;
}

export const INTERPRETED_ROWS_SHOWN = 8;

export default function InterpretedRowsTable({ statement, currency, limit = INTERPRETED_ROWS_SHOWN }: InterpretedRowsTableProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const { money, date } = useFormatters();
  const rows = statement.report.rows.slice(0, limit);
  const total = statement.report.rows.length;

  return (
    <Box sx={{ minWidth: 0 }}>
      <TableContainer sx={{ border: 1, borderColor: 'divider', borderRadius: 1, maxWidth: '100%' }}>
        <Table size="small" data-testid="import-interpreted-table" sx={{ '& td, & th': { px: { xs: 0.75, sm: 2 } } }}>
          <TableHead>
            <TableRow>
              <TableCell>{t('common:fields.date')}</TableCell>
              <TableCell>{t('common:fields.description')}</TableCell>
              <TableCell align="right">{t('layout.moneyIn')}</TableCell>
              <TableCell align="right">{t('layout.moneyOut')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const rawAmount = rawAmountCell(statement, row.index);
              return (
                <TableRow
                  key={row.index}
                  data-testid="import-interpreted-row"
                  sx={row.skipped ? { opacity: 0.55 } : undefined}
                >
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {row.date ? (
                      date(row.date)
                    ) : (
                      <Typography variant="body2" color="error" component="span">
                        {rawDateCell(statement, row.index) || t('layout.emptyCell')}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ overflowWrap: 'anywhere', minWidth: 80 }}>
                    {row.description}
                    {row.skipped && <Chip size="small" label={t('layout.notImported')} sx={{ ml: 1 }} />}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap', color: 'success.main' }}>
                    {row.amount !== null && row.amount > 0 ? money(row.amount, currency) : ''}
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {row.amount !== null && row.amount < 0 ? money(-row.amount, currency) : ''}
                    {row.amount === null && (
                      <Typography variant="body2" color="error" component="span">
                        {rawAmount || t('layout.emptyCell')}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {total > rows.length && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
          {t('layout.moreRows', { count: total - rows.length })}
        </Typography>
      )}
    </Box>
  );
}
