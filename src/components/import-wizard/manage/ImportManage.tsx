'use client';

/**
 * The "History & formats" view of the Import page: import history with undo,
 * saved formats, and what files call each account. Everything is read on
 * demand through `useImportManageSlice`; the history reloads whenever
 * transactions change. The props are defined in ../ImportPage.
 */

import React, { useCallback, useState } from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { History as HistoryIcon, UploadFile as StartImportIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useImportManageSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import type { ImportBatch } from '@/types/database';

import type { ImportManageProps } from '../ImportPage';
import AccountIdentifiersSection from './AccountIdentifiersSection';
import ImportHistorySection from './ImportHistorySection';
import { HISTORY_LIMIT } from './manageModel';
import SavedFormatsSection from './SavedFormatsSection';
import UndoImportDialog, { type UndoImportResult } from './UndoImportDialog';
import { useAsyncList } from './useAsyncList';

interface Notice {
  id: string;
  severity: 'success' | 'warning';
  text: string;
}

/** Shown instead of three empty lists before anything has been imported. */
function NothingImportedYet({ onStartImport }: { onStartImport: () => void }) {
  const { t } = useTranslation('importManage');

  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 4 }, textAlign: 'center' }} data-testid="import-manage-empty">
      <HistoryIcon color="action" sx={{ fontSize: 48 }} />
      <Typography variant="h6" component="h2" sx={{ mt: 1 }}>
        {t('empty.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        {t('empty.body')}
      </Typography>
      <Box
        component="ul"
        sx={{ display: 'inline-block', textAlign: 'left', maxWidth: 560, my: 2, pl: 3, '& li': { mb: 0.5 } }}
      >
        <Typography component="li" variant="body2">
          {t('empty.history')}
        </Typography>
        <Typography component="li" variant="body2">
          {t('empty.formats')}
        </Typography>
        <Typography component="li" variant="body2">
          {t('empty.identifiers')}
        </Typography>
      </Box>
      <Box>
        <Button variant="contained" startIcon={<StartImportIcon />} onClick={onStartImport} data-testid="import-manage-start">
          {t('page.startImport')}
        </Button>
      </Box>
    </Paper>
  );
}

export default function ImportManage({ onStartImport }: ImportManageProps) {
  const { t } = useTranslation('importManage');
  const { number } = useFormatters();
  const {
    accounts,
    transactionVersion,
    listImportBatches,
    getImportBatchImpact,
    undoImportBatch,
    runSubscriptionScan,
    listImportProfiles,
    saveImportProfile,
    deleteImportProfile,
    listAccountIdentifiers,
    removeAccountIdentifier,
  } = useImportManageSlice();

  const loadHistory = useCallback(() => listImportBatches(HISTORY_LIMIT), [listImportBatches]);
  const loadFormats = useCallback(() => listImportProfiles(), [listImportProfiles]);
  const loadIdentifiers = useCallback(() => listAccountIdentifiers(), [listAccountIdentifiers]);

  const history = useAsyncList('listImportBatches', loadHistory, transactionVersion);
  const formats = useAsyncList('listImportProfiles', loadFormats);
  const identifiers = useAsyncList('listAccountIdentifiers', loadIdentifiers);

  const [undoTarget, setUndoTarget] = useState<{ batch: ImportBatch; fileName: string } | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);

  const reloadHistory = history.reload;
  const reloadFormats = formats.reload;
  const reloadIdentifiers = identifiers.reload;

  const handleUndone = useCallback(
    ({ impact, scanFailed }: UndoImportResult, fileName: string) => {
      setUndoTarget(null);
      const next: Notice[] = [
        {
          id: 'undone',
          severity: 'success',
          text: t('history.undone', { file: fileName, count: number(impact.transactions) }),
        },
      ];
      if (scanFailed) next.push({ id: 'scan-failed', severity: 'warning', text: t('history.undoneScanFailed') });
      setNotices(next);
      void reloadHistory();
    },
    [number, reloadHistory, t]
  );

  // Undone elsewhere (another tab) since this list was read: say so and drop the stale row.
  const handleBatchMissing = useCallback(() => {
    setUndoTarget(null);
    setNotices([{ id: 'batch-missing', severity: 'warning', text: t('undo.errors.IMPORT_BATCH_NOT_FOUND') }]);
    void reloadHistory();
  }, [reloadHistory, t]);

  // A renamed or deleted format also changes the "Saved format" shown on history rows.
  const handleFormatsChanged = useCallback(() => {
    void reloadFormats();
    void reloadHistory();
  }, [reloadFormats, reloadHistory]);

  const handleIdentifiersChanged = useCallback(() => {
    void reloadIdentifiers();
  }, [reloadIdentifiers]);

  const nothingYet =
    history.items?.length === 0 &&
    formats.items?.length === 0 &&
    identifiers.items?.length === 0 &&
    !history.failed &&
    !formats.failed &&
    !identifiers.failed;

  return (
    <Stack spacing={2} data-testid="import-manage">
      {notices.map((notice) => (
        <Alert
          key={notice.id}
          severity={notice.severity}
          onClose={() => setNotices((current) => current.filter((entry) => entry.id !== notice.id))}
          data-testid={`import-manage-notice-${notice.id}`}
        >
          {notice.text}
        </Alert>
      ))}

      {nothingYet ? (
        <NothingImportedYet onStartImport={onStartImport} />
      ) : (
        <>
          <ImportHistorySection
            batches={history.items}
            failed={history.failed}
            accounts={accounts}
            onRetry={() => void reloadHistory()}
            onStartImport={onStartImport}
            onUndo={(batch, fileName) => setUndoTarget({ batch, fileName })}
          />
          <SavedFormatsSection
            profiles={formats.items}
            failed={formats.failed}
            accounts={accounts}
            onRetry={() => void reloadFormats()}
            onStartImport={onStartImport}
            saveImportProfile={saveImportProfile}
            deleteImportProfile={deleteImportProfile}
            onChanged={handleFormatsChanged}
          />
          <AccountIdentifiersSection
            identifiers={identifiers.items}
            failed={identifiers.failed}
            accounts={accounts}
            onRetry={() => void reloadIdentifiers()}
            onStartImport={onStartImport}
            removeAccountIdentifier={removeAccountIdentifier}
            onChanged={handleIdentifiersChanged}
          />
        </>
      )}

      {/* Lives here, not in the history row: the undo removes that row while the dialog is still working. */}
      {undoTarget && (
        <UndoImportDialog
          key={undoTarget.batch.id}
          batch={undoTarget.batch}
          fileName={undoTarget.fileName}
          getImportBatchImpact={getImportBatchImpact}
          undoImportBatch={undoImportBatch}
          runSubscriptionScan={runSubscriptionScan}
          onClose={() => setUndoTarget(null)}
          onUndone={(result) => handleUndone(result, undoTarget.fileName)}
          onMissing={handleBatchMissing}
        />
      )}
    </Stack>
  );
}
