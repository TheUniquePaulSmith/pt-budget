'use client';

import React, { useState, useEffect } from 'react';
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
  CreditCard as CreditCardIcon,
} from '@mui/icons-material';
import { useAccountManagementSlice } from '@/contexts/useDatabaseSlices';
import { Account, User, AccountCard } from '@/types/database';

export default function ManageAccounts() {
  const { 
    accounts, 
    users, 
    addAccount, 
    deleteAccount, 
    addUser,
    updateUser,
    deleteUser,
    getAccountCards,
    addAccountCard,
    deleteAccountCard,
  } = useAccountManagementSlice();
  
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [cardDialogOpen, setCardDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [selectedAccountForCardManagement, setSelectedAccountForCardManagement] = useState<Account | null>(null);
  const [accountCards, setAccountCards] = useState<any[]>([]);
  const [accountCardsByAccountId, setAccountCardsByAccountId] = useState<Record<number, AccountCard[]>>({});
  const [expandedAccountIds, setExpandedAccountIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{ type: 'user' | 'account' | 'card'; item: User | Account | any } | null>(null);
  
  const [userFormData, setUserFormData] = useState({
    display_name: '',
  });
  
  const [accountFormData, setAccountFormData] = useState({
    name: '',
    type: 'checking' as 'checking' | 'savings' | 'credit' | 'joint',
    owner_user_id: null as number | null,
  });

  const [cardFormData, setCardFormData] = useState({
    last_four: '',
    nickname: '',
    user_id: null as number | null,
  });

  // Preload all account cards to enable cardholder account detection
  useEffect(() => {
    if (accounts.length > 0) {
      const loadAllCards = async () => {
        const cardsByAccount: Record<number, AccountCard[]> = {};
        for (const account of accounts) {
          try {
            const cards = await getAccountCards(account.id);
            cardsByAccount[account.id] = cards;
          } catch (error) {
            console.error(`Failed to load cards for account ${account.id}:`, error);
            cardsByAccount[account.id] = [];
          }
        }
        setAccountCardsByAccountId(cardsByAccount);
      };
      loadAllCards();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length]);

  const handleOpenUserDialog = (user?: User) => {
    if (user) {
      setEditingUser(user);
      setUserFormData({ display_name: user.display_name });
    } else {
      setEditingUser(null);
      setUserFormData({ display_name: '' });
    }
    setError(null);
    setUserDialogOpen(true);
  };

  const handleCloseUserDialog = () => {
    setUserDialogOpen(false);
    setEditingUser(null);
    setUserFormData({ display_name: '' });
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
        await updateUser(editingUser.id, { display_name: userFormData.display_name });
      } else {
        await addUser({ display_name: userFormData.display_name });
      }

      handleCloseUserDialog();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save user');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAccountDialog = (selectedUserId?: number) => {
    setAccountFormData({
      name: '',
      type: 'checking',
      owner_user_id: selectedUserId ?? null,
    });
    setError(null);
    setAccountDialogOpen(true);
  };

  const handleCloseAccountDialog = () => {
    setAccountDialogOpen(false);
    setAccountFormData({
      name: '',
      type: 'checking',
      owner_user_id: null,
    });
    setError(null);
  };

  const handleAccountSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!accountFormData.name.trim()) throw new Error('Account name is required');
      if (!accountFormData.owner_user_id) throw new Error('Owner is required');

      await addAccount({
        name: accountFormData.name,
        type: accountFormData.type,
      }, accountFormData.owner_user_id);

      handleCloseAccountDialog();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to save account');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (type: 'user' | 'account' | 'card', item: User | Account | any) => {
    setItemToDelete({ type, item });
    setDeleteDialogOpen(true);
  };

  const handleOpenCardDialog = async (account: Account) => {
    setSelectedAccountForCardManagement(account);
    setCardFormData({ last_four: '', nickname: '', user_id: null });
    setLoading(true);
    try {
      const cards = await getAccountCards(account.id);
      setAccountCards(cards);
    } catch (err) {
      setError('Failed to load account cards');
    } finally {
      setLoading(false);
    }
    setCardDialogOpen(true);
  };

  const handleCloseCardDialog = () => {
    setCardDialogOpen(false);
    setSelectedAccountForCardManagement(null);
    setAccountCards([]);
    setCardFormData({ last_four: '', nickname: '', user_id: null });
    setError(null);
  };

  const handleAddCard = async () => {
    if (!selectedAccountForCardManagement) return;
    setLoading(true);
    setError(null);
    try {
      if (!cardFormData.last_four.trim()) throw new Error('Last four digits are required');
      if (cardFormData.last_four.length !== 4 || !/^\d{4}$/.test(cardFormData.last_four)) {
        throw new Error('Last four digits must be exactly 4 numbers');
      }

      await addAccountCard({
        account_id: selectedAccountForCardManagement.id,
        last_four: cardFormData.last_four,
        nickname: cardFormData.nickname || undefined,
        user_id: cardFormData.user_id || undefined,
      });

      const cards = await getAccountCards(selectedAccountForCardManagement.id);
      setAccountCards(cards);
      // Update the accountCardsByAccountId state to reflect changes in UI
      setAccountCardsByAccountId(prev => ({ ...prev, [selectedAccountForCardManagement.id]: cards }));
      setCardFormData({ last_four: '', nickname: '', user_id: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add card');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteCard = async (cardId: number) => {
    setLoading(true);
    try {
      await deleteAccountCard(cardId);
      if (selectedAccountForCardManagement) {
        const cards = await getAccountCards(selectedAccountForCardManagement.id);
        setAccountCards(cards);
        // Update the accountCardsByAccountId state to reflect changes in UI
        setAccountCardsByAccountId(prev => ({ ...prev, [selectedAccountForCardManagement.id]: cards }));
      }
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    } catch (err) {
      setError('Failed to delete card');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!itemToDelete) return;
    setLoading(true);
    setError(null);

    try {
      if (itemToDelete.type === 'user') {
        await deleteUser(itemToDelete.item.id);
      } else if (itemToDelete.type === 'account') {
        await deleteAccount(itemToDelete.item.id);
      } else if (itemToDelete.type === 'card') {
        await handleDeleteCard(itemToDelete.item.id);
        return; // handleDeleteCard already closes dialog
      }
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : `Failed to delete ${itemToDelete.type}`);
    } finally {
      setLoading(false);
    }
  };

  const getUserOwnedAccounts = (userId: number) => {
    return accounts.filter(account => account.owner_user_id === userId);
  };

  const getUserCardholderAccounts = (userId: number) => {
    return accounts.filter(account => account.owner_user_id !== userId && (accountCardsByAccountId[account.id]?.some(c => c.user_id === userId)));
  };

  const toggleAccountExpanded = async (account: Account) => {
    const newSet = new Set(expandedAccountIds);
    if (newSet.has(account.id)) {
      newSet.delete(account.id);
    } else {
      newSet.add(account.id);
      if (!accountCardsByAccountId[account.id]) {
        const cards = await getAccountCards(account.id);
        setAccountCardsByAccountId(prev => ({ ...prev, [account.id]: cards }));
      }
    }
    setExpandedAccountIds(newSet);
  };


  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" component="h1" fontWeight="bold">
          Manage Users & Accounts
        </Typography>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Button variant="outlined" startIcon={<PersonIcon />} onClick={() => handleOpenUserDialog()}>
            Add User
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => handleOpenAccountDialog()}>
            Add Account
          </Button>
        </Box>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>Users and Their Accounts</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Each account has a single owner. Users may be cardholders on the owner&apos;s account.
          </Typography>

          {users.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 4 }}>
              No users found. Add your first user to get started.
            </Typography>
          ) : (
            <Box>
              {users.map((user) => {
                const ownedAccounts = getUserOwnedAccounts(user.id);
                const cardholderAccounts = getUserCardholderAccounts(user.id);
                return (
                  <Accordion key={user.id} sx={{ mb: 1, '&.Mui-expanded': { bgcolor: 'action.hover' } }}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                      <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', pr: 2 }}>
                        <PersonIcon sx={{ mr: 2, color: 'primary.main' }} />
                        <Box sx={{ flexGrow: 1 }}>
                          <Typography variant="subtitle1" fontWeight="medium">{user.display_name}</Typography>
                          <Chip label={`${ownedAccounts.length} owned • ${cardholderAccounts.length} cardholder`} size="small" variant="outlined" />
                        </Box>
                        <Box sx={{ display: 'flex', gap: 0.5 }} onClick={(e) => e.stopPropagation()}>
                          <IconButton component="div" onClick={() => handleOpenUserDialog(user)} size="small" title="Edit User">
                            <EditIcon />
                          </IconButton>
                          <IconButton component="div" onClick={() => handleDeleteClick('user', user)} color="error" size="small" title="Delete User">
                            <DeleteIcon />
                          </IconButton>
                        </Box>
                      </Box>
                    </AccordionSummary>
                    <AccordionDetails>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                        <Typography variant="subtitle2">Owned Accounts</Typography>
                        <Button size="small" startIcon={<AddIcon />} onClick={() => handleOpenAccountDialog(user.id)}>
                          Add Account
                        </Button>
                      </Box>
                      {ownedAccounts.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                          No owned accounts.
                        </Typography>
                      ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {ownedAccounts.map((account) => (
                            <Box key={account.id}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'background.paper', p: 2, borderRadius: 1, border: 1, borderColor: 'divider' }}>
                                <AccountIcon sx={{ color: 'primary.main' }} />
                                <Box sx={{ flexGrow: 1 }}>
                                  <Typography variant="subtitle2" fontWeight="medium">{account.name}</Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {account.type.charAt(0).toUpperCase() + account.type.slice(1)}
                                  </Typography>
                                </Box>
                                <Box sx={{ display: 'flex', gap: 0.5 }}>
                                  <IconButton onClick={() => toggleAccountExpanded(account)} size="small" title={expandedAccountIds.has(account.id) ? 'Hide Cards' : 'Show Cards'}>
                                    <ExpandMoreIcon sx={{ transform: expandedAccountIds.has(account.id) ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                                  </IconButton>
                                  <IconButton onClick={() => handleOpenCardDialog(account)} size="small" title="Manage Cards">
                                    <CreditCardIcon />
                                  </IconButton>
                                  <IconButton onClick={() => handleDeleteClick('account', account)} size="small" color="error" title="Delete Account">
                                    <DeleteIcon />
                                  </IconButton>
                                </Box>
                              </Box>
                              {expandedAccountIds.has(account.id) && (
                                <Box sx={{ bgcolor: 'action.hover', px: 3, py: 2, mb: 1, borderRadius: 1, ml: 1, mr: 1 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 'medium' }}>
                                    Cards on this account:
                                  </Typography>
                                  {accountCardsByAccountId[account.id]?.length ? (
                                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                      {accountCardsByAccountId[account.id].map((card) => (
                                        <Box key={card.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'background.paper', px: 2, py: 1, borderRadius: 1 }}>
                                          <CreditCardIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                                          <Typography variant="body2">****{card.last_four}</Typography>
                                          {card.nickname && (
                                            <Typography variant="body2" color="text.secondary">({card.nickname})</Typography>
                                          )}
                                          {card.user_id && (
                                            <Typography variant="body2" color="text.secondary">
                                              • {users.find(u => u.id === card.user_id)?.display_name || 'Unknown User'}
                                            </Typography>
                                          )}
                                        </Box>
                                      ))}
                                    </Box>
                                  ) : (
                                    <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                      No cards added.
                                    </Typography>
                                  )}
                                </Box>
                              )}
                            </Box>
                          ))}
                        </Box>
                      )}

                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3, mb: 1 }}>
                        <Typography variant="subtitle2">Cardholder Accounts (Read-only)</Typography>
                      </Box>
                      {cardholderAccounts.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                          Not a cardholder on any accounts.
                        </Typography>
                      ) : (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                          {cardholderAccounts.map((account) => (
                            <Box key={account.id}>
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'background.paper', p: 2, borderRadius: 1, border: 1, borderColor: 'divider' }}>
                                <AccountIcon sx={{ color: 'text.secondary' }} />
                                <Box sx={{ flexGrow: 1 }}>
                                  <Typography variant="subtitle2" fontWeight="medium">{account.name}</Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {account.type.charAt(0).toUpperCase() + account.type.slice(1)}
                                    {account.owner_display_name && ` • Owner: ${account.owner_display_name}`}
                                  </Typography>
                                </Box>
                                <IconButton onClick={() => toggleAccountExpanded(account)} size="small" title={expandedAccountIds.has(account.id) ? 'Hide Cards' : 'Show Cards'}>
                                  <ExpandMoreIcon sx={{ transform: expandedAccountIds.has(account.id) ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
                                </IconButton>
                              </Box>
                              {expandedAccountIds.has(account.id) && (
                                <Box sx={{ bgcolor: 'action.hover', px: 3, py: 2, mb: 1, borderRadius: 1, ml: 1, mr: 1 }}>
                                  <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block', fontWeight: 'medium' }}>
                                    Your cards on this account:
                                  </Typography>
                                  {(() => {
                                    const userCards = accountCardsByAccountId[account.id]?.filter(c => c.user_id === user.id) || [];
                                    return userCards.length ? (
                                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                                        {userCards.map((card) => (
                                          <Box key={card.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'background.paper', px: 2, py: 1, borderRadius: 1 }}>
                                            <CreditCardIcon sx={{ fontSize: 16, color: 'primary.main' }} />
                                            <Typography variant="body2">****{card.last_four}</Typography>
                                            {card.nickname && (
                                              <Typography variant="body2" color="text.secondary">({card.nickname})</Typography>
                                            )}
                                          </Box>
                                        ))}
                                      </Box>
                                    ) : (
                                      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                        No cards assigned to you on this account.
                                      </Typography>
                                    );
                                  })()}
                                </Box>
                              )}
                            </Box>
                          ))}
                        </Box>
                      )}
                    </AccordionDetails>
                  </Accordion>
                );
              })}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* User Dialog */}
      <Dialog open={userDialogOpen} onClose={handleCloseUserDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingUser ? 'Edit User' : 'Add New User'}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Display Name"
            fullWidth
            value={userFormData.display_name}
            onChange={(e) => setUserFormData({ display_name: e.target.value })}
            required
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseUserDialog}>Cancel</Button>
          <Button onClick={handleUserSubmit} variant="contained" disabled={loading}>
            {loading ? 'Saving...' : editingUser ? 'Update' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Account Dialog */}
      <Dialog open={accountDialogOpen} onClose={handleCloseAccountDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Account</DialogTitle>
        <DialogContent>
          <FormControl fullWidth margin="dense">
            <InputLabel>Owner</InputLabel>
            <Select
              value={accountFormData.owner_user_id ?? ''}
              label="Owner"
              onChange={(e) => setAccountFormData(prev => ({ ...prev, owner_user_id: e.target.value ? Number(e.target.value) : null }))}
              required
            >
              <MenuItem value="" disabled>Select Owner</MenuItem>
              {users.map((user) => (
                <MenuItem key={user.id} value={user.id}>{user.display_name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            margin="dense"
            label="Account Name"
            fullWidth
            value={accountFormData.name}
            onChange={(e) => setAccountFormData(prev => ({ ...prev, name: e.target.value }))}
            required
          />
          <FormControl fullWidth margin="dense">
            <InputLabel>Account Type</InputLabel>
            <Select
              value={accountFormData.type}
              label="Account Type"
              onChange={(e) => setAccountFormData(prev => ({ ...prev, type: e.target.value as any }))}
            >
              <MenuItem value="checking">Checking</MenuItem>
              <MenuItem value="savings">Savings</MenuItem>
              <MenuItem value="credit">Credit Card</MenuItem>
              <MenuItem value="joint">Joint Account</MenuItem>
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseAccountDialog}>Cancel</Button>
          <Button onClick={handleAccountSubmit} variant="contained" disabled={loading}>
            {loading ? 'Saving...' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Manage Users Dialog removed for single-owner model */}

      {/* Card Management Dialog */}
      <Dialog open={cardDialogOpen} onClose={handleCloseCardDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Manage Cards: {selectedAccountForCardManagement?.name}</DialogTitle>
        <DialogContent>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          
          <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Current Cards:</Typography>
          {accountCards.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 2 }}>
              No cards added yet.
            </Typography>
          ) : (
            <List dense>
              {accountCards.map((card) => (
                <ListItem key={card.id} divider>
                  <CreditCardIcon sx={{ mr: 2, color: 'primary.main' }} />
                  <ListItemText 
                    primary={`****${card.last_four}`}
                    secondary={
                      <>
                        {card.nickname && <Typography variant="body2" component="span">{card.nickname}</Typography>}
                        {card.user_id && (
                          <Typography variant="body2" component="span" color="text.secondary">
                            {card.nickname && ' • '}
                            {users.find(u => u.id === card.user_id)?.display_name || 'Unknown User'}
                          </Typography>
                        )}
                      </>
                    }
                  />
                  <ListItemSecondaryAction>
                    <IconButton onClick={() => handleDeleteClick('card', card)} size="small" color="error" disabled={loading}>
                      <DeleteIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          )}

          <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>Add New Card:</Typography>
          <TextField
            margin="dense"
            label="Last Four Digits"
            fullWidth
            value={cardFormData.last_four}
            onChange={(e) => setCardFormData(prev => ({ ...prev, last_four: e.target.value }))}
            inputProps={{ maxLength: 4, pattern: '[0-9]{4}' }}
            required
          />
          <TextField
            margin="dense"
            label="Nickname (Optional)"
            fullWidth
            value={cardFormData.nickname}
            onChange={(e) => setCardFormData(prev => ({ ...prev, nickname: e.target.value }))}
            placeholder="e.g., My Card, Spouse Card"
          />
          <FormControl fullWidth margin="dense">
            <InputLabel>Cardholder (Optional)</InputLabel>
            <Select
              value={cardFormData.user_id || ''}
              onChange={(e) => setCardFormData(prev => ({ ...prev, user_id: e.target.value ? Number(e.target.value) : null }))}
            >
              <MenuItem value="">None</MenuItem>
              {users.map((user) => (
                <MenuItem key={user.id} value={user.id}>
                  {user.display_name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button 
            onClick={handleAddCard} 
            variant="contained" 
            disabled={loading || !cardFormData.last_four}
            fullWidth
            sx={{ mt: 2 }}
          >
            {loading ? 'Adding...' : 'Add Card'}
          </Button>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseCardDialog}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Delete {itemToDelete?.type === 'user' ? 'User' : itemToDelete?.type === 'card' ? 'Card' : 'Account'}</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete this {itemToDelete?.type}?</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {itemToDelete?.type === 'user' 
              ? 'This will remove the user from all shared accounts.'
              : itemToDelete?.type === 'card'
              ? 'CSV imports matching this card number will no longer work.'
              : 'All transactions associated with this account will remain.'
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
