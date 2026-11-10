'use client';

/**
 * Step 3, "Check how we read it": the first rows as they will be imported,
 * how dates, numbers and the direction of money are read (each with a worded
 * example from the file), which column plays which part, and, for a file read
 * wrongly, Advanced and "Ask AI".
 */

import React from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { CheckCircle } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { AmountSign, DateOrder, DecimalSeparator } from '@/lib/statementImport';

import AdvancedReadOptions from './AdvancedReadOptions';
import AiLayoutHelp from './AiLayoutHelp';
import InterpretedRowsTable from './InterpretedRowsTable';
import { useIssueTexts } from './issueText';
import { dateExample, decimalExample, signExamples, type AmountExample } from './layoutExamples';
import type { ImportWizardController } from './useImportWizard';
import { findAccount } from './wizardFormat';
import {
  ASK_BELOW_CONFIDENCE,
  ROLE_KEYS,
  missingParts,
  roleOfColumn,
  settingsToConfirm,
  singleAccountId,
  usesSingleAmount,
  type ConfirmSubject,
  type RoleKey,
  type StatementSession,
} from './wizardModel';

/**
 * Why the wizard reads a setting the way it does, in the analysis's own words. Shown while the
 * layout still is what was proposed: once the user changed the setting, the reason no longer applies.
 */
function useReason(statement: StatementSession, subject: ConfirmSubject): string | null {
  const texts = useIssueTexts();
  const { layout, proposal } = statement;
  if (layout[subject] !== proposal.layout[subject]) return null;
  const assumption = proposal.assumptions.find((candidate) => candidate.subject === subject);
  return assumption ? texts.assumption(assumption) : null;
}

const NOT_IMPORTED = 'none';
const DATE_ORDERS: readonly DateOrder[] = ['MDY', 'DMY', 'YMD'];
const DECIMALS: readonly DecimalSeparator[] = ['.', ','];

interface LayoutStepProps {
  wizard: ImportWizardController;
}

export default function LayoutStep({ wizard }: LayoutStepProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const { current: statement, slice, dispatch } = wizard;
  if (!statement) return null;

  const currency = findAccount(slice.accounts, singleAccountId(statement))?.currency ?? null;
  const pending = settingsToConfirm(statement);
  const missing = missingParts(statement.layout);
  const editable = statement.table.format === 'delimited';
  const lowConfidence = statement.proposal.confidence < ASK_BELOW_CONFIDENCE || missing.length > 0;

  return (
    <Stack spacing={2.5}>
      <Box>
        <Typography variant="h5" component="h2" gutterBottom>
          {t('layout.title')}
        </Typography>
        <Typography color="text.secondary">{t('layout.intro')}</Typography>
      </Box>

      {statement.layoutSource === 'profile' && statement.profile && !statement.profileForOtherAccount && (
        <Alert severity="success" data-testid="import-layout-saved">
          {t('layout.fromSavedFormat', { name: statement.profile.name })}
        </Alert>
      )}
      {statement.layoutSource === 'profile' && statement.profile && statement.profileForOtherAccount && (
        <Alert severity="info" data-testid="import-layout-saved-other">
          {t('layout.fromSavedFormatOtherAccount', { name: statement.profile.name })}
        </Alert>
      )}
      {statement.layoutSource === 'preset' && <Alert severity="success">{t('layout.fromFileType')}</Alert>}
      {statement.layoutSource === 'ai' && <Alert severity="warning">{t('layout.fromAi')}</Alert>}
      {missing.length > 0 && (
        <Alert severity="error" data-testid="import-layout-missing">
          {t('layout.missing', { parts: missing.map((part) => t(`layout.roles.${part}`)).join(', ') })}
        </Alert>
      )}

      {editable && lowConfidence && statement.layoutSource !== 'profile' && (
        <AiLayoutHelp table={statement.table} onProposal={wizard.applyAiProposal} />
      )}

      <Box>
        <Typography variant="subtitle1" component="h3" gutterBottom>
          {t('layout.previewTitle')}
        </Typography>
        <InterpretedRowsTable statement={statement} currency={currency} />
      </Box>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
        <DateSetting statement={statement} pending={pending.includes('dateOrder')} editable={editable} dispatch={dispatch} />
        <DecimalSetting
          statement={statement}
          pending={pending.includes('decimal')}
          editable={editable}
          currency={currency}
          dispatch={dispatch}
        />
        <SignSetting statement={statement} pending={pending.includes('amountSign')} editable={editable} currency={currency} dispatch={dispatch} />
      </Box>

      {editable ? (
        <ColumnRolesEditor statement={statement} dispatch={dispatch} />
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t('layout.fixedColumns')}
        </Typography>
      )}

      {editable && <AdvancedReadOptions statement={statement} onApply={wizard.applyReadOptions} />}
    </Stack>
  );
}

