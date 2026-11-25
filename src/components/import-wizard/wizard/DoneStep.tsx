'use client';

/**
 * Step 6, Done: one combined result, a line per file (D12). From here the
 * user looks at the transactions, imports another file, or opens the import
 * history to undo what was just imported.
 */

import React from 'react';
import { Alert, Box, Button, Paper, Stack, Typography } from '@mui/material';
import { CheckCircle, InfoOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import AccountLabel from '@/components/accounts/AccountLabel';
import { useAccountLabels } from '@/components/accounts/useAccountLabels';
import type { AccountLabel as AccountLabelModel } from '@/lib/accountLabels';
import type { User } from '@/types/database';

import type { ImportWizardController } from './useImportWizard';
import type { StatementSession } from './wizardModel';

interface DoneStepProps {
  wizard: ImportWizardController;
  onOpenHistory: () => void;
}

export default function DoneStep({ wizard, onOpenHistory }: DoneStepProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const { state, slice } = wizard;
  const labels = useAccountLabels(slice.accounts, slice.users);
  const finished = state.statements.filter((statement) => statement.result);
  const inserted = finished.reduce((sum, statement) => sum + (statement.result?.inserted ?? 0), 0);
  const duplicates = finished.reduce((sum, statement) => sum + (statement.result?.duplicates ?? 0), 0);

  return (
    <Stack spacing={2.5} data-testid="import-done" data-inserted={inserted} data-duplicates={duplicates}>
      <Box>
        <Typography variant="h5" component="h2" gutterBottom>
          {t('done.title')}
        </Typography>
        <Typography color="text.secondary" data-testid="import-done-total">
          {inserted > 0 ? t('done.total', { count: inserted }) : t('done.totalNone')}
        </Typography>
      </Box>

      {finished.map((statement, index) => (
        <ResultCard
          key={statement.id}
          statement={statement}
          index={index}
          users={slice.users}
          accountLabels={(statement.result?.accountIds ?? [])
            .map((id) => labels.get(id))
            .filter((label) => label !== undefined)}
        />
      ))}

      <Alert
        severity="info"
        icon={<InfoOutlined fontSize="inherit" />}
        action={
          <Button color="inherit" size="small" onClick={onOpenHistory} data-testid="import-undo">
            {t('done.undo')}
          </Button>
        }
      >
        {t('done.undoHelp')}
      </Alert>
    </Stack>
  );
}

interface ResultCardProps {
  statement: StatementSession;
  index: number;
  /** The accounts the statement went into (one that no longer exists is left out). */
  accountLabels: AccountLabelModel[];
  users: User[];
}

function ResultCard({ statement, index, accountLabels, users }: ResultCardProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const result = statement.result;
  if (!result) return null;
  const imported = result.outcome === 'imported';

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, minWidth: 0 }}
      data-testid={`import-result-${index}`}
      data-outcome={result.outcome}
      data-inserted={result.inserted}
      data-duplicates={result.duplicates}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, minWidth: 0 }}>
        {imported ? <CheckCircle color="success" /> : <InfoOutlined color="action" />}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ overflowWrap: 'anywhere' }}>
            {statement.fileName}
            {statement.tableCount > 1
              ? ` · ${t('files.accountPart', { index: statement.tableIndex + 1, total: statement.tableCount })}`
              : ''}
          </Typography>
          {accountLabels.length > 0 && (
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
              {accountLabels.map((label, labelIndex) => (
                <React.Fragment key={label.account.id}>
                  {labelIndex > 0 && ', '}
                  <AccountLabel label={label} users={users} />
                </React.Fragment>
              ))}
            </Typography>
          )}
          <Box sx={{ mt: 1 }}>
            {imported && (
              <Typography variant="body2" data-testid={`import-result-${index}-inserted`}>
                {t('done.inserted', { count: result.inserted })}
              </Typography>
            )}
            {result.outcome === 'nothingNew' && <Typography variant="body2">{t('done.nothingNew')}</Typography>}
            {result.outcome === 'skipped' && <Typography variant="body2">{t('done.skippedFile')}</Typography>}
            {result.duplicates > 0 && (
              <Typography variant="body2" data-testid={`import-result-${index}-duplicates`}>
                {t('done.duplicates', { count: result.duplicates })}
              </Typography>
            )}
            {imported && result.skipped > 0 && (
              <Typography variant="body2" data-testid={`import-result-${index}-skipped`}>
                {t('done.skipped', { count: result.skipped })}
              </Typography>
            )}
            {result.transfers > 0 && (
              <Typography variant="body2" data-testid={`import-result-${index}-transfers`}>
                {t('done.transfers', { count: result.transfers })}
              </Typography>
            )}
            {result.refunds > 0 && (
              <Typography variant="body2" data-testid={`import-result-${index}-refunds`}>
                {t('done.refunds', { count: result.refunds })}
              </Typography>
            )}
            {result.ruleTyped > 0 && (
              <Typography variant="body2" data-testid={`import-result-${index}-rule-typed`}>
                {t('done.ruleTyped', { count: result.ruleTyped })}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>
    </Paper>
  );
}
