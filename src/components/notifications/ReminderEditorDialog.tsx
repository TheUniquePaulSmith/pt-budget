'use client';

/**
 * Create / edit a user reminder: type, title, notes, date, recurrence, lead
 * override, optional link to a recurring series or budget category.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';

import { isDateOnly, todayLocalISO } from '@/lib/dateOnly';
import { resolveLeadDays } from '@/lib/notificationService';
import type { AppNotification, AppNotificationInput, Category, NotificationRecurrence, NotificationSetting, RecurringSeries } from '@/types/database';
import { REMINDER_TYPES, type ReminderType } from '@/types/notifications';
import { NOTIFICATION_TYPE_LABELS, RECURRENCE_LABELS } from './notificationPresentation';

export interface ReminderEditorDialogProps {
  open: boolean;
  /** Existing reminder to edit; null creates a new one. */
  reminder: AppNotification | null;
  settings: NotificationSetting[];
  categories: Category[];
  recurringSeries: RecurringSeries[];
  onClose: () => void;
  onSave: (input: AppNotificationInput, existingId: number | null) => Promise<void>;
}

type LinkKind = 'none' | 'recurring_series' | 'categories';

const DEFAULT_RECURRENCE: Record<ReminderType, NotificationRecurrence> = {
  birthday: 'yearly',
  anniversary: 'yearly',
  seasonal: 'yearly',
  custom: 'once',
};

