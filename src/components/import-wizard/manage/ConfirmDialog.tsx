'use client';

import React, { type ReactNode } from 'react';
import { Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import { useTranslation } from 'react-i18next';

export interface ConfirmDialogProps {
  title: string;
  /** What will happen, in words. */
  children: ReactNode;
  confirmLabel: string;
  confirmTestId: string;
  busy: boolean;
  /** Why the last attempt failed; the dialog stays open so it can be retried. */
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

/** A destructive confirmation: says what will happen, then Cancel / the action. Mounted only while open. */
export default function ConfirmDialog({
  title,
  children,
  confirmLabel,
  confirmTestId,
  busy,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation('common');

  return (
    <Dialog open onClose={busy ? undefined : onCancel} fullWidth maxWidth="xs">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {children}
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          {t('actions.cancel')}
        </Button>
        <Button
          variant="contained"
          color="error"
          onClick={onConfirm}
          disabled={busy}
          startIcon={busy ? <CircularProgress size={16} color="inherit" /> : undefined}
          data-testid={confirmTestId}
        >
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
