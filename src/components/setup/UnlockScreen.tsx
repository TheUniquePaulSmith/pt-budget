'use client';

/**
 * The gate's unlock screen. Picks the form from what protects the database:
 * the password form (PasswordEntry) or the recovery-phrase form. Used both
 * for the device's own database (needs-unlock, `methods` from the header)
 * and for an archive waiting to be restored (needs-password-entry,
 * `masterType` from the archive header).
 *
 * When the header holds passkey slots and this browser can use them, a
 * passkey view leads (one button that runs the WebAuthn PRF ceremony and
 * hands the output to the worker); "Use password / recovery phrase instead"
 * switches to the master form, which stays the fallback that always works.
 * The last method that opened the database decides which view comes first,
 * and right after Settings → Lock the passkey prompt starts by itself.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Fingerprint, KeyOutlined } from '@mui/icons-material';
import { Alert, Box, Button, CircularProgress, Paper, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { ResetAppButton } from '@/components/common/ResetAppButton';
import { describeEncryptionError } from '@/lib/encryptionErrorMessage';
import type { MasterSecret, MasterSlotType, SlotSummary, UnlockMethod, UnlockMethods } from '@/lib/encryptionTypes';
import { readLastUnlockMethod } from '@/lib/lastUnlockMethod';
import { getPrfOutput, isPasskeyUnlockAvailable, type PasskeySlotRef } from '@/lib/passkeyUnlock';
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
  /**
   * Start the passkey prompt without a click when a passkey last opened the
   * database. The gate sets it only after Settings → Lock, never on first
   * load (a page that opens with a system prompt is a surprise).
   */
  autoTriggerPasskey?: boolean;
  isLoading: boolean;
  error: string | null;
}

/** Which master-type form to show: the explicit archive type, else the header's master slot, else password. */
export function resolveMasterType(methods: UnlockMethods | null | undefined, masterType: MasterSlotType | null | undefined): MasterSlotType {
  if (masterType) return masterType;
  const master = methods?.methods.find((slot) => slot.isMaster);
  return master?.type === 'recovery' ? 'recovery' : 'password';
}

/** The passkey slots the lock screen can run an assertion over. */
export function passkeySlotRefs(methods: UnlockMethods | null | undefined): PasskeySlotRef[] {
  return (methods?.methods ?? [])
    .filter((slot): slot is SlotSummary & { passkey: NonNullable<SlotSummary['passkey']> } => slot.type === 'passkey' && !!slot.passkey)
    .map((slot) => ({
      slotId: slot.slotId,
      credentialId: slot.passkey.credentialId,
      prfSalt: slot.passkey.prfSalt,
      transports: slot.passkey.transports,
    }));
}

const centeredSx = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  p: 2,
} as const;

