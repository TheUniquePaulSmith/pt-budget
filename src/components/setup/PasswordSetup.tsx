'use client';

/**
 * First setup step: the primary user's name and the MASTER SECRET that
 * protects the new database — a password (default) or a generated 12-word
 * recovery phrase. Exactly one of the two exists per database; Settings →
 * Security can switch between them later.
 */

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
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import type { MasterSecret, MasterSlotType } from '@/lib/encryptionTypes';
import { RecoveryPhraseSetup } from './RecoveryPhraseSetup';

interface PasswordSetupProps {
  /** Called after the user confirms a valid master secret. */
  onPasswordConfirmed: (master: MasterSecret, primaryUserName: string) => Promise<void>;
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
  const [masterType, setMasterType] = useState<MasterSlotType>('password');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [recoveryStep, setRecoveryStep] = useState(false);

  const trimmedPrimaryUserName = primaryUserName.trim();

  const handleSubmit = useCallback(async () => {
    setValidationError(null);

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
      await onPasswordConfirmed({ type: 'password', secret: password }, trimmedPrimaryUserName);
    } catch {
      // Error is surfaced via the `error` prop from the parent.
    }
  }, [trimmedPrimaryUserName, password, confirm, onPasswordConfirmed, t]);

  const handleRecoveryConfirmed = useCallback(
    async (entropy: Uint8Array) => {
      await onPasswordConfirmed({ type: 'recovery', secret: entropy }, trimmedPrimaryUserName);
    },
    [onPasswordConfirmed, trimmedPrimaryUserName]
  );

  const startRecovery = useCallback(() => {
    setValidationError(null);
    if (!trimmedPrimaryUserName) {
      setValidationError(t('passwordSetup.primaryUserNameRequired'));
      return;
    }
    setRecoveryStep(true);
  }, [trimmedPrimaryUserName, t]);

  const displayError = validationError ?? error;
  const canSubmit =
    !isLoading &&
    trimmedPrimaryUserName.length > 0 &&
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
        {recoveryStep ? (
          <RecoveryPhraseSetup
            onConfirmed={handleRecoveryConfirmed}
            onBack={() => setRecoveryStep(false)}
            isLoading={isLoading}
            error={error}
            confirmLabel={isLoading ? t('passwordSetup.creating') : t('passwordSetup.create')}
          />
        ) : (
          <>
            <Box sx={{ textAlign: 'center', mb: 3 }}>
              <LockOutlined sx={{ fontSize: 56, color: 'primary.main', mb: 1.5 }} />
              <Typography variant="h5" gutterBottom fontWeight="bold">
                {t('passwordSetup.title')}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {masterType === 'password' ? t('passwordSetup.description') : t('passwordSetup.recoveryDescription')}
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
              {t('passwordSetup.masterTypeLabel')}
            </Typography>

            <ToggleButtonGroup
              value={masterType}
              exclusive
              fullWidth
              size="small"
              disabled={isLoading}
              onChange={(_event, value: MasterSlotType | null) => {
                if (value) setMasterType(value);
              }}
              sx={{ mb: 3 }}
            >
              <ToggleButton value="password" data-testid="master-type-password">
                {t('passwordSetup.masterTypePassword')}
              </ToggleButton>
              <ToggleButton value="recovery" data-testid="master-type-recovery">
                {t('passwordSetup.masterTypeRecovery')}
              </ToggleButton>
            </ToggleButtonGroup>

            {masterType === 'password' ? (
              <>
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
              </>
            ) : (
              <>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  {t('passwordSetup.recoveryHint')}
                </Typography>
                <Button
                  variant="contained"
                  size="large"
                  fullWidth
                  disabled={isLoading || trimmedPrimaryUserName.length === 0}
                  onClick={startRecovery}
                  data-testid="generate-recovery-phrase"
                >
                  {t('passwordSetup.generateRecovery')}
                </Button>
              </>
            )}
          </>
        )}
      </Paper>
    </Box>
  );
}
