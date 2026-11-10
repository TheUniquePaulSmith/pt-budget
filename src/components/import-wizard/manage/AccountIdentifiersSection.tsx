'use client';

/**
 * What statement files call each account (`account_identifiers`), grouped by
 * account, with remove. An account number is shown as its last four digits
 * only: the stored value never reaches the screen, a tooltip or a label.
 */

import React, { useCallback, useState } from 'react';
import { Box, IconButton, Tooltip, Typography } from '@mui/material';
import { DeleteOutline } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import { storedTimestampToDate } from '@/lib/formatting';
import { logger } from '@/lib/logging';
import type { Account, AccountIdentifier } from '@/types/database';

import ConfirmDialog from './ConfirmDialog';
import ManageSection from './ManageSection';
import { groupIdentifiersByAccount, identifierDisplay } from './manageModel';

const log = logger.child({ component: 'AccountIdentifiersSection' });

export interface AccountIdentifiersSectionProps {
  /** null while the first load is running. */
  identifiers: AccountIdentifier[] | null;
  failed: boolean;
  accounts: readonly Account[];
  onRetry: () => void;
  onStartImport: () => void;
  removeAccountIdentifier: (id: number) => Promise<void>;
  onChanged: () => void;
}

interface RemoveTarget {
  identifier: AccountIdentifier;
  /** The masked text the row shows. */
  text: string;
  accountName: string;
}

export default function AccountIdentifiersSection({
  identifiers,
  failed,
  accounts,
  onRetry,
  onStartImport,
  removeAccountIdentifier,
  onChanged,
}: AccountIdentifiersSectionProps) {
  const { t } = useTranslation('importManage');
  const { date } = useFormatters();
  const [removeTarget, setRemoveTarget] = useState<RemoveTarget | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const groups = groupIdentifiersByAccount(identifiers ?? [], accounts);

  const textOf = (identifier: AccountIdentifier): string => {
    const display = identifierDisplay(identifier);
    if (display.kind === 'label') return t('identifiers.label', { text: display.text });
    return display.lastFour ? t('identifiers.numberEnding', { lastFour: display.lastFour }) : t('identifiers.shortNumber');
  };

  const handleRemove = useCallback(async () => {
    if (!removeTarget) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      await removeAccountIdentifier(removeTarget.identifier.id);
      setRemoveTarget(null);
      onChanged();
    } catch (error) {
      // The identifier's value is an account number: only its id is logged.
      log.error('Failed to remove an account identifier', {
        operation: 'removeAccountIdentifier',
        identifierId: removeTarget.identifier.id,
        error,
      });
      setRemoveError(t('identifiers.removeDialog.failed'));
    } finally {
      setRemoving(false);
    }
  }, [onChanged, removeAccountIdentifier, removeTarget, t]);

  return (
    <>
      <ManageSection
        testId="import-identifiers"
        title={t('identifiers.title')}
        description={t('identifiers.description')}
        itemCount={identifiers ? identifiers.length : null}
        failed={failed}
        onRetry={onRetry}
        emptyText={t('identifiers.empty')}
        onStartImport={onStartImport}
      >
        {groups.map((group) => {
          const accountName = group.accountName || t('page.deletedAccount');
          return (
            <Box
              key={group.accountId}
              data-testid="import-identifier-group"
              data-account-id={group.accountId}
              sx={{ py: 1.5, borderTop: 1, borderColor: 'divider' }}
            >
              <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>
                {accountName}
              </Typography>
              <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
                {group.identifiers.map((identifier) => {
                  const text = textOf(identifier);
                  // A stored timestamp, not a calendar date: the day is the one on this device.
                  const added = date(storedTimestampToDate(identifier.created_at));
                  const removeLabel = t('identifiers.remove', { identifier: text, account: accountName });
                  return (
                    <Box
                      component="li"
                      key={identifier.id}
                      data-testid="import-identifier-row"
                      data-identifier-id={identifier.id}
                      sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }} data-testid="import-identifier-text">
                          {text}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" component="p">
                          {identifier.source === 'manual'
                            ? t('identifiers.manual', { date: added })
                            : t('identifiers.fromImport', { date: added })}
                        </Typography>
                      </Box>
                      <Tooltip title={removeLabel}>
                        <IconButton
                          size="small"
                          aria-label={removeLabel}
                          onClick={() => {
                            setRemoveError(null);
                            setRemoveTarget({ identifier, text, accountName });
                          }}
                          data-testid="import-identifier-remove"
                          sx={{ flexShrink: 0 }}
                        >
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          );
        })}
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          sx={{ pt: 1, borderTop: 1, borderColor: 'divider' }}
        >
          {t('identifiers.cardsNote')}
        </Typography>
      </ManageSection>

      {removeTarget && (
        <ConfirmDialog
          title={t('identifiers.removeDialog.title', { account: removeTarget.accountName })}
          confirmLabel={t('identifiers.removeDialog.confirm')}
          confirmTestId="import-identifier-remove-confirm"
          busy={removing}
          error={removeError}
          onConfirm={() => void handleRemove()}
          onCancel={() => setRemoveTarget(null)}
        >
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>
            {t('identifiers.removeDialog.body', { identifier: removeTarget.text, account: removeTarget.accountName })}
          </Typography>
        </ConfirmDialog>
      )}
    </>
  );
}
