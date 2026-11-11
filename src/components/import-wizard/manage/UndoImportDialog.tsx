'use client';

/**
 * "Undo this import?": shows what the import added (transactions, how many
 * were edited since, loan payments, transfer pairs) before anything is
 * removed, says that it cannot be reversed, then removes the batch and
 * re-runs the subscription scan, because the removed rows may have been what
 * a detected series was built from. An import that is no longer in the
 * database (undone in another tab) is handed back to the view, which says so
 * and reloads the history.
 *
 * Mounted only while open (keyed by batch), so every opening starts clean.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material';
import type { i18n as I18nInstance } from 'i18next';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import { logger } from '@/lib/logging';
import type { ImportBatchImpact } from '@/lib/statementImport/types';
import type { ImportBatch } from '@/types/database';

import { BATCH_NOT_FOUND_CODE, errorCodeOf, isDatabaseNotReady } from './manageModel';

const log = logger.child({ component: 'UndoImportDialog' });

export interface UndoImportResult {
  batch: ImportBatch;
  impact: ImportBatchImpact;
  /** The import is gone, but the subscription scan that follows it failed. */
  scanFailed: boolean;
}

export interface UndoImportDialogProps {
  batch: ImportBatch;
  /** The batch's file name as the history shows it. */
  fileName: string;
  getImportBatchImpact: (batchId: number) => Promise<ImportBatchImpact>;
  undoImportBatch: (batchId: number) => Promise<ImportBatchImpact>;
  runSubscriptionScan: () => Promise<unknown>;
  onClose: () => void;
  onUndone: (result: UndoImportResult) => void;
  /** The import is not in the database any more (undone in another tab): there is nothing left to confirm. */
  onMissing: () => void;
}

type LooseTranslate = (key: string) => string;

/** A failure in words: a known service code has its own text, anything else the general one. */
function describeFailure(t: LooseTranslate, i18n: I18nInstance, error: unknown, fallbackKey: string): string {
  if (isDatabaseNotReady(error)) return t('undo.errors.notReady');
  const code = errorCodeOf(error);
  if (code && i18n.exists(`importManage:undo.errors.${code}`)) return t(`undo.errors.${code}`);
  return t(fallbackKey);
}

