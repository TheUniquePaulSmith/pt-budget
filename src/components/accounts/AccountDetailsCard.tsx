'use client';

/**
 * What an account label opens: the account's discrete fields in one place
 * (type, bank, owner, every card with its cardholder, currency). Read-only
 * text, so it can live inside a tooltip.
 */

import React from 'react';
import { Box, Chip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { maskedCard, type AccountLabelSource } from '@/lib/accountLabels';
import type { User } from '@/types/database';

import { accountTypeLabel, cardholderName } from './accountDisplay';

export interface AccountDetailsCardProps {
  account: AccountLabelSource;
  /** Resolves owner and cardholder names the account rows do not carry. */
  users?: readonly Pick<User, 'id' | 'display_name'>[];
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <>
      <Typography component="dt" variant="caption" color="text.secondary" sx={{ pt: '1px' }}>
        {term}
      </Typography>
      <Typography component="dd" variant="body2" sx={{ m: 0, minWidth: 0, overflowWrap: 'anywhere' }}>
        {children}
      </Typography>
    </>
  );
}

export default function AccountDetailsCard({ account, users = [] }: AccountDetailsCardProps) {
  const { t } = useTranslation(['accounts', 'common']);
  const owner =
    account.owner_display_name ??
    (account.owner_user_id == null ? undefined : users.find((user) => user.id === account.owner_user_id)?.display_name);
  const institution = account.institution?.trim();
  const closed = account.is_active === 0;

  return (
    <Box data-testid="account-details-card" sx={{ minWidth: 200 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <Typography variant="subtitle2" component="p" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
          {account.name}
        </Typography>
        {closed && <Chip size="small" label={t('common:status.closed')} />}
      </Box>
      <Box
        component="dl"
        sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 1.5, rowGap: 0.5 }}
      >
        {account.type && <Row term={t('grid.columnType')}>{accountTypeLabel(account.type, t)}</Row>}
        {institution && <Row term={t('grid.columnInstitution')}>{institution}</Row>}
        {owner && (
          <Row term={t('grid.columnOwner')}>
            {account.ownership === 'joint' ? t('grid.ownerJoint', { owner }) : owner}
          </Row>
        )}
        {account.cards && (
          <Row term={t('grid.columnCards')}>
            {account.cards.length === 0
              ? t('grid.noCards')
              : account.cards.map((card, index) => (
                  <Box component="span" key={card.id ?? `${card.last_four}-${index}`} sx={{ display: 'block' }}>
                    {[maskedCard(card.last_four), card.nickname?.trim()].filter(Boolean).join(' ')}
                    <Box component="span" sx={{ color: 'text.secondary' }}>
                      {` — ${cardholderName(card, users, t, owner)}`}
                    </Box>
                  </Box>
                ))}
          </Row>
        )}
        {account.currency && <Row term={t('grid.columnCurrency')}>{account.currency}</Row>}
      </Box>
    </Box>
  );
}
