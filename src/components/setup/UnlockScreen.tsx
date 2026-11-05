'use client';

/**
 * The gate's unlock screen. Picks the form from what protects the database:
 * the password form (PasswordEntry) or the recovery-phrase form. Used both
 * for the device's own database (needs-unlock, `methods` from the header)
 * and for an archive waiting to be restored (needs-password-entry,
 * `masterType` from the archive header).
 *
 * Later phases add passkey / cloud buttons here; the master form stays the
 * fallback they can always switch back to.
 */

import { useCallback, useState } from 'react';

import { KeyOutlined } from '@mui/icons-material';
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { ResetAppButton } from '@/components/common/ResetAppButton';
import type { MasterSecret, MasterSlotType, UnlockMethod, UnlockMethods } from '@/lib/encryptionTypes';
import { mnemonicToEntropy } from '@/lib/recoveryPhrase/bip39';
import { PasswordEntry } from './PasswordEntry';
import { RecoveryPhraseField } from './RecoveryPhraseField';

interface UnlockScreenProps {
  /** Key slots on this device (needs-unlock). Null while unknown. */
  methods?: UnlockMethods | null;
  /** The secret type an archive being restored needs (needs-password-entry). Wins over `methods`. */
  masterType?: MasterSlotType | null;
  description?: string;
  onUnlock: (method: UnlockMethod) => Promise<void>;
  onCancel?: () => void;
  /** Debug-only Reset App; receives the typed master secret to confirm. */
  onResetApp?: (master: MasterSecret) => void | Promise<void>;
  isLoading: boolean;
  error: string | null;
}

/** Which master-type form to show: the explicit archive type, else the header's master slot, else password. */
export function resolveMasterType(methods: UnlockMethods | null | undefined, masterType: MasterSlotType | null | undefined): MasterSlotType {
  if (masterType) return masterType;
  const master = methods?.methods.find((slot) => slot.isMaster);
  return master?.type === 'recovery' ? 'recovery' : 'password';
}

export function UnlockScreen({ methods, masterType, description, onUnlock, onCancel, onResetApp, isLoading, error }: UnlockScreenProps) {
  const { t } = useTranslation(['setup', 'common']);
  const resolved = resolveMasterType(methods, masterType);
  const [phrase, setPhrase] = useState('');
  const [entropy, setEntropy] = useState<Uint8Array | null>(null);

  const submitRecovery = useCallback(async () => {
    if (!entropy) return;
    try {
      // The worker zeroes the transferred buffer; hand it a copy so the field's validation state survives a wrong-phrase retry.
      await onUnlock({ type: 'recovery', secret: entropy.slice() });
    } catch {
      // Error is surfaced via the `error` prop.
    }
  }, [entropy, onUnlock]);

  const resetWithRecovery = useCallback(
    async (text: string) => {
      if (!onResetApp) return;
      const secret = await mnemonicToEntropy(text);
      await onResetApp({ type: 'recovery', secret });
    },
    [onResetApp]
  );

  if (resolved === 'password') {
    return (
      <PasswordEntry
        description={description}
        onPasswordSubmitted={(password) => onUnlock({ type: 'password', secret: password })}
        onCancel={onCancel}
        onResetApp={onResetApp ? (password) => onResetApp({ type: 'password', secret: password }) : undefined}
        isLoading={isLoading}
        error={error}
      />
    );
  }

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
          <KeyOutlined sx={{ fontSize: 56, color: 'primary.main', mb: 1.5 }} />
          <Typography variant="h5" gutterBottom fontWeight="bold">
            {t('recoveryEntry.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {description ?? t('recoveryEntry.defaultDescription')}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        <Box sx={{ mb: 3 }}>
          <RecoveryPhraseField
            value={phrase}
            onChange={setPhrase}
            onEntropyChange={setEntropy}
            onSubmit={() => void submitRecovery()}
            disabled={isLoading}
            autoFocus
          />
        </Box>

        <Box sx={{ display: 'flex', gap: 2 }}>
          {onCancel && (
            <Button variant="outlined" fullWidth onClick={onCancel} disabled={isLoading}>
              {t('common:actions.cancel')}
            </Button>
          )}
          <Button
            variant="contained"
            fullWidth
            disabled={!entropy || isLoading}
            onClick={() => void submitRecovery()}
            startIcon={isLoading ? <CircularProgress size={18} color="inherit" /> : undefined}
            data-testid="recovery-unlock"
          >
            {isLoading ? t('recoveryEntry.decrypting') : t('recoveryEntry.unlock')}
          </Button>
        </Box>

        {onResetApp && (
          <Box sx={{ mt: 3 }}>
            <ResetAppButton onReset={resetWithRecovery} confirmWith="recovery" fullWidth />
          </Box>
        )}
      </Paper>
    </Box>
  );
}
