'use client';

import React, { type FormEvent } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

interface UserFormDialogProps {
  open: boolean;
  editing: boolean;
  displayName: string;
  loading: boolean;
  onDisplayNameChange: (value: string) => void;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}

export function UserFormDialog({
  open,
  editing,
  displayName,
  loading,
  onDisplayNameChange,
  onClose,
  onSubmit,
}: UserFormDialogProps) {
  const { t } = useTranslation(['accounts', 'common']);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? t('userDialog.editTitle') : t('userDialog.addTitle')}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label={t('userDialog.displayNameLabel')}
          fullWidth
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          required
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button onClick={onSubmit} variant="contained" disabled={loading}>
          {loading ? t('userDialog.saving') : editing ? t('common:actions.update') : t('common:actions.add')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
