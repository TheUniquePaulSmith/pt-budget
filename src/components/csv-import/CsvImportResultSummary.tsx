'use client';

import { Alert, Box, List, ListItem, ListItemText, Typography } from '@mui/material';
import { CheckCircle, Error as ErrorIcon } from '@mui/icons-material';

export interface CsvImportResult {
  inserted: number;
  duplicates: number;
  skipped: number;
  rejected: number;
  /** One line per rejected row ("Row 7: Unrecognized date …"). */
  errors: string[];
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
  const severity = result.rejected === 0 ? 'success' : result.inserted > 0 ? 'warning' : 'error';

  return (
    <Box data-testid="csv-import-result">
      <Alert severity={severity} icon={severity === 'success' ? <CheckCircle /> : <ErrorIcon />}>
        <Typography variant="body2" gutterBottom>
          <strong>Import completed{fileName ? ` (${fileName})` : ''}:</strong>
        </Typography>
        <Typography variant="body2" data-testid="csv-import-result-inserted">
          • Imported: {result.inserted}
        </Typography>
        <Typography variant="body2" data-testid="csv-import-result-duplicates">
          • Already in database (duplicates): {result.duplicates}
        </Typography>
        <Typography variant="body2" data-testid="csv-import-result-skipped">
          • Skipped (unlinked accounts): {result.skipped}
        </Typography>
        <Typography variant="body2" data-testid="csv-import-result-rejected">
          • Rejected (could not be read): {result.rejected}
        </Typography>
        {result.transfers !== undefined && (
          <Typography variant="body2" data-testid="csv-import-result-transfers">
            • Transfers between your accounts: {result.transfers}
            {result.transfersWithExisting ? ` (${result.transfersWithExisting} matched to rows already in the database)` : ''}
          </Typography>
        )}
        {result.refunds !== undefined && result.refunds > 0 && (
          <Typography variant="body2" data-testid="csv-import-result-refunds">
            • Refunds detected: {result.refunds}
          </Typography>
        )}
        {result.ruleTyped !== undefined && result.ruleTyped > 0 && (
          <Typography variant="body2" data-testid="csv-import-result-rule-typed">
            • Typed by your rules: {result.ruleTyped}
          </Typography>
        )}
      </Alert>

      {result.errors.length > 0 && (
        <Box mt={2}>
          <Typography variant="body2" color="error" gutterBottom>
            Rejected rows:
          </Typography>
          <List dense>
            {result.errors.map((line, index) => (
              <ListItem key={index}>
                <ListItemText primary={line} />
              </ListItem>
            ))}
          </List>
        </Box>
      )}
    </Box>
  );
}
