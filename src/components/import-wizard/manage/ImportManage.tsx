'use client';

/**
 * Import history with undo, saved formats and account identifiers.
 * PLACEHOLDER (Import Wizard foundation): the history agent replaces this
 * body; the props are the frozen seam defined in ../ImportPage.
 */

import React from 'react';
import { Alert } from '@mui/material';
import { useTranslation } from 'react-i18next';

import type { ImportManageProps } from '../ImportPage';

export default function ImportManage(_props: ImportManageProps) {
  const { t } = useTranslation('importManage');
  return (
    <Alert severity="info" data-testid="import-manage-placeholder">
      {t('placeholder.body')}
    </Alert>
  );
}
