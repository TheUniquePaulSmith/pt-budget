'use client';

/**
 * Shell slot: the notification bell. Owned by the notifications feature,
 * which adds the popover and OS-notification hooks; the shell only decides
 * where the slot is rendered and which variant.
 */

import React from 'react';
import { Badge, IconButton, ListItem, ListItemButton, ListItemIcon, ListItemText } from '@mui/material';
import { NotificationsNone as BellIcon } from '@mui/icons-material';

import { useNotificationBadgeSlice } from '@/contexts/useDatabaseSlices';
import { todayLocalISO } from '@/lib/dateOnly';
import type { AppNotification } from '@/types/database';

export type NotificationBellVariant = 'header' | 'menuItem';

export interface NotificationBellSlotProps {
  variant: NotificationBellVariant;
  onNavigate: () => void;
}

export const NOTIFICATION_BELL_LABEL = 'Notifications';

/** Active notifications whose due date has arrived (or that have no date). */
export function countDueNotifications(notifications: AppNotification[], today: string = todayLocalISO()): number {
  return notifications.filter(
    (notification) => notification.status === 'active' && (!notification.due_date || notification.due_date <= today)
  ).length;
}

export default function NotificationBellSlot({ variant, onNavigate }: NotificationBellSlotProps) {
  const { notifications } = useNotificationBadgeSlice();
  const dueCount = countDueNotifications(notifications);

  if (variant === 'menuItem') {
    return (
      <ListItem disablePadding>
        <ListItemButton onClick={onNavigate} data-testid="notification-bell-menu-item">
          <ListItemIcon>
            <Badge badgeContent={dueCount} color="error">
              <BellIcon />
            </Badge>
          </ListItemIcon>
          <ListItemText primary={NOTIFICATION_BELL_LABEL} />
        </ListItemButton>
      </ListItem>
    );
  }

  return (
    <IconButton
      color="inherit"
      onClick={onNavigate}
      sx={{ ml: 2 }}
      title={NOTIFICATION_BELL_LABEL}
      aria-label={NOTIFICATION_BELL_LABEL}
      data-testid="notification-bell-button"
    >
      <Badge badgeContent={dueCount} color="error" data-testid="notification-bell-badge">
        <BellIcon />
      </Badge>
    </IconButton>
  );
}
