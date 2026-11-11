'use client';

/**
 * Import history: one row per import run, newest first, with what the file
 * was, where it went, what it added and what the analysis found, and "Undo
 * this import" (the confirmation itself is UndoImportDialog, opened by the
 * view so it outlives the row it removes).
 */

import React, { useId, useState } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import { Undo as UndoIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { Account, ImportBatch } from '@/types/database';

import ManageSection from './ManageSection';
import {
  type BatchFindings,
  HISTORY_PREVIEW_COUNT,
  batchAccounts,
  hasFindings,
  parseIssuesSummary,
} from './manageModel';
import { useFindingText } from './useFindingText';

export interface ImportHistorySectionProps {
  /** null while the first load is running. */
  batches: ImportBatch[] | null;
  failed: boolean;
  accounts: readonly Account[];
  onRetry: () => void;
  onStartImport: () => void;
  /** Opens the undo confirmation; `fileName` is the name this row shows. */
  onUndo: (batch: ImportBatch, fileName: string) => void;
}

// The import went through, so a blocker here was fixed or skipped at the time: it is something that
// needed attention, not an error still standing.
const SEVERITY_CHIP_COLOR = { blocker: 'warning', warning: 'warning', info: 'default' } as const;

function Findings({ findings }: { findings: BatchFindings }) {
  const { t } = useTranslation('importManage');
  const { number } = useFormatters();
  const findingText = useFindingText();

  if (!hasFindings(findings)) {
    return (
      <Typography variant="body2" color="text.secondary" data-testid="import-history-findings">
        {t('history.noFindings')}
      </Typography>
    );
  }

  // Chips wrap instead of truncating: a finding's name can be a short sentence.
  const chipSx = { height: 'auto', maxWidth: '100%', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.25 } };

  return (
    <Box sx={{ mt: 0.5 }} data-testid="import-history-findings">
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 0.5 }}>
        {t('history.findingsLabel')}
      </Typography>
      <Box component="ul" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, m: 0, p: 0, listStyle: 'none' }}>
        {findings.issues.map((issue) => (
          <Box component="li" key={issue.code} sx={{ minWidth: 0 }}>
            <Chip
              size="small"
              variant="outlined"
              color={SEVERITY_CHIP_COLOR[issue.severity]}
              label={findingText(issue.code, issue.count)}
              sx={chipSx}
            />
          </Box>
        ))}
        {findings.assumptions > 0 && (
          <Box component="li" sx={{ minWidth: 0 }}>
            <Chip
              size="small"
              variant="outlined"
              label={t('history.assumptions', { count: number(findings.assumptions) })}
              sx={chipSx}
            />
          </Box>
        )}
        {findings.fixedRows > 0 && (
          <Box component="li" sx={{ minWidth: 0 }}>
            <Chip
              size="small"
              variant="outlined"
              label={t('history.fixedRows', { count: number(findings.fixedRows) })}
              sx={chipSx}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}

interface HistoryRowProps {
  batch: ImportBatch;
  fileName: string;
  accounts: readonly Account[];
  onUndo: () => void;
}

function HistoryRow({ batch, fileName, accounts, onUndo }: HistoryRowProps) {
  const { t } = useTranslation('importManage');
  const { number, date, dateTime } = useFormatters();
  const fileId = useId();

  const accountNames = batchAccounts(batch, accounts).map((account) => account.name ?? t('page.deletedAccount'));
  const findings = parseIssuesSummary(batch.issues_json);

  let range: string;
  if (!batch.min_date || !batch.max_date) range = t('history.noDates');
  else if (batch.min_date === batch.max_date) range = t('history.singleDate', { date: date(batch.min_date) });
  else range = t('history.dateRange', { from: date(batch.min_date), to: date(batch.max_date) });

  const formatLabel =
    batch.file_format === 'ofx'
      ? t('history.format.ofx')
      : batch.file_format === 'delimited'
        ? t('history.format.delimited')
        : null;
  const details = [formatLabel, batch.profile_name ? t('history.savedFormat', { name: batch.profile_name }) : null].filter(
    (part): part is string => part !== null
  );

  const counts = [
    { key: 'imported', label: t('history.counts.imported'), value: batch.inserted_count },
    { key: 'duplicates', label: t('history.counts.duplicates'), value: batch.duplicate_count },
    { key: 'skipped', label: t('history.counts.skipped'), value: batch.skipped_count },
    { key: 'rejected', label: t('history.counts.rejected'), value: batch.rejected_count },
  ];

  return (
    <Box
      component="li"
      data-testid="import-history-row"
      data-batch-id={batch.id}
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', md: 'row' },
        alignItems: { md: 'flex-start' },
        gap: { xs: 1.5, md: 3 },
        py: 1.5,
        borderTop: 1,
        borderColor: 'divider',
      }}
    >
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          id={fileId}
          variant="subtitle1"
          component="h3"
          sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
          data-testid="import-history-file"
        >
          {fileName}
        </Typography>
        <Typography variant="body2" color="text.secondary" data-testid="import-history-when">
          {dateTime(batch.imported_at)}
        </Typography>
        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }} data-testid="import-history-accounts">
          {accountNames.length > 0 ? accountNames.join(', ') : t('history.noAccount')}
        </Typography>
        <Typography variant="body2" color="text.secondary" data-testid="import-history-range">
          {range}
        </Typography>
        {details.length > 0 && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ overflowWrap: 'anywhere' }}
            data-testid="import-history-details"
          >
            {details.join(' · ')}
          </Typography>
        )}
        {findings && <Findings findings={findings} />}
      </Box>

      <Box
        component="dl"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' },
          gap: 1,
          m: 0,
          flexShrink: 0,
          width: { xs: '100%', md: 380 },
        }}
      >
        {counts.map((count) => (
          <Box key={count.key} sx={{ minWidth: 0 }}>
            <Typography component="dt" variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {count.label}
            </Typography>
            <Typography
              component="dd"
              variant="body1"
              sx={{ m: 0, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
              data-testid={`import-history-count-${count.key}`}
            >
              {number(count.value)}
            </Typography>
          </Box>
        ))}
      </Box>

      <Box sx={{ flexShrink: 0 }}>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          startIcon={<UndoIcon fontSize="small" />}
          onClick={onUndo}
          aria-describedby={fileId}
          data-testid="import-history-undo"
        >
          {t('history.undo')}
        </Button>
      </Box>
    </Box>
  );
}

