'use client';

/**
 * The guided import. PLACEHOLDER (Import Wizard foundation): the wizard-flow
 * agent replaces this body with the six steps; the props are the frozen seam
 * defined in ../ImportPage.
 */

import React from 'react';
import { Alert } from '@mui/material';
import { useTranslation } from 'react-i18next';

import type { ImportWizardProps } from '../ImportPage';

export default function ImportWizard(_props: ImportWizardProps) {
  const { t } = useTranslation('importWizard');
  return (
    <Alert severity="info" data-testid="import-wizard-placeholder">
      {t('placeholder.wizard')}
    </Alert>
  );
}
