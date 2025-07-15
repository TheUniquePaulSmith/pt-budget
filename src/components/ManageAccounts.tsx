'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Button,
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
  Accordion,
  AccordionSummary,
  AccordionDetails,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  AccountBalance as AccountIcon,
  Person as PersonIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { useDatabaseContext } from '@/contexts/DatabaseContext';
import { Account, User } from '@/types/database';

export default function ManageAccounts() {
  const { 
    accounts, 
    users, 
    isDatabaseLoaded,
    addAccount, 
    deleteAccount, 
    refreshAccounts,
    addUser,
    updateUser,
    deleteUser,
    refreshUsers,
    getAccountsByUserId
  } = useDatabaseContext();
  
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ type: 'user' | 'account'; item: User | Account } | null>(null);
  
  const [userFormData, setUserFormData] = useState({
    display_name: '',
  });
  
  const [accountFormData, setAccountFormData] = useState({
    name: '',
    type: 'checking' as 'checking' | 'savings' | 'credit',
    last_four: '',
    user_id: '',
  });

  const loadingRef = useRef(false);

  useEffect(() => {
    if (isDatabaseLoaded && !loadingRef.current) {
      loadingRef.current = true;
      console.debug('Database loaded, refreshing accounts and users');
      const loadData = async () => {
        try {
          await refreshAccounts();
          await refreshUsers();
        } catch (error) {
          console.error('Error loading data:', error);
        } finally {
          loadingRef.current = false;
        }
      };
      loadData();
    }
  }, [isDatabaseLoaded, refreshAccounts, refreshUsers]);

  // User Dialog Handlers
  const handleOpenUserDialog = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setUserFormData({
        display_name: user.display_name,
      });
    } else {
      setEditingUser(null);
      setUserFormData({
        display_name: '',
      });
    }
    setError(null);
    setUserDialogOpen(true);
  };

  const handleCloseUserDialog = () => {
    setUserDialogOpen(false);
    setEditingUser(null);
    setUserFormData({
      display_name: '',
    });
    setError(null);
  };

  const handleUserSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!userFormData.display_name.trim()) {
        throw new Error('Display name is required');
      }

      if (editingUser) {
        await updateUser(editingUser.id, {
          display_name: userFormData.display_name,
        });
      } else {
        await addUser({
          display_name: userFormData.display_name,
        });
      }

      handleCloseUserDialog();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save user');
    } finally {
      setLoading(false);
    }
  };

  // Account Dialog Handlers
  const handleOpenAccountDialog = (account?: Account, selectedUserId?: string) => {
    if (account) {
      setEditingAccount(account);
      setAccountFormData({
        name: account.name,
        type: account.type,
        last_four: account.last_four,
        user_id: account.user_id,
      });
    } else {
      setEditingAccount(null);
      setAccountFormData({
        name: '',
        type: 'checking',
        last_four: '',
        user_id: selectedUserId || '',
      });
    }
    setError(null);
    setAccountDialogOpen(true);
  };

  const handleCloseAccountDialog = () => {
    setAccountDialogOpen(false);
    setEditingAccount(null);
    setAccountFormData({
      name: '',
      type: 'checking',
      last_four: '',
      user_id: '',
    });
    setError(null);
  };

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!accountFormData.name.trim()) {
        throw new Error('Account name is required');
      }
      if (!accountFormData.user_id) {
        throw new Error('User is required');
      }
      if (!accountFormData.last_four.trim()) {
        throw new Error('Last four digits are required');
      }
      if (accountFormData.last_four.length !== 4 || !/^\d{4}$/.test(accountFormData.last_four)) {
        throw new Error('Last four digits must be exactly 4 numbers');
      }

      // Check for duplicate last four digits
      const isDuplicateLastFour = accounts.some(acc =>
        acc.last_four === accountFormData.last_four &&
        acc.id !== editingAccount?.id
      );

      if (isDuplicateLastFour) {
        throw new Error('An account with these last four digits already exists');
      }

      if (editingAccount) {
        // Account editing is not implemented yet
        throw new Error('Account editing is not yet implemented');
      } else {
        await addAccount({
          name: accountFormData.name,
          type: accountFormData.type,
          last_four: accountFormData.last_four,
          user_id: accountFormData.user_id,
        });
      }

      handleCloseAccountDialog();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save account');
    } finally {
      setLoading(false);
    }
  };

  // Delete Handlers
  const handleDeleteClick = (type: 'user' | 'account', item: User | Account) => {
    setItemToDelete({ type, item });
    setError(null);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;

    setLoading(true);
    setError(null);

    try {
      if (itemToDelete.type === 'user') {
        await deleteUser(itemToDelete.item.id);
      } else {
        await deleteAccount(itemToDelete.item.id);
      }
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : `Failed to delete ${itemToDelete.type}`);
    } finally {
      setLoading(false);
    }
  };

  const getUserAccounts = (userId: string) => {
    return accounts.filter(account => account.user_id === userId);
  };

  const getUserById = (userId: string) => {
    return users.find(user => user.id === userId);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" fontWeight="bold">
          Manage Users & Accounts
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button
            variant="outlined"
            startIcon={<PersonIcon />}
            onClick={() => handleOpenUserDialog()}
            sx={{ minWidth: 120 }}
          >
            Add User
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleOpenAccountDialog()}
            sx={{ minWidth: 150 }}
          >
            Add Account
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Users and Their Accounts
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Each user can have multiple accounts. When importing CSV files, 
            transactions will be matched to accounts based on their last 4 digits.
          </Typography>

          {users.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              No users found. Add your first user to get started.
            </Typography>
          ) : (
            <Box>
              {users.map((user) => {
                const userAccounts = getUserAccounts(user.id);
                return (
                  <Accordion key={user.id} sx={{ mb: 1 }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                        <PersonIcon sx={{ mr: 2, color: 'primary.main' }} />
                        <Box sx={{ flexGrow: 1 }}>
                          <Typography variant="subtitle1" fontWeight="medium">
                            {user.display_name}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                            <Chip 
                              label={`${userAccounts.length} account${userAccounts.length !== 1 ? 's' : ''}`}
                              size="small"
                              variant="outlined"
                            />
                          </Box>
                        </Box>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="subtitle2">
                          Accounts
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Button
                            size="small"
                            startIcon={<AddIcon />}
                            onClick={() => handleOpenAccountDialog(undefined, user.id)}
                          >
                            Add Account
                          </Button>
                          <IconButton
                            onClick={() => handleOpenUserDialog(user)}
                            size="small"
                          >
                            <EditIcon />
                          </IconButton>
                          <IconButton
                            onClick={() => handleDeleteClick('user', user)}
                            color="error"
                            size="small"
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Box>
                      </Box>
                      
                      {userAccounts.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                          No accounts configured. Add an account to link CSV imports to this user.
                        </Typography>
                      ) : (
                        <List dense>
                          {userAccounts.map((account) => (
                            <ListItem key={account.id} divider>
                              <AccountIcon sx={{ mr: 2, color: 'text.secondary' }} />
                              <ListItemText
                                primary={`${account.name} (****${account.last_four})`}
                                secondary={`${account.type.charAt(0).toUpperCase() + account.type.slice(1)} account`}
                              />
                              <ListItemSecondaryAction>
                                <IconButton
                                  edge="end"
                                  onClick={() => handleOpenAccountDialog(account)}
                                  size="small"
                                >
                                  <EditIcon />
                                </IconButton>
                                <IconButton
                                  edge="end"
                                  onClick={() => handleDeleteClick('account', account)}
                                  size="small"
                                  color="error"
                                >
                                  <DeleteIcon />
                                </IconButton>
                              </ListItemSecondaryAction>
                            </ListItem>
                          ))}
                        </List>
                      )}
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Add/Edit User Dialog */}
      <Dialog open={userDialogOpen} onClose={handleCloseUserDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingUser ? 'Edit User' : 'Add New User'}
        </DialogTitle>
        <DialogContent>
          <Box component="form" onSubmit={handleUserSubmit} sx={{ mt: 1 }}>
            <TextField
              autoFocus
              margin="dense"
              label="Display Name"
              fullWidth
              variant="outlined"
              value={userFormData.display_name}
              onChange={(e) => setUserFormData(prev => ({ ...prev, display_name: e.target.value }))}
              required
              helperText="Enter a friendly name for this user"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseUserDialog}>Cancel</Button>
          <Button 
            onClick={handleUserSubmit} 
            variant="contained" 
            disabled={loading}
          >
            {loading ? 'Saving...' : editingUser ? 'Update' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add/Edit Account Dialog */}
      <Dialog open={accountDialogOpen} onClose={handleCloseAccountDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingAccount ? 'Edit Account' : 'Add New Account'}
        </DialogTitle>
        <DialogContent>
          <Box component="form" onSubmit={handleAccountSubmit} sx={{ mt: 1 }}>
            <FormControl fullWidth margin="dense" variant="outlined">
              <InputLabel>User</InputLabel>
              <Select
                value={accountFormData.user_id}
                label="User"
                onChange={(e) => setAccountFormData(prev => ({ ...prev, user_id: e.target.value }))}
                required
              >
                {users.map((user) => (
                  <MenuItem key={user.id} value={user.id}>
                    {user.display_name}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <TextField
              margin="dense"
              label="Account Name"
              fullWidth
              variant="outlined"
              value={accountFormData.name}
              onChange={(e) => setAccountFormData(prev => ({ ...prev, name: e.target.value }))}
              required
              helperText="e.g., 'Primary Checking', 'Business Savings', etc."
            />
            
            <FormControl fullWidth margin="dense" variant="outlined">
              <InputLabel>Account Type</InputLabel>
              <Select
                value={accountFormData.type}
                label="Account Type"
                onChange={(e) => setAccountFormData(prev => ({ ...prev, type: e.target.value as 'checking' | 'savings' | 'credit' }))}
              >
                <MenuItem value="checking">Checking</MenuItem>
                <MenuItem value="savings">Savings</MenuItem>
                <MenuItem value="credit">Credit Card</MenuItem>
              </Select>
            </FormControl>
            
            <TextField
              margin="dense"
              label="Last Four Digits"
              fullWidth
              variant="outlined"
              value={accountFormData.last_four}
              onChange={(e) => setAccountFormData(prev => ({ ...prev, last_four: e.target.value }))}
              inputProps={{ maxLength: 4, pattern: '[0-9]{4}' }}
              required
              helperText="Enter the last 4 digits of the account number"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAccountDialog}>Cancel</Button>
          <Button 
            onClick={handleAccountSubmit} 
            variant="contained" 
            disabled={loading}
          >
            {loading ? 'Saving...' : editingAccount ? 'Update' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete {itemToDelete?.type === 'user' ? 'User' : 'Account'}</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this {itemToDelete?.type}?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {itemToDelete?.type === 'user' 
              ? 'This action cannot be undone. All accounts associated with this user will also be deleted.'
              : 'This action cannot be undone.'
            }
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
