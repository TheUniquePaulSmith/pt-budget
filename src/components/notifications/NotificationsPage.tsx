'use client';

/**
 * Notifications page: Due / Upcoming / History tabs over the cached
 * collection, row actions (done / snooze / dismiss, edit + delete for user
 * reminders), a "New reminder" editor and a Rescan button for the system
 * alerts. Classification (lead times, recurring occurrences) happens at read
 * time from the settings the runtime publishes to `notificationsStore`.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Snackbar,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Add as AddIcon,
  DeleteOutline as DeleteIcon,
  Edit as EditIcon,
  Radar as ScanIcon,
} from '@mui/icons-material';
import type { GridColDef } from '@mui/x-data-grid';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { useNotificationsPageSlice } from '@/contexts/useDatabaseSlices';
import { classifyNotifications, compareByOccurrence } from '@/lib/notificationService';
import type { AppNotification, AppNotificationInput } from '@/types/database';
import type { ClassifiedNotification, NotificationBucket } from '@/types/notifications';
import NotificationRowActions from './NotificationRowActions';
import ReminderEditorDialog from './ReminderEditorDialog';
import { describeTiming, RECURRENCE_LABELS, STATUS_LABELS, timingColor, typeChipColor, typeLabel } from './notificationPresentation';
import { requestNotificationRescan, useNotificationsView } from './notificationsStore';

const TABS: Array<{ id: NotificationBucket; label: string; empty: string }> = [
  { id: 'due', label: 'Due', empty: 'Nothing is due right now.' },
  { id: 'upcoming', label: 'Upcoming', empty: 'No upcoming reminders.' },
  { id: 'history', label: 'History', empty: 'No completed or dismissed notifications yet.' },
];

export default function NotificationsPage() {
  const {
    notifications,
    categories,
    recurringSeries,
    createNotification,
    updateNotification,
    deleteNotification,
    completeNotification,
    snoozeNotification,
    dismissNotification,
  } = useNotificationsPageSlice();
  const view = useNotificationsView();

  const [tab, setTab] = useState<NotificationBucket>('due');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AppNotification | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const classified = useMemo(
    () => classifyNotifications(notifications, view.settings, view.today),
    [notifications, view.settings, view.today]
  );

  const byBucket = useMemo(() => {
    const groups: Record<NotificationBucket, ClassifiedNotification[]> = { due: [], upcoming: [], history: [] };
    for (const entry of classified) groups[entry.bucket].push(entry);
    groups.due.sort(compareByOccurrence);
    groups.upcoming.sort(compareByOccurrence);
    groups.history.sort((a, b) => (b.notification.updated_at ?? '').localeCompare(a.notification.updated_at ?? ''));
    return groups;
  }, [classified]);

  const rows = byBucket[tab];

  const handleSave = useCallback(
    async (input: AppNotificationInput, existingId: number | null) => {
      if (existingId === null) {
        await createNotification(input);
        setToast('Reminder created');
      } else {
        await updateNotification(existingId, input);
        setToast('Reminder updated');
      }
    },
    [createNotification, updateNotification]
  );

  const handleDelete = useCallback(
    async (notification: AppNotification) => {
      try {
        await deleteNotification(notification.id);
        setToast('Reminder deleted');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete reminder');
      }
    },
    [deleteNotification]
  );

  const columns = useMemo<GridColDef<ClassifiedNotification>[]>(
    () => [
      {
        field: 'type',
        headerName: 'Type',
        width: 150,
        valueGetter: (_, row) => typeLabel(row.notification.type),
        renderCell: (params) => (
          <Chip
            size="small"
            label={typeLabel(params.row.notification.type)}
            color={typeChipColor(params.row.notification)}
            variant={params.row.notification.kind === 'alert' ? 'filled' : 'outlined'}
          />
        ),
      },
      {
        field: 'title',
        headerName: 'Title',
        flex: 1.6,
        minWidth: 220,
        valueGetter: (_, row) => row.notification.title,
        renderCell: (params) => (
          <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', minWidth: 0 }}>
            <Typography variant="body2" fontWeight={600} noWrap title={params.row.notification.title}>
              {params.row.notification.title}
            </Typography>
            {params.row.notification.body && (
              <Typography variant="caption" color="text.secondary" noWrap title={params.row.notification.body}>
                {params.row.notification.body}
              </Typography>
            )}
          </Box>
        ),
      },
      {
        field: 'occurrence',
        headerName: 'When',
        width: 210,
        valueGetter: (_, row) => row.occurrence ?? '',
        renderCell: (params) => (
          <Box display="flex" alignItems="center" gap={1}>
            <Typography variant="body2">{params.row.occurrence ?? '—'}</Typography>
            {params.row.bucket !== 'history' && (
              <Chip size="small" label={describeTiming(params.row)} color={timingColor(params.row)} variant="outlined" />
            )}
          </Box>
        ),
      },
      {
        field: 'recurrence',
        headerName: 'Repeats',
        width: 110,
        valueGetter: (_, row) => RECURRENCE_LABELS[row.notification.recurrence] ?? row.notification.recurrence,
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 110,
        valueGetter: (_, row) => STATUS_LABELS[row.notification.status] ?? row.notification.status,
      },
      {
        field: 'actions',
        headerName: 'Actions',
        width: 220,
        align: 'right',
        headerAlign: 'right',
        sortable: false,
        filterable: false,
        renderCell: (params) => {
          const { notification } = params.row;
          return (
            <Box display="flex" justifyContent="flex-end" alignItems="center">
              {params.row.bucket !== 'history' && (
                <NotificationRowActions
                  notification={notification}
                  onComplete={completeNotification}
                  onSnooze={snoozeNotification}
                  onDismiss={dismissNotification}
                  onError={setError}
                />
              )}
              {notification.source === 'user' && (
                <>
                  <Tooltip title="Edit">
                    <IconButton
                      size="small"
                      aria-label={`Edit ${notification.title}`}
                      onClick={() => {
                        setEditing(notification);
                        setEditorOpen(true);
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete">
                    <IconButton size="small" aria-label={`Delete ${notification.title}`} onClick={() => void handleDelete(notification)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </>
              )}
            </Box>
          );
        },
      },
    ],
    [completeNotification, dismissNotification, handleDelete, snoozeNotification]
  );

  const lastScanText = view.preferences.lastScanAt ? new Date(view.preferences.lastScanAt).toLocaleString() : 'never';

  return (
    <Box sx={{ flexGrow: 1, p: { xs: 2, sm: 3 } }} data-testid="notifications-page">
      <Box display="flex" alignItems="flex-start" justifyContent="space-between" flexWrap="wrap" gap={2} mb={2}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            Notifications
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Reminders you create and alerts about payments and budgets. Last scan: {lastScanText}.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            variant="outlined"
            startIcon={view.scanning ? <CircularProgress size={18} color="inherit" /> : <ScanIcon />}
            onClick={() => requestNotificationRescan()}
            disabled={view.scanning || !view.ready}
            data-testid="notifications-rescan"
          >
            {view.scanning ? 'Scanning…' : 'Rescan'}
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
            data-testid="notifications-new-reminder"
          >
            New reminder
          </Button>
        </Stack>
      </Box>

      {!view.preferences.enabled && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Notifications are turned off in Settings. Existing rows are listed here, but nothing new is scanned or counted.
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {view.lastError && !error && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          {view.lastError}
        </Alert>
      )}

      <Paper sx={{ p: { xs: 1, sm: 2 } }}>
        <Tabs value={tab} onChange={(_, value: NotificationBucket) => setTab(value)} sx={{ mb: 1 }}>
          {TABS.map((entry) => (
            <Tab
              key={entry.id}
              value={entry.id}
              label={`${entry.label} (${byBucket[entry.id].length})`}
              data-testid={`notifications-tab-${entry.id}`}
            />
          ))}
        </Tabs>

        {notifications.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 2 }} data-testid="notifications-empty">
            No notifications yet.
          </Typography>
        ) : (
          <AppDataGrid
            rows={rows}
            columns={columns}
            getRowId={(row) => row.notification.id}
            height={Math.min(Math.max(rows.length, 3) * 56 + 120, 640)}
            hideFooter={rows.length <= 25}
            emptyMessage={TABS.find((entry) => entry.id === tab)?.empty}
            disableVirtualization={process.env.NODE_ENV === 'test'}
            data-testid={`notifications-grid-${tab}`}
          />
        )}
      </Paper>

      <ReminderEditorDialog
        open={editorOpen}
        reminder={editing}
        settings={view.settings}
        categories={categories}
        recurringSeries={recurringSeries}
        onClose={() => setEditorOpen(false)}
        onSave={handleSave}
      />

      <Snackbar open={toast !== null} autoHideDuration={4000} onClose={() => setToast(null)} message={toast ?? ''} />
    </Box>
  );
}
