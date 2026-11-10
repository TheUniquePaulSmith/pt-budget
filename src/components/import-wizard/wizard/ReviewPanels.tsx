'use client';

/**
 * The parts of "Things to check" that come from staging the rows rather than
 * from the analysis: rows repeated inside the file, and transfers detected
 * between the user's accounts. Both are inline panels (the old dialog opened a
 * second dialog for each).
 */

import React from 'react';
import { Box, Checkbox, Chip, FormControlLabel, Stack, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { TransferLegSummary } from '@/types/classification';
import type { Account } from '@/types/database';

import type { ImportWizardController } from './useImportWizard';
import { excludedTempIds, type StatementSession } from './wizardModel';

interface PanelProps {
  statement: StatementSession;
  accounts: Account[];
  dispatch: ImportWizardController['dispatch'];
}

/**
 * Rows identical to each other in this file (same account, date, amount and
 * description). Every copy is imported unless the user leaves some out: two
 * coffees on one day are two rows, a bank's repeated line is not.
 */
export function DuplicatesPanel({
  statement,
  currency,
  dispatch,
}: Pick<PanelProps, 'statement' | 'dispatch'> & { currency: string | null }) {
  const { t } = useTranslation(['importWizard', 'common']);
  const { money, date } = useFormatters();
  const groups = statement.staging.result?.duplicateGroups ?? [];
  const excluded = new Set(statement.excludedDuplicateRows);
  const rowsByIndex = new Map(statement.report.rows.map((row) => [row.index, row]));

  return (
    <Stack spacing={1.5} data-testid="import-duplicates">
      <Typography variant="body2" color="text.secondary">
        {t('review.duplicates.help')}
      </Typography>
      {groups.map((group, groupIndex) => {
        const first = rowsByIndex.get(group.rowIndexes[0]);
        if (!first) return null;
        return (
          <Box key={group.rowIndexes.join('-')} sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', minWidth: 0 }} data-testid="import-duplicate-group">
            <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
              {t('review.duplicates.group', {
                copies: group.rowIndexes.length,
                date: first.date ? date(first.date) : '',
                description: first.description || t('review.noDescription'),
                amount: first.amount !== null ? money(first.amount, currency) : '',
              })}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2 }}>
              {group.rowIndexes.map((rowIndex, copyIndex) => {
                const row = rowsByIndex.get(rowIndex);
                return (
                  <FormControlLabel
                    key={rowIndex}
                    control={
                      <Checkbox
                        size="small"
                        checked={!excluded.has(rowIndex)}
                        onChange={(event) => dispatch({ type: 'duplicateExcluded', index: rowIndex, excluded: !event.target.checked })}
                        slotProps={{
                          input: { 'data-testid': `import-duplicate-${groupIndex}-${copyIndex}` } as React.InputHTMLAttributes<HTMLInputElement>,
                        }}
                      />
                    }
                    label={t('review.duplicates.copy', { line: row?.sourceLine ?? rowIndex + 1 })}
                  />
                );
              })}
            </Box>
          </Box>
        );
      })}
    </Stack>
  );
}

function confidenceColor(confidence: number): 'success' | 'warning' | 'default' {
  if (confidence >= 0.8) return 'success';
  if (confidence >= 0.6) return 'warning';
  return 'default';
}

function Leg({ leg }: { leg: TransferLegSummary }) {
  const { t } = useTranslation('importWizard');
  const { date } = useFormatters();
  const values = { account: leg.account_name, date: date(leg.date) };
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
        {leg.description}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {leg.isNew ? t('review.transfers.leg', values) : t('review.transfers.legExisting', values)}
      </Typography>
    </Box>
  );
}

/**
 * Transfers the classifier found among the staged rows (and against rows
 * already stored). A checked pair is imported as a transfer, so it counts as
 * neither income nor spending; recommended pairs start checked.
 */
export function TransfersPanel({ statement, accounts, dispatch }: PanelProps) {
  const { t } = useTranslation(['importWizard', 'common']);
  const { money, percent } = useFormatters();
  const classification = statement.staging.classification;
  if (!classification) return null;
  const selected = new Set(statement.selectedPairIds);
  const excluded = new Set(excludedTempIds(statement));
  const currencyOf = (accountId: number) => accounts.find((account) => account.id === accountId)?.currency;

  return (
    <Stack spacing={1.5} data-testid="import-transfers">
      {classification.pairs.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          {t('review.transfers.help')}
        </Typography>
      )}
      {classification.pairs.map((pair, index) => {
        const legLeftOut =
          (pair.out.tempId != null && excluded.has(pair.out.tempId)) || (pair.in.tempId != null && excluded.has(pair.in.tempId));
        const confidence = percent(pair.confidence, { maximumFractionDigits: 0 });
        return (
          <Box
            key={pair.pairId}
            sx={{ p: 1, borderRadius: 1, bgcolor: 'action.hover', display: 'flex', alignItems: 'flex-start', gap: 1, minWidth: 0 }}
            data-testid="import-transfer-pair"
          >
            <Checkbox
              size="small"
              checked={selected.has(pair.pairId) && !legLeftOut}
              disabled={legLeftOut}
              onChange={(event) => dispatch({ type: 'pairToggled', pairId: pair.pairId, selected: event.target.checked })}
              slotProps={{
                input: {
                  'aria-label': t('review.transfers.importAsTransfer', { description: pair.out.description }),
                  'data-testid': `import-transfer-${index}`,
                } as React.InputHTMLAttributes<HTMLInputElement>,
              }}
            />
            <Box sx={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1 }}>
              <Leg leg={pair.out} />
              <Leg leg={pair.in} />
            </Box>
            <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
              <Typography variant="body2">{money(Math.abs(pair.out.amount), currencyOf(pair.out.account_id))}</Typography>
              <Tooltip title={pair.reasons.join(' · ')}>
                <Chip
                  size="small"
                  color={confidenceColor(pair.confidence)}
                  variant={pair.recommended ? 'filled' : 'outlined'}
                  label={
                    pair.recommended
                      ? t('review.transfers.match', { percent: confidence })
                      : t('review.transfers.possible', { percent: confidence })
                  }
                />
              </Tooltip>
            </Box>
          </Box>
        );
      })}
      {classification.summary.refundsInferred > 0 && (
        <Typography variant="body2" data-testid="import-refunds">
          {t('review.transfers.refunds', { count: classification.summary.refundsInferred })}
        </Typography>
      )}
      {classification.summary.ruleMatches > 0 && (
        <Typography variant="body2" data-testid="import-rule-typed">
          {t('review.transfers.ruleTyped', { count: classification.summary.ruleMatches })}
        </Typography>
      )}
    </Stack>
  );
}
