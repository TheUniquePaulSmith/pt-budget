'use client';

import React, { useState } from 'react';

import { WarningAmber } from '@mui/icons-material';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material';

interface ResetAppButtonProps {
  /** Receives the confirmation password when `requirePassword` is set. Reject to refuse the reset. */
  onReset: (password: string) => void | Promise<void>;
  fullWidth?: boolean;
  variant?: 'text' | 'outlined' | 'contained';
  /**
   * Make the user type the database password to confirm. Used while the app is
   * locked, where nothing else proves who is at the keyboard. A rejection from
   * `onReset` is then shown in the dialog, which stays open for another try.
   */
  requirePassword?: boolean;
}

/** Debug-only control that wipes all locally saved app data after confirmation. */
export function ResetAppButton({
  onReset,
  fullWidth,
  variant = 'outlined',
  requirePassword = false,
}: ResetAppButtonProps) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const closeDialog = () => {
    setIsDialogOpen(false);
    setPassword('');
    setError(null);
  };

  const handleConfirm = async () => {
    setIsResetting(true);
    setError(null);
    try {
      await onReset(password);
    } catch (err) {
      // onReset navigates away on success; only reachable here on failure.
      setIsResetting(false);
      if (requirePassword) {
        setError(err instanceof Error ? err.message : 'Reset failed');
        setPassword('');
      } else {
        closeDialog();
      }
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

      <Dialog open={isDialogOpen} onClose={() => !isResetting && closeDialog()}>
        <DialogTitle>Reset app to its original state?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This permanently deletes your database, settings, and cookies, then reloads the
            app as if freshly installed. This cannot be undone.
          </DialogContentText>
          {requirePassword && (
            <>
              {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {error}
                </Alert>
              )}
              <TextField
                label="Database password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && password && !isResetting) void handleConfirm();
                }}
                helperText="Enter your password to confirm the reset."
                fullWidth
                autoFocus
                disabled={isResetting}
                sx={{ mt: 2 }}
              />
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog} disabled={isResetting}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void handleConfirm()}
            disabled={isResetting || (requirePassword && !password)}
            startIcon={isResetting ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {isResetting ? 'Resetting…' : 'Reset App'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
