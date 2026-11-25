'use client';

/**
 * An account inside a control that owns the click: a menu item, an
 * autocomplete option, a select's value. Two lines of plain text (the name
 * with its hint, then bank / type / owner / cards) and nothing interactive.
 */

import React from 'react';
import { Box, Typography } from '@mui/material';

import { LABEL_SEPARATOR, type AccountLabel } from '@/lib/accountLabels';

export interface AccountOptionContentProps {
  label: AccountLabel | null | undefined;
  /** Shown when there is no label. */
  fallback?: string;
  /** Keep each line on one row with an ellipsis (a select's value; menus may wrap). */
  noWrap?: boolean;
}

const ELLIPSIS = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } as const;

export default function AccountOptionContent({ label, fallback = '', noWrap = false }: AccountOptionContentProps) {
  if (!label) return <>{fallback}</>;
  return (
    <Box sx={{ minWidth: 0, flex: '1 1 auto', display: 'flex', flexDirection: 'column' }}>
      <Box component="span" sx={noWrap ? ELLIPSIS : undefined}>
        {label.name}
        {label.hint && (
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {LABEL_SEPARATOR}
            {label.hint.text}
          </Box>
        )}
      </Box>
      {label.detailLine && (
        <Typography
          component="span"
          variant="caption"
          color="text.secondary"
          data-testid="account-detail-line"
          sx={noWrap ? ELLIPSIS : { whiteSpace: 'normal' }}
        >
          {label.detailLine}
        </Typography>
      )}
    </Box>
  );
}
