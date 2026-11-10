'use client';

/**
 * Saved formats: how each bank's file shape is read (`import_profiles`).
 * A format can be renamed, pointed at another account or at none ("ask each
 * time"), and deleted; deleting says that the next file of that shape will
 * be asked about again.
 *
 * The wizard trusts a format only for the account it was saved for, so one
 * file shape (fingerprint) can have a format per account, often under the
 * same name. Every row shows its account, and every change goes by the
 * format's id: editing or deleting one never touches its sibling.
 */

import React, { useCallback, useId, useState } from 'react';
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
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DeleteOutline, EditOutlined } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import { storedTimestampToDate } from '@/lib/formatting';
import { logger } from '@/lib/logging';
import type { ImportProfileInput, SavedImportProfile } from '@/lib/statementImport/types';
import type { Account } from '@/types/database';

import ConfirmDialog from './ConfirmDialog';
import ManageSection from './ManageSection';

const log = logger.child({ component: 'SavedFormatsSection' });

export interface SavedFormatsSectionProps {
  /** null while the first load is running. */
  profiles: SavedImportProfile[] | null;
  failed: boolean;
  accounts: readonly Account[];
  onRetry: () => void;
  onStartImport: () => void;
  saveImportProfile: (input: ImportProfileInput, id?: number) => Promise<number>;
  deleteImportProfile: (id: number) => Promise<void>;
  /** A format was renamed, re-pointed or deleted: the lists that show it reload. */
  onChanged: () => void;
}

interface EditFormatDialogProps {
  profile: SavedImportProfile;
  accounts: readonly Account[];
  saveImportProfile: SavedFormatsSectionProps['saveImportProfile'];
  onClose: () => void;
  onSaved: () => void;
}