interface SettingProps {
  statement: StatementSession;
  /** The wizard is not sure and asks. */
  pending: boolean;
  editable: boolean;
  dispatch: ImportWizardController['dispatch'];
}

interface SettingCardProps {
  subject: ConfirmSubject;
  title: string;
  pending: boolean;
  confirmed: boolean;
  onConfirm: () => void;
  children: React.ReactNode;
  extraAction?: React.ReactNode;
  /** Why it is read this way (`importIssues:assumptions.<code>`). */
  reason?: string | null;
}

/** One reading setting: its control, a worded example and, when the wizard is unsure, "That's right". */
function SettingCard({ subject, title, pending, confirmed, onConfirm, children, extraAction, reason }: SettingCardProps) {
  const { t } = useTranslation('importWizard');
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, minWidth: 0, borderColor: pending ? 'warning.main' : 'divider', borderWidth: pending ? 2 : 1 }}
      data-testid={`import-setting-${subject}`}
      data-pending={String(pending)}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5, flexWrap: 'wrap' }}>
        <Typography variant="subtitle1" component="h3" sx={{ flex: 1, minWidth: 0 }}>
          {title}
        </Typography>
        {pending && <Chip size="small" color="warning" label={t('layout.pleaseCheck')} />}
        {!pending && confirmed && <Chip size="small" color="success" variant="outlined" icon={<CheckCircle />} label={t('layout.confirmed')} />}
      </Box>
      {children}
      {reason && (
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ mt: 1, overflowWrap: 'anywhere' }}
          data-testid={`import-reason-${subject}`}
        >
          {reason}
        </Typography>
      )}
      {pending && (
        <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
          <Button size="small" variant="contained" onClick={onConfirm} data-testid={`import-confirm-${subject}`}>
            {t('layout.thatsRight')}
          </Button>
          {extraAction}
        </Box>
      )}
    </Paper>
  );
}