export function UnlockScreen({
  methods,
  masterType,
  description,
  onUnlock,
  onCancel,
  onResetApp,
  autoTriggerPasskey = false,
  isLoading,
  error,
}: UnlockScreenProps) {
  const { t } = useTranslation(['setup', 'common']);
  const resolved = resolveMasterType(methods, masterType);
  const [phrase, setPhrase] = useState('');
  const [entropy, setEntropy] = useState<Uint8Array | null>(null);

  // --- passkeys ------------------------------------------------------------
  const passkeySlots = useMemo(() => (masterType ? [] : passkeySlotRefs(methods)), [methods, masterType]);
  const [passkeyAvailable, setPasskeyAvailable] = useState<boolean | null>(null);
  const [view, setView] = useState<'passkey' | 'master'>(() => {
    const last = readLastUnlockMethod();
    return last === 'password' || last === 'recovery' ? 'master' : 'passkey';
  });
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const autoTriggered = useRef(false);

  useEffect(() => {
    if (passkeySlots.length === 0) return;
    let active = true;
    void isPasskeyUnlockAvailable().then((available) => {
      if (active) setPasskeyAvailable(available);
    });
    return () => {
      active = false;
    };
  }, [passkeySlots.length]);

  const passkeyOffered = passkeySlots.length > 0 && passkeyAvailable === true;
  const showPasskeyView = passkeyOffered && view === 'passkey';

  const unlockWithPasskey = useCallback(async () => {
    if (passkeyBusy || isLoading) return;
    setPasskeyBusy(true);
    setPasskeyError(null);
    try {
      const { slotId, secret } = await getPrfOutput(passkeySlots);
      // Worker-side failures (a wrong PRF output, say) come back through the
      // `error` prop; only the WebAuthn step is reported here.
      await onUnlock({ type: 'passkey', slotId, secret });
    } catch (err) {
      setPasskeyError(describeEncryptionError(t, 'setup:unlockErrors', err, t('unlockErrors.PASSKEY_FAILED')));
    } finally {
      setPasskeyBusy(false);
    }
  }, [passkeyBusy, isLoading, passkeySlots, onUnlock, t]);

  useEffect(() => {
    if (!autoTriggerPasskey || !showPasskeyView || autoTriggered.current) return;
    if (readLastUnlockMethod() !== 'passkey') return;
    autoTriggered.current = true;
    void unlockWithPasskey();
  }, [autoTriggerPasskey, showPasskeyView, unlockWithPasskey]);

  // --- master forms ----------------------------------------------------------
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

  const switchToPasskey = passkeyOffered ? (
    <Button
      variant="text"
      fullWidth
      startIcon={<Fingerprint />}
      onClick={() => {
        setPasskeyError(null);
        setView('passkey');
      }}
      disabled={isLoading}
      data-testid="unlock-method-passkey-switch"
    >
      {t('unlock.passkeyUsePasskey')}
    </Button>
  ) : undefined;

  if (showPasskeyView) {
    const busy = passkeyBusy || isLoading;
    const shownError = passkeyError ?? error;
    return (
      <Box sx={centeredSx}>
        <Paper sx={{ p: 4, maxWidth: 420, width: '100%' }}>
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <Fingerprint sx={{ fontSize: 56, color: 'primary.main', mb: 1.5 }} />
            <Typography variant="h5" gutterBottom fontWeight="bold">
              {t('unlock.passkeyTitle')}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t('unlock.passkeyDescription')}
            </Typography>
          </Box>

          {shownError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {shownError}
            </Alert>
          )}

          <Button
            variant="contained"
            fullWidth
            size="large"
            disabled={busy}
            onClick={() => void unlockWithPasskey()}
            startIcon={busy ? <CircularProgress size={18} color="inherit" /> : <Fingerprint />}
            data-testid="unlock-method-passkey"
          >
            {busy ? t('unlock.passkeyWaiting') : t('unlock.passkeyButton')}
          </Button>

          <Button
            variant="text"
            fullWidth
            sx={{ mt: 2 }}
            disabled={busy}
            onClick={() => setView('master')}
            data-testid="unlock-method-master"
          >
            {resolved === 'recovery' ? t('unlock.passkeyUseRecovery') : t('unlock.passkeyUsePassword')}
          </Button>
        </Paper>
      </Box>
    );
  }

  if (resolved === 'password') {
    return (
      <PasswordEntry
        description={description}
        onPasswordSubmitted={(password) => onUnlock({ type: 'password', secret: password })}
        onCancel={onCancel}
        onResetApp={onResetApp ? (password) => onResetApp({ type: 'password', secret: password }) : undefined}
        secondaryAction={switchToPasskey}
        isLoading={isLoading}
        error={error}
      />
    );
  }

  return (
    <Box sx={centeredSx}>
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

        {switchToPasskey && <Box sx={{ mt: 2 }}>{switchToPasskey}</Box>}

        {onResetApp && (
          <Box sx={{ mt: 3 }}>
            <ResetAppButton onReset={resetWithRecovery} confirmWith="recovery" fullWidth />
          </Box>
        )}
      </Paper>
    </Box>
  );
}