export default function ImportHistorySection({
  batches,
  failed,
  accounts,
  onRetry,
  onStartImport,
  onUndo,
}: ImportHistorySectionProps) {
  const { t } = useTranslation('importManage');
  const { number } = useFormatters();
  const [showAll, setShowAll] = useState(false);

  const all = batches ?? [];
  const visible = showAll ? all : all.slice(0, HISTORY_PREVIEW_COUNT);
  const nameOf = (batch: ImportBatch) => batch.file_name?.trim() || t('history.unnamedFile');

  return (
    <ManageSection
      testId="import-history"
      title={t('history.title')}
      description={t('history.description')}
      itemCount={batches ? batches.length : null}
      failed={failed}
      onRetry={onRetry}
      emptyText={t('history.empty')}
      onStartImport={onStartImport}
    >
      <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }} data-testid="import-history-list">
        {visible.map((batch) => (
          <HistoryRow
            key={batch.id}
            batch={batch}
            fileName={nameOf(batch)}
            accounts={accounts}
            onUndo={() => onUndo(batch, nameOf(batch))}
          />
        ))}
      </Box>

      {all.length > HISTORY_PREVIEW_COUNT && (
        <Stack direction="row" sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}>
          <Button size="small" onClick={() => setShowAll((current) => !current)} data-testid="import-history-toggle">
            {showAll ? t('history.showFewer') : t('history.showAll', { count: number(all.length) })}
          </Button>
        </Stack>
      )}
    </ManageSection>
  );
}
