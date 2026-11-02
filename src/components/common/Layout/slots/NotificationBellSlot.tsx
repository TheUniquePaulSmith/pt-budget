'use client';

/**
 * Shell slot: the notification bell. Owned by the notifications feature; the
 * shell only decides where the slot is rendered and which variant.
 *
 * Clicking the bell always navigates to the Notifications page (the shell
 * tests and the registry e2e rely on that). Hovering or focusing the header
 * bell shows a read-only preview of the top due rows.
 */

import React, { useMemo, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Popover,
  Typography,
} from '@mui/material';
import { NotificationsNone as BellIcon } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import { useNotificationBadgeSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { useNotificationsView } from '@/components/notifications/notificationsStore';
import { describeNotification, describeTiming, timingColor } from '@/components/notifications/notificationPresentation';
import { todayLocalISO } from '@/lib/dateOnly';
import { classifyNotifications, selectDue } from '@/lib/notificationService';
import type { AppNotification, NotificationSetting } from '@/types/database';

export type NotificationBellVariant = 'header' | 'menuItem';

export interface NotificationBellSlotProps {
  variant: NotificationBellVariant;
  onNavigate: () => void;
}

/** English default of the bell's accessible name (`shell:notificationBell.label` at render time). */
export const NOTIFICATION_BELL_LABEL = 'Notifications';
const PREVIEW_ROWS = 5;
const HOVER_DELAY_MS = 250;

/** Active notifications inside their lead window (or without a date). */
export function countDueNotifications(
  notifications: AppNotification[],
  today: string = todayLocalISO(),
  settings: ReadonlyArray<NotificationSetting> = []
): number {
  return selectDue(classifyNotifications(notifications, settings, today)).length;
}

export default function NotificationBellSlot({ variant, onNavigate }: NotificationBellSlotProps) {
  const { t } = useTranslation('shell');
  // Alert rows are rebuilt from their payload in the current language.
  const { t: notificationsT } = useTranslation('notifications');
  const { money, date, month } = useFormatters();
  const { notifications } = useNotificationBadgeSlice();
  const view = useNotificationsView();
  const [previewAnchor, setPreviewAnchor] = useState<HTMLElement | null>(null);
  const hoverTimer = useRef<number | null>(null);

  const due = useMemo(() => {
    if (!view.preferences.enabled) return [];
    return selectDue(classifyNotifications(notifications, view.settings, view.today));
  }, [notifications, view.preferences.enabled, view.settings, view.today]);
  const dueCount = due.length;
  const label = t('notificationBell.label');

  if (variant === 'menuItem') {
    return (
      <ListItem disablePadding>
        <ListItemButton onClick={onNavigate} data-testid="notification-bell-menu-item">
          <ListItemIcon>
            <Badge badgeContent={dueCount} color="error">
              <BellIcon />
            </Badge>
          </ListItemIcon>
          <ListItemText primary={label} secondary={dueCount > 0 ? t('notificationBell.due', { count: dueCount }) : undefined} />
        </ListItemButton>
      </ListItem>
    );
  }

  const openPreview = (target: HTMLElement) => {
    if (dueCount === 0) return;
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setPreviewAnchor(target), HOVER_DELAY_MS);
  };
  const closePreview = () => {
    if (hoverTimer.current) window.clearTimeout(hoverTimer.current);
    hoverTimer.current = null;
    setPreviewAnchor(null);
  };

  return (
    <>
      <IconButton
        color="inherit"
        onClick={() => {
          closePreview();
          onNavigate();
        }}
        onMouseEnter={(event) => openPreview(event.currentTarget)}
        onMouseLeave={closePreview}
        onFocus={(event) => openPreview(event.currentTarget)}
        onBlur={closePreview}
        sx={{ ml: 2 }}
        title={dueCount > 0 ? t('notificationBell.titleWithDue', { label, count: dueCount }) : label}
        aria-label={label}
        data-testid="notification-bell-button"
      >
        <Badge badgeContent={dueCount} color="error" data-testid="notification-bell-badge">
          <BellIcon />
        </Badge>
      </IconButton>

      <Popover
        open={previewAnchor !== null && dueCount > 0}
        anchorEl={previewAnchor}
        onClose={closePreview}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        disableRestoreFocus
        disableAutoFocus
        disableEnforceFocus
        sx={{ pointerEvents: 'none' }}
        slotProps={{ paper: { sx: { width: 340, maxWidth: 'calc(100vw - 32px)' } } }}
        data-testid="notification-bell-preview"
      >
        <Box sx={{ px: 2, pt: 1.5, pb: 0.5 }}>
          <Typography variant="subtitle2">
            {t('notificationBell.due', { count: dueCount })}
          </Typography>
        </Box>
        <List dense disablePadding sx={{ pb: 1 }}>
          {due.slice(0, PREVIEW_ROWS).map((entry) => (
            <ListItem key={entry.notification.id} sx={{ py: 0.5 }}>
              <ListItemText
                primary={describeNotification(entry.notification, notificationsT, (amount) => money(amount), { date, month, today: view.today }).title}
                secondary={<Chip size="small" label={describeTiming(entry, notificationsT, date)} color={timingColor(entry)} variant="outlined" sx={{ mt: 0.5 }} />}
                slotProps={{ primary: { noWrap: true, variant: 'body2' }, secondary: { component: 'div' } }}
              />
            </ListItem>
          ))}
          {dueCount > PREVIEW_ROWS && (
            <ListItem sx={{ py: 0.5 }}>
              <Typography variant="caption" color="text.secondary">
                {t('notificationBell.more', { count: dueCount - PREVIEW_ROWS })}
              </Typography>
            </ListItem>
          )}
        </List>
      </Popover>
    </>
  );
}
