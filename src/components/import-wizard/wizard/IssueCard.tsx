'use client';

/**
 * One finding of the analysis, in the catalog's own words, with the rows it
 * applies to. A row can be fixed in place (date, description, amount) or left
 * out; both are overrides kept in the wizard's state (D8). The file is never
 * rewritten.
 */

import React, { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { ImportIssue, NormalizedRow, RowOverride } from '@/lib/statementImport';

import { useIssueTexts } from './issueText';
import { rawAmountCell, rawDateCell } from './layoutExamples';
import type { ImportWizardController } from './useImportWizard';
import { listedRowsOf, type StatementSession } from './wizardModel';

const ROWS_SHOWN = 5;

const SEVERITY_COLOR = { blocker: 'error', warning: 'warning', info: 'info' } as const;

interface IssueCardProps {
  issue: ImportIssue;
  statement: StatementSession;
  currency: string | null;
  dispatch: ImportWizardController['dispatch'];
}

export default function IssueCard({ issue, statement, currency, dispatch }: IssueCardProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const texts = useIssueTexts();
  const [showAll, setShowAll] = useState(false);
  const detail = texts.detail(issue);
  const column = issue.column != null ? statement.table.columns[issue.column]?.name : null;

  // Rows the user already left out no longer need a decision; rows the analysis left out by
  // itself (a total line) stay listed, so one that is a real transaction can be brought back.
  const rows = listedRowsOf(statement, issue).map((index) => statement.report.rows[index]);
  const open = rows.filter((row) => !row.skipped);
  const shown = showAll ? rows : rows.slice(0, ROWS_SHOWN);

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, minWidth: 0, borderLeft: 4, borderLeftColor: `${SEVERITY_COLOR[issue.severity]}.main` }}
      data-testid="import-issue"
      data-issue-code={issue.code}
      data-severity={issue.severity}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
          {texts.title(issue)}
        </Typography>
        {column && <Chip size="small" variant="outlined" label={t('review.column', { name: column })} />}
        {rows.length > 0 && <Chip size="small" label={t('common:plurals.rows', { count: rows.length })} />}
      </Box>
      {detail && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {detail}
        </Typography>
      )}

      {rows.length > 0 && (
        <Stack spacing={1} sx={{ mt: 1.5 }}>
          {shown.map((row) => (
            <IssueRow key={row.index} row={row} statement={statement} currency={currency} dispatch={dispatch} />
          ))}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {rows.length > ROWS_SHOWN && (
              <Button size="small" onClick={() => setShowAll((current) => !current)}>
                {showAll ? t('common:actions.showLess') : t('review.showAllRows', { total: rows.length })}
              </Button>
            )}
            {open.length > 1 && (
              <Button
                size="small"
                onClick={() => dispatch({ type: 'rowsSkipped', indexes: open.map((row) => row.index), skip: true })}
                data-testid="import-issue-skip-all"
              >
                {t('review.skipAll', { total: open.length })}
              </Button>
            )}
          </Box>
        </Stack>
      )}
    </Paper>
  );
}

interface IssueRowProps {
  row: NormalizedRow;
  statement: StatementSession;
  currency: string | null;
  dispatch: ImportWizardController['dispatch'];
}

