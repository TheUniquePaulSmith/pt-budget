'use client';

/**
 * Step 5, Summary: what pressing Import will do. How many rows go in, into
 * which account, over which dates, with what totals, and whether this file's
 * format is remembered for next time. A file in a known format with nothing
 * to decide opens here directly (D16), with the details one click away.
 */

import React from 'react';
import { Alert, Box, Button, Checkbox, Chip, FormControlLabel, Paper, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';

import { useBlockerLine } from './blockerText';
import { useIssueTexts } from './issueText';
import type { ImportWizardController } from './useImportWizard';
import { accountDisplayName, findAccount, sharedCurrency } from './wizardFormat';
import { accountIssueCode, importBlockers, isStagingFresh, summarize } from './wizardModel';

interface SummaryStepProps {
  wizard: ImportWizardController;
}

interface FactProps {
  label: string;
  value: React.ReactNode;
  testId: string;
  emphasized?: boolean;
}

function Fact({ label, value, testId, emphasized = false }: FactProps) {
  return (
    <Box sx={{ minWidth: 0 }} data-testid={testId}>
      <Typography variant="caption" color="text.secondary" component="div">
        {label}
      </Typography>
      <Typography variant={emphasized ? 'h4' : 'body1'} component="div" sx={{ overflowWrap: 'anywhere' }}>
        {value}
      </Typography>
    </Box>
  );
}

export default function SummaryStep({ wizard }: SummaryStepProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const { money, number, date } = useFormatters();
  const texts = useIssueTexts();
  const blockerLine = useBlockerLine();
  const { current: statement, slice, state, dispatch, stagingPending } = wizard;
  if (!statement) return null;

  const summary = summarize(statement);
  const fresh = isStagingFresh(statement);
  const blockers = importBlockers(statement);
  const currency = sharedCurrency(slice.accounts, summary.accountIds);
  const amount = (value: number) =>
    currency ? money(value, currency) : number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const choices = (statement.accounts ?? []).filter((choice) => !choice.skipped && choice.accountId != null);
  const nothingNew = fresh && blockers.length === 0 && summary.toImport === 0;

  return (
    <Stack spacing={2.5}>
      <Typography variant="h5" component="h2">
        {t('summary.title')}
      </Typography>

      {statement.fastPath && (
        <Alert
          severity="success"
          data-testid="import-fast-path"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => dispatch({ type: 'goToStep', step: 'account' })}
              data-testid="import-review-details"
            >
              {t('summary.reviewDetails')}
            </Button>
          }
        >
          {t('summary.sameFormat', { name: statement.profile?.name ?? '' })}
        </Alert>
      )}

      {state.importError && (
        <Alert severity="error" data-testid="import-error">
          {t('summary.failed', { error: state.importError })}
        </Alert>
      )}

      {statement.staging.status === 'error' && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={wizard.retryStaging}>
              {t('common:actions.retry')}
            </Button>
          }
        >
          {t('review.checkFailed')}
        </Alert>
      )}

      {blockers.length > 0 && (
        <Alert severity="error" data-testid="import-summary-blockers">
          <Typography variant="subtitle2">{t('summary.blockedTitle')}</Typography>
          {blockers.map((blocker, index) => {
            const line = blockerLine(blocker);
            return (
              <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
                  {line.text}
                </Typography>
                <Button color="inherit" size="small" onClick={() => dispatch({ type: 'goToStep', step: line.step })}>
                  {t('summary.goThere')}
                </Button>
              </Box>
            );
          })}
        </Alert>
      )}

      {nothingNew && (
        <Alert severity="info" data-testid="import-nothing-new">
          {summary.alreadyImported > 0 ? t('summary.nothingNew', { count: summary.alreadyImported }) : t('summary.nothingLeft')}
        </Alert>
      )}

      <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 2.5 }}>
          <Box sx={{ gridColumn: '1 / -1' }}>
            <Typography variant="caption" color="text.secondary" component="div">
              {t('summary.into', { count: choices.length })}
            </Typography>
            <Stack spacing={0.5} data-testid="import-summary-accounts">
              {choices.map((choice) => {
                const account = findAccount(slice.accounts, choice.accountId);
                // On the fast path a guess is not confirmed step by step: the Summary says so and Import confirms it.
                const guess =
                  !choice.confirmed && choice.resolution.status === 'assumed' && choice.accountId === choice.resolution.accountId;
                return (
                  <Box key={choice.value} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="body1" sx={{ overflowWrap: 'anywhere' }}>
                      {account ? accountDisplayName(account) : ''}
                    </Typography>
                    {choices.length > 1 && (
                      <Chip size="small" variant="outlined" label={t('common:plurals.rows', { count: choice.rowCount })} />
                    )}
                    {guess && (
                      <Chip
                        size="small"
                        color="warning"
                        variant="outlined"
                        label={texts.title({
                          code: accountIssueCode(choice.resolution),
                          params: { value: choice.value, count: choice.rowCount },
                        })}
                        data-testid="import-summary-assumed"
                      />
                    )}
                  </Box>
                );
              })}
            </Stack>
          </Box>

          <Fact
            label={t('summary.toImport')}
            value={stagingPending ? '…' : number(summary.toImport)}
            testId="import-summary-to-import"
            emphasized
          />
          <Fact label={t('summary.rowsInFile')} value={number(summary.totalRows)} testId="import-summary-total" />
          <Fact
            label={t('summary.alreadyImported')}
            value={stagingPending ? '…' : number(summary.alreadyImported)}
            testId="import-summary-already"
          />
          <Fact label={t('summary.leftOut')} value={number(summary.skipped)} testId="import-summary-skipped" />
          <Fact
            label={t('summary.dates')}
            value={
              summary.firstDate && summary.lastDate
                ? summary.firstDate === summary.lastDate
                  ? date(summary.firstDate)
                  : t('files.dateRange', { from: date(summary.firstDate), to: date(summary.lastDate) })
                : '–'
            }
            testId="import-summary-dates"
          />
          <Fact label={t('layout.moneyIn')} value={amount(summary.moneyIn)} testId="import-summary-money-in" />
          <Fact label={t('layout.moneyOut')} value={amount(summary.moneyOut)} testId="import-summary-money-out" />
          {summary.transfers > 0 && (
            <Fact label={t('summary.transfers')} value={number(summary.transfers)} testId="import-summary-transfers" />
          )}
          {summary.refunds > 0 && <Fact label={t('summary.refunds')} value={number(summary.refunds)} testId="import-summary-refunds" />}
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <FormControlLabel
          control={
            <Checkbox
              checked={statement.rememberFormat}
              onChange={(event) => dispatch({ type: 'rememberSet', remember: event.target.checked })}
              slotProps={{ input: { 'data-testid': 'import-remember' } as React.InputHTMLAttributes<HTMLInputElement> }}
            />
          }
          label={t('summary.remember')}
        />
        <Typography variant="body2" color="text.secondary" sx={{ ml: 4, mb: statement.rememberFormat ? 1.5 : 0 }}>
          {statement.profile && !statement.profileForOtherAccount ? t('summary.rememberHelpKnown') : t('summary.rememberHelp')}
        </Typography>
        {statement.rememberFormat && (
          <TextField
            size="small"
            label={t('summary.formatName')}
            value={statement.formatName}
            onChange={(event) => dispatch({ type: 'formatNameSet', name: event.target.value })}
            sx={{ ml: { xs: 0, sm: 4 }, width: { xs: '100%', sm: 320 }, maxWidth: '100%' }}
            slotProps={{ htmlInput: { 'data-testid': 'import-format-name', maxLength: 80 } }}
          />
        )}
      </Paper>
    </Stack>
  );
}
