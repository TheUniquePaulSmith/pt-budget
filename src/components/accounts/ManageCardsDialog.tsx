'use client';

import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  MenuItem,
  Select,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  CreditCard as CreditCardIcon,
} from '@mui/icons-material';
import { Account, AccountCard, User } from '@/types/database';
import { parseCardNumberInput } from './accountCardNumber';

interface ManageCardsDialogProps {
  open: boolean;
  account: Account | null;
  cards: AccountCard[];
  users: User[];
  onClose: () => void;
  addAccountCard: (card: {
    account_id: number;
    last_four: string;
    full_number?: string | null;
    nickname?: string;
    user_id?: number;
  }) => Promise<number>;
  updateAccountCard: (
    id: number,
    updates: Partial<Pick<AccountCard, 'last_four' | 'full_number' | 'nickname' | 'user_id'>>
  ) => Promise<void>;
  onMutated: () => Promise<void>;
  onRequestDeleteCard: (card: AccountCard) => void;
}

export function ManageCardsDialog({
  open,
  account,
  cards,
  users,
  onClose,
  addAccountCard,
  updateAccountCard,
  onMutated,
  onRequestDeleteCard,
}: ManageCardsDialogProps) {
  const [cardNumberInput, setCardNumberInput] = useState('');
  const [cardNickname, setCardNickname] = useState('');
  const [cardUserId, setCardUserId] = useState<number | null>(null);
  const [editingCardId, setEditingCardId] = useState<number | null>(null);
  const [editCardNumberInput, setEditCardNumberInput] = useState('');
  const [editCardNickname, setEditCardNickname] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCardNumberInput('');
    setCardNickname('');
    setCardUserId(null);
    setEditingCardId(null);
    setError(null);
  }, [open, account?.id]);

  const handleAddCard = async () => {
    if (!account) return;
    setError(null);
    const parsed = parseCardNumberInput(cardNumberInput);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    try {
      await addAccountCard({
        account_id: account.id,
        last_four: parsed.last_four,
        full_number: parsed.full_number,
        nickname: cardNickname.trim() || undefined,
        user_id: cardUserId || undefined,
      });
      await onMutated();
      setCardNumberInput('');
      setCardNickname('');
      setCardUserId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add card');
    } finally {
      setSaving(false);
    }
  };

  const handleStartEditCard = (card: AccountCard) => {
    setError(null);
    setEditingCardId(card.id);
    setEditCardNumberInput(card.full_number || card.last_four);
    setEditCardNickname(card.nickname || '');
  };

  const handleCancelEditCard = () => {
    setEditingCardId(null);
    setError(null);
  };

  const handleSaveEditCard = async (card: AccountCard) => {
    setError(null);
    const parsed = parseCardNumberInput(editCardNumberInput);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    try {
      await updateAccountCard(card.id, {
        last_four: parsed.last_four,
        full_number: parsed.full_number,
        nickname: editCardNickname.trim() || null,
        user_id: card.user_id ?? null,
      });
      await onMutated();
      setEditingCardId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update card');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Manage Cards: {account?.name}</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>Current Cards:</Typography>
        {cards.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 2 }}>
            No cards added yet.
          </Typography>
        ) : (
          <List dense>
            {cards.map((card) => (
              <ListItem key={card.id} divider>
                {editingCardId === card.id ? (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, width: '100%', py: 1 }}>
                    <TextField
                      size="small"
                      label="Card / Account Number"
                      fullWidth
                      value={editCardNumberInput}
                      onChange={(e) => setEditCardNumberInput(e.target.value)}
                    />
                    <TextField
                      size="small"
                      label="Nickname"
                      fullWidth
                      value={editCardNickname}
                      onChange={(e) => setEditCardNickname(e.target.value)}
                    />
                    <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
                      <Button size="small" onClick={handleCancelEditCard} disabled={saving}>
                        Cancel
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => handleSaveEditCard(card)}
                        disabled={saving}
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </Button>
                    </Box>
                  </Box>
                ) : (
                  <>
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
                      <IconButton onClick={() => handleStartEditCard(card)} size="small" sx={{ mr: 0.5 }} title="Edit Card">
                        <EditIcon />
                      </IconButton>
                      <Tooltip title={cards.length <= 1 ? 'An account must keep at least one card' : 'Delete card'}>
                        <span>
                          <IconButton
                            onClick={() => onRequestDeleteCard(card)}
                            size="small"
                            color="error"
                            disabled={cards.length <= 1}
                          >
                            <DeleteIcon />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </ListItemSecondaryAction>
                  </>
                )}
              </ListItem>
            ))}
          </List>
        )}

        <Typography variant="subtitle2" sx={{ mt: 3, mb: 1 }}>Add New Card:</Typography>
        <TextField
          margin="dense"
          label="Card / Account Number"
          fullWidth
          value={cardNumberInput}
          onChange={(e) => setCardNumberInput(e.target.value)}
          helperText="Enter the full number or just the last 4 digits — only the last 4 are shown elsewhere"
          required
        />
        <TextField
          margin="dense"
          label="Nickname (Optional)"
          fullWidth
          value={cardNickname}
          onChange={(e) => setCardNickname(e.target.value)}
          placeholder="e.g., My Card, Spouse Card"
        />
        <FormControl fullWidth margin="dense">
          <InputLabel>Cardholder (Optional)</InputLabel>
          <Select
            value={cardUserId ?? ''}
            onChange={(e) => setCardUserId(e.target.value ? Number(e.target.value) : null)}
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
          disabled={saving || !cardNumberInput}
          fullWidth
          sx={{ mt: 2 }}
        >
          {saving ? 'Adding...' : 'Add Card'}
        </Button>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
