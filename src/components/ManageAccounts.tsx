'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Chip,
  Alert,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  AccountBalance as AccountIcon,
} from '@mui/icons-material';
import { useDatabaseContext } from '@/contexts/DatabaseContext';
import { Account } from '@/types/database';

export default function ManageAccounts() {
  const { accounts, addAccount, deleteAccount, refreshAccounts } = useDatabaseContext();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    last_four: '',
    type: 'checking' as 'checking' | 'savings' | 'credit',
  });

  // Refresh accounts when component mounts or when database loads
  useEffect(() => {
    refreshAccounts();
  }, [refreshAccounts]);

  const handleOpenDialog = (account?: Account) => {
    if (account) {
      setEditingAccount(account);
      setFormData({
        name: account.name,
        last_four: account.last_four,
        type: account.type as 'checking' | 'savings' | 'credit',
      });
    } else {
      setEditingAccount(null);
      setFormData({
        name: '',
        last_four: '',
        type: 'checking',
      });
    }
    setError(null);
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setEditingAccount(null);
    setFormData({
      name: '',
      last_four: '',
      type: 'checking',
    });
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Validate form data
      if (!formData.name.trim()) {
        throw new Error('Account name is required');
      }
      if (!formData.last_four.trim()) {
        throw new Error('Last 4 digits are required');
      }
      if (formData.last_four.length !== 4 || !/^\d{4}$/.test(formData.last_four)) {
        throw new Error('Last 4 digits must be exactly 4 numbers');
      }

      // Check for duplicate last_four (excluding current account when editing)
      const existingAccount = accounts.find(acc => 
        acc.last_four === formData.last_four && 
        (!editingAccount || acc.id !== editingAccount.id)
      );
      if (existingAccount) {
        throw new Error('An account with these last 4 digits already exists');
      }

      if (editingAccount) {
        // TODO: Implement account editing when needed
        throw new Error('Account editing not yet implemented');
      } else {
        await addAccount({
          name: formData.name.trim(),
          last_four: formData.last_four,
          type: formData.type,
        });
      }

      await refreshAccounts();
      handleCloseDialog();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (account: Account) => {
    setAccountToDelete(account);
    setError(null); // Clear any previous errors
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!accountToDelete) return;

    setLoading(true);
    setError(null);

    try {
      await deleteAccount(accountToDelete.id);
      setDeleteDialogOpen(false);
      setAccountToDelete(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to delete account');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setAccountToDelete(null);
  };

  const getAccountTypeColor = (type: string) => {
    switch (type) {
      case 'checking': return 'primary';
      case 'savings': return 'success';
      case 'credit': return 'warning';
      default: return 'default';
    }
  };

  const getAccountTypeLabel = (type: string) => {
    switch (type) {
      case 'checking': return 'Checking';
      case 'savings': return 'Savings';
      case 'credit': return 'Credit Card';
      default: return type;
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h4" component="h1" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AccountIcon />
          Manage Accounts
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
        >
          Add Account
        </Button>
      </Box>

      <Card>
        <CardContent>
          <Typography variant="h6" sx={{ mb: 2 }}>
            Account Overview
          </Typography>
          
          {accounts.length === 0 ? (
            <Box sx={{ textAlign: 'center', py: 4 }}>
              <Typography variant="body1" color="text.secondary" sx={{ mb: 2 }}>
                No accounts found. Add your first account to get started.
              </Typography>
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => handleOpenDialog()}
              >
                Add First Account
              </Button>
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Account Name</TableCell>
                    <TableCell>Last 4 Digits</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Created</TableCell>
                    <TableCell align="right">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {accounts.map((account) => (
                    <TableRow key={account.id} hover>
                      <TableCell>
                        <Typography variant="body1" sx={{ fontWeight: 'medium' }}>
                          {account.name}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                          ••••{account.last_four}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={getAccountTypeLabel(account.type)}
                          color={getAccountTypeColor(account.type) as any}
                          size="small"
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" color="text.secondary">
                          {new Date(account.created_at).toLocaleDateString()}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <IconButton
                          size="small"
                          onClick={() => handleOpenDialog(account)}
                          title="Edit Account"
                        >
                          <EditIcon />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => handleDeleteClick(account)}
                          title="Delete Account"
                          color="error"
                        >
                          <DeleteIcon />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit Account Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingAccount ? 'Edit Account' : 'Add New Account'}
        </DialogTitle>
        <form onSubmit={handleSubmit}>
          <DialogContent>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
              {error && (
                <Alert severity="error">{error}</Alert>
              )}
              
              <TextField
                label="Account Name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                fullWidth
                helperText="Enter a friendly name for this account (e.g., 'Chase Checking', 'Savings Account')"
              />

              <TextField
                label="Last 4 Digits"
                value={formData.last_four}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setFormData({ ...formData, last_four: value });
                }}
                required
                fullWidth
                inputProps={{
                  maxLength: 4,
                  pattern: '[0-9]{4}',
                }}
                helperText="Enter the last 4 digits of the account number"
              />

              <FormControl fullWidth>
                <InputLabel>Account Type</InputLabel>
                <Select
                  value={formData.type}
                  label="Account Type"
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                >
                  <MenuItem value="checking">Checking Account</MenuItem>
                  <MenuItem value="savings">Savings Account</MenuItem>
                  <MenuItem value="credit">Credit Card</MenuItem>
                </Select>
              </FormControl>
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleCloseDialog}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={loading}>
              {loading ? 'Saving...' : editingAccount ? 'Update Account' : 'Add Account'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
        aria-labelledby="delete-confirmation-dialog-title"
        aria-describedby="delete-confirmation-dialog-description"
      >
        <DialogTitle id="delete-confirmation-dialog-title">
          Confirm Deletion
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
          )}
          {accountToDelete && (
            <Box>
              <Typography variant="body1" gutterBottom>
                Are you sure you want to delete the following account?
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>Name:</strong> {accountToDelete.name}
              </Typography>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>Last 4 digits:</strong> ••••{accountToDelete.last_four}
              </Typography>
              <Typography variant="body2" sx={{ mb: 2 }}>
                <strong>Type:</strong> {accountToDelete.type}
              </Typography>
              <Alert severity="warning">
                This action cannot be undone. If this account has linked transactions, 
                the deletion will fail to protect your data integrity.
              </Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} color="primary">
            Cancel
          </Button>
          <Button
            onClick={handleDeleteConfirm}
            color="secondary"
            variant="contained"
            disabled={loading}
          >
            {loading ? 'Deleting...' : 'Delete Account'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
