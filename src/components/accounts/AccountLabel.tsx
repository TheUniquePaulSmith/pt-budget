'use client';

/**
 * An account wherever it is shown on its own: its name (plus the one detail
 * that tells it from a same-named account), and its details card on hover,
 * click or keyboard focus. Inside a menu item or a select's value, where the
 * click belongs to the control, use `AccountOptionContent` instead.
 */

import React from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';

import { LABEL_SEPARATOR, type AccountLabel as AccountLabelModel } from '@/lib/accountLabels';
import type { User } from '@/types/database';

import AccountDetailsTooltip from './AccountDetailsTooltip';

export interface AccountLabelProps {
  /** From `useAccountLabels(accounts)`; missing when the account no longer exists. */
  label: AccountLabelModel | null | undefined;
  /** Shown as plain text when there is no label (a deleted account, an unknown row). */
  fallback?: string;
  /** `twoLine` adds the bank / type / owner / cards line under the name. */
  variant?: 'inline' | 'twoLine';
  /** One line with an ellipsis (table cells). */
  noWrap?: boolean;
  users?: readonly Pick<User, 'id' | 'display_name'>[];
  /** A data grid cell passes its own `tabIndex`, so only the focused cell's label is a tab stop. */
  tabIndex?: number;
}

const ELLIPSIS = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

function AccountLabel({ label, fallback = '', variant = 'inline', noWrap = false, users, tabIndex }: AccountLabelProps) {
  if (!label) {
    return (
      <Box component="span" sx={noWrap ? { ...ELLIPSIS, display: 'block', minWidth: 0 } : undefined}>
        {fallback}
      </Box>
    );
  }

  const twoLine = variant === 'twoLine';
  return (
    <AccountDetailsTooltip account={label.account} users={users}>
      <ButtonBase
        component="button"
        type="button"
        disableRipple
        tabIndex={tabIndex}
        data-testid="account-label"
        data-account-id={label.account.id}
        sx={{
          font: 'inherit',
          color: 'inherit',
          textAlign: 'start',
          verticalAlign: 'baseline',
          userSelect: 'text',
          minWidth: 0,
          maxWidth: '100%',
          borderRadius: 0.5,
          display: twoLine ? 'inline-flex' : noWrap ? 'block' : 'inline',
          ...(twoLine ? { flexDirection: 'column', alignItems: 'flex-start' } : null),
          '&:hover .account-label-name, &.Mui-focusVisible .account-label-name': {
            textDecoration: 'underline dotted',
            textUnderlineOffset: '3px',
          },
          '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: '2px' },
        }}
      >
        <Box
          component="span"
          className="account-label-name"
          sx={noWrap ? { ...ELLIPSIS, display: 'block', maxWidth: '100%' } : undefined}
        >
          {label.name}
          {label.hint && (
            <Box component="span" sx={{ color: 'text.secondary' }}>
              {LABEL_SEPARATOR}
              {label.hint.text}
            </Box>
          )}
        </Box>
        {twoLine && label.detailLine && (
          <Typography
            component="span"
            variant="caption"
            color="text.secondary"
            data-testid="account-detail-line"
            sx={{ display: 'block', maxWidth: '100%', ...(noWrap ? ELLIPSIS : null) }}
          >
            {label.detailLine}
          </Typography>
        )}
      </ButtonBase>
    </AccountDetailsTooltip>
  );
}

export default React.memo(AccountLabel);
