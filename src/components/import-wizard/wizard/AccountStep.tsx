'use client';

/**
 * Step 2, Account: "Which account is this for?" Each value the file uses for
 * an account is shown with what the lookup made of it: recognised (a full
 * number matched), assumed (with the reason, to confirm), or unknown (pick an
 * account, create one here, or leave those rows out).
 */

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  FormControl,
  InputLabel,
  ListItemText,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { CheckCircle } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import type { Account } from '@/types/database';

import { accountPrefillFrom } from './accountPrefill';
import InlineAccountForm from './InlineAccountForm';
import { useIssueTexts } from './issueText';
import type { ImportWizardController } from './useImportWizard';
import { accountDisplayName } from './wizardFormat';
import { accountIssueCode, type AccountChoice, type StatementSession } from './wizardModel';

const CREATE_VALUE = 'create';
const SKIP_VALUE = 'skip';

interface AccountStepProps {
  wizard: ImportWizardController;
}

export default function AccountStep({ wizard }: AccountStepProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const { current: statement, slice } = wizard;
  const [creatingFor, setCreatingFor] = useState<string | null>(null);

  if (!statement || !statement.accounts) return null;
  const choices = statement.accounts;
  const several = choices.length > 1;

  return (
    <Stack spacing={2}>
      <Box>
        <Typography variant="h5" component="h2" gutterBottom>
          {t('account.title')}
        </Typography>
        <Typography color="text.secondary">{several ? t('account.introSeveral') : t('account.intro')}</Typography>
      </Box>

      {choices.map((choice, index) => (
        <ChoiceCard
          key={choice.value}
          index={index}
          choice={choice}
          statement={statement}
          accounts={slice.accounts}
          canSkip={several}
          // With no account yet there is nothing to pick from: the form opens by itself.
          creating={creatingFor === choice.value || (slice.accounts.length === 0 && choice.accountId == null && !choice.skipped)}
          onStartCreate={() => setCreatingFor(choice.value)}
          onCancelCreate={slice.accounts.length === 0 ? undefined : () => setCreatingFor(null)}
          wizard={wizard}
          onCreated={() => setCreatingFor(null)}
        />
      ))}
    </Stack>
  );
}

interface ChoiceCardProps {
  index: number;
  choice: AccountChoice;
  statement: StatementSession;
  accounts: Account[];
  canSkip: boolean;
  creating: boolean;
  onStartCreate: () => void;
  onCancelCreate?: () => void;
  onCreated: () => void;
  wizard: ImportWizardController;
}

