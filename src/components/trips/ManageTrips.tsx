'use client';

import React, { useState } from 'react';
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
import { useTripsSlice } from '@/contexts/useDatabaseSlices';
import { Trip } from '@/types/database';

export default function ManageTrips() {
  const { 
    trips, 
    addTrip, 
    updateTrip,
    deleteTrip, 
  } = useTripsSlice();
  
  const [tripDialogOpen, setTripDialogOpen] = useState(false);
  const [editingTrip, setEditingTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [tripToDelete, setTripToDelete] = useState<Trip | null>(null);
  
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
        throw new Error('Trip name is required');
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
      };

      if (editingTrip) {
        await updateTrip(editingTrip.id, tripData);
      } else {
        await addTrip(tripData);
      }

      handleCloseTripDialog();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save trip');
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
      setError(error instanceof Error ? error.message : 'Failed to delete trip');
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

  const getCategoryLabel = (category: Trip['trip_category']) => {
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" fontWeight="bold">
          Manage Trips
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenTripDialog()}
          sx={{ minWidth: 120 }}
        >
          Add Trip
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
                    <Tooltip title="Edit Trip">
                      <IconButton size="small" onClick={() => handleOpenTripDialog(trip)}>
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete Trip">
                      <IconButton size="small" onClick={() => handleDeleteClick(trip)}>
                        <DeleteIcon />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>

                {trip.destination && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    <strong>Destination:</strong> {trip.destination}
                  </Typography>
                )}

                {trip.purpose && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    <strong>Purpose:</strong> {trip.purpose}
                  </Typography>
                )}

                <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                  <Chip 
                    label={trip.status.charAt(0).toUpperCase() + trip.status.slice(1).replace('_', ' ')} 
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
                    <strong>Dates:</strong> {trip.start_date || 'TBD'} - {trip.end_date || 'TBD'}
                  </Typography>
                )}

                {trip.estimated_cost && (
                  <Typography variant="body2" color="text.secondary">
                    <strong>Estimated Cost:</strong> ${trip.estimated_cost.toFixed(2)}
                  </Typography>
                )}
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
                No trips found
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                Create your first trip to start tracking travel expenses
              </Typography>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => handleOpenTripDialog()}
              >
                Add Your First Trip
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
            {editingTrip ? 'Edit Trip' : 'Add New Trip'}
          </DialogTitle>
          <DialogContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <TextField
                fullWidth
                label="Trip Name"
                value={tripFormData.name}
                onChange={(e) => setTripFormData({ ...tripFormData, name: e.target.value })}
                required
              />
              
              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  fullWidth
                  label="Destination"
                  value={tripFormData.destination}
                  onChange={(e) => setTripFormData({ ...tripFormData, destination: e.target.value })}
                />
                
                <TextField
                  fullWidth
                  label="Purpose"
                  value={tripFormData.purpose}
                  onChange={(e) => setTripFormData({ ...tripFormData, purpose: e.target.value })}
                />
              </Box>

              <Box sx={{ display: 'flex', gap: 2 }}>
                <FormControl fullWidth>
                  <InputLabel>Category</InputLabel>
                  <Select
                    value={tripFormData.trip_category}
                    label="Category"
                    onChange={(e) => setTripFormData({ ...tripFormData, trip_category: e.target.value as Trip['trip_category'] })}
                  >
                    <MenuItem value="business">Business</MenuItem>
                    <MenuItem value="vacation">Vacation</MenuItem>
                    <MenuItem value="family">Family</MenuItem>
                    <MenuItem value="medical">Medical</MenuItem>
                    <MenuItem value="education">Education</MenuItem>
                    <MenuItem value="other">Other</MenuItem>
                  </Select>
                </FormControl>

                <FormControl fullWidth>
                  <InputLabel>Status</InputLabel>
                  <Select
                    value={tripFormData.status}
                    label="Status"
                    onChange={(e) => setTripFormData({ ...tripFormData, status: e.target.value as Trip['status'] })}
                  >
                    <MenuItem value="planning">Planning</MenuItem>
                    <MenuItem value="in_progress">In Progress</MenuItem>
                    <MenuItem value="completed">Completed</MenuItem>
                    <MenuItem value="cancelled">Cancelled</MenuItem>
                  </Select>
                </FormControl>
              </Box>

              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  fullWidth
                  label="Start Date"
                  type="date"
                  value={tripFormData.start_date}
                  onChange={(e) => setTripFormData({ ...tripFormData, start_date: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />

                <TextField
                  fullWidth
                  label="End Date"
                  type="date"
                  value={tripFormData.end_date}
                  onChange={(e) => setTripFormData({ ...tripFormData, end_date: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                />
              </Box>

              <TextField
                fullWidth
                label="Estimated Cost"
                type="number"
                value={tripFormData.estimated_cost}
                onChange={(e) => setTripFormData({ ...tripFormData, estimated_cost: e.target.value })}
                inputProps={{ step: '0.01', min: '0' }}
              />

              <TextField
                fullWidth
                label="Notes"
                multiline
                rows={3}
                value={tripFormData.notes}
                onChange={(e) => setTripFormData({ ...tripFormData, notes: e.target.value })}
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseTripDialog}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={loading}>
              {loading ? 'Saving...' : editingTrip ? 'Update' : 'Add'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Trip</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete &quot;{tripToDelete?.name}&quot;? This action cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" disabled={loading}>
            {loading ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}