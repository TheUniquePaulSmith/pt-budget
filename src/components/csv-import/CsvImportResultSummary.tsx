'use client';

import { Alert, Box, List, ListItem, ListItemText, Typography } from '@mui/material';
import { CheckCircle, Error as ErrorIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import type { CsvRejectedRow } from '@/lib/csvImportService';

export interface CsvImportResult {
  inserted: number;
  duplicates: number;
  skipped: number;
  rejected: number;
  /** The rejected rows, listed one per line ("Row 7: Unrecognized date …"). */
  rejectedRows: CsvRejectedRow[];
  /** Transfers imported as pairs (both legs typed transfer). */
  transfers?: number;
  /** ...of which paired with a row that was already in the database. */
  transfersWithExisting?: number;
  /** Rows typed refund by inference. */
  refunds?: number;
  /** Rows typed by one of the user's type rules. */
  ruleTyped?: number;
}

interface CsvImportResultSummaryProps {
  result: CsvImportResult;
  fileName: string | null;
}

/**
 * What happened to every row of the file, shown until the user closes the
 * dialog (the parent is told via `onSuccess` only on dismiss).
 */
export default function CsvImportResultSummary({ result, fileName }: CsvImportResultSummaryProps) {
  const { t } = useTranslation('csvImport');
  const severity = result.rejected === 0 ? 'success' : result.inserted > 0 ? 'warning' : 'error';

  return (
    <Box data-testid="csv-import-result">
      <Alert severity={severity} icon={severity === 'success' ? <CheckCircle /> : <ErrorIcon />}>
        <Typography variant="body2" gutterBottom>
          <strong>
            {fileName ? t('resultSummary.completedWithFile', { fileName }) : t('resultSummary.completed')}
          </strong>
        </Typography>
        <Typography variant="body2" data-testid="csv-import-result-inserted">
          {t('resultSummary.imported', { count: result.inserted })}
        </Typography>
        <Typography variant="body2" data-testid="csv-import-result-duplicates">
          {t('resultSummary.duplicates', { count: result.duplicates })}
        </Typography>
        <Typography variant="body2" data-testid="csv-import-result-skipped">
          {t('resultSummary.skipped', { count: result.skipped })}
        </Typography>
        <Typography variant="body2" data-testid="csv-import-result-rejected">
          {t('resultSummary.rejected', { count: result.rejected })}
        </Typography>
        {result.transfers !== undefined && (
          <Typography variant="body2" data-testid="csv-import-result-transfers">
            {t('resultSummary.transfers', { count: result.transfers })}
            {result.transfersWithExisting
              ? t('resultSummary.transfersWithExisting', { count: result.transfersWithExisting })
              : ''}
          </Typography>
        )}
        {result.refunds !== undefined && result.refunds > 0 && (
          <Typography variant="body2" data-testid="csv-import-result-refunds">
            {t('resultSummary.refunds', { count: result.refunds })}
          </Typography>
        )}
        {result.ruleTyped !== undefined && result.ruleTyped > 0 && (
          <Typography variant="body2" data-testid="csv-import-result-rule-typed">
            {t('resultSummary.ruleTyped', { count: result.ruleTyped })}
          </Typography>
        )}
      </Alert>

      {result.rejectedRows.length > 0 && (
        <Box mt={2}>
          <Typography variant="body2" color="error" gutterBottom>
            {t('resultSummary.rejectedRows')}
          </Typography>
          <List dense>
            {result.rejectedRows.map((row) => (
              <ListItem key={row.rowNumber}>
                <ListItemText
                  primary={t('resultSummary.rejectedLine', {
                    row: row.rowNumber,
                    reason: t(`rejectedReason.${row.reason.code}`, { value: row.reason.value, column: row.reason.column }),
                  })}
                />
              </ListItem>
            ))}
          </List>
        </Box>
      )}
    </Box>
  );
}
