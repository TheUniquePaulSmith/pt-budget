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
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation('settings');
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
      setValidationError(t('changePassword.tooShort', { count: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setValidationError(t('changePassword.mismatch'));
      return;
    }

    setIsSubmitting(true);
    try {
      const { syncError } = await changePassword(currentPassword, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccessMessage(t('changePassword.updated'));
      if (syncError) {
        setSyncWarning(t('changePassword.syncWarning', { error: syncError }));
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : t('changePassword.failed'));
    } finally {
      setIsSubmitting(false);
    }
  }, [currentPassword, newPassword, confirmPassword, changePassword, t]);

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
        {t('changePassword.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('changePassword.description')}
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
          label={t('changePassword.current')}
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
                    aria-label={showCurrent ? t('changePassword.hide') : t('changePassword.show')}
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
          label={t('changePassword.new')}
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
                    aria-label={showNew ? t('changePassword.hide') : t('changePassword.show')}
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
          label={t('changePassword.confirm')}
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
              ? t('changePassword.updatingCloud')
              : isSubmitting
                ? t('changePassword.changing')
                : t('changePassword.submit')}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}
