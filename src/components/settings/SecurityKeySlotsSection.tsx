'use client';

/**
 * Settings → Security: everything about the key slots that protect the
 * database on this device.
 *
 *   - Master secret: which kind protects it (password / recovery phrase),
 *     change the password, or switch to the other kind (SwitchMasterDialog).
 *   - Unlock methods: the slot list. Phase 1 shows the master slot; passkeys
 *     and the cloud-account slot plug in here in later phases.
 *
 * Owns the one `getUnlockMethods` read so the two parts stay in step.
 */

import { useCallback, useEffect, useState } from 'react';

import { KeyOutlined, SwapHoriz } from '@mui/icons-material';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { SyncStage } from '@/lib/cloudSyncService';
import type { DatabaseSource } from '@/lib/databaseSourceStorage';
import { logger } from '@/lib/logging';
import type { MasterSecret, MasterSlotType, SlotSummary, UnlockMethods } from '@/lib/encryptionTypes';
import { ChangePasswordSection } from './ChangePasswordSection';
import { SwitchMasterDialog } from './SwitchMasterDialog';

const log = logger.child({ component: 'SecurityKeySlotsSection' });

interface SecurityKeySlotsSectionProps {
  getUnlockMethods: () => Promise<UnlockMethods>;
  changeMaster: (current: MasterSecret, next: MasterSecret) => Promise<{ syncError: string | null }>;
  databaseSource: DatabaseSource;
  syncStage: SyncStage | null;
}

export function SecurityKeySlotsSection({ getUnlockMethods, changeMaster, databaseSource, syncStage }: SecurityKeySlotsSectionProps) {
  const { t } = useTranslation('settings');
  const { dateTime } = useFormatters();
  const [methods, setMethods] = useState<UnlockMethods | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);
  const [notice, setNotice] = useState<{ severity: 'success' | 'warning'; text: string } | null>(null);

  const reload = useCallback(async () => {
    try {
      setMethods(await getUnlockMethods());
      setLoadError(null);
    } catch (err) {
      log.error('Failed to read the unlock methods', { operation: 'getUnlockMethods', error: err });
      setLoadError(t('master.failed'));
    }
  }, [getUnlockMethods, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const master = methods?.methods.find((slot) => slot.isMaster) ?? null;
  const masterType: MasterSlotType | null = master ? (master.type as MasterSlotType) : null;

  const changePassword = useCallback(
    (current: string, next: string) => changeMaster({ type: 'password', secret: current }, { type: 'password', secret: next }),
    [changeMaster]
  );

  const typeLabel = (slot: SlotSummary) => {
    switch (slot.type) {
      case 'password':
        return t('unlockMethods.typePassword');
      case 'recovery':
        return t('unlockMethods.typeRecovery');
      case 'passkey':
        return t('unlockMethods.typePasskey');
      default:
        return t('unlockMethods.typeCloud');
    }
  };

  return (
    <Stack spacing={3}>
      <Box>
        <Typography variant="h6" gutterBottom>
          {t('master.title')}
        </Typography>
        {loadError && <Alert severity="error">{loadError}</Alert>}
        {!methods && !loadError && <CircularProgress size={20} />}
        {masterType && (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }} data-testid="master-type-description">
              {masterType === 'password' ? t('master.currentPassword') : t('master.currentRecovery')}
            </Typography>
            {notice && (
              <Alert severity={notice.severity} sx={{ mb: 2 }} onClose={() => setNotice(null)}>
                {notice.text}
              </Alert>
            )}
            <Button
              variant="outlined"
              startIcon={<SwapHoriz />}
              onClick={() => setSwitchOpen(true)}
              data-testid="switch-master-type"
            >
              {masterType === 'password' ? t('master.switchToRecovery') : t('master.switchToPassword')}
            </Button>
            <SwitchMasterDialog
              open={switchOpen}
              currentType={masterType}
              changeMaster={changeMaster}
              onClose={() => setSwitchOpen(false)}
              onSwitched={(next, syncError) => {
                setSwitchOpen(false);
                setNotice(
                  syncError
                    ? { severity: 'warning', text: t('changePassword.syncWarning', { error: syncError }) }
                    : { severity: 'success', text: next === 'recovery' ? t('switchMaster.doneRecovery') : t('switchMaster.donePassword') }
                );
                void reload();
              }}
            />
          </>
        )}
      </Box>

      {masterType === 'password' && (
        <>
          <Divider />
          <ChangePasswordSection changePassword={changePassword} databaseSource={databaseSource} syncStage={syncStage} />
        </>
      )}

      <Divider />

      <Box>
        <Typography variant="h6" gutterBottom>
          {t('unlockMethods.title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          {t('unlockMethods.description')}
        </Typography>
        {methods && (
          <List dense disablePadding data-testid="unlock-methods-list">
            {methods.methods.map((slot) => (
              <ListItem key={slot.slotId} disableGutters data-testid={`unlock-method-${slot.type}`}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <KeyOutlined fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <span>{typeLabel(slot)}</span>
                      {slot.isMaster && <Chip size="small" label={t('unlockMethods.master')} />}
                    </Box>
                  }
                  secondary={
                    slot.lastUsedAt
                      ? t('unlockMethods.lastUsed', { date: dateTime(slot.lastUsedAt) })
                      : t('unlockMethods.added', { date: dateTime(slot.createdAt) })
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
        {methods && methods.methods.every((slot) => slot.isMaster) && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {t('unlockMethods.empty')}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
