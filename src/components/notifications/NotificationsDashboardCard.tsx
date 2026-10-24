'use client';

/**
 * Dashboard slot for due notifications. Renders nothing when there is
 * nothing due, so the dashboard looks unchanged until the notifications
 * feature fills the collection.
 */

import React from 'react';
import { List, ListItem, ListItemText, Paper, Typography } from '@mui/material';

import { useNotificationBadgeSlice } from '@/contexts/useDatabaseSlices';
import { todayLocalISO } from '@/lib/dateOnly';

export default function NotificationsDashboardCard() {
  const { notifications } = useNotificationBadgeSlice();
  const today = todayLocalISO();
  const due = notifications.filter(
    (notification) => notification.status === 'active' && (!notification.due_date || notification.due_date <= today)
  );

  if (due.length === 0) return null;

  return (
    <Paper sx={{ p: 3, mb: 4 }} data-testid="notifications-dashboard-card">
      <Typography variant="h6" gutterBottom>
        Reminders &amp; alerts
      </Typography>
      <List dense disablePadding>
        {due.slice(0, 5).map((notification) => (
          <ListItem key={notification.id} disableGutters>
            <ListItemText primary={notification.title} secondary={notification.due_date ?? undefined} />
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}
