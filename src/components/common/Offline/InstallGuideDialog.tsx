'use client';

/**
 * Safari has no install API, so its Install controls open these steps:
 * Share → Add to Home Screen on iPhone/iPad, File → Add to Dock on the Mac.
 * Mounted once by OfflineRuntime; opened through the install store.
 */

import React from 'react';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import type { InstallGuide } from '@/lib/appInstall';

export interface InstallGuideDialogProps {
  open: boolean;
  guide: InstallGuide | null;
  onClose: () => void;
}

export default function InstallGuideDialog({ open, guide, onClose }: InstallGuideDialogProps) {
  const { t } = useTranslation('shell');
  const steps =
    guide === 'macSafari'
      ? [t('installGuide.macStep1'), t('installGuide.macStep2'), t('installGuide.macStep3')]
      : [t('installGuide.iosStep1'), t('installGuide.iosStep2'), t('installGuide.iosStep3')];

  return (
    <Dialog open={open && guide !== null} onClose={onClose} maxWidth="xs" fullWidth data-testid="install-guide">
      <DialogTitle>{t('installGuide.title')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {guide === 'macSafari' ? t('installGuide.macIntro') : t('installGuide.iosIntro')}
        </Typography>
        <Typography component="ol" variant="body1" sx={{ pl: 3, m: 0, '& li': { mb: 0.75 } }}>
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose} data-testid="install-guide-close">
          {t('installGuide.close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
