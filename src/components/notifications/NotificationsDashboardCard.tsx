'use client';

/**
 * Dashboard slot: what is due now plus what comes up in the next seven days,
 * with inline done / snooze / dismiss. Renders nothing when there is nothing
 * to show (or notifications are turned off), so the dashboard looks unchanged.
 */

import React, { useMemo, useState } from 'react';
import { Alert, Box, Chip, List, ListItem, ListItemText, Paper, Typography } from '@mui/material';

import { useNotificationBadgeSlice } from '@/contexts/useDatabaseSlices';
import {
  DASHBOARD_LOOKAHEAD_DAYS,
  classifyNotifications,
  selectDue,
  selectUpcomingWithin,
} from '@/lib/notificationService';
import type { ClassifiedNotification } from '@/types/notifications';
import NotificationRowActions from './NotificationRowActions';
import { describeTiming, timingColor, typeChipColor, typeLabel } from './notificationPresentation';
import { useNotificationsView } from './notificationsStore';

const MAX_ROWS = 8;

export default function NotificationsDashboardCard() {
  const { notifications, completeNotification, snoozeNotification, dismissNotification } = useNotificationBadgeSlice();
  const view = useNotificationsView();
  const [error, setError] = useState<string | null>(null);

  const { due, upcoming } = useMemo(() => {
    if (!view.preferences.enabled) return { due: [], upcoming: [] };
    const classified = classifyNotifications(notifications, view.settings, view.today);
    return {
      due: selectDue(classified),
      upcoming: selectUpcomingWithin(classified, DASHBOARD_LOOKAHEAD_DAYS),
    };
  }, [notifications, view.preferences.enabled, view.settings, view.today]);

  if (due.length === 0 && upcoming.length === 0) return null;

  const renderRow = (entry: ClassifiedNotification) => (
    <ListItem
      key={entry.notification.id}
      disableGutters
      divider
      data-testid={`dashboard-notification-${entry.notification.id}`}
      secondaryAction={
        <NotificationRowActions
          notification={entry.notification}
          onComplete={completeNotification}
          onSnooze={snoozeNotification}
          onDismiss={dismissNotification}
          onError={setError}
        />
      }
      sx={{ pr: 15 }}
    >
      <ListItemText
        primary={
          <Box display="flex" alignItems="center" gap={1} flexWrap="wrap">
            <Typography variant="body2" fontWeight={600}>
              {entry.notification.title}
            </Typography>
            <Chip size="small" label={typeLabel(entry.notification.type)} color={typeChipColor(entry.notification)} variant="outlined" />
          </Box>
        }
        secondary={
          <Box component="span" display="flex" alignItems="center" gap={1}>
            <Chip size="small" label={describeTiming(entry)} color={timingColor(entry)} variant="outlined" />
            {entry.occurrence && (
              <Typography component="span" variant="caption" color="text.secondary">
                {entry.occurrence}
              </Typography>
            )}
          </Box>
        }
        slotProps={{ secondary: { component: 'div' } }}
      />
    </ListItem>
  );

  const shownDue = due.slice(0, MAX_ROWS);
  const shownUpcoming = upcoming.slice(0, Math.max(0, MAX_ROWS - shownDue.length));
  const hiddenCount = due.length + upcoming.length - shownDue.length - shownUpcoming.length;

  return (
    <Paper sx={{ p: 3, mb: 4 }} data-testid="notifications-dashboard-card">
      <Box display="flex" alignItems="center" justifyContent="space-between" flexWrap="wrap" gap={1} mb={1}>
        <Typography variant="h6">Reminders &amp; alerts</Typography>
        <Typography variant="body2" color="text.secondary">
          {due.length} due · {upcoming.length} in the next {DASHBOARD_LOOKAHEAD_DAYS} days
        </Typography>
      </Box>
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <List dense disablePadding>
        {shownDue.map(renderRow)}
        {shownUpcoming.length > 0 && (
          <ListItem disableGutters sx={{ pt: 1.5 }}>
            <Typography variant="overline" color="text.secondary">
              Coming up
            </Typography>
          </ListItem>
        )}
        {shownUpcoming.map(renderRow)}
      </List>
      {hiddenCount > 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {hiddenCount} more on the Notifications page.
        </Typography>
      )}
    </Paper>
  );
}