export default function ReminderEditorDialog({
  open,
  reminder,
  settings,
  categories,
  recurringSeries,
  onClose,
  onSave,
}: ReminderEditorDialogProps) {
  const [type, setType] = useState<ReminderType>('custom');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dueDate, setDueDate] = useState(todayLocalISO());
  const [recurrence, setRecurrence] = useState<NotificationRecurrence>('once');
  const [overrideLead, setOverrideLead] = useState(false);
  const [leadDays, setLeadDays] = useState('7');
  const [linkKind, setLinkKind] = useState<LinkKind>('none');
  const [linkId, setLinkId] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (reminder) {
      setType((REMINDER_TYPES.includes(reminder.type as ReminderType) ? reminder.type : 'custom') as ReminderType);
      setTitle(reminder.title);
      setBody(reminder.body ?? '');
      setDueDate(reminder.due_date ?? todayLocalISO());
      setRecurrence(reminder.recurrence);
      setOverrideLead(reminder.lead_days != null);
      setLeadDays(String(reminder.lead_days ?? resolveLeadDays(reminder, settings)));
      const kind: LinkKind =
        reminder.entity_table === 'recurring_series' || reminder.entity_table === 'categories' ? reminder.entity_table : 'none';
      setLinkKind(kind);
      setLinkId(reminder.entity_id != null ? String(reminder.entity_id) : '');
    } else {
      setType('custom');
      setTitle('');
      setBody('');
      setDueDate(todayLocalISO());
      setRecurrence('once');
      setOverrideLead(false);
      setLeadDays(String(resolveLeadDays({ type: 'custom', lead_days: null }, settings)));
      setLinkKind('none');
      setLinkId('');
    }
  }, [open, reminder, settings]);

  const defaultLead = useMemo(() => resolveLeadDays({ type, lead_days: null }, settings), [settings, type]);

  const handleTypeChange = (next: ReminderType) => {
    setType(next);
    if (!reminder) setRecurrence(DEFAULT_RECURRENCE[next]);
    if (!overrideLead) setLeadDays(String(resolveLeadDays({ type: next, lead_days: null }, settings)));
  };

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!isDateOnly(dueDate)) {
      setError('Enter a valid date');
      return;
    }
    const parsedLead = overrideLead ? Number(leadDays) : null;
    if (parsedLead !== null && (!Number.isInteger(parsedLead) || parsedLead < 0 || parsedLead > 365)) {
      setError('Lead time must be a whole number of days between 0 and 365');
      return;
    }
    const entityId = linkKind === 'none' || linkId === '' ? null : Number(linkId);

    setSaving(true);
    setError(null);
    try {
      await onSave(
        {
          kind: 'reminder',
          type,
          title: title.trim(),
          body: body.trim() || null,
          due_date: dueDate,
          recurrence,
          lead_days: parsedLead,
          status: reminder?.status === 'snoozed' ? 'snoozed' : 'active',
          snoozed_until: reminder?.status === 'snoozed' ? reminder.snoozed_until : null,
          source: 'user',
          dedupe_key: reminder?.dedupe_key ?? null,
          entity_table: entityId === null ? null : linkKind,
          entity_id: entityId,
          payload_json: reminder?.payload_json ?? null,
        },
        reminder?.id ?? null
      );
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save reminder');
    } finally {
      setSaving(false);
    }
  };

  const linkOptions =
    linkKind === 'recurring_series'
      ? recurringSeries.filter((series) => series.status === 'active' || series.id === Number(linkId)).map((series) => ({ id: series.id, label: series.name }))
      : linkKind === 'categories'
        ? categories.map((category) => ({ id: category.id, label: category.name }))
        : [];

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="reminder-editor-title">
      <DialogTitle id="reminder-editor-title">{reminder ? 'Edit reminder' : 'New reminder'}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Box display="flex" flexWrap="wrap" gap={2} mt={1}>
          <TextField
            select
            label="Type"
            value={type}
            onChange={(event) => handleTypeChange(event.target.value as ReminderType)}
            size="small"
            sx={{ flex: '1 1 160px' }}
            data-testid="reminder-type"
          >
            {REMINDER_TYPES.map((option) => (
              <MenuItem key={option} value={option}>
                {NOTIFICATION_TYPE_LABELS[option]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            size="small"
            required
            sx={{ flex: '2 1 240px' }}
            slotProps={{ htmlInput: { 'data-testid': 'reminder-title' } }}
          />
          <TextField
            label="Date"
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            size="small"
            sx={{ flex: '1 1 160px' }}
            slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'data-testid': 'reminder-date' } }}
          />
          <TextField
            select
            label="Repeats"
            value={recurrence}
            onChange={(event) => setRecurrence(event.target.value as NotificationRecurrence)}
            size="small"
            sx={{ flex: '1 1 160px' }}
          >
            {(Object.keys(RECURRENCE_LABELS) as NotificationRecurrence[]).map((option) => (
              <MenuItem key={option} value={option}>
                {RECURRENCE_LABELS[option]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Notes"
            value={body}
            onChange={(event) => setBody(event.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={2}
          />
          <Box sx={{ flex: '1 1 100%', display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <FormControlLabel
              control={<Switch checked={overrideLead} onChange={(event) => setOverrideLead(event.target.checked)} data-testid="reminder-lead-override" />}
              label="Custom lead time"
            />
            {overrideLead ? (
              <TextField
                label="Remind me (days before)"
                type="number"
                value={leadDays}
                onChange={(event) => setLeadDays(event.target.value)}
                size="small"
                sx={{ width: 220 }}
                slotProps={{ htmlInput: { min: 0, max: 365, 'data-testid': 'reminder-lead-days' } }}
              />
            ) : (
              <Typography variant="body2" color="text.secondary">
                Uses the {NOTIFICATION_TYPE_LABELS[type].toLowerCase()} default: {defaultLead} day{defaultLead === 1 ? '' : 's'} before.
              </Typography>
            )}
          </Box>
          <TextField
            select
            label="Link to"
            value={linkKind}
            onChange={(event) => {
              setLinkKind(event.target.value as LinkKind);
              setLinkId('');
            }}
            size="small"
            sx={{ flex: '1 1 160px' }}
          >
            <MenuItem value="none">Nothing</MenuItem>
            <MenuItem value="recurring_series">Subscription or bill</MenuItem>
            <MenuItem value="categories">Budget category</MenuItem>
          </TextField>
          {linkKind !== 'none' && (
            <TextField
              select
              label={linkKind === 'categories' ? 'Category' : 'Series'}
              value={linkId}
              onChange={(event) => setLinkId(event.target.value)}
              size="small"
              sx={{ flex: '2 1 240px' }}
            >
              <MenuItem value="">—</MenuItem>
              {linkOptions.map((option) => (
                <MenuItem key={option.id} value={String(option.id)}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving} data-testid="reminder-save">
          {saving ? 'Saving…' : reminder ? 'Save' : 'Create reminder'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
