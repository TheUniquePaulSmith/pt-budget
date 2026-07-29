'use client';

import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
} from '@mui/material';

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
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>
        Delete {targetType === 'user' ? 'User' : targetType === 'card' ? 'Card' : 'Account'}
      </DialogTitle>
      <DialogContent>
        <Typography>Are you sure you want to delete this {targetType}?</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {targetType === 'user'
            ? 'This will remove the user from all shared accounts.'
            : targetType === 'card'
            ? 'CSV imports matching this card number will no longer work.'
            : 'All transactions associated with this account will remain.'}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onConfirm} color="error" disabled={loading}>
          {loading ? 'Deleting...' : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
