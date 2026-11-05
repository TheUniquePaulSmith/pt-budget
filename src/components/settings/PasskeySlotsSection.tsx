'use client';

/**
 * Settings → Security → Passkeys: the passkey key slots registered on this
 * device. Add one (WebAuthn registration + PRF evaluation on the page, then
 * `add_slot` in the worker — adding while unlocked needs no master secret),
 * rename it inline, or remove it after a confirmation. The whole section is
 * hidden when this browser cannot use passkeys and none are registered; with
 * registered ones it still lists them (so they can be removed) behind a
 * notice.
 *
 * The 32-byte PRF output is transferred to the worker and zeroed there; it
 * is never logged or kept in React state.
 */

import { useCallback, useEffect, useState } from 'react';

import { Add, DeleteOutline, DriveFileRenameOutline, Fingerprint } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import { describeEncryptionError } from '@/lib/encryptionErrorMessage';
import { getErrorCode, type NewConvenienceSlot, type SlotSummary } from '@/lib/encryptionTypes';
import { logger } from '@/lib/logging';
import { isPasskeyUnlockAvailable, registerPasskey } from '@/lib/passkeyUnlock';

const log = logger.child({ component: 'PasskeySlotsSection' });

interface PasskeySlotsSectionProps {
  /** The header's root-key id (null while unknown); the passkey's user handle. */
  keyId: string | null;
  /** Passkey slots from the last `getUnlockMethods` read. */
  passkeys: SlotSummary[];
  /** Account name the OS passkey picker shows (the primary user). */
  userName: string;
  addUnlockSlot: (slot: NewConvenienceSlot) => Promise<SlotSummary>;
  removeUnlockSlot: (slotId: string) => Promise<void>;
  renameUnlockSlot: (slotId: string, label: string) => Promise<void>;
  /** Re-reads the slot list after a change. */
  onChanged: () => Promise<void>;
}

