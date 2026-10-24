'use client';

/**
 * Notifications page. Foundation stub: lists what is in the cached
 * collection so the registry entry, bell and dashboard card have a target.
 * The notifications feature replaces this with the full page (Due / Upcoming
 * / History tabs, reminder editor, row actions).
 */

import React from 'react';
import {
  Box,
  Chip,
  List,
  ListItem,
  ListItemText,
  Paper,
  Typography,
} from '@mui/material';

import { useNotificationsPageSlice } from '@/contexts/useDatabaseSlices';

export default function NotificationsPage() {
  const { notifications } = useNotificationsPageSlice();
  const visible = notifications.filter((notification) => notification.status !== 'dismissed');

  return (
    <Box sx={{ flexGrow: 1, p: { xs: 2, sm: 3 } }} data-testid="notifications-page">
      <Typography variant="h4" component="h1" gutterBottom>
        Notifications
      </Typography>
      <Typography variant="body2" color="text.secondary" paragraph>
        Reminders and alerts about your finances show up here.
      </Typography>

      <Paper sx={{ p: { xs: 2, sm: 3 } }}>
        {visible.length === 0 ? (
          <Typography color="text.secondary" data-testid="notifications-empty">
            No notifications yet.
          </Typography>
        ) : (
          <List disablePadding>
            {visible.map((notification) => (
              <ListItem key={notification.id} divider disableGutters>
                <ListItemText
                  primary={notification.title}
                  secondary={[notification.due_date, notification.body].filter(Boolean).join(' · ')}
                />
                <Chip size="small" label={notification.kind} />
              </ListItem>
            ))}
          </List>
        )}
      </Paper>
    </Box>
  );
}
