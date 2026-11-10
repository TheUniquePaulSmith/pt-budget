'use client';

/**
 * Step 4, "Things to check": everything the analysis found, most urgent
 * first. Blockers need a decision (fix the row or leave it out) before the
 * import can run (D7); warnings and notes are for reading; assumptions are
 * listed so nothing was decided silently. Repeated rows, detected transfers
 * and how the file lines up with what is already stored follow.
 */

import React from 'react';
import { Alert, Box, Button, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { ImportIssue } from '@/lib/statementImport';

import IssueCard from './IssueCard';
import { useIssueTexts } from './issueText';
import { DuplicatesPanel, TransfersPanel } from './ReviewPanels';
import type { ImportWizardController } from './useImportWizard';
import { accountDisplayName, findAccount, sharedCurrency } from './wizardFormat';
import {
  accountIssueCode,
  importBlockers,
  isStagingFresh,
  issuesBySeverity,
  statementIssues,
  summarize,
  type StatementSession,
} from './wizardModel';

interface ReviewStepProps {
  wizard: ImportWizardController;
}

interface SectionProps {
  title: string;
  count?: number;
  testId: string;
  children: React.ReactNode;
}

function Section({ title, count, testId, children }: SectionProps) {
  return (
    <Box component="section" data-testid={testId} sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle1" component="h3">
          {title}
        </Typography>
        {count !== undefined && <Chip size="small" label={count} />}
      </Box>
      {children}
    </Box>
  );
}

export default function ReviewStep({ wizard }: ReviewStepProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const { date } = useFormatters();
  const texts = useIssueTexts();
  const { current: statement, slice, dispatch, stagingPending } = wizard;
  if (!statement) return null;

  const summary = summarize(statement);
  const currency = sharedCurrency(slice.accounts, summary.accountIds);
  const fresh = isStagingFresh(statement);
  const duplicateGroups = fresh ? (statement.staging.result?.duplicateGroups ?? []) : [];
  const classification = fresh ? statement.staging.classification : null;
  const hasTransfers =
    classification != null &&
    (classification.pairs.length > 0 || classification.summary.refundsInferred > 0 || classification.summary.ruleMatches > 0);

  // Coverage and repeated rows have their own sections below.
  const general = (issue: ImportIssue) =>
    issue.scope !== 'coverage' && !(issue.code === 'duplicateInFile' && duplicateGroups.length > 0);
  const blockers = issuesBySeverity(statement, 'blocker').filter(general);
  const warnings = issuesBySeverity(statement, 'warning').filter(general);
  const notes = issuesBySeverity(statement, 'info').filter(general);
  const coverageIssues = statementIssues(statement).filter((issue) => issue.scope === 'coverage');
  const duplicateIssue = statementIssues(statement).find((issue) => issue.code === 'duplicateInFile');
  const open = importBlockers(statement).filter((blocker) => blocker.kind !== 'noRows');
  const changes = Object.entries(statement.overrides)
    .map(([index, override]) => ({ index: Number(index), override, row: statement.report.rows[Number(index)] }))
    .filter((entry) => entry.row);

  const card = (issue: ImportIssue, index: number) => (
    <IssueCard key={`${issue.code}-${index}`} issue={issue} statement={statement} currency={currency} dispatch={dispatch} />
  );

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h5" component="h2" gutterBottom>
          {t('review.title')}
        </Typography>
        <Typography color="text.secondary">{t('review.intro')}</Typography>
      </Box>

      {open.length > 0 ? (
        <Alert severity="error" data-testid="import-review-status" data-blocked="true">
          {t('review.blocked')}
        </Alert>
      ) : (
        <Alert severity="success" data-testid="import-review-status" data-blocked="false">
          {warnings.length > 0 ? t('review.clearWithWarnings', { count: warnings.length }) : t('review.clear')}
        </Alert>
      )}

      {blockers.length > 0 && (
        <Section title={texts.severity('blocker')} count={blockers.length} testId="import-review-blockers">
          <Stack spacing={1.5}>{blockers.map(card)}</Stack>
        </Section>
      )}

      {warnings.length > 0 && (
        <Section title={texts.severity('warning')} count={warnings.length} testId="import-review-warnings">
          <Stack spacing={1.5}>{warnings.map(card)}</Stack>
        </Section>
      )}

      {changes.length > 0 && (
        <Section title={t('review.changes.title')} count={changes.length} testId="import-review-changes">
          <Stack spacing={0.5}>
            {changes.map(({ index, override, row }) => (
              <Box key={index} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }} data-testid="import-change">
                <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {override.skip
                    ? t('review.changes.skipped', { line: row.sourceLine })
                    : override.skip === false && Object.keys(override).length === 1
                      ? t('review.changes.kept', { line: row.sourceLine })
                      : t('review.changes.fixed', { line: row.sourceLine })}
                  {row.description ? ` · ${row.description}` : ''}
                </Typography>
                <Button size="small" onClick={() => dispatch({ type: 'rowReset', index })} data-testid="import-change-undo">
                  {t('review.changes.undo')}
                </Button>
              </Box>
            ))}
          </Stack>
        </Section>
      )}

      {stagingPending && (
        <Box data-testid="import-staging-pending">
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {t('review.checking')}
          </Typography>
          <LinearProgress />
        </Box>
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

      {duplicateGroups.length > 0 && (
        <Section title={t('review.duplicates.title')} count={duplicateGroups.length} testId="import-review-duplicates">
          <Paper variant="outlined" sx={{ p: 2 }}>
            {duplicateIssue && texts.detail(duplicateIssue) && (
              <Typography variant="body2" sx={{ mb: 1 }}>
                {texts.detail(duplicateIssue)}
              </Typography>
            )}
            <DuplicatesPanel statement={statement} currency={currency} dispatch={dispatch} />
          </Paper>
        </Section>
      )}

      {hasTransfers && (
        <Section title={t('review.transfers.title')} count={classification?.pairs.length} testId="import-review-transfers">
          <Paper variant="outlined" sx={{ p: 2 }}>
            <TransfersPanel statement={statement} accounts={slice.accounts} dispatch={dispatch} />
          </Paper>
        </Section>
      )}

      {(coverageIssues.length > 0 || statement.coverage) && (
        <Section title={t('review.coverage.title')} testId="import-review-coverage">
          <Stack spacing={1.5}>
            {statement.coverage && statement.coverage.transactionCount > 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('review.coverage.stored', {
                  count: statement.coverage.transactionCount,
                  from: date(statement.coverage.firstDate),
                  to: date(statement.coverage.lastDate),
                })}
              </Typography>
            )}
            {statement.coverage && statement.coverage.transactionCount === 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('review.coverage.none')}
              </Typography>
            )}
            {coverageIssues.map(card)}
          </Stack>
        </Section>
      )}

      <Section title={t('review.assumptions.title')} testId="import-review-assumptions">
        <AssumptionsList statement={statement} wizard={wizard} />
      </Section>

      {notes.length > 0 && (
        <Section title={texts.severity('info')} count={notes.length} testId="import-review-notes">
          <Stack spacing={1.5}>{notes.map(card)}</Stack>
        </Section>
      )}
    </Stack>
  );
}

