'use client';

import { useState, useCallback } from 'react';

import { LockOutlined, Visibility, VisibilityOff } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputAdornment,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

interface PasswordSetupProps {
  /** Called after the user confirms a valid password. */
  onPasswordConfirmed: (password: string, primaryUserName: string) => Promise<void>;
  isLoading: boolean;
  error: string | null;
}

const MIN_PASSWORD_LENGTH = 8;

export function PasswordSetup({
  onPasswordConfirmed,
  isLoading,
  error,
}: PasswordSetupProps) {
  const { t } = useTranslation('setup');
  const [primaryUserName, setPrimaryUserName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    setValidationError(null);

    const trimmedPrimaryUserName = primaryUserName.trim();
    if (!trimmedPrimaryUserName) {
      setValidationError(t('passwordSetup.primaryUserNameRequired'));
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setValidationError(t('passwordSetup.passwordTooShort', { count: MIN_PASSWORD_LENGTH }));
      return;
    }

    if (password !== confirm) {
      setValidationError(t('passwordSetup.passwordsMismatch'));
      return;
    }

    try {
      await onPasswordConfirmed(password, trimmedPrimaryUserName);
    } catch {
      // Error is surfaced via the `error` prop from the parent.
    }
  }, [primaryUserName, password, confirm, onPasswordConfirmed, t]);

  const displayError = validationError ?? error;
  const canSubmit =
    !isLoading &&
    primaryUserName.trim().length > 0 &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password === confirm;

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 2,
      }}
    >
      <Paper sx={{ p: 4, maxWidth: 480, width: '100%' }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <LockOutlined sx={{ fontSize: 56, color: 'primary.main', mb: 1.5 }} />
          <Typography variant="h5" gutterBottom fontWeight="bold">
            {t('passwordSetup.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('passwordSetup.description')}
          </Typography>
        </Box>

        {displayError && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {displayError}
          </Alert>
        )}

        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>
          {t('passwordSetup.primaryUserSection')}
        </Typography>

        <TextField
          label={t('passwordSetup.primaryUserNameLabel')}
          value={primaryUserName}
          onChange={(e) => setPrimaryUserName(e.target.value)}
          fullWidth
          required
          autoFocus
          disabled={isLoading}
          sx={{ mb: 3 }}
        />

        <Typography variant="subtitle1" fontWeight="bold" sx={{ mb: 1 }}>
          {t('passwordSetup.passwordSection')}
        </Typography>

        <TextField
          label={t('passwordSetup.passwordLabel')}
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          disabled={isLoading}
          sx={{ mb: 2 }}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={showPassword ? t('passwordSetup.hidePassword') : t('passwordSetup.showPassword')}
                    onClick={() => setShowPassword((v) => !v)}
                    edge="end"
                  >
                    {showPassword ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />

        <TextField
          label={t('passwordSetup.confirmPasswordLabel')}
          type={showConfirm ? 'text' : 'password'}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          fullWidth
          disabled={isLoading}
          sx={{ mb: 3 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && canSubmit) void handleSubmit();
          }}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={showConfirm ? t('passwordSetup.hidePassword') : t('passwordSetup.showPassword')}
                    onClick={() => setShowConfirm((v) => !v)}
                    edge="end"
                  >
                    {showConfirm ? <VisibilityOff /> : <Visibility />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />

        <Button
          variant="contained"
          size="large"
          fullWidth
          disabled={!canSubmit}
          onClick={() => void handleSubmit()}
          startIcon={
            isLoading ? <CircularProgress size={18} color="inherit" /> : undefined
          }
        >
          {isLoading ? t('passwordSetup.creating') : t('passwordSetup.create')}
        </Button>
      </Paper>
    </Box>
  );
}
