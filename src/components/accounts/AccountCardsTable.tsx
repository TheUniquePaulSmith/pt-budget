'use client';

/**
 * The Cards sub-grid of the account detail form: a dense table with inline
 * add / edit / delete and a cardholder select on every row.
 */

import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Check as SaveIcon, Close as CancelIcon, Delete as DeleteIcon, Edit as EditIcon } from '@mui/icons-material';

import type { AccountCard, User } from '@/types/database';
import { parseCardNumberInput } from './accountCardNumber';
import { cardholderName } from './accountDisplay';

export interface CardDraft {
  cardNumberInput: string;
  nickname: string;
  userId: number | null;
}

export interface AccountCardsTableProps {
  cards: AccountCard[];
  users: User[];
  ownerUserId: number;
  disabled?: boolean;
  onAddCard: (card: { last_four: string; full_number: string | null; nickname: string | null; user_id: number | null }) => Promise<void>;
  onUpdateCard: (
    card: AccountCard,
    updates: { last_four: string; full_number: string | null; nickname: string | null; user_id: number | null }
  ) => Promise<void>;
  onRequestDeleteCard: (card: AccountCard) => void;
}

const EMPTY_DRAFT: CardDraft = { cardNumberInput: '', nickname: '', userId: null };

interface CardholderSelectProps {
  value: number | null;
  users: User[];
  onChange: (userId: number | null) => void;
  label: string;
}

function CardholderSelect({ value, users, onChange, label }: CardholderSelectProps) {
  return (
    <FormControl size="small" fullWidth>
      <InputLabel>{label}</InputLabel>
      <Select<number | ''>
        value={value ?? ''}
        label={label}
        onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
      >
        <MenuItem value="">Account owner</MenuItem>
        {users.map((user) => (
          <MenuItem key={user.id} value={user.id}>
            {user.display_name}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

export default function AccountCardsTable({
  cards,
  users,
  ownerUserId,
  disabled = false,
  onAddCard,
  onUpdateCard,
  onRequestDeleteCard,
}: AccountCardsTableProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<CardDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<CardDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ownerName = users.find((user) => user.id === ownerUserId)?.display_name;

  const startEdit = (card: AccountCard) => {
    setError(null);
    setAdding(false);
    setEditingId(card.id);
    setEditDraft({
      cardNumberInput: card.full_number || card.last_four,
      nickname: card.nickname ?? '',
      userId: card.user_id ?? null,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setError(null);
  };

  const submit = async (candidate: CardDraft, apply: (parsed: { last_four: string; full_number: string | null }) => Promise<void>) => {
    const parsed = parseCardNumberInput(candidate.cardNumberInput);
    if (!parsed.ok) {
      setError(parsed.error);
      return false;
    }
    setSaving(true);
    setError(null);
    try {
      await apply({ last_four: parsed.last_four, full_number: parsed.full_number });
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save card');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleAdd = async () => {
    const ok = await submit(draft, (parsed) =>
      onAddCard({ ...parsed, nickname: draft.nickname.trim() || null, user_id: draft.userId })
    );
    if (ok) {
      setDraft(EMPTY_DRAFT);
      setAdding(false);
    }
  };

  const handleSaveEdit = async (card: AccountCard) => {
    const ok = await submit(editDraft, (parsed) =>
      onUpdateCard(card, { ...parsed, nickname: editDraft.nickname.trim() || null, user_id: editDraft.userId })
    );
    if (ok) {
      setEditingId(null);
    }
  };

  const renderEditorCells = (value: CardDraft, onChange: (next: CardDraft) => void, kind: 'add' | 'edit') => (
    <>
      <TableCell sx={{ minWidth: 150 }}>
        <TextField
          size="small"
          fullWidth
          label="Card / account number"
          value={value.cardNumberInput}
          onChange={(event) => onChange({ ...value, cardNumberInput: event.target.value })}
          autoFocus
          inputProps={{ 'data-testid': `card-${kind}-number` }}
          required
        />
      </TableCell>
      <TableCell sx={{ minWidth: 130 }}>
        <TextField
          size="small"
          fullWidth
          label="Nickname"
          value={value.nickname}
          onChange={(event) => onChange({ ...value, nickname: event.target.value })}
          inputProps={{ 'data-testid': `card-${kind}-nickname` }}
        />
      </TableCell>
      <TableCell sx={{ minWidth: 150 }}>
        <CardholderSelect
          label="Cardholder"
          value={value.userId}
          users={users}
          onChange={(userId) => onChange({ ...value, userId })}
        />
      </TableCell>
    </>
  );

  return (
    <Box data-testid="account-cards-table">
      {error && (
        <Alert severity="error" sx={{ mb: 1 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Table size="small" aria-label="Cards">
        <TableHead>
          <TableRow>
            <TableCell>Number</TableCell>
            <TableCell>Nickname</TableCell>
            <TableCell>Cardholder</TableCell>
            <TableCell align="right" sx={{ width: 96 }} />
          </TableRow>
        </TableHead>
        <TableBody>
          {cards.length === 0 && !adding && (
            <TableRow>
              <TableCell colSpan={4}>
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                  No cards on this account.
                </Typography>
              </TableCell>
            </TableRow>
          )}
          {cards.map((card) =>
            editingId === card.id ? (
              <TableRow key={card.id} data-testid={`card-row-${card.id}`}>
                {renderEditorCells(editDraft, setEditDraft, 'edit')}
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <IconButton size="small" color="primary" onClick={() => void handleSaveEdit(card)} disabled={saving} aria-label="Save card" title="Save card">
                    <SaveIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={cancelEdit} disabled={saving} aria-label="Cancel card edit" title="Cancel">
                    <CancelIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ) : (
              <TableRow key={card.id} hover data-testid={`card-row-${card.id}`}>
                <TableCell sx={{ fontFamily: 'monospace' }}>••••{card.last_four}</TableCell>
                <TableCell>{card.nickname || <Typography variant="caption" color="text.secondary">—</Typography>}</TableCell>
                <TableCell>{cardholderName(card, users, ownerName)}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  <IconButton size="small" onClick={() => startEdit(card)} disabled={disabled || saving} aria-label="Edit card" title="Edit Card">
                    <EditIcon fontSize="small" />
                  </IconButton>
                  <Tooltip title={cards.length <= 1 ? 'An account must keep at least one card' : 'Delete card'}>
                    <span>
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => onRequestDeleteCard(card)}
                        disabled={disabled || saving || cards.length <= 1}
                        aria-label="Delete card"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            )
          )}
          {adding && (
            <TableRow data-testid="card-add-row">
              {renderEditorCells(draft, setDraft, 'add')}
              <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                <IconButton size="small" color="primary" onClick={() => void handleAdd()} disabled={saving || !draft.cardNumberInput} aria-label="Save new card" title="Save new card">
                  <SaveIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={() => {
                    setAdding(false);
                    setDraft(EMPTY_DRAFT);
                    setError(null);
                  }}
                  disabled={saving}
                  aria-label="Cancel new card"
                  title="Cancel"
                >
                  <CancelIcon fontSize="small" />
                </IconButton>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {!adding && (
        <Button
          size="small"
          startIcon={<AddIcon />}
          onClick={() => {
            setEditingId(null);
            setError(null);
            setAdding(true);
          }}
          disabled={disabled}
          sx={{ mt: 0.5 }}
          data-testid="add-card-button"
        >
          Add card
        </Button>
      )}
    </Box>
  );
}
