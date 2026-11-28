'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useTripDetailSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { logger } from '@/lib/logging';
import type { Trip } from '@/types/database';
import type { TripCandidateTransaction } from '@/types/tripExpenses';

import { tripExpenseErrorKey, tripSearchWindow } from './tripExpensePresentation';

const log = logger.child({ component: 'AddTripTransactionsDialog' });

export interface AddTripTransactionsDialogProps {
  trip: Trip;
  onClose: () => void;
}

/** Finds the charges around the trip's dates that are on no trip yet and adds the chosen ones. */
export default function AddTripTransactionsDialog({ trip, onClose }: AddTripTransactionsDialogProps) {
  const { t } = useTranslation(['trips', 'common']);
  const { money, date } = useFormatters();
  const { findTripCandidates, assignTransactionsToTrip } = useTripDetailSlice();
  const initialWindow = useMemo(() => tripSearchWindow(trip), [trip]);

  const [start, setStart] = useState(initialWindow.start);
  const [end, setEnd] = useState(initialWindow.end);
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<TripCandidateTransaction[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!start || !end) return;
    let cancelled = false;
    setCandidates(null);
    findTripCandidates(start, end)
      .then((found) => {
        if (!cancelled) setCandidates(found);
      })
      .catch((loadError) => {
        log.error('Failed to load trip candidates', { operation: 'loadTripCandidates', error: loadError });
        if (!cancelled) setCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [end, findTripCandidates, start]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!candidates) return [];
    if (!needle) return candidates;
    return candidates.filter((candidate) =>
      [candidate.description, candidate.category_name, candidate.company_name, candidate.user_name]
        .filter(Boolean)
        .some((text) => String(text).toLowerCase().includes(needle))
    );
  }, [candidates, search]);

  const toggle = (id: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allVisibleSelected = visible.length > 0 && visible.every((candidate) => selected.has(candidate.transaction_id));
  const toggleAllVisible = () =>
    setSelected((current) => {
      const next = new Set(current);
      for (const candidate of visible) {
        if (allVisibleSelected) next.delete(candidate.transaction_id);
        else next.add(candidate.transaction_id);
      }
      return next;
    });

  const onProject = (candidates ?? []).some((candidate) => selected.has(candidate.transaction_id) && candidate.project_id != null);

  const handleAdd = async () => {
    if (selected.size === 0) return;
    setSaving(true);
    setError(null);
    try {
      await assignTransactionsToTrip([...selected], trip.id);
      onClose();
    } catch (addError) {
      setError(t(tripExpenseErrorKey(addError)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('add.title', { name: trip.name })}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Typography variant="body2" color="text.secondary">
            {t('add.intro')}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label={t('add.from')}
              type="date"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label={t('add.to')}
              type="date"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
            <TextField
              label={t('common:actions.search')}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              inputProps={{ 'data-testid': 'trip-add-search' }}
              fullWidth
            />
          </Stack>

          {candidates === null ? (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
              <CircularProgress aria-label={t('detail.loading')} />
            </Box>
          ) : visible.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t('add.empty')}
            </Typography>
          ) : (
            <Box>
              <Button size="small" onClick={toggleAllVisible}>
                {allVisibleSelected ? t('common:actions.deselectAll') : t('common:actions.selectAll')}
              </Button>
              <List dense sx={{ maxHeight: 380, overflowY: 'auto' }} aria-label={t('add.listLabel')}>
                {visible.map((candidate) => {
                  const id = candidate.transaction_id;
                  const labelId = `trip-candidate-${id}`;
                  return (
                    <ListItem key={id} disablePadding>
                      <ListItemButton onClick={() => toggle(id)} dense>
                        <ListItemIcon sx={{ minWidth: 36 }}>
                          <Checkbox
                            edge="start"
                            checked={selected.has(id)}
                            tabIndex={-1}
                            disableRipple
                            inputProps={{ 'aria-labelledby': labelId }}
                          />
                        </ListItemIcon>
                        <ListItemText
                          id={labelId}
                          primary={candidate.description}
                          secondary={[
                            date(candidate.date),
                            candidate.user_name,
                            candidate.category_name,
                            candidate.project_id != null ? t('add.onProject') : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        />
                        <Typography
                          variant="body2"
                          fontWeight={600}
                          color={candidate.amount < 0 ? 'error.main' : 'success.main'}
                          sx={{ ml: 2, whiteSpace: 'nowrap' }}
                        >
                          {money(candidate.amount, candidate.account_currency)}
                        </Typography>
                      </ListItemButton>
                    </ListItem>
                  );
                })}
              </List>
            </Box>
          )}
          {onProject && <Alert severity="info">{t('add.clearsProject')}</Alert>}
          {trip.expense_mode === 'business' && <Alert severity="info">{t('add.businessDefault')}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button
          variant="contained"
          onClick={() => void handleAdd()}
          disabled={saving || selected.size === 0}
          data-testid="trip-add-confirm"
        >
          {t('add.confirm', { count: selected.size })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