export default function UndoImportDialog({
  batch,
  fileName,
  getImportBatchImpact,
  undoImportBatch,
  runSubscriptionScan,
  onClose,
  onUndone,
  onMissing,
}: UndoImportDialogProps) {
  const { t, i18n } = useTranslation(['importManage', 'common']);
  const { number, dateTime } = useFormatters();
  const [impact, setImpact] = useState<ImportBatchImpact | null>(null);
  const [impactError, setImpactError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);

  // Read through a ref so a new callback from the parent never re-runs the impact read below.
  const onMissingRef = useRef(onMissing);
  useEffect(() => {
    onMissingRef.current = onMissing;
  }, [onMissing]);

  useEffect(() => {
    let active = true;
    getImportBatchImpact(batch.id)
      .then((result) => {
        if (active) setImpact(result);
      })
      .catch((error: unknown) => {
        if (!active) return;
        if (errorCodeOf(error) === BATCH_NOT_FOUND_CODE) {
          log.info('The import to undo is no longer there', { operation: 'getImportBatchImpact', batchId: batch.id });
          onMissingRef.current();
          return;
        }
        log.error('Failed to read what an import added', { operation: 'getImportBatchImpact', batchId: batch.id, error });
        setImpactError(describeFailure(t as unknown as LooseTranslate, i18n, error, 'undo.impactFailed'));
      });
    return () => {
      active = false;
    };
    // `attempt` re-runs the read after "Try again".
  }, [attempt, batch.id, getImportBatchImpact, i18n, t]);

  const handleRetry = useCallback(() => {
    setImpactError(null);
    setAttempt((current) => current + 1);
  }, []);

  const handleConfirm = useCallback(async () => {
    setUndoing(true);
    setUndoError(null);
    let removed: ImportBatchImpact;
    try {
      removed = await undoImportBatch(batch.id);
    } catch (error) {
      if (errorCodeOf(error) === BATCH_NOT_FOUND_CODE) {
        // Undone somewhere else between opening the confirmation and confirming it.
        log.info('The import to undo is no longer there', { operation: 'undoImportBatch', batchId: batch.id });
        onMissing();
        return;
      }
      log.error('Failed to undo an import', { operation: 'undoImportBatch', batchId: batch.id, error });
      setUndoError(describeFailure(t as unknown as LooseTranslate, i18n, error, 'undo.errors.generic'));
      setUndoing(false);
      return;
    }
    let scanFailed = false;
    try {
      await runSubscriptionScan();
    } catch (error) {
      log.warn('Subscription scan after an undone import failed', { operation: 'runSubscriptionScan', error });
      scanFailed = true;
    }
    onUndone({ batch, impact: removed, scanFailed });
  }, [batch, i18n, onMissing, onUndone, runSubscriptionScan, t, undoImportBatch]);

  const rows: Array<{ key: string; label: string; value: number }> = impact
    ? [
        { key: 'transactions', label: t('undo.transactions'), value: impact.transactions },
        { key: 'edited', label: t('undo.edited'), value: impact.editedSinceImport },
        { key: 'loan-payments', label: t('undo.loanPayments'), value: impact.loanPayments },
        { key: 'transfer-pairs', label: t('undo.transferPairs'), value: impact.transferPairs },
      ]
    : [];

  return (
    <Dialog open onClose={undoing ? undefined : onClose} fullWidth maxWidth="xs" data-testid="import-undo-dialog">
      <DialogTitle>{t('undo.title')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere', mb: 2 }}>
          {t('undo.summary', { file: fileName, when: dateTime(batch.imported_at) })}
        </Typography>

        {!impact && !impactError && (
          <Stack direction="row" spacing={1.5} alignItems="center" data-testid="import-undo-loading">
            <CircularProgress size={18} />
            <Typography variant="body2">{t('undo.loading')}</Typography>
          </Stack>
        )}

        {impactError && (
          <Alert
            severity="error"
            data-testid="import-undo-impact-error"
            action={
              <Button color="inherit" size="small" onClick={handleRetry}>
                {t('page.tryAgain')}
              </Button>
            }
          >
            {impactError}
          </Alert>
        )}

        {impact && (
          <>
            <Typography variant="body2" sx={{ mb: 1 }}>
              {t('undo.intro')}
            </Typography>
            <Box component="dl" sx={{ m: 0, mb: 2 }} data-testid="import-undo-impact">
              {rows.map((row) => (
                <Box
                  key={row.key}
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 2,
                    py: 0.5,
                    borderBottom: 1,
                    borderColor: 'divider',
                  }}
                >
                  <Typography component="dt" variant="body2">
                    {row.label}
                  </Typography>
                  <Typography
                    component="dd"
                    variant="body2"
                    sx={{ m: 0, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                    data-testid={`import-undo-${row.key}`}
                  >
                    {number(row.value)}
                  </Typography>
                </Box>
              ))}
            </Box>

            <Stack spacing={1}>
              {impact.editedSinceImport > 0 && (
                <Alert severity="warning" data-testid="import-undo-edited-warning">
                  {t('undo.editedWarning')}
                </Alert>
              )}
              {impact.transferPairs > 0 && (
                <Typography variant="body2" color="text.secondary">
                  {t('undo.transferNote')}
                </Typography>
              )}
              <Typography variant="body2" color="text.secondary">
                {t('undo.afterwards')}
              </Typography>
              <Alert severity="warning" data-testid="import-undo-irreversible">
                {t('undo.irreversible')}
              </Alert>
            </Stack>
          </>
        )}

        {undoError && (
          <Alert severity="error" sx={{ mt: 2 }} data-testid="import-undo-error">
            {undoError}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={undoing}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={() => void handleConfirm()}
          disabled={!impact || undoing}
          startIcon={undoing ? <CircularProgress size={16} color="inherit" /> : undefined}
          data-testid="import-undo-confirm"
        >
          {undoing ? t('undo.undoing') : t('undo.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
