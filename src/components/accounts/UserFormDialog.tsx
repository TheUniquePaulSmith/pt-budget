'use client';

import type { FormEvent } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from '@mui/material';

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
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{editing ? 'Edit User' : 'Add New User'}</DialogTitle>
      <DialogContent>
        <TextField
          autoFocus
          margin="dense"
          label="Display Name"
          fullWidth
          value={displayName}
          onChange={(e) => onDisplayNameChange(e.target.value)}
          required
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button onClick={onSubmit} variant="contained" disabled={loading}>
          {loading ? 'Saving...' : editing ? 'Update' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
