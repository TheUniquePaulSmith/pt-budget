'use client';

/**
 * Step 1, Files: a drop zone and a picker for one or more statement files,
 * and a card per file saying what was recognised in it. A file that cannot be
 * read says why and what to export from the bank instead.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Alert, Box, Button, Chip, IconButton, LinearProgress, Paper, Stack, Tooltip, Typography } from '@mui/material';
import {
  CheckCircle,
  CloudUpload,
  DeleteOutline,
  DescriptionOutlined,
  ErrorOutline,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';

import { useIssueTexts } from './issueText';
import type { ImportWizardController } from './useImportWizard';
import { fileSizeParts } from './wizardFormat';
import type { StatementSession, WizardFile } from './wizardModel';

interface FilesStepProps {
  wizard: ImportWizardController;
}

export default function FilesStep({ wizard }: FilesStepProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const { state, addFiles } = wizard;
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = useCallback(
    (list: FileList | null) => {
      if (list && list.length > 0) addFiles(Array.from(list));
    },
    [addFiles]
  );

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5" component="h2" gutterBottom>
          {t('files.title')}
        </Typography>
        <Typography color="text.secondary">{t('files.intro')}</Typography>
      </Box>

      <Paper
        variant="outlined"
        data-testid="import-drop-zone"
        data-dragging={String(dragging)}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFiles(event.dataTransfer.files);
        }}
        sx={{
          p: { xs: 2, sm: 4 },
          textAlign: 'center',
          borderStyle: 'dashed',
          borderWidth: 2,
          borderColor: dragging ? 'primary.main' : 'divider',
          bgcolor: dragging ? 'action.hover' : 'background.paper',
        }}
      >
        <CloudUpload color="action" sx={{ fontSize: 40 }} />
        <Typography variant="subtitle1" sx={{ mt: 1 }}>
          {t('files.drop')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('files.supported')}
        </Typography>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          aria-label={t('files.inputLabel')}
          data-testid="import-file-input"
          onChange={(event) => {
            handleFiles(event.target.files);
            // The same file can be picked again after it was removed.
            event.target.value = '';
          }}
        />
        <Button variant="contained" onClick={() => inputRef.current?.click()} data-testid="import-choose-files">
          {t('files.choose')}
        </Button>
      </Paper>

      {state.files.map((file) => (
        <FileCard
          key={file.id}
          file={file}
          statements={state.statements.filter((statement) => statement.fileId === file.id)}
          onRemove={() => wizard.removeFile(file.id)}
        />
      ))}
    </Stack>
  );
}

interface FileCardProps {
  file: WizardFile;
  statements: StatementSession[];
  onRemove: () => void;
}

function FileCard({ file, statements, onRemove }: FileCardProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const { number } = useFormatters();
  const texts = useIssueTexts();
  const size = fileSizeParts(file.size);
  const imported = statements.some((statement) => statement.status === 'done');

  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }} data-testid="import-file-card" data-status={file.status}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
        {file.status === 'unreadable' ? <ErrorOutline color="error" /> : <DescriptionOutlined color="action" />}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ overflowWrap: 'anywhere' }}>
            {file.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t(`files.size.${size.unit}`, { value: number(size.value) })}
          </Typography>
        </Box>
        {!imported && (
          <Tooltip title={t('files.remove', { name: file.name })}>
            <IconButton size="small" onClick={onRemove} aria-label={t('files.remove', { name: file.name })} data-testid="import-file-remove">
              <DeleteOutline fontSize="small" />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {file.status === 'reading' && (
        <Box sx={{ mt: 1.5 }}>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('files.reading')}
          </Typography>
          <LinearProgress />
        </Box>
      )}

      {file.status === 'unreadable' && (
        <Alert severity="error" sx={{ mt: 1.5 }} data-testid="import-file-unreadable">
          {/* Why the file cannot be read, and what to do about it, in the finding's own words. */}
          {file.issues.map((issue, index) => (
            <Box key={`${issue.code}-${index}`} data-issue-code={issue.code} sx={{ mt: index > 0 ? 1 : 0 }}>
              <Typography variant="subtitle2">{texts.title(issue)}</Typography>
              {texts.detail(issue) && <Typography variant="body2">{texts.detail(issue)}</Typography>}
            </Box>
          ))}
          {/* A finding with no advice of its own still says what to export instead. */}
          {file.issues.every((issue) => !texts.detail(issue)) && (
            <Typography variant="body2" sx={{ mt: 1 }}>
              {t('files.unreadableHelp')}
            </Typography>
          )}
        </Alert>
      )}

      {statements.map((statement) => (
        <StatementLine key={statement.id} statement={statement} />
      ))}
    </Paper>
  );
}

/** What was recognised in one statement of the file: format, rows, dates, a known layout. */
function StatementLine({ statement }: { statement: StatementSession }) {
  const { t } = useTranslation(['importWizard', 'common']);
  const { date } = useFormatters();
  const { stats } = statement.report;
  const accountHint = statement.table.meta.accountHints.find((hint) => hint.kind === 'number' || hint.kind === 'label');
  const outcome = statement.result?.outcome;

  return (
    <Box sx={{ mt: 1.5 }} data-testid="import-file-statement">
      {statement.tableCount > 1 && (
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {t('files.accountPart', { index: statement.tableIndex + 1, total: statement.tableCount })}
        </Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Chip size="small" label={statement.table.format === 'ofx' ? t('files.formatOfx') : t('files.formatDelimited')} />
        <Chip size="small" label={t('common:plurals.rows', { count: stats.totalRows })} data-testid="import-file-rows" />
        {stats.firstDate && stats.lastDate && (
          <Chip
            size="small"
            label={
              stats.firstDate === stats.lastDate
                ? date(stats.firstDate)
                : t('files.dateRange', { from: date(stats.firstDate), to: date(stats.lastDate) })
            }
          />
        )}
        {accountHint && <Chip size="small" variant="outlined" label={t('files.accountInFile', { value: accountHint.value })} />}
        {statement.profile ? (
          <Chip
            size="small"
            color="success"
            variant="outlined"
            icon={<CheckCircle />}
            label={t('files.savedFormat', { name: statement.profile.name })}
            data-testid="import-file-saved-format"
          />
        ) : (
          statement.table.format === 'delimited' && <Chip size="small" variant="outlined" label={t('files.newFormat')} />
        )}
        {outcome && (
          <Chip
            size="small"
            color={outcome === 'imported' ? 'success' : 'default'}
            label={t(`files.outcome.${outcome}`)}
            data-testid="import-file-outcome"
          />
        )}
      </Box>
    </Box>
  );
}
