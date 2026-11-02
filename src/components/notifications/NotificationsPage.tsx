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
import { useTranslation } from 'react-i18next';

import { AppDataGrid } from '@/components/common/DataGrid/AppDataGrid';
import { useNotificationsPageSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { classifyNotifications, compareByOccurrence } from '@/lib/notificationService';
import type { AppNotification, AppNotificationInput } from '@/types/database';
import type { ClassifiedNotification, NotificationBucket } from '@/types/notifications';
import NotificationRowActions from './NotificationRowActions';
import ReminderEditorDialog from './ReminderEditorDialog';
import {
  describeNotification,
  describeTiming,
  recurrenceLabel,
  statusLabel,
  timingColor,
  typeChipColor,
  typeLabel,
} from './notificationPresentation';
import { requestNotificationRescan, useNotificationsView } from './notificationsStore';

const TABS: Array<{ id: NotificationBucket; label: 'page.tabDue' | 'page.tabUpcoming' | 'page.tabHistory'; empty: 'page.emptyDue' | 'page.emptyUpcoming' | 'page.emptyHistory' }> = [
  { id: 'due', label: 'page.tabDue', empty: 'page.emptyDue' },
  { id: 'upcoming', label: 'page.tabUpcoming', empty: 'page.emptyUpcoming' },
  { id: 'history', label: 'page.tabHistory', empty: 'page.emptyHistory' },
];

export default function NotificationsPage() {
  const { t } = useTranslation('notifications');
  const { money, date, month, dateTime } = useFormatters();
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
        setToast(t('page.reminderCreated'));
      } else {
        await updateNotification(existingId, input);
        setToast(t('page.reminderUpdated'));
      }
    },
    [createNotification, t, updateNotification]
  );

  const handleDelete = useCallback(
    async (notification: AppNotification) => {
      try {
        await deleteNotification(notification.id);
        setToast(t('page.reminderDeleted'));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('page.deleteFailed'));
      }
    },
    [deleteNotification, t]
  );

  const columns = useMemo<GridColDef<ClassifiedNotification>[]>(() => {
    const describe = (notification: AppNotification) =>
      describeNotification(notification, t, (amount) => money(amount), { date, month, today: view.today });
    return [
      {
        field: 'type',
        headerName: t('page.columnType'),
        width: 150,
        valueGetter: (_, row) => typeLabel(row.notification.type, t),
        renderCell: (params) => (
          <Chip
            size="small"
            label={typeLabel(params.row.notification.type, t)}
            color={typeChipColor(params.row.notification)}
            variant={params.row.notification.kind === 'alert' ? 'filled' : 'outlined'}
          />
        ),
      },
      {
        field: 'title',
        headerName: t('page.columnTitle'),
        flex: 1.6,
        minWidth: 220,
        valueGetter: (_, row) => describe(row.notification).title,
        renderCell: (params) => {
          const text = describe(params.row.notification);
          return (
            <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', height: '100%', minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600} noWrap title={text.title}>
                {text.title}
              </Typography>
              {text.body && (
                <Typography variant="caption" color="text.secondary" noWrap title={text.body}>
                  {text.body}
                </Typography>
              )}
            </Box>
          );
        },
      },
      {
        field: 'occurrence',
        headerName: t('page.columnWhen'),
        width: 210,
        valueGetter: (_, row) => row.occurrence ?? '',
        renderCell: (params) => (
          <Box display="flex" alignItems="center" gap={1}>
            <Typography variant="body2">{params.row.occurrence ? date(params.row.occurrence) : '—'}</Typography>
            {params.row.bucket !== 'history' && (
              <Chip size="small" label={describeTiming(params.row, t, date)} color={timingColor(params.row)} variant="outlined" />
            )}
          </Box>
        ),
      },
      {
        field: 'recurrence',
        headerName: t('page.columnRepeats'),
        width: 110,
        valueGetter: (_, row) => recurrenceLabel(row.notification.recurrence, t),
      },
      {
        field: 'status',
        headerName: t('page.columnStatus'),
        width: 110,
        valueGetter: (_, row) => statusLabel(row.notification.status, t),
      },
      {
        field: 'actions',
        headerName: t('page.columnActions'),
        width: 220,
        align: 'right',
        headerAlign: 'right',
        sortable: false,
        filterable: false,
        renderCell: (params) => {
          const { notification } = params.row;
          const text = describe(notification);
          return (
            <Box display="flex" justifyContent="flex-end" alignItems="center">
              {params.row.bucket !== 'history' && (
                <NotificationRowActions
                  notification={notification}
                  title={text.title}
                  onComplete={completeNotification}
                  onSnooze={snoozeNotification}
                  onDismiss={dismissNotification}
                  onError={setError}
                />
              )}
              {notification.source === 'user' && (
                <>
                  <Tooltip title={t('page.edit')}>
                    <IconButton
                      size="small"
                      aria-label={t('page.editAria', { title: text.title })}
                      onClick={() => {
                        setEditing(notification);
                        setEditorOpen(true);
                      }}
                    >
                      <EditIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('page.delete')}>
                    <IconButton size="small" aria-label={t('page.deleteAria', { title: text.title })} onClick={() => void handleDelete(notification)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </>
              )}
            </Box>
          );
        },
      },
    ];
  }, [completeNotification, date, dismissNotification, handleDelete, money, month, snoozeNotification, t, view.today]);

  const lastScanText = view.preferences.lastScanAt ? dateTime(view.preferences.lastScanAt) : t('page.lastScanNever');

  return (
    <Box sx={{ flexGrow: 1, p: { xs: 2, sm: 3 } }} data-testid="notifications-page">
      <Box display="flex" alignItems="flex-start" justifyContent="space-between" flexWrap="wrap" gap={2} mb={2}>
        <Box>
          <Typography variant="h4" component="h1" gutterBottom>
            {t('page.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('page.subtitle', { lastScan: lastScanText })}
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
            {view.scanning ? t('page.scanning') : t('page.rescan')}
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
            {t('page.newReminder')}
          </Button>
        </Stack>
      </Box>

      {!view.preferences.enabled && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('page.disabledInfo')}
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
              label={t('page.tabLabel', { label: t(entry.label), n: byBucket[entry.id].length })}
              data-testid={`notifications-tab-${entry.id}`}
            />
          ))}
        </Tabs>

        {notifications.length === 0 ? (
          <Typography color="text.secondary" sx={{ p: 2 }} data-testid="notifications-empty">
            {t('page.empty')}
          </Typography>
        ) : (
          <AppDataGrid
            rows={rows}
            columns={columns}
            getRowId={(row) => row.notification.id}
            height={Math.min(Math.max(rows.length, 3) * 56 + 120, 640)}
            hideFooter={rows.length <= 25}
            emptyMessage={t(TABS.find((entry) => entry.id === tab)?.empty ?? 'page.emptyDue')}
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