function ChoiceCard({
  index,
  choice,
  statement,
  accounts,
  canSkip,
  creating,
  onStartCreate,
  onCancelCreate,
  onCreated,
  wizard,
}: ChoiceCardProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const texts = useIssueTexts();
  const { slice, dispatch, chooseAccount } = wizard;
  const { resolution } = choice;
  const issue = { code: accountIssueCode(resolution), params: { value: choice.value, count: choice.rowCount } };
  const labelId = `import-account-${index}-label`;

  // Accounts the lookup pointed at come first, flagged; every other account follows.
  const ordered = useMemo(() => {
    const suggested = new Set<number>([
      ...(resolution.accountId != null ? [resolution.accountId] : []),
      ...resolution.candidateAccountIds,
    ]);
    return [
      ...accounts.filter((account) => suggested.has(account.id)).map((account) => ({ account, suggested: true })),
      ...accounts.filter((account) => !suggested.has(account.id)).map((account) => ({ account, suggested: false })),
    ];
  }, [accounts, resolution.accountId, resolution.candidateAccountIds]);

  const status: 'recognised' | 'assumed' | 'chosen' | 'skipped' | 'open' = choice.skipped
    ? 'skipped'
    : choice.accountId == null
      ? 'open'
      : choice.accountId !== resolution.accountId
        ? 'chosen'
        : resolution.status === 'recognised'
          ? 'recognised'
          : choice.confirmed
            ? 'chosen'
            : 'assumed';
  const statusColor = { recognised: 'success', assumed: 'warning', chosen: 'success', skipped: 'default', open: 'error' } as const;

  const selectValue: number | string = choice.skipped ? SKIP_VALUE : (choice.accountId ?? '');

  const handleSelect = (value: number | string) => {
    if (value === CREATE_VALUE) {
      onStartCreate();
      return;
    }
    if (value === SKIP_VALUE) {
      dispatch({ type: 'accountSkipped', value: choice.value, skipped: true });
      return;
    }
    void chooseAccount(choice.value, Number(value));
  };

  // A file that names no account has nothing to explain; otherwise the finding says how it was matched.
  const showFinding = choice.value !== '' || resolution.status !== 'unknown';

  return (
    <Paper variant="outlined" sx={{ p: 2, minWidth: 0 }} data-testid={`import-account-${index}`} data-status={status}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
        <Typography variant="subtitle1" sx={{ overflowWrap: 'anywhere', minWidth: 0 }}>
          {choice.value !== '' ? t('account.inFile', { value: choice.value }) : t('account.noneInFile')}
        </Typography>
        {canSkip && <Chip size="small" variant="outlined" label={t('common:plurals.rows', { count: choice.rowCount })} />}
        <Chip
          size="small"
          color={statusColor[status]}
          icon={status === 'recognised' || status === 'chosen' ? <CheckCircle /> : undefined}
          label={t(`account.status.${status}`)}
          data-testid={`import-account-${index}-status`}
        />
      </Box>

      {showFinding && !choice.skipped && (
        <Box sx={{ mb: 1.5 }} data-issue-code={issue.code}>
          <Typography variant="body2">{texts.title(issue)}</Typography>
          {texts.detail(issue) && (
            <Typography variant="body2" color="text.secondary">
              {texts.detail(issue)}
            </Typography>
          )}
        </Box>
      )}

      <FormControl fullWidth size="small">
        <InputLabel id={labelId} shrink>
          {t('common:fields.account')}
        </InputLabel>
        <Select
          labelId={labelId}
          label={t('common:fields.account')}
          notched
          displayEmpty
          value={selectValue}
          onChange={(event) => handleSelect(event.target.value as number | string)}
          renderValue={(value) => {
            if (value === SKIP_VALUE) return t('account.skip');
            const account = accounts.find((candidate) => candidate.id === value);
            return account ? accountDisplayName(account) : <Typography color="text.secondary">{t('account.choose')}</Typography>;
          }}
          SelectDisplayProps={{ 'data-testid': `import-account-${index}-select` } as React.HTMLAttributes<HTMLDivElement>}
        >
          {ordered.map(({ account, suggested }) => (
            <MenuItem key={account.id} value={account.id}>
              <ListItemText
                primary={accountDisplayName(account)}
                secondary={[t(`common:accountType.${account.type}`), account.institution].filter(Boolean).join(' · ')}
              />
              {suggested && <Chip size="small" color="info" variant="outlined" label={t('account.suggested')} sx={{ ml: 1 }} />}
            </MenuItem>
          ))}
          {ordered.length > 0 && <Divider />}
          <MenuItem value={CREATE_VALUE} sx={{ fontStyle: 'italic' }} data-testid={`import-account-${index}-create`}>
            {t('account.createNew')}
          </MenuItem>
          {canSkip && <MenuItem value={SKIP_VALUE}>{t('account.skip')}</MenuItem>}
        </Select>
      </FormControl>

      {status === 'assumed' && (
        <Alert
          severity="warning"
          sx={{ mt: 1.5 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => dispatch({ type: 'accountConfirmed', value: choice.value })}
              data-testid={`import-account-${index}-confirm`}
            >
              {t('account.confirm')}
            </Button>
          }
        >
          {t('account.confirmPrompt')}
        </Alert>
      )}
      {status === 'open' && !creating && (
        <Alert severity="info" sx={{ mt: 1.5 }}>
          {canSkip ? t('account.openHintSeveral') : t('account.openHint')}
        </Alert>
      )}
      {choice.skipped && (
        <Alert
          severity="info"
          sx={{ mt: 1.5 }}
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => dispatch({ type: 'accountSkipped', value: choice.value, skipped: false })}
            >
              {t('account.unskip')}
            </Button>
          }
        >
          {t('account.skipped', { count: choice.rowCount })}
        </Alert>
      )}

      {creating && (
        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}>
          <InlineAccountForm
            users={slice.users}
            defaultCurrency={slice.defaultCurrency}
            prefill={accountPrefillFrom(choice.value, statement.table.meta.accountHints)}
            onAdd={slice.addAccountWithCard}
            onAddUser={(displayName) => slice.addUser({ display_name: displayName })}
            onCreated={async ({ accountId, cardId }) => {
              // `addAccountWithCard` resolves after the accounts list refreshed, so the new account is selectable.
              await chooseAccount(choice.value, accountId, cardId);
              onCreated();
            }}
            onCancel={onCancelCreate}
          />
        </Box>
      )}
    </Paper>
  );
}
