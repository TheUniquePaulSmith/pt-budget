'use client';

import React, { type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';

export interface FormGridProps {
  children: ReactNode;
  /** Columns at the `md` breakpoint and up; always one column below it. */
  columns?: 1 | 2 | 3;
  sx?: React.ComponentProps<typeof Box>['sx'];
}

/**
 * Lays fields out two-up (by default) on desktop and stacked on phones. Each
 * direct child occupies one cell; wrap a child in `FormRow` with `span="all"`
 * to let it take the full width.
 */
export function FormGrid({ children, columns = 2, sx }: FormGridProps) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: `repeat(${columns}, minmax(0, 1fr))` },
        columnGap: 2,
        rowGap: 1.25,
        alignItems: 'start',
        ...sx,
      }}
    >
      {children}
    </Box>
  );
}

export interface FormRowProps {
  /** Optional caption shown in a label column on desktop and above the field on phones. */
  label?: ReactNode;
  /** Associates the caption with the field (`<label for>`), when the field has an id. */
  htmlFor?: string;
  hint?: ReactNode;
  children: ReactNode;
  /** `all` spans every column of the enclosing `FormGrid`. */
  span?: 'one' | 'all';
  sx?: React.ComponentProps<typeof Box>['sx'];
}

/**
 * One field of a ledger form: an optional caption column (fixed width on
 * desktop, stacked on phones) and the control. Without a caption it is just a
 * grid cell, which suits MUI fields that carry their own floating label.
 */
export function FormRow({ label, htmlFor, hint, children, span = 'one', sx }: FormRowProps) {
  return (
    <Box
      sx={{
        gridColumn: span === 'all' ? '1 / -1' : undefined,
        display: label ? 'grid' : 'block',
        gridTemplateColumns: label ? { xs: '1fr', md: 'minmax(96px, 140px) minmax(0, 1fr)' } : undefined,
        columnGap: 1.5,
        rowGap: 0.5,
        alignItems: 'center',
        minWidth: 0,
        ...sx,
      }}
    >
      {label && (
        <Typography
          component="label"
          htmlFor={htmlFor}
          variant="body2"
          color="text.secondary"
          sx={{ fontWeight: 500, pt: { md: 0.5 }, alignSelf: { md: 'start' } }}
        >
          {label}
        </Typography>
      )}
      <Box sx={{ minWidth: 0 }}>
        {children}
        {hint && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.25 }}>
            {hint}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export default FormRow;
