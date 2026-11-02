'use client';

import React, { useEffect, useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Alert,
  IconButton,
  Tooltip,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  FlightTakeoff as TripIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useBudgetFundsSlice, useTripsSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { Trip } from '@/types/database';
import type { BudgetFundStatus } from '@/types/budgetCarry';
import { currentMonthKey } from '@/lib/budgetCarry';
import { logger } from '@/lib/logging';
import {
  EMPTY_BUDGET_FUND_FORM,
  budgetFundColumnsFromForm,
  budgetFundFormFromEntity,
  type BudgetFundFormValue,
} from '@/components/budget/BudgetFundFields';
import { BudgetFundSummary } from '@/components/budget/BudgetFundSummary';
import { TripBudgetFields } from './TripBudgetFields';

const log = logger.child({ component: 'ManageTrips' });

// Values and ordering only; labels resolve through `trips:category.*` /
// `trips:status.*` at render time.
const TRIP_CATEGORIES: ReadonlyArray<Trip['trip_category']> = ['business', 'vacation', 'family', 'medical', 'education', 'other'];
const TRIP_STATUSES: ReadonlyArray<Trip['status']> = ['planning', 'in_progress', 'completed', 'cancelled'];

export default function ManageTrips() {
  const { t } = useTranslation(['trips', 'common']);
  // Trip costs are in the default currency.
  const { money } = useFormatters();
  const {
    trips, 
    addTrip, 
    updateTrip,
    deleteTrip, 
  } = useTripsSlice();
  const { categories, budgetVersion, transactionVersion, getFundStatus } = useBudgetFundsSlice();
  
  const [tripDialogOpen, setTripDialogOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tripToDelete, setTripToDelete] = useState<Trip | null>(null);
  const [fundStatus, setFundStatus] = useState<Record<number, BudgetFundStatus>>({});

  // Savings-fund balances for linked trips, as of the current month
  useEffect(() => {
    let cancelled = false;
    getFundStatus(currentMonthKey()).then((funds) => {
      if (cancelled) return;
      const map: Record<number, BudgetFundStatus> = {};
      for (const fund of funds) {
        if (fund.entity_type === 'trip') map[fund.entity_id] = fund;
      }
      setFundStatus(map);
    }).catch((error) => {
      log.error('Failed to load trip fund status', { operation: 'loadTripFunds', error });
    });
    return () => { cancelled = true; };
  }, [trips, transactionVersion, budgetVersion, getFundStatus]);
  
  const [tripFormData, setTripFormData] = useState({
    name: '',
    destination: '',
    purpose: '',
    trip_category: 'vacation' as Trip['trip_category'],
    status: 'planning' as Trip['status'],
    start_date: '',
    end_date: '',
    estimated_cost: '',
    notes: '',
    fund: EMPTY_BUDGET_FUND_FORM as BudgetFundFormValue,
  });

  const handleOpenTripDialog = (trip?: Trip) => {
    if (trip) {
      setEditingTrip(trip);
      setTripFormData({
        name: trip.name,
        destination: trip.destination || '',
        purpose: trip.purpose || '',
        trip_category: trip.trip_category,
        status: trip.status,
        start_date: trip.start_date || '',
        end_date: trip.end_date || '',
        estimated_cost: trip.estimated_cost?.toString() || '',
        notes: trip.notes || '',
        fund: budgetFundFormFromEntity(trip),
      });
    } else {
      setEditingTrip(null);
      setTripFormData({
        name: '',
        destination: '',
        purpose: '',
        trip_category: 'vacation',
        status: 'planning',
        start_date: '',
        end_date: '',
        estimated_cost: '',
        notes: '',
        fund: EMPTY_BUDGET_FUND_FORM,
      });
    }
    setError(null);
    setTripDialogOpen(true);
  };

  const handleCloseTripDialog = () => {
    setTripDialogOpen(false);
    setEditingTrip(null);
    setError(null);
  };

  const handleTripSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!tripFormData.name.trim()) {
        throw new Error(t('manage.nameRequired'));
      }

      const tripData = {
        name: tripFormData.name,
        destination: tripFormData.destination || null,
        purpose: tripFormData.purpose || null,
        trip_category: tripFormData.trip_category,
        status: tripFormData.status,
        start_date: tripFormData.start_date || null,
        end_date: tripFormData.end_date || null,
        estimated_cost: tripFormData.estimated_cost ? parseFloat(tripFormData.estimated_cost) : null,
        actual_cost: null,
        notes: tripFormData.notes || null,
        ...budgetFundColumnsFromForm(tripFormData.fund),
      };

      if (editingTrip) {
        await updateTrip(editingTrip.id, tripData);
      } else {
        await addTrip(tripData);
      }

      handleCloseTripDialog();
    } catch (error) {
      setError(error instanceof Error ? error.message : t('manage.saveFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (trip: Trip) => {
    setTripToDelete(trip);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!tripToDelete) return;

    setLoading(true);
    setError(null);

    try {
      await deleteTrip(tripToDelete.id);
      setDeleteDialogOpen(false);
      setTripToDelete(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('manage.deleteFailed'));
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: Trip['status']) => {
    switch (status) {
      case 'planning': return 'info';
      case 'in_progress': return 'warning';
      case 'completed': return 'success';
      case 'cancelled': return 'error';
      default: return 'default';
    }
  };

  const getCategoryLabel = (category: Trip['trip_category']) => t(`category.${category}`);
  const getStatusLabel = (status: Trip['status']) => t(`status.${status}`);

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" fontWeight="bold">
          {t('manage.title')}
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenTripDialog()}
          sx={{ minWidth: 120 }}
        >
          {t('manage.addTrip')}
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Box 
        sx={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', 
          gap: 3 
        }}
      >
        {trips.map((trip) => (
          <Card key={trip.id}>
              <CardContent>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Typography variant="h6" component="h2" fontWeight="bold">
                    {trip.name}
                  </Typography>
                  <Box>
                    <Tooltip title={t('manage.editTrip')}>
                      <IconButton size="small" onClick={() => handleOpenTripDialog(trip)}>
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('manage.deleteTrip')}>
                      <IconButton size="small" onClick={() => handleDeleteClick(trip)}>
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                {trip.destination && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    <strong>{t('manage.destination')}</strong> {trip.destination}
                  </Typography>
                )}

                {trip.purpose && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    <strong>{t('manage.purpose')}</strong> {trip.purpose}
                  </Typography>
                )}

                <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                  <Chip
                    label={getStatusLabel(trip.status)}
                    color={getStatusColor(trip.status) as any}
                    size="small"
                  />
                  <Chip 
                    label={getCategoryLabel(trip.trip_category)} 
                    variant="outlined"
                    size="small"
                  />
                </Box>

                {(trip.start_date || trip.end_date) && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    <strong>{t('manage.dates')}</strong>{' '}
                    {t('manage.dateRange', { start: trip.start_date || t('manage.tbd'), end: trip.end_date || t('manage.tbd') })}
                  </Typography>
                )}

                {trip.estimated_cost && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: fundStatus[trip.id] ? 1.5 : 0 }}>
                    <strong>{t('manage.estimatedCost')}</strong> {money(trip.estimated_cost)}
                  </Typography>
                )}

                {fundStatus[trip.id] && <BudgetFundSummary fund={fundStatus[trip.id]} />}
              </CardContent>
            </Card>
        ))}
      </Box>

      {trips.length === 0 && (
        <Card>
          <CardContent>
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <TripIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
              <Typography variant="h6" color="text.secondary" gutterBottom>
                {t('manage.emptyTitle')}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                {t('manage.emptyHelp')}
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => handleOpenTripDialog()}
              >
                {t('manage.addFirstTrip')}
              </Button>
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Trip Dialog */}
      <Dialog 
        open={tripDialogOpen} 
        onClose={handleCloseTripDialog}
        maxWidth="md"
        fullWidth
      >
        <form onSubmit={handleTripSubmit}>
          <DialogTitle>
            {editingTrip ? t('manage.editTrip') : t('manage.addTitle')}
          </DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <TextField
                fullWidth
                label={t('manage.tripName')}
                value={tripFormData.name}
                onChange={(e) => setTripFormData({ ...tripFormData, name: e.target.value })}
                required
              />
              
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  fullWidth
                  label={t('manage.destinationField')}
                  value={tripFormData.destination}
                  onChange={(e) => setTripFormData({ ...tripFormData, destination: e.target.value })}
                />

                <TextField
                  fullWidth
                  label={t('manage.purposeField')}
                  value={tripFormData.purpose}
                  onChange={(e) => setTripFormData({ ...tripFormData, purpose: e.target.value })}
                />
              </Box>

              <Box sx={{ display: 'flex', gap: 2 }}>
                <FormControl fullWidth>
                  <InputLabel>{t('common:fields.category')}</InputLabel>
                  <Select
                    value={tripFormData.trip_category}
                    label={t('common:fields.category')}
                    onChange={(e) => setTripFormData({ ...tripFormData, trip_category: e.target.value as Trip['trip_category'] })}
                  >
                    {TRIP_CATEGORIES.map((value) => (
                      <MenuItem key={value} value={value}>{t(`category.${value}`)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel>{t('common:fields.status')}</InputLabel>
                  <Select
                    value={tripFormData.status}
                    label={t('common:fields.status')}
                    onChange={(e) => setTripFormData({ ...tripFormData, status: e.target.value as Trip['status'] })}
                  >
                    {TRIP_STATUSES.map((value) => (
                      <MenuItem key={value} value={value}>{t(`statusOption.${value}`)}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  fullWidth
                  label={t('manage.startDate')}
                  type="date"
                  value={tripFormData.start_date}
                  onChange={(e) => setTripFormData({ ...tripFormData, start_date: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />

                <TextField
                  fullWidth
                  label={t('manage.endDate')}
                  type="date"
                  value={tripFormData.end_date}
                  onChange={(e) => setTripFormData({ ...tripFormData, end_date: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />
              </Box>

              <TextField
                fullWidth
                label={t('manage.estimatedCostField')}
                type="number"
                value={tripFormData.estimated_cost}
                onChange={(e) => setTripFormData({ ...tripFormData, estimated_cost: e.target.value })}
                inputProps={{ step: '0.01', min: '0' }}
              />

              <TextField
                fullWidth
                label={t('common:fields.notes')}
                multiline
                rows={3}
                value={tripFormData.notes}
                onChange={(e) => setTripFormData({ ...tripFormData, notes: e.target.value })}
              />

              <TripBudgetFields
                categories={categories}
                value={tripFormData.fund}
                onChange={(fund) => setTripFormData({ ...tripFormData, fund })}
                startDate={tripFormData.start_date}
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseTripDialog}>{t('common:actions.cancel')}</Button>
            <Button type="submit" variant="contained" disabled={loading}>
              {loading ? t('manage.saving') : editingTrip ? t('common:actions.update') : t('common:actions.add')}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>{t('manage.deleteTrip')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('manage.deleteConfirm', { name: tripToDelete?.name ?? '' })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('common:actions.cancel')}</Button>
          <Button onClick={handleDeleteConfirm} color="error" disabled={loading}>
            {loading ? t('manage.deleting') : t('common:actions.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}