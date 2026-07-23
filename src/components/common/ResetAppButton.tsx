'use client';

import { useState } from 'react';

import { WarningAmber } from '@mui/icons-material';
import {
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@mui/material';

interface ResetAppButtonProps {
  onReset: () => void | Promise<void>;
  fullWidth?: boolean;
  variant?: 'text' | 'outlined' | 'contained';
}

/** Debug-only control that wipes all locally saved app data after confirmation. */
export function ResetAppButton({ onReset, fullWidth, variant = 'outlined' }: ResetAppButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleConfirm = async () => {
    setIsResetting(true);
    try {
      await onReset();
    } catch {
      // onReset navigates away on success; only reachable here on failure.
      setIsResetting(false);
      setIsDialogOpen(false);
    }
  };

  return (
    <>
      <Button
        color="error"
        variant={variant}
        fullWidth={fullWidth}
        startIcon={<WarningAmber />}
        onClick={() => setIsDialogOpen(true)}
      >
        Reset App
      </Button>

      <Dialog open={isDialogOpen} onClose={() => !isResetting && setIsDialogOpen(false)}>
        <DialogTitle>Reset app to its original state?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently deletes your database, settings, and cookies, then reloads the
            app as if freshly installed. This cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setIsDialogOpen(false)} disabled={isResetting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void handleConfirm()}
            disabled={isResetting}
            startIcon={isResetting ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {isResetting ? 'Resetting…' : 'Reset App'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