function IssueRow({ row, statement, currency, dispatch }: IssueRowProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const { money, date } = useFormatters();
  const [editing, setEditing] = useState(false);
  const unreadable = (text: string) => (
    <Typography component="span" variant="body2" color="error">
      {text || t('layout.emptyCell')}
    </Typography>
  );

  // Left out by the analysis (a total or balance line): shown as the file has it, with a way back.
  if (row.skipped) {
    const cells = (statement.table.rows[row.index] ?? []).map((cell) => cell.trim()).filter(Boolean);
    return (
      <Box
        sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', minWidth: 0 }}
        data-testid="import-issue-row"
        data-row-index={row.index}
        data-skipped="true"
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Chip size="small" variant="outlined" label={t('review.line', { line: row.sourceLine })} />
          <Typography variant="body2" color="text.secondary" sx={{ flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>
            {cells.join(' · ') || t('layout.emptyCell')}
          </Typography>
          <Button
            size="small"
            onClick={() => dispatch({ type: 'rowsSkipped', indexes: [row.index], skip: false })}
            data-testid="import-row-restore"
          >
            {t('review.restore')}
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', minWidth: 0 }}
      data-testid="import-issue-row"
      data-row-index={row.index}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Chip size="small" variant="outlined" label={t('review.line', { line: row.sourceLine })} />
        <Typography variant="body2" sx={{ flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>
          {row.date ? date(row.date) : unreadable(rawDateCell(statement, row.index))}
          {' · '}
          {row.description || t('review.noDescription')}
          {' · '}
          {row.amount !== null ? money(row.amount, currency) : unreadable(rawAmountCell(statement, row.index))}
        </Typography>
        {!editing && (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Button size="small" onClick={() => setEditing(true)} data-testid="import-row-fix">
              {t('review.fix')}
            </Button>
            <Button
              size="small"
              onClick={() => dispatch({ type: 'rowsSkipped', indexes: [row.index], skip: true })}
              data-testid="import-row-skip"
            >
              {t('review.skip')}
            </Button>
          </Box>
        )}
      </Box>
      {editing && (
        <RowEditor
          row={row}
          onCancel={() => setEditing(false)}
          onSave={(patch) => {
            if (Object.keys(patch).length > 0) dispatch({ type: 'rowFixed', index: row.index, patch });
            setEditing(false);
          }}
        />
      )}
    </Box>
  );
}

interface RowEditorProps {
  row: NormalizedRow;
  onSave: (patch: Pick<RowOverride, 'date' | 'amount' | 'description'>) => void;
  onCancel: () => void;
}

/** Date, description and amount of one row, as the user wants them imported. */
function RowEditor({ row, onSave, onCancel }: RowEditorProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const [dateValue, setDateValue] = useState(row.date ?? '');
  const [description, setDescription] = useState(row.description);
  const [amount, setAmount] = useState(row.amount === null ? '' : String(Math.abs(row.amount)));
  const [direction, setDirection] = useState<'out' | 'in'>(row.amount !== null && row.amount > 0 ? 'in' : 'out');

  const save = () => {
    const patch: Pick<RowOverride, 'date' | 'amount' | 'description'> = {};
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue) && dateValue !== row.date) patch.date = dateValue;
    if (description.trim() !== row.description) patch.description = description.trim();
    const magnitude = Number(amount);
    if (amount.trim() !== '' && Number.isFinite(magnitude)) {
      const signed = direction === 'out' ? -Math.abs(magnitude) : Math.abs(magnitude);
      if (signed !== row.amount) patch.amount = signed;
    }
    onSave(patch);
  };

  return (
    <Box
      sx={{ mt: 1, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}
      data-testid="import-row-editor"
    >
      <TextField
        size="small"
        type="date"
        label={t('common:fields.date')}
        value={dateValue}
        onChange={(event) => setDateValue(event.target.value)}
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'data-testid': 'import-row-date' } }}
      />
      <TextField
        size="small"
        label={t('common:fields.description')}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        slotProps={{ htmlInput: { 'data-testid': 'import-row-description' } }}
      />
      <TextField
        size="small"
        type="number"
        label={t('common:fields.amount')}
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        slotProps={{ htmlInput: { step: 0.01, min: 0, 'data-testid': 'import-row-amount' } }}
      />
      <ToggleButtonGroup
        size="small"
        exclusive
        value={direction}
        onChange={(_, value) => value && setDirection(value)}
        aria-label={t('review.direction')}
      >
        <ToggleButton value="out" data-testid="import-row-direction-out">
          {t('layout.moneyOut')}
        </ToggleButton>
        <ToggleButton value="in" data-testid="import-row-direction-in">
          {t('layout.moneyIn')}
        </ToggleButton>
      </ToggleButtonGroup>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Button size="small" variant="contained" onClick={save} data-testid="import-row-save">
          {t('common:actions.save')}
        </Button>
        <Button size="small" onClick={onCancel}>
          {t('common:actions.cancel')}
        </Button>
      </Box>
    </Box>
  );
}
