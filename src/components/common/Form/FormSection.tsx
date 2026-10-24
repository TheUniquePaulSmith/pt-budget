'use client';

import React, { type ReactNode } from 'react';
import { Box, Divider, Typography } from '@mui/material';

export interface FormSectionProps {
  title: ReactNode;
  description?: ReactNode;
  /** Controls rendered on the right of the heading (e.g. an "Add" button). */
  actions?: ReactNode;
  children: ReactNode;
  /** Draws a divider above the section (every section but the first, typically). */
  divider?: boolean;
  sx?: React.ComponentProps<typeof Box>['sx'];
  'data-testid'?: string;
}

/**
 * A titled block of a dense "ledger" form: a small bold heading with optional
 * description and actions, followed by the fields. Pairs with `FormGrid` /
 * `FormRow` for the field layout.
 */
export function FormSection({
  title,
  description,
  actions,
  children,
  divider = false,
  sx,
  'data-testid': testId,
}: FormSectionProps) {
  return (
    <Box component="section" data-testid={testId} sx={sx}>
      {divider && <Divider sx={{ mb: 1.5 }} />}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
          mb: 1,
        }}
      >
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2" component="h3" sx={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
            {title}
          </Typography>
          {description && (
            <Typography variant="caption" color="text.secondary" component="p">
              {description}
            </Typography>
          )}
        </Box>
        {actions && <Box sx={{ flexShrink: 0, display: 'flex', gap: 0.5 }}>{actions}</Box>}
      </Box>
      {children}
    </Box>
  );
}

export default FormSection;
