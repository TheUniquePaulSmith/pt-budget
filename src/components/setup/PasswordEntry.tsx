'use client';

import { useState, useCallback, type ReactNode } from 'react';

import { LockOpenOutlined, Visibility, VisibilityOff } from '@mui/icons-material';
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

import { ResetAppButton } from '@/components/common/ResetAppButton';

interface PasswordEntryProps {
  /** Shown when context is needed (e.g. "Enter password to open cloud backup"). */
  description?: string;
  /** Called with the entered password so the caller can attempt decryption. */
  onPasswordSubmitted: (password: string) => Promise<void>;
  /** Shown when the user can go back (e.g. cancel cloud import). */
  onCancel?: () => void;
  /**
   * Debug-only (`?debug`) — when set, shows a "Reset App" button that wipes all
   * local data. The button asks for the database password and passes it here;
   * the callback must reject (e.g. "Incorrect password") to refuse the reset.
   */
  onResetApp?: (password: string) => void | Promise<void>;
  /** Rendered under the Unlock button, e.g. a link to another unlock method (passkey). */
  secondaryAction?: ReactNode;
  isLoading: boolean;
  error: string | null;
}

export function PasswordEntry({
  description,
  onPasswordSubmitted,
  onCancel,
  onResetApp,
  secondaryAction,
  isLoading,
  error,
}: PasswordEntryProps) {
  const { t } = useTranslation(['setup', 'common']);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!password) return;
    try {
      await onPasswordSubmitted(password);
    } catch {
      // Error is surfaced via the `error` prop.
    }
  }, [password, onPasswordSubmitted]);

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
      <Paper sx={{ p: 4, maxWidth: 420, width: '100%' }}>
        <Box sx={{ textAlign: 'center', mb: 3 }}>
          <LockOpenOutlined sx={{ fontSize: 56, color: 'primary.main', mb: 1.5 }} />
          <Typography variant="h5" gutterBottom fontWeight="bold">
            {t('passwordEntry.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {description ?? t('passwordEntry.defaultDescription')}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <TextField
          label={t('passwordEntry.passwordLabel')}
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          autoFocus
          disabled={isLoading}
          sx={{ mb: 3 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && password && !isLoading) void handleSubmit();
          }}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={showPassword ? t('passwordEntry.hidePassword') : t('passwordEntry.showPassword')}
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

        <Box sx={{ display: 'flex', gap: 2 }}>
          {onCancel && (
            <Button
              variant="outlined"
              fullWidth
              onClick={onCancel}
              disabled={isLoading}
            >
              {t('common:actions.cancel')}
            </Button>
          )}
          <Button
            variant="contained"
            fullWidth
            disabled={!password || isLoading}
            onClick={() => void handleSubmit()}
            startIcon={
              isLoading ? <CircularProgress size={18} color="inherit" /> : undefined
            }
          >
            {isLoading ? t('passwordEntry.decrypting') : t('passwordEntry.unlock')}
          </Button>
        </Box>

        {secondaryAction && <Box sx={{ mt: 2 }}>{secondaryAction}</Box>}

        {onResetApp && (
          <Box sx={{ mt: 3 }}>
            <ResetAppButton onReset={onResetApp} requirePassword fullWidth />
          </Box>
        )}
      </Paper>
    </Box>
  );
}