function DateSetting({ statement, pending, editable, dispatch }: SettingProps) {
  const { t } = useTranslation('importWizard');
  const { date } = useFormatters();
  const example = dateExample(statement);
  const hasDateColumn = statement.layout.roles.date != null;
  const reason = useReason(statement, 'dateOrder');

  return (
    <SettingCard
      subject="dateOrder"
      title={t('layout.dates.title')}
      pending={pending}
      reason={reason}
      confirmed={statement.confirmed.dateOrder}
      onConfirm={() => dispatch({ type: 'settingConfirmed', subject: 'dateOrder' })}
    >
      <FormControl fullWidth size="small" disabled={!editable}>
        <InputLabel id="import-date-order-label">{t('layout.dates.label')}</InputLabel>
        <Select
          labelId="import-date-order-label"
          label={t('layout.dates.label')}
          value={statement.layout.dateOrder}
          onChange={(event) => dispatch({ type: 'dateOrderSet', order: event.target.value as DateOrder })}
          SelectDisplayProps={{ 'data-testid': 'import-date-order' } as React.HTMLAttributes<HTMLDivElement>}
        >
          {DATE_ORDERS.map((order) => (
            <MenuItem key={order} value={order}>
              {t(`layout.dates.order.${order}`)}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography variant="body2" sx={{ mt: 1.5 }} color={example ? 'text.primary' : 'error'} data-testid="import-date-example">
        {example
          ? t('layout.dates.example', { raw: example.raw, date: date(example.date, 'long') })
          : hasDateColumn
            ? t('layout.dates.noneReadable')
            : t('layout.dates.noColumn')}
      </Typography>
    </SettingCard>
  );
}

function DecimalSetting({ statement, pending, editable, currency, dispatch }: SettingProps & { currency: string | null }) {
  const { t } = useTranslation('importWizard');
  const { money } = useFormatters();
  const example = decimalExample(statement);
  const reason = useReason(statement, 'decimal');

  return (
    <SettingCard
      subject="decimal"
      title={t('layout.decimal.title')}
      pending={pending}
      reason={reason}
      confirmed={statement.confirmed.decimal}
      onConfirm={() => dispatch({ type: 'settingConfirmed', subject: 'decimal' })}
    >
      <FormControl fullWidth size="small" disabled={!editable}>
        <InputLabel id="import-decimal-label">{t('layout.decimal.label')}</InputLabel>
        <Select
          labelId="import-decimal-label"
          label={t('layout.decimal.label')}
          value={statement.layout.decimal}
          onChange={(event) => dispatch({ type: 'decimalSet', decimal: event.target.value as DecimalSeparator })}
          SelectDisplayProps={{ 'data-testid': 'import-decimal' } as React.HTMLAttributes<HTMLDivElement>}
        >
          {DECIMALS.map((decimal) => (
            <MenuItem key={decimal} value={decimal}>
              {decimal === '.' ? t('layout.decimal.period') : t('layout.decimal.comma')}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
      <Typography variant="body2" sx={{ mt: 1.5 }} color={example ? 'text.primary' : 'error'} data-testid="import-decimal-example">
        {example
          ? t('layout.decimal.example', { raw: example.raw, amount: money(Math.abs(example.amount), currency) })
          : t('layout.decimal.noneReadable')}
      </Typography>
    </SettingCard>
  );
}

function SignSetting({ statement, pending, editable, currency, dispatch }: SettingProps & { currency: string | null }) {
  const { t } = useTranslation('importWizard');
  const { money } = useFormatters();
  const { layout, table } = statement;
  const flipped: AmountSign = layout.amountSign === 'asIs' ? 'inverted' : 'asIs';
  const columnName = (index: number | null | undefined) => (index == null ? '' : (table.columns[index]?.name ?? ''));
  const reason = useReason(statement, 'amountSign');

  const describe = (example: AmountExample) =>
    t(example.amount < 0 ? 'layout.sign.exampleOut' : 'layout.sign.exampleIn', {
      raw: example.raw,
      description: example.description || t('layout.sign.noDescription'),
      amount: money(Math.abs(example.amount), currency),
    });

  if (!usesSingleAmount(layout)) {
    const hasPair = layout.roles.debit != null || layout.roles.credit != null;
    return (
      <SettingCard subject="amountSign" title={t('layout.sign.title')} pending={false} confirmed={false} onConfirm={() => undefined}>
        <Typography variant="body2" data-testid="import-sign-example">
          {hasPair
            ? t('layout.sign.fromColumns', {
                debit: columnName(layout.roles.debit) || t('layout.sign.noColumn'),
                credit: columnName(layout.roles.credit) || t('layout.sign.noColumn'),
              })
            : t('layout.sign.noAmount')}
        </Typography>
      </SettingCard>
    );
  }

  const examples = signExamples(statement);
  const shown = [examples.out, examples.in].filter((example): example is AmountExample => example !== null);
  const flip = editable ? (
    <Button size="small" onClick={() => dispatch({ type: 'amountSignSet', sign: flipped })} data-testid="import-flip-sign">
      {t('layout.sign.flip')}
    </Button>
  ) : null;

  return (
    <SettingCard
      subject="amountSign"
      title={t('layout.sign.title')}
      pending={pending}
      reason={reason}
      confirmed={statement.confirmed.amountSign}
      onConfirm={() => dispatch({ type: 'settingConfirmed', subject: 'amountSign' })}
      extraAction={flip}
    >
      <Typography variant="body2" color="text.secondary" gutterBottom>
        {layout.amountSign === 'asIs' ? t('layout.sign.asIs') : t('layout.sign.inverted')}
      </Typography>
      <Box data-testid="import-sign-example">
        {shown.length > 0 ? (
          shown.map((example) => (
            <Typography key={example.raw + example.description} variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>
              {describe(example)}
            </Typography>
          ))
        ) : (
          <Typography variant="body2" color="error">
            {t('layout.decimal.noneReadable')}
          </Typography>
        )}
      </Box>
      {!pending && flip && <Box sx={{ mt: 1 }}>{flip}</Box>}
    </SettingCard>
  );
}

/** "Columns in your file": every column with a sample value and the part it plays. */
function ColumnRolesEditor({ statement, dispatch }: Pick<SettingProps, 'statement' | 'dispatch'>) {
  const { t } = useTranslation('importWizard');
  const texts = useIssueTexts();
  const { table, layout } = statement;
  const sampleOf = (column: number) => table.rows.find((cells) => cells[column]?.trim())?.[column]?.trim() ?? '';
  // How the columns were worked out, while they still are what was proposed.
  const reasons = statement.layoutEdited
    ? []
    : statement.proposal.assumptions.filter((assumption) => assumption.subject === 'columns');

  return (
    <Box>
      <Typography variant="subtitle1" component="h3" gutterBottom>
        {t('layout.columnsTitle')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('layout.columnsHelp')}
      </Typography>
      {reasons.map((assumption, index) => (
        <Typography
          key={`${assumption.code}-${index}`}
          variant="body2"
          sx={{ mb: 1, overflowWrap: 'anywhere' }}
          data-testid="import-columns-reason"
          data-assumption-code={assumption.code}
        >
          {texts.assumption(assumption)}
        </Typography>
      ))}
      <Stack spacing={1} data-testid="import-column-roles">
        {table.columns.map((column) => {
          const role = roleOfColumn(layout.roles, column.index);
          const labelId = `import-column-${column.index}-label`;
          return (
            <Paper
              key={column.index}
              variant="outlined"
              sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', minWidth: 0 }}
              data-testid={`import-column-${column.index}`}
            >
              <Box sx={{ flex: '1 1 140px', minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                  {column.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
                  {sampleOf(column.index) ? t('layout.columnSample', { value: sampleOf(column.index) }) : t('layout.columnEmpty')}
                </Typography>
              </Box>
              <FormControl size="small" sx={{ flex: '0 1 200px', minWidth: 150 }}>
                <InputLabel id={labelId}>{t('layout.columnRole')}</InputLabel>
                <Select
                  labelId={labelId}
                  label={t('layout.columnRole')}
                  value={role ?? NOT_IMPORTED}
                  onChange={(event) =>
                    dispatch({
                      type: 'roleAssigned',
                      column: column.index,
                      role: event.target.value === NOT_IMPORTED ? null : (event.target.value as RoleKey),
                    })
                  }
                  SelectDisplayProps={{ 'data-testid': `import-column-${column.index}-role` } as React.HTMLAttributes<HTMLDivElement>}
                >
                  <MenuItem value={NOT_IMPORTED}>{t('layout.roles.none')}</MenuItem>
                  {ROLE_KEYS.map((key) => (
                    <MenuItem key={key} value={key}>
                      {t(`layout.roles.${key}`)}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Paper>
          );
        })}
      </Stack>
    </Box>
  );
}
