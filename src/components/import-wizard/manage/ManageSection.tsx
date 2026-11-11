'use client';

import React, { type ReactNode, useId } from 'react';
import { Alert, Box, Button, LinearProgress, Paper, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export interface ManageSectionProps {
  /** Prefix of the section's test ids (`<testId>`, `<testId>-empty`, …). */
  testId: string;
  title: string;
  description: string;
  /** null while the first load is still running. */
  itemCount: number | null;
  failed: boolean;
  onRetry: () => void;
  /** What will appear here, shown while the list is empty. */
  emptyText: string;
  onStartImport: () => void;
  children: ReactNode;
}

/**
 * The frame of one list on the "History & formats" view: heading, what the
 * list is for, and the loading / failed / empty states, so the three sections
 * behave the same way.
 */
export default function ManageSection({
  testId,
  title,
  description,
  itemCount,
  failed,
  onRetry,
  emptyText,
  onStartImport,
  children,
}: ManageSectionProps) {
  const { t } = useTranslation('importManage');
  const headingId = useId();

  return (
    <Paper
      component="section"
      variant="outlined"
      aria-labelledby={headingId}
      data-testid={testId}
      sx={{ p: { xs: 1.5, sm: 2 }, minWidth: 0 }}
    >
      <Typography id={headingId} variant="h6" component="h2">
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {description}
      </Typography>

      {failed && (
        <Alert
          severity="error"
          sx={{ mb: itemCount ? 1.5 : 0 }}
          data-testid={`${testId}-error`}
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              {t('page.tryAgain')}
            </Button>
          }
        >
          {t('page.loadFailed')}
        </Alert>
      )}

      {itemCount === null && !failed && <LinearProgress data-testid={`${testId}-loading`} />}

      {itemCount === 0 && !failed && (
        <Box data-testid={`${testId}-empty`}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {emptyText}
          </Typography>
          <Button size="small" onClick={onStartImport}>
            {t('page.startImport')}
          </Button>
        </Box>
      )}

      {itemCount !== null && itemCount > 0 && children}
    </Paper>
  );
}