/** Name and target account of one saved format. Mounted only while open. */
function EditFormatDialog({ profile, accounts, saveImportProfile, onClose, onSaved }: EditFormatDialogProps) {
  const { t } = useTranslation(['importManage', 'common']);
  const [name, setName] = useState(profile.name);
  const [accountId, setAccountId] = useState<number | null>(profile.account_id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedName = name.trim();
  const sortedAccounts = [...accounts].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

  const handleSave = useCallback(async () => {
    if (!trimmedName) return;
    setSaving(true);
    setError(null);
    try {
      // Everything about how the file is read stays as it was saved.
      await saveImportProfile(
        {
          name: trimmedName,
          format: profile.format,
          fingerprint: profile.fingerprint,
          institution: profile.institution,
          account_id: accountId,
          config: profile.config,
        },
        profile.id
      );
      onSaved();
    } catch (err) {
      log.error('Failed to save an import format', { operation: 'saveImportProfile', profileId: profile.id, error: err });
      setError(t('formats.editDialog.saveFailed'));
      setSaving(false);
    }
  }, [accountId, onSaved, profile, saveImportProfile, t, trimmedName]);

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="xs" data-testid="import-format-dialog">
      <DialogTitle>{t('formats.editDialog.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            label={t('formats.editDialog.name')}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void handleSave();
            }}
            error={!trimmedName}
            helperText={trimmedName ? undefined : t('formats.editDialog.nameRequired')}
            disabled={saving}
            fullWidth
            autoFocus
            slotProps={{ htmlInput: { 'data-testid': 'import-format-name-input', maxLength: 120 } }}
          />
          <TextField
            select
            label={t('formats.editDialog.account')}
            value={accountId === null ? '' : String(accountId)}
            onChange={(event) => setAccountId(event.target.value === '' ? null : Number(event.target.value))}
            helperText={t('formats.editDialog.accountHelp')}
            disabled={saving}
            fullWidth
            slotProps={{
              select: { displayEmpty: true },
              inputLabel: { shrink: true },
              htmlInput: { 'data-testid': 'import-format-account-input' },
            }}
          >
            <MenuItem value="">
              <em>{t('formats.editDialog.askEachTime')}</em>
            </MenuItem>
            {sortedAccounts.map((account) => (
              <MenuItem key={account.id} value={String(account.id)}>
                {account.name}
              </MenuItem>
            ))}
          </TextField>
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('common:actions.cancel')}
        </Button>
        <Button
          variant="contained"
          onClick={() => void handleSave()}
          disabled={saving || !trimmedName}
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : undefined}
          data-testid="import-format-save"
        >
          {t('common:actions.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default function SavedFormatsSection({
  profiles,
  failed,
  accounts,
  onRetry,
  onStartImport,
  saveImportProfile,
  deleteImportProfile,
  onChanged,
}: SavedFormatsSectionProps) {
  const { t } = useTranslation('importManage');
  const { number, date } = useFormatters();
  const [editTarget, setEditTarget] = useState<SavedImportProfile | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SavedImportProfile | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const rowIdPrefix = useId();

  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  /** "Goes into: …", or that the format asks each time. */
  const accountLine = (profile: SavedImportProfile): string => {
    const accountName =
      profile.account_id === null ? null : (accountNames.get(profile.account_id) ?? profile.account_name ?? null);
    return accountName ? t('formats.account', { account: accountName }) : t('formats.noAccount');
  };

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteImportProfile(deleteTarget.id);
      setDeleteTarget(null);
      onChanged();
    } catch (error) {
      log.error('Failed to delete an import format', { operation: 'deleteImportProfile', profileId: deleteTarget.id, error });
      setDeleteError(t('formats.deleteDialog.failed'));
    } finally {
      setDeleting(false);
    }
  }, [deleteImportProfile, deleteTarget, onChanged, t]);

  return (
    <>
      <ManageSection
        testId="import-formats"
        title={t('formats.title')}
        description={t('formats.description')}
        itemCount={profiles ? profiles.length : null}
        failed={failed}
        onRetry={onRetry}
        emptyText={t('formats.empty')}
        onStartImport={onStartImport}
      >
        <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }} data-testid="import-formats-list">
          {(profiles ?? []).map((profile) => {
            const fileType = profile.format === 'ofx' ? t('formats.fileType.ofx') : t('formats.fileType.delimited');
            // A stored timestamp, not a calendar date: the day is the one on this device.
            const lastUsed = storedTimestampToDate(profile.last_used_at);
            // One file shape can have a format per account, often under the same name: the account
            // line is what tells them apart, also for a screen reader on the two buttons.
            const accountLineId = `${rowIdPrefix}-account-${profile.id}`;
            return (
              <Box
                component="li"
                key={profile.id}
                data-testid="import-format-row"
                data-profile-id={profile.id}
                sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, py: 1.5, borderTop: 1, borderColor: 'divider' }}
              >
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography
                    variant="subtitle1"
                    component="h3"
                    sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}
                    data-testid="import-format-name"
                  >
                    {profile.name}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                    {[profile.institution, fileType].filter(Boolean).join(' · ')}
                  </Typography>
                  <Typography
                    id={accountLineId}
                    variant="body2"
                    sx={{ overflowWrap: 'anywhere' }}
                    data-testid="import-format-account"
                  >
                    {accountLine(profile)}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" data-testid="import-format-usage">
                    {[
                      lastUsed ? t('formats.lastUsed', { date: date(lastUsed) }) : t('formats.neverUsed'),
                      t('formats.useCount', { count: number(profile.use_count) }),
                    ].join(' · ')}
                  </Typography>
                </Box>
                <Stack direction="row" spacing={0.5} sx={{ flexShrink: 0 }}>
                  <Tooltip title={t('formats.edit', { name: profile.name })}>
                    <IconButton
                      size="small"
                      aria-label={t('formats.edit', { name: profile.name })}
                      aria-describedby={accountLineId}
                      onClick={() => setEditTarget(profile)}
                      data-testid="import-format-edit"
                    >
                      <EditOutlined fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('formats.delete', { name: profile.name })}>
                    <IconButton
                      size="small"
                      aria-label={t('formats.delete', { name: profile.name })}
                      aria-describedby={accountLineId}
                      onClick={() => {
                        setDeleteError(null);
                        setDeleteTarget(profile);
                      }}
                      data-testid="import-format-delete"
                    >
                      <DeleteOutline fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Box>
            );
          })}
        </Box>
      </ManageSection>

      {editTarget && (
        <EditFormatDialog
          key={editTarget.id}
          profile={editTarget}
          accounts={accounts}
          saveImportProfile={saveImportProfile}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            onChanged();
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title={t('formats.deleteDialog.title')}
          confirmLabel={t('formats.deleteDialog.confirm')}
          confirmTestId="import-format-delete-confirm"
          busy={deleting}
          error={deleteError}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleteTarget(null)}
        >
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mb: 1 }}>
            {t('formats.deleteDialog.body', { name: deleteTarget.name })}
          </Typography>
          {/* Which of two same-named formats this is. */}
          <Typography variant="body2" sx={{ overflowWrap: 'anywhere', mb: 1 }} data-testid="import-format-delete-account">
            {accountLine(deleteTarget)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('formats.deleteDialog.note')}
          </Typography>
        </ConfirmDialog>
      )}
    </>
  );
}
