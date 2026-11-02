'use client';

import React, { useState } from 'react';

import { Warning } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { ConflictResolutionChoice } from '@/lib/cloudSyncService';
import type { DatabaseSourceConflict } from '@/lib/databaseSourceStorage';

interface CloudConflictDialogProps {
  open: boolean;
  conflict: DatabaseSourceConflict | null;
  pendingChangesSince: string | null;
  onResolve: (choice: ConflictResolutionChoice) => Promise<void>;
  onClose: () => void;
}

export function CloudConflictDialog({
  open,
  conflict,
  pendingChangesSince,
  onResolve,
  onClose,
}: CloudConflictDialogProps) {
  const { t } = useTranslation('settings');
  const { dateTime } = useFormatters();
  const [pendingChoice, setPendingChoice] = useState<ConflictResolutionChoice | null>(null);
  const [confirmingUseCloud, setConfirmingUseCloud] = useState(false);

  const isBusy = pendingChoice !== null;

  const formatTimestamp = (value: string | null | undefined): string =>
    value ? dateTime(value) : t('conflictDialog.unknownTime');

  const handleResolve = async (choice: ConflictResolutionChoice) => {
    setPendingChoice(choice);
    try {
      await onResolve(choice);
    } finally {
      setPendingChoice(null);
      setConfirmingUseCloud(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={isBusy ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      data-testid="cloud-conflict-dialog"
    >
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Warning color="warning" />
          {t('conflictDialog.title')}
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 2 }}>
          {t('conflictDialog.body')}
        </Typography>

        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2">{t('conflictDialog.thisDevice')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('conflictDialog.changedSince', { time: formatTimestamp(pendingChangesSince) })}
            </Typography>
          </Box>
          <Divider orientation="vertical" flexItem />
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle2">{t('conflictDialog.cloudCopy')}</Typography>
            <Typography variant="body2" color="text.secondary">
              {t('conflictDialog.changed', { time: formatTimestamp(conflict?.remoteModifiedAt) })}
            </Typography>
          </Box>
        </Box>

        {confirmingUseCloud && (
          <Alert severity="warning" sx={{ mb: 1 }}>
            {t('conflictDialog.discardWarning')}
          </Alert>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1, p: 2 }}>
        <Button onClick={onClose} disabled={isBusy}>
          {t('conflictDialog.notNow')}
        </Button>
        <Button onClick={() => void handleResolve('keep-both')} disabled={isBusy}>
          {pendingChoice === 'keep-both' ? t('conflictDialog.saving') : t('conflictDialog.keepBoth')}
        </Button>
        <Button onClick={() => void handleResolve('overwrite')} disabled={isBusy} color="warning">
          {pendingChoice === 'overwrite' ? t('conflictDialog.overwriting') : t('conflictDialog.overwriteCloud')}
        </Button>
        {confirmingUseCloud ? (
          <Button
            variant="contained"
            color="error"
            onClick={() => void handleResolve('use-cloud')}
            disabled={isBusy}
          >
            {pendingChoice === 'use-cloud' ? t('conflictDialog.applying') : t('conflictDialog.confirmDiscard')}
          </Button>
        ) : (
          <Button variant="contained" onClick={() => setConfirmingUseCloud(true)} disabled={isBusy}>
            {t('conflictDialog.useCloud')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
