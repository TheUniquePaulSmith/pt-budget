'use client';

/**
 * Settings → Security: switch the master secret between a password and a
 * 12-word recovery phrase. Step 1 verifies the current secret, step 2
 * collects the new one (a password pair, or a freshly generated phrase the
 * user must confirm). The worker re-wraps the root key; nothing is
 * re-encrypted.
 */

import { useCallback, useState } from 'react';

import { Visibility, VisibilityOff } from '@mui/icons-material';
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { RecoveryPhraseField } from '@/components/setup/RecoveryPhraseField';
import { RecoveryPhraseSetup } from '@/components/setup/RecoveryPhraseSetup';
import { describeEncryptionError } from '@/lib/encryptionErrorMessage';
import type { MasterSecret, MasterSlotType } from '@/lib/encryptionTypes';

interface SwitchMasterDialogProps {
  open: boolean;
  /** The master type the database has now. */
  currentType: MasterSlotType;
  changeMaster: (current: MasterSecret, next: MasterSecret) => Promise<{ syncError: string | null }>;
  onClose: () => void;
  /** Called after a successful switch, with any cloud re-sync warning. */
  onSwitched: (next: MasterSlotType, syncError: string | null) => void;
}

const MIN_PASSWORD_LENGTH = 8;

export function SwitchMasterDialog({ open, currentType, changeMaster, onClose, onSwitched }: SwitchMasterDialogProps) {
  const { t } = useTranslation(['settings', 'common']);
  const nextType: MasterSlotType = currentType === 'password' ? 'recovery' : 'password';

  const [step, setStep] = useState<'current' | 'next'>('current');
  const [currentPassword, setCurrentPassword] = useState('');
  const [currentPhrase, setCurrentPhrase] = useState('');
  const [currentEntropy, setCurrentEntropy] = useState<Uint8Array | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep('current');
    setCurrentPassword('');
    setCurrentPhrase('');
    setCurrentEntropy(null);
    setNewPassword('');
    setConfirmPassword('');
    setError(null);
    setIsSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    if (isSubmitting) return;
    reset();
    onClose();
  }, [isSubmitting, onClose, reset]);

  const currentSecret = useCallback((): MasterSecret | null => {
    if (currentType === 'password') {
      return currentPassword ? { type: 'password', secret: currentPassword } : null;
    }
    return currentEntropy ? { type: 'recovery', secret: currentEntropy.slice() } : null;
  }, [currentEntropy, currentPassword, currentType]);

  const submit = useCallback(
    async (next: MasterSecret) => {
      const current = currentSecret();
      if (!current) return;
      setIsSubmitting(true);
      setError(null);
      try {
        const { syncError } = await changeMaster(current, next);
        reset();
        onSwitched(next.type, syncError);
      } catch (err) {
        setError(describeEncryptionError(t, 'settings:securityErrors', err, t('securityErrors.failed')));
        // A wrong current secret sends the user back to step 1.
        setStep('current');
        throw err;
      } finally {
        setIsSubmitting(false);
      }
    },
    [changeMaster, currentSecret, onSwitched, reset, t]
  );

  const submitPassword = useCallback(async () => {
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(t('changePassword.tooShort', { count: MIN_PASSWORD_LENGTH }));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('changePassword.mismatch'));
      return;
    }
    try {
      await submit({ type: 'password', secret: newPassword });
    } catch {
      // shown via `error`
    }
  }, [confirmPassword, newPassword, submit, t]);

  const canContinue = currentSecret() !== null && !isSubmitting;

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle>{nextType === 'recovery' ? t('switchMaster.toRecoveryTitle') : t('switchMaster.toPasswordTitle')}</DialogTitle>
      <DialogContent>
        {step === 'current' ? (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {currentType === 'password' ? t('switchMaster.enterCurrentPassword') : t('switchMaster.enterCurrentRecovery')}
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            {currentType === 'password' ? (
              <TextField
                label={t('switchMaster.currentPasswordLabel')}
                type={showPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoFocus
                fullWidth
                disabled={isSubmitting}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canContinue) setStep('next');
                }}
                slotProps={{
                  htmlInput: { 'data-testid': 'switch-master-current-password' },
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          aria-label={showPassword ? t('changePassword.hide') : t('changePassword.show')}
                          onClick={() => setShowPassword((value) => !value)}
                          edge="end"
                        >
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
            ) : (
              <RecoveryPhraseField
                value={currentPhrase}
                onChange={setCurrentPhrase}
                onEntropyChange={setCurrentEntropy}
                onSubmit={() => canContinue && setStep('next')}
                disabled={isSubmitting}
                autoFocus
                data-testid="switch-master-current-phrase"
              />
            )}
          </Stack>
        ) : nextType === 'recovery' ? (
          <RecoveryPhraseSetup
            onConfirmed={(entropy) => submit({ type: 'recovery', secret: entropy })}
            onBack={() => setStep('current')}
            isLoading={isSubmitting}
            error={error}
            confirmLabel={isSubmitting ? t('switchMaster.switching') : t('switchMaster.submit')}
          />
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {t('switchMaster.chooseNewPassword')}
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label={t('switchMaster.newPasswordLabel')}
              type={showPassword ? 'text' : 'password'}
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoFocus
              fullWidth
              disabled={isSubmitting}
              slotProps={{ htmlInput: { 'data-testid': 'switch-master-new-password' } }}
            />
            <TextField
              label={t('switchMaster.confirmPasswordLabel')}
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              fullWidth
              disabled={isSubmitting}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isSubmitting) void submitPassword();
              }}
              slotProps={{ htmlInput: { 'data-testid': 'switch-master-confirm-password' } }}
            />
          </Stack>
        )}
      </DialogContent>
      {!(step === 'next' && nextType === 'recovery') && (
        <DialogActions>
          <Button onClick={handleClose} disabled={isSubmitting}>
            {t('common:actions.cancel')}
          </Button>
          {step === 'current' ? (
            <Button variant="contained" onClick={() => setStep('next')} disabled={!canContinue} data-testid="switch-master-next">
              {t('common:actions.next')}
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={() => void submitPassword()}
              disabled={isSubmitting || newPassword.length < MIN_PASSWORD_LENGTH || newPassword !== confirmPassword}
              startIcon={isSubmitting ? <CircularProgress size={16} color="inherit" /> : undefined}
              data-testid="switch-master-submit"
            >
              {isSubmitting ? t('switchMaster.switching') : t('switchMaster.submit')}
            </Button>
          )}
        </DialogActions>
      )}
    </Dialog>
  );
}
