'use client';

import { useState, useCallback } from 'react';

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

import { ResetAppButton } from '@/components/common/ResetAppButton';

interface PasswordEntryProps {
  /** Shown when context is needed (e.g. "Enter password to open cloud backup"). */
  description?: string;
  /** Called with the entered password so the caller can attempt decryption. */
  onPasswordSubmitted: (password: string) => Promise<void>;
  /** Shown when the user can go back (e.g. cancel cloud import). */
  onCancel?: () => void;
  /** Debug-only (`?debug`) — when set, shows a "Reset App" button that wipes all local data. */
  onResetApp?: () => void | Promise<void>;
  isLoading: boolean;
  error: string | null;
}

export function PasswordEntry({
  description,
  onPasswordSubmitted,
  onCancel,
  onResetApp,
  isLoading,
  error,
}: PasswordEntryProps) {
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
            Enter Password
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {description ??
              'This database is encrypted. Enter the password to open it.'}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <TextField
          label="Password"
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
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
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
              Cancel
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
            {isLoading ? 'Decrypting…' : 'Unlock'}
          </Button>
        </Box>

        {onResetApp && (
          <Box sx={{ mt: 3 }}>
            <ResetAppButton onReset={onResetApp} fullWidth />
          </Box>
        )}
      </Paper>
    </Box>
  );
}