export function PasskeySlotsSection({
  keyId,
  passkeys,
  userName,
  addUnlockSlot,
  removeUnlockSlot,
  renameUnlockSlot,
  onChanged,
}: PasskeySlotsSectionProps) {
  const { t } = useTranslation(['settings', 'setup', 'common']);
  const { date, dateTime } = useFormatters();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ slotId: string; label: string } | null>(null);
  const [savingRename, setSavingRename] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<SlotSummary | null>(null);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    let active = true;
    void isPasskeyUnlockAvailable().then((value) => {
      if (active) setAvailable(value);
    });
    return () => {
      active = false;
    };
  }, []);

  /** Passkey (page-side WebAuthn) codes live in setup:unlockErrors; worker codes in settings:securityErrors. */
  const describe = useCallback(
    (err: unknown) => {
      const code = getErrorCode(err);
      const prefix = code?.startsWith('PASSKEY_') ? 'setup:unlockErrors' : 'settings:securityErrors';
      return describeEncryptionError(t, prefix, err, t('securityErrors.failed'));
    },
    [t]
  );

  const handleAdd = useCallback(async () => {
    if (!keyId || adding) return;
    setAdding(true);
    setError(null);
    setNotice(null);
    try {
      const label = t('unlockMethods.passkeyDefaultLabel', { date: date(new Date()) });
      const registered = await registerPasskey({
        keyId,
        userName,
        existingCredentialIds: passkeys.map((slot) => slot.passkey?.credentialId).filter((id): id is string => !!id),
        label,
      });
      await addUnlockSlot({
        type: 'passkey',
        secret: registered.prfOutput,
        label,
        kdf: {
          credentialId: registered.credentialId,
          prfSalt: registered.prfSalt,
          rpId: registered.rpId,
          transports: registered.transports,
          userHandle: registered.userHandle,
        },
      });
      setNotice(t('unlockMethods.passkeyAdded'));
      await onChanged();
    } catch (err) {
      log.warn('Adding a passkey failed', { operation: 'addPasskey', code: getErrorCode(err), error: err });
      setError(describe(err));
    } finally {
      setAdding(false);
    }
  }, [keyId, adding, t, date, userName, passkeys, addUnlockSlot, onChanged, describe]);

  const handleRenameSave = useCallback(async () => {
    if (!renaming) return;
    const label = renaming.label.trim();
    if (!label) return;
    setSavingRename(true);
    setError(null);
    try {
      await renameUnlockSlot(renaming.slotId, label);
      setRenaming(null);
      await onChanged();
    } catch (err) {
      log.warn('Renaming a passkey failed', { operation: 'renamePasskey', code: getErrorCode(err), error: err });
      setError(describe(err));
    } finally {
      setSavingRename(false);
    }
  }, [renaming, renameUnlockSlot, onChanged, describe]);

  const handleRemove = useCallback(async () => {
    if (!removeTarget) return;
    setRemoving(true);
    setError(null);
    try {
      await removeUnlockSlot(removeTarget.slotId);
      setRemoveTarget(null);
      setNotice(null);
      await onChanged();
    } catch (err) {
      log.warn('Removing a passkey failed', { operation: 'removePasskey', code: getErrorCode(err), error: err });
      setError(describe(err));
    } finally {
      setRemoving(false);
    }
  }, [removeTarget, removeUnlockSlot, onChanged, describe]);

  // Nothing to show: the browser cannot use passkeys and none exist here.
  if (available !== true && passkeys.length === 0) return null;

  return (
    <Box data-testid="passkeys-section">
      <Typography variant="subtitle1" fontWeight="medium" gutterBottom>
        {t('unlockMethods.passkeys')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('unlockMethods.passkeysDescription')}
      </Typography>

      {available === false && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('unlockMethods.passkeyUnavailable')}
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {passkeys.length > 0 && (
        <List dense disablePadding data-testid="passkey-list">
          {passkeys.map((slot) => {
            const isRenaming = renaming?.slotId === slot.slotId;
            return (
              <ListItem
                key={slot.slotId}
                disableGutters
                data-testid="passkey-slot"
                secondaryAction={
                  isRenaming ? undefined : (
                    <Stack direction="row" spacing={0.5}>
                      <Tooltip title={t('unlockMethods.rename')}>
                        <IconButton
                          size="small"
                          aria-label={t('unlockMethods.rename')}
                          onClick={() => setRenaming({ slotId: slot.slotId, label: slot.label })}
                          data-testid="rename-passkey"
                        >
                          <DriveFileRenameOutline fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('unlockMethods.remove')}>
                        <IconButton
                          size="small"
                          aria-label={t('unlockMethods.remove')}
                          onClick={() => setRemoveTarget(slot)}
                          data-testid="remove-passkey"
                        >
                          <DeleteOutline fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </Stack>
                  )
                }
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Fingerprint fontSize="small" />
                </ListItemIcon>
                {isRenaming ? (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1, pr: 1 }}>
                    <TextField
                      size="small"
                      label={t('unlockMethods.renameLabel')}
                      value={renaming.label}
                      onChange={(event) => setRenaming({ slotId: slot.slotId, label: event.target.value })}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void handleRenameSave();
                        if (event.key === 'Escape') setRenaming(null);
                      }}
                      autoFocus
                      fullWidth
                      disabled={savingRename}
                      slotProps={{ htmlInput: { 'data-testid': 'rename-passkey-input' } }}
                    />
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => void handleRenameSave()}
                      disabled={savingRename || !renaming.label.trim()}
                      data-testid="rename-passkey-save"
                    >
                      {t('common:actions.save')}
                    </Button>
                    <Button size="small" onClick={() => setRenaming(null)} disabled={savingRename}>
                      {t('common:actions.cancel')}
                    </Button>
                  </Stack>
                ) : (
                  <ListItemText
                    primary={<span data-testid="passkey-label">{slot.label}</span>}
                    secondary={
                      slot.lastUsedAt
                        ? t('unlockMethods.lastUsed', { date: dateTime(slot.lastUsedAt) })
                        : t('unlockMethods.added', { date: dateTime(slot.createdAt) })
                    }
                  />
                )}
              </ListItem>
            );
          })}
        </List>
      )}

      {available === true && (
        <Button
          variant="outlined"
          startIcon={adding ? <CircularProgress size={16} color="inherit" /> : <Add />}
          onClick={() => void handleAdd()}
          disabled={adding || !keyId}
          sx={{ mt: passkeys.length > 0 ? 1.5 : 0 }}
          data-testid="add-passkey"
        >
          {adding ? t('unlockMethods.addingPasskey') : t('unlockMethods.addPasskey')}
        </Button>
      )}

      <Dialog open={removeTarget !== null} onClose={() => (removing ? undefined : setRemoveTarget(null))}>
        <DialogTitle>{t('unlockMethods.removePasskeyTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">{t('unlockMethods.removePasskeyBody', { label: removeTarget?.label ?? '' })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTarget(null)} disabled={removing}>
            {t('common:actions.cancel')}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => void handleRemove()}
            disabled={removing}
            startIcon={removing ? <CircularProgress size={16} color="inherit" /> : undefined}
            data-testid="confirm-remove-passkey"
          >
            {t('unlockMethods.remove')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
