'use client';

import React, { useCallback, useState } from 'react';

import { LockOutlined, Visibility, VisibilityOff } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

import type { DatabaseSource } from '@/lib/databaseSourceStorage';
import type { SyncStage } from '@/lib/cloudSyncService';

interface ChangePasswordSectionProps {
  changePassword: (
    currentPassword: string,
    newPassword: string
  ) => Promise<{ syncError: string | null }>;
  databaseSource: DatabaseSource;
  syncStage: SyncStage | null;
}

const MIN_PASSWORD_LENGTH = 8;

export function ChangePasswordSection({
  changePassword,
  databaseSource,
  syncStage,
}: ChangePasswordSectionProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setValidationError(null);
    setSubmitError(null);
    setSuccessMessage(null);
    setSyncWarning(null);

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setValidationError(`New password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setValidationError('New passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    try {
      const { syncError } = await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccessMessage('Password updated.');
      if (syncError) {
        setSyncWarning(
          `Password changed locally, but the cloud backup could not be re-encrypted yet (${syncError}). It will retry automatically.`
        );
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to change password.');
    } finally {
      setIsSubmitting(false);
    }
  }, [currentPassword, newPassword, confirmPassword, changePassword]);

  const displayError = validationError ?? submitError;
  const canSubmit =
    !isSubmitting &&
    currentPassword.length > 0 &&
    newPassword.length >= MIN_PASSWORD_LENGTH &&
    newPassword === confirmPassword;

  const isSyncingAfterChange = isSubmitting && databaseSource !== 'local' && syncStage !== null;

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Change Password
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        This is the password used to encrypt exports and cloud backups. There is no password
        recovery, so store it somewhere safe.
      </Typography>

      {displayError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {displayError}
        </Alert>
      )}
      {successMessage && !displayError && (
        <Alert severity="success" sx={{ mb: 2 }}>
          {successMessage}
        </Alert>
      )}
      {syncWarning && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {syncWarning}
        </Alert>
      )}

      <Stack spacing={2} sx={{ maxWidth: 420 }}>
        <TextField
          label="Current Password"
          type={showCurrent ? 'text' : 'password'}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          fullWidth
          disabled={isSubmitting}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={showCurrent ? 'Hide password' : 'Show password'}
                    onClick={() => setShowCurrent((v) => !v)}
                    edge="end"
                  >
                    {showCurrent ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          label="New Password"
          type={showNew ? 'text' : 'password'}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          fullWidth
          disabled={isSubmitting}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={showNew ? 'Hide password' : 'Show password'}
                    onClick={() => setShowNew((v) => !v)}
                    edge="end"
                  >
                    {showNew ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          label="Confirm New Password"
          type={showNew ? 'text' : 'password'}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          fullWidth
          disabled={isSubmitting}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) void handleSubmit();
          }}
        />
        <Box>
          <Button
            variant="contained"
            startIcon={
              isSubmitting ? <CircularProgress size={18} color="inherit" /> : <LockOutlined />
            }
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {isSyncingAfterChange
              ? 'Updating cloud backup…'
              : isSubmitting
                ? 'Changing Password…'
                : 'Change Password'}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}
