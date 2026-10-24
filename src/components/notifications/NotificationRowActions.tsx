'use client';

/**
 * Done / Snooze / Dismiss for one notification row. Shared by the page grid
 * and the dashboard card; the snooze menu offers 1 day, 1 week, or a date.
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
} from '@mui/icons-material';

import { addDaysISO, isDateOnly, todayLocalISO } from '@/lib/dateOnly';
import type { SnoozePreset } from '@/lib/notificationService';
import type { AppNotification } from '@/types/database';

export interface NotificationRowActionsProps {
  notification: AppNotification;
  onComplete: (notification: AppNotification) => Promise<void>;
  onSnooze: (id: number, until: SnoozePreset | string) => Promise<void>;
  onDismiss: (id: number) => Promise<void>;
  onError?: (message: string) => void;
  /** Smaller icon buttons for dense surfaces. */
  size?: 'small' | 'medium';
}

export default function NotificationRowActions({
  notification,
  onComplete,
  onSnooze,
  onDismiss,
  onError,
  size = 'small',
}: NotificationRowActionsProps) {
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

  const closed = notification.status === 'done' || notification.status === 'dismissed';
  const doneLabel = notification.kind === 'reminder' && notification.recurrence !== 'once' ? 'Done (advance to next)' : 'Done';

  return (
    <>
      <Tooltip title={doneLabel}>
        <span>
          <IconButton
            size={size}
            color="success"
            aria-label={`Mark ${notification.title} done`}
            data-testid={`notification-done-${notification.id}`}
            disabled={busy || closed}
            onClick={() => run(() => onComplete(notification), 'Could not complete the notification')}
          >
            <DoneIcon fontSize={size} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Snooze">
        <span>
          <IconButton
            size={size}
            aria-label={`Snooze ${notification.title}`}
            data-testid={`notification-snooze-${notification.id}`}
            disabled={busy || closed}
            onClick={(event) => setMenuAnchor(event.currentTarget)}
          >
            <SnoozeIcon fontSize={size} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Dismiss">
        <span>
          <IconButton
            size={size}
            aria-label={`Dismiss ${notification.title}`}
            data-testid={`notification-dismiss-${notification.id}`}
            disabled={busy || closed}
            onClick={() => run(() => onDismiss(notification.id), 'Could not dismiss the notification')}
          >
            <DismissIcon fontSize={size} />
          </IconButton>
        </span>
      </Tooltip>

      <Menu open={menuAnchor !== null} anchorEl={menuAnchor} onClose={() => setMenuAnchor(null)}>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            void run(() => onSnooze(notification.id, 'day'), 'Could not snooze the notification');
          }}
        >
          Snooze 1 day
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            void run(() => onSnooze(notification.id, 'week'), 'Could not snooze the notification');
          }}
        >
          Snooze 1 week
        </MenuItem>
        <MenuItem
          onClick={() => {
            setMenuAnchor(null);
            setPickDateOpen(true);
          }}
        >
          Pick a date…
        </MenuItem>
      </Menu>

      <Dialog open={pickDateOpen} onClose={() => setPickDateOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Snooze until</DialogTitle>
        <DialogContent>
          <TextField
            label="Date"
            type="date"
            value={pickedDate}
            onChange={(event) => setPickedDate(event.target.value)}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: addDaysISO(todayLocalISO(), 1) } }}
            fullWidth
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickDateOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!isDateOnly(pickedDate) || pickedDate <= todayLocalISO()}
            onClick={() => {
              setPickDateOpen(false);
              void run(() => onSnooze(notification.id, pickedDate), 'Could not snooze the notification');
            }}
          >
            Snooze
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
