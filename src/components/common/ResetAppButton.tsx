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
import { useTranslation } from 'react-i18next';

interface ResetAppButtonProps {
  /** Receives the typed confirmation secret (password, or recovery phrase text) when one is required. Reject to refuse the reset. */
  onReset: (secret: string) => void | Promise<void>;
  fullWidth?: boolean;
  variant?: 'text' | 'outlined' | 'contained';
  /**
   * Make the user type the database password to confirm. Used while the app is
   * locked, where nothing else proves who is at the keyboard. A rejection from
   * `onReset` is then shown in the dialog, which stays open for another try.
   * Shorthand for `confirmWith="password"`.
   */
  requirePassword?: boolean;
  /** Which master secret confirms the reset: the password or the 12-word recovery phrase. */
  confirmWith?: 'password' | 'recovery';
}

/** Debug-only control that wipes all locally saved app data after confirmation. */
export function ResetAppButton({
  onReset,
  fullWidth,
  variant = 'outlined',
  requirePassword = false,
  confirmWith,
}: ResetAppButtonProps) {
  const { t } = useTranslation(['shell', 'common']);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState<string | null>(null);

  const confirmation = confirmWith ?? (requirePassword ? 'password' : null);

  const closeDialog = () => {
    setIsDialogOpen(false);
    setSecret('');
    setError(null);
  };

  const handleConfirm = async () => {
    setIsResetting(true);
    setError(null);
    try {
      await onReset(secret);
    } catch (err) {
      // onReset navigates away on success; only reachable here on failure.
      setIsResetting(false);
      if (confirmation) {
        setError(err instanceof Error ? err.message : t('resetApp.failed'));
        setSecret('');
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
        {t('resetApp.button')}
      </Button>

      <Dialog open={isDialogOpen} onClose={() => !isResetting && closeDialog()}>
        <DialogTitle>{t('resetApp.title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('resetApp.body')}
          </DialogContentText>
          {confirmation && (
            <>
              {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                  {error}
                </Alert>
              )}
              <TextField
                label={confirmation === 'password' ? t('resetApp.passwordLabel') : t('resetApp.recoveryLabel')}
                type={confirmation === 'password' ? 'password' : 'text'}
                multiline={confirmation === 'recovery'}
                minRows={confirmation === 'recovery' ? 2 : undefined}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && secret && !isResetting) {
                    e.preventDefault();
                    void handleConfirm();
                  }
                }}
                helperText={confirmation === 'password' ? t('resetApp.passwordHelp') : t('resetApp.recoveryHelp')}
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
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
            {t('common:actions.cancel')}
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => void handleConfirm()}
            disabled={isResetting || (confirmation !== null && !secret)}
            startIcon={isResetting ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {isResetting ? t('resetApp.resetting') : t('resetApp.button')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
