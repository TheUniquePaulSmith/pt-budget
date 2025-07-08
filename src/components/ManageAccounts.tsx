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
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import { useDatabaseContext } from '@/contexts/DatabaseContext';
import { Account, AccountAlias } from '@/types/database';
import { set } from 'date-fns';

export default function ManageAccounts() {
  const { 
    accounts, 
    accountAliases, 
    isDatabaseLoaded,
    addAccount, 
    deleteAccount, 
    refreshAccounts,
    addAccountAlias,
    updateAccountAlias,
    deleteAccountAlias,
    refreshAccountAliases
  } = useDatabaseContext();
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [accountToDelete, setAccountToDelete] = useState<Account | null>(null);
  
  // Alias management state
  const [aliasDialogOpen, setAliasDialogOpen] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<Account | null>(null);
  const [editingAlias, setEditingAlias] = useState<AccountAlias | null>(null);
  const [aliasFormData, setAliasFormData] = useState({
    last_four: '',
    alias_name: '',
  });
  
  const [formData, setFormData] = useState({
    name: '',
    type: 'checking' as 'checking' | 'savings' | 'credit',
  });

  const loadingRef = useRef(false);

// Replace both useEffects with this single one
useEffect(() => {
  if (isDatabaseLoaded && !loadingRef.current) {
    loadingRef.current = true;
    console.debug('Database loaded, refreshing accounts and aliases');
    const loadData = async () => {
      try {
        await refreshAccounts();
        await refreshAccountAliases(); // Wait for accounts to finish first
      } catch (error) {
        console.error('Error loading account data:', error);
      } finally {
        loadingRef.current = false;
      }
    };
    loadData();
  }
}, [isDatabaseLoaded, refreshAccounts, refreshAccountAliases]);

  const handleOpenDialog = (account?: Account) => {
    if (account) {
      setEditingAccount(account);
      setFormData({
        name: account.name,
        type: account.type as 'checking' | 'savings' | 'credit',
      });
    } else {
      setEditingAccount(null);
      setFormData({
        name: '',
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

      // Check for duplicate account names
      const isDuplicateName = accounts.some(acc =>
        acc.name.toLowerCase() === formData.name.toLowerCase() &&
        acc.id !== editingAccount?.id
      );

      if (isDuplicateName) {
        throw new Error('An account with this name already exists');
      }

      if (editingAccount) {
        // For now, we'll just close the dialog since we don't have an update function
        // In a full implementation, you'd add an updateAccount function
        throw new Error('Account editing is not yet implemented');
      } else {
        // Create new account
        await addAccount({
          name: formData.name,
          type: formData.type,
        });
      }

      handleCloseDialog();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save account');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (account: Account) => {
    setAccountToDelete(account);
    setError(null);
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

  const handleAliasDialog = (account: Account, alias?: AccountAlias) => {
    setSelectedAccount(account);
    if (alias) {
      setEditingAlias(alias);
      setAliasFormData({
        last_four: alias.last_four,
        alias_name: alias.alias_name || '',
      });
    } else {
      setEditingAlias(null);
      setAliasFormData({
        last_four: '',
        alias_name: '',
      });
    }
    setAliasDialogOpen(true);
  };

  const handleAliasSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) return;

    setLoading(true);
    setError(null);

    try {
      if (!aliasFormData.last_four.trim()) {
        throw new Error('Last four digits are required');
      }
      if (aliasFormData.last_four.length !== 4 || !/^\d{4}$/.test(aliasFormData.last_four)) {
        throw new Error('Last four digits must be exactly 4 numbers');
      }

      // Check for duplicate aliases
      const isDuplicateAlias = accountAliases.some(alias =>
        alias.last_four === aliasFormData.last_four &&
        alias.id !== editingAlias?.id
      );

      if (isDuplicateAlias) {
        throw new Error('An alias with these last four digits already exists');
      }

      if (editingAlias) {
        await updateAccountAlias(editingAlias.id, {
          last_four: aliasFormData.last_four,
          alias_name: aliasFormData.alias_name.trim() || undefined,
        });
      } else {
        await addAccountAlias({
          account_id: selectedAccount.id,
          last_four: aliasFormData.last_four,
          alias_name: aliasFormData.alias_name.trim() || undefined,
        });
      }

      setAliasDialogOpen(false);
      setSelectedAccount(null);
      setEditingAlias(null);
      setAliasFormData({ last_four: '', alias_name: '' });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save alias');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAlias = async (alias: AccountAlias) => {
    if (!window.confirm('Are you sure you want to delete this alias?')) return;

    try {
      await deleteAccountAlias(alias.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to delete alias');
    }
  };

  const getAccountAliases = (accountId: string) => {
    return accountAliases.filter(alias => alias.account_id === accountId);
  };

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" fontWeight="bold">
          Manage Accounts
        </Typography>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
          sx={{ minWidth: 150 }}
        >
          Add Account
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Accounts and Aliases
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Each account can have multiple aliases (last 4 digits). When importing CSV files, 
            transactions will be matched to accounts based on these aliases.
          </Typography>

          {accounts.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              No accounts found. Add your first account to get started.
            </Typography>
          ) : (
            <Box>
              {accounts.map((account) => {
                const aliases = getAccountAliases(account.id);
                return (
                  <Accordion key={account.id} sx={{ mb: 1 }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                        <AccountIcon sx={{ mr: 2, color: 'primary.main' }} />
                        <Box sx={{ flexGrow: 1 }}>
                          <Typography variant="subtitle1" fontWeight="medium">
                            {account.name}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                            <Chip label={account.type} size="small" />
                            {aliases.length > 0 && (
                              <Chip 
                                label={`${aliases.length} alias${aliases.length > 1 ? 'es' : ''}`}
                                size="small"
                                variant="outlined"
                              />
                            )}
                          </Box>
                        </Box>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                        <Typography variant="subtitle2">
                          Account Aliases (Last 4 Digits)
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1 }}>
                          <Button
                            size="small"
                            startIcon={<AddIcon />}
                            onClick={() => handleAliasDialog(account)}
                          >
                            Add Alias
                          </Button>
                          <IconButton
                            onClick={() => handleDeleteClick(account)}
                            color="error"
                            size="small"
                          >
                            <DeleteIcon />
                          </IconButton>
                        </Box>
                      </Box>
                      
                      {aliases.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                          No aliases configured. Add an alias to link CSV imports to this account.
                        </Typography>
                      ) : (
                        <List dense>
                          {aliases.map((alias) => (
                            <ListItem key={alias.id} divider>
                              <ListItemText
                                primary={`****${alias.last_four}`}
                                secondary={alias.alias_name || 'No description'}
                              />
                              <ListItemSecondaryAction>
                                <IconButton
                                  edge="end"
                                  onClick={() => handleAliasDialog(account, alias)}
                                  size="small"
                                >
                                  <EditIcon />
                                </IconButton>
                                <IconButton
                                  edge="end"
                                  onClick={() => handleDeleteAlias(alias)}
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

      {/* Add/Edit Account Dialog */}
      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingAccount ? 'Edit Account' : 'Add New Account'}
        </DialogTitle>
        <DialogContent>
          <Box component="form" onSubmit={handleSubmit} sx={{ mt: 1 }}>
            <TextField
              autoFocus
              margin="dense"
              label="Account Name"
              fullWidth
              variant="outlined"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              required
            />
            
            <FormControl fullWidth margin="dense" variant="outlined">
              <InputLabel>Account Type</InputLabel>
              <Select
                value={formData.type}
                label="Account Type"
                onChange={(e) => setFormData(prev => ({ ...prev, type: e.target.value as 'checking' | 'savings' | 'credit' }))}
              >
                <MenuItem value="checking">Checking</MenuItem>
                <MenuItem value="savings">Savings</MenuItem>
                <MenuItem value="credit">Credit Card</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button 
            onClick={handleSubmit} 
            variant="contained" 
            disabled={loading}
          >
            {loading ? 'Saving...' : editingAccount ? 'Update' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add/Edit Alias Dialog */}
      <Dialog open={aliasDialogOpen} onClose={() => setAliasDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingAlias ? 'Edit Alias' : 'Add New Alias'}
        </DialogTitle>
        <DialogContent>
          {selectedAccount && (
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
              for {selectedAccount.name}
            </Typography>
          )}
          <Box component="form" onSubmit={handleAliasSubmit} sx={{ mt: 1 }}>
            <TextField
              autoFocus
              margin="dense"
              label="Last Four Digits"
              fullWidth
              variant="outlined"
              value={aliasFormData.last_four}
              onChange={(e) => setAliasFormData(prev => ({ ...prev, last_four: e.target.value }))}
              inputProps={{ maxLength: 4, pattern: '[0-9]{4}' }}
              required
              helperText="Enter the last 4 digits of the account number"
            />
            
            <TextField
              margin="dense"
              label="Alias Description (Optional)"
              fullWidth
              variant="outlined"
              value={aliasFormData.alias_name}
              onChange={(e) => setAliasFormData(prev => ({ ...prev, alias_name: e.target.value }))}
              helperText="e.g., 'Primary Checking', 'Business Account', etc."
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAliasDialogOpen(false)}>Cancel</Button>
          <Button 
            onClick={handleAliasSubmit} 
            variant="contained" 
            disabled={loading}
          >
            {loading ? 'Saving...' : editingAlias ? 'Update' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Account Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete Account</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete the account &quot;{accountToDelete?.name}&quot;?
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            This action cannot be undone. All aliases associated with this account will also be deleted.
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