/** What the wizard decided on the user's behalf: the account(s) and how the file is read. */
function AssumptionsList({ statement, wizard }: { statement: StatementSession; wizard: ImportWizardController }) {
  const { t } = useTranslation(['importWizard', 'common']);
  const texts = useIssueTexts();
  const { slice, dispatch } = wizard;
  const choices = (statement.accounts ?? []).filter((choice) => !choice.skipped && choice.accountId != null);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={1}>
        {choices.map((choice) => {
          const account = findAccount(slice.accounts, choice.accountId);
          const proposed = choice.accountId === choice.resolution.accountId;
          const issue = { code: accountIssueCode(choice.resolution), params: { value: choice.value, count: choice.rowCount } };
          return (
            <Box key={choice.value} sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }} data-testid="import-assumption-account">
              <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                {t('review.assumptions.account', { account: account ? accountDisplayName(account) : '' })}
                {' · '}
                {proposed ? texts.title(issue) : t('review.assumptions.chosenByYou')}
              </Typography>
              <Button size="small" onClick={() => dispatch({ type: 'goToStep', step: 'account' })}>
                {t('review.assumptions.change')}
              </Button>
            </Box>
          );
        })}
        {statement.proposal.assumptions.map((assumption, index) => (
          <Box
            key={`${assumption.subject}-${assumption.code}-${index}`}
            sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
            data-testid="import-assumption"
            data-assumption-code={assumption.code}
          >
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
              {texts.assumption(assumption)}
            </Typography>
            <Button size="small" onClick={() => dispatch({ type: 'goToStep', step: 'layout' })}>
              {t('review.assumptions.change')}
            </Button>
          </Box>
        ))}
        {choices.length === 0 && statement.proposal.assumptions.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            {t('review.assumptions.none')}
          </Typography>
        )}
      </Stack>
    </Paper>
  );
}
