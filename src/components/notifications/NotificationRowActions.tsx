'use client';

/**
 * Done / Snooze / Dismiss for one notification row. Shared by the page grid
 * and the dashboard card; the snooze menu offers 1 day, 1 week, or a date. A
 * payment that is not confirmed overdue yet also offers to import a newer
 * statement (inside the shell, which owns page navigation).
 */

import React, { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  TextField,
  Tooltip,
} from '@mui/material';
import {
  CheckCircleOutline as DoneIcon,
  Close as DismissIcon,
  Snooze as SnoozeIcon,
  UploadFile as ImportIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useShellNavigate } from '@/components/common/Layout/slots/ShellNavigation';
import { addDaysISO, isDateOnly, todayLocalISO } from '@/lib/dateOnly';
import { isUnconfirmedOverdue, type SnoozePreset } from '@/lib/notificationService';
import type { AppNotification } from '@/types/database';

export interface NotificationRowActionsProps {
  notification: AppNotification;
  /** The title as displayed (system alerts are rebuilt in the current language); defaults to the stored title. */
  title?: string;
  onComplete: (notification: AppNotification) => Promise<void>;
  onSnooze: (id: number, until: SnoozePreset | string) => Promise<void>;
  onDismiss: (id: number) => Promise<void>;
  onError?: (message: string) => void;
  /** Smaller icon buttons for dense surfaces. */
  size?: 'small' | 'medium';
  /** The day the surface classifies against (defaults to the local date). */
  today?: string;
}

export default function NotificationRowActions({
  notification,
  title,
  onComplete,
  onSnooze,
  onDismiss,
  onError,
  size = 'small',
  today,
}: NotificationRowActionsProps) {
  const navigate = useShellNavigate();
  const { t } = useTranslation(['notifications', 'common']);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [pickDateOpen, setPickDateOpen] = useState(false);
  const [pickedDate, setPickedDate] = useState(() => addDaysISO(todayLocalISO(), 1));
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>, failure: string) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      onError?.(error instanceof Error ? error.message : failure);
    } finally {
      setBusy(false);
    }
  };

  const displayTitle = title ?? notification.title;
  const closed = notification.status === 'done' || notification.status === 'dismissed';
  // A payment not confirmed yet, or an account not imported for months: a newer statement settles it.
  const offerImport =
    !closed &&
    navigate !== null &&
    (notification.type === 'stale_account' || isUnconfirmedOverdue(notification, today ?? todayLocalISO()));
  const doneLabel = notification.kind === 'reminder' && notification.recurrence !== 'once' ? t('rowActions.doneAdvance') : t('rowActions.done');

  return (
    <>
      {offerImport && (
        <Tooltip title={t('rowActions.importNewer')}>
          <IconButton
            size={size}
            color="warning"
            aria-label={t('rowActions.importNewerAria', { title: displayTitle })}
            data-testid={`notification-import-${notification.id}`}
            onClick={() => navigate?.('import')}
          >
            <ImportIcon fontSize={size} />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title={doneLabel}>
        <span>
          <IconButton
            size={size}
            color="success"
            aria-label={t('rowActions.doneAria', { title: displayTitle })}
            data-testid={`notification-done-${notification.id}`}
            disabled={busy || closed}
            onClick={() => run(() => onComplete(notification), t('rowActions.completeFailed'))}
          >
            <DoneIcon fontSize={size} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('rowActions.snooze')}>
        <span>
          <IconButton
            size={size}
            aria-label={t('rowActions.snoozeAria', { title: displayTitle })}
            data-testid={`notification-snooze-${notification.id}`}
            disabled={busy || closed}
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            <SnoozeIcon fontSize={size} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={t('rowActions.dismiss')}>
        <span>
          <IconButton
            size={size}
            aria-label={t('rowActions.dismissAria', { title: displayTitle })}
            data-testid={`notification-dismiss-${notification.id}`}
            disabled={busy || closed}
            onClick={() => run(() => onDismiss(notification.id), t('rowActions.dismissFailed'))}
          >
            <DismissIcon fontSize={size} />
          </IconButton>
        </span>
      </Tooltip>

      <Menu open={menuAnchor !== null} anchorEl={menuAnchor} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            void run(() => onSnooze(notification.id, 'day'), t('rowActions.snoozeFailed'));
          }}
        >
          {t('rowActions.snoozeDay')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            void run(() => onSnooze(notification.id, 'week'), t('rowActions.snoozeFailed'));
          }}
        >
          {t('rowActions.snoozeWeek')}
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            setPickDateOpen(true);
          }}
        >
          {t('rowActions.pickDate')}
        </MenuItem>
      </Menu>

      <Dialog open={pickDateOpen} onClose={() => setPickDateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('rowActions.snoozeUntilTitle')}</DialogTitle>
        <DialogContent>
          <TextField
            label={t('rowActions.dateLabel')}
            type="date"
            value={pickedDate}
            onChange={(event) => setPickedDate(event.target.value)}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: addDaysISO(todayLocalISO(), 1) } }}
            fullWidth
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickDateOpen(false)}>{t('common:actions.cancel')}</Button>
          <Button
            variant="contained"
            disabled={!isDateOnly(pickedDate) || pickedDate <= todayLocalISO()}
            onClick={() => {
              setPickDateOpen(false);
              void run(() => onSnooze(notification.id, pickedDate), t('rowActions.snoozeFailed'));
            }}
          >
            {t('rowActions.snoozeConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
