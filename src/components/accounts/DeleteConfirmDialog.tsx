'use client';

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

export type DeleteTargetType = 'user' | 'account' | 'card';

interface DeleteConfirmDialogProps {
  open: boolean;
  targetType: DeleteTargetType | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({
  open,
  targetType,
  loading,
  onClose,
  onConfirm,
}: DeleteConfirmDialogProps) {
  const { t } = useTranslation(['accounts', 'common']);
  const target: DeleteTargetType = targetType ?? 'account';

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{t(`deleteDialog.title.${target}`)}</DialogTitle>
      <DialogContent>
        <Typography>{t(`deleteDialog.question.${target}`)}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t(`deleteDialog.hint.${target}`)}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button onClick={onConfirm} color="error" disabled={loading}>
          {loading ? t('deleteDialog.deleting') : t('common:actions.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
