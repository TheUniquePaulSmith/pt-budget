'use client';

import { useState } from 'react';
import { Add, Delete, Edit } from '@mui/icons-material';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';

import type { Account, IncomeSource, User } from '@/types/database';

interface IncomeSourcesManagerProps {
  accounts: Account[];
  users: User[];
  sources: IncomeSource[];
  onAdd: (input: Omit<IncomeSource, 'id' | 'created_at' | 'updated_at' | 'account_name'>) => Promise<void>;
  onUpdate: (id: number, input: Omit<IncomeSource, 'id' | 'created_at' | 'updated_at' | 'account_name'>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

const formatCurrency = (value: number | null | undefined) =>
  value == null
    ? 'Not set'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

function monthlyEquivalent(source: IncomeSource) {
  if (source.amount == null) return null;
  if (source.kind === 'linked_account' && !source.frequency) return source.amount;
  switch (source.frequency) {
    case 'weekly':
      return source.amount * 52 / 12;
    case 'biweekly':
      return source.amount * 26 / 12;
    case 'semi_monthly':
      return source.amount * 2;
    case 'monthly':
      return source.amount;
    default:
      return null;
  }
}

export function IncomeSourcesManager({ accounts, users, sources, onAdd, onUpdate, onDelete }: IncomeSourcesManagerProps) {
  const [open, setOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<IncomeSource | null>(null);
  const [kind, setKind] = useState<IncomeSource['kind']>('recurring_salary');
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState<number | ''>('');
  const [userId, setUserId] = useState<number | ''>('');
  const [amount, setAmount] = useState('');
  const [frequency, setFrequency] = useState<IncomeSource['frequency']>('monthly');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setEditingSource(null);
    setKind('recurring_salary');
    setName('');
    setAccountId('');
    setUserId('');
    setAmount('');
    setFrequency('monthly');
    setStartDate('');
    setEndDate('');
    setIsActive(true);
    setNotes('');
  };

  const openForAdd = () => {
    resetForm();
    setOpen(true);
  };

  const openForEdit = (source: IncomeSource) => {
    setEditingSource(source);
    setKind(source.kind);
    setName(source.name);
    setAccountId(source.account_id ?? '');
    setUserId(source.user_id ?? '');
    setAmount(source.amount == null ? '' : String(source.amount));
    setFrequency(source.frequency ?? 'monthly');
    setStartDate(source.start_date ?? '');
    setEndDate(source.end_date ?? '');
    setIsActive(source.is_active === 1);
    setNotes(source.notes ?? '');
    setOpen(true);
  };

  const closeDialog = () => {
    setOpen(false);
    resetForm();
  };

  const buildInput = (): Omit<IncomeSource, 'id' | 'created_at' | 'updated_at' | 'account_name'> => ({
      name,
      kind,
      user_id: userId === '' ? null : Number(userId),
      account_id: kind === 'linked_account' ? Number(accountId) : null,
      amount: amount ? Number(amount) : null,
      frequency: amount ? frequency : null,
      start_date: startDate || null,
      end_date: endDate || null,
      is_active: isActive ? 1 : 0,
      notes: notes || null,
  });

  const handleSave = async () => {
    setSaving(true);
    try {
      const input = buildInput();
      if (editingSource) {
        await onUpdate(editingSource.id, input);
      } else {
        await onAdd(input);
      }
      closeDialog();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 2 }}>
        <Typography variant="h6">Income Sources</Typography>
        <Button size="small" startIcon={<Add />} onClick={openForAdd}>Add</Button>
      </Box>
      <Stack spacing={1.5}>
        {sources.map((source) => (
          <Box key={source.id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'flex-start' }}>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.25 }}>
                <Typography variant="body2" fontWeight={700} noWrap>{source.name}</Typography>
                {source.is_active !== 1 && <Chip label="Inactive" size="small" />}
              </Stack>
              <Typography variant="body2" color="text.secondary" noWrap>
                User: {source.user_display_name || source.owner_display_name || 'Unassigned'}
              </Typography>
              {source.kind === 'linked_account' ? (
                <Stack spacing={0.25}>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    Linked account: {source.account_name || 'Unknown account'}
                  </Typography>
                  {source.amount != null && (
                    <Typography variant="body2" color="text.secondary">
                      Expected {formatCurrency(source.amount)} {source.frequency?.replace('_', '-') || 'monthly'} • {formatCurrency(monthlyEquivalent(source))} / month
                    </Typography>
                  )}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {formatCurrency(source.amount)} {source.frequency?.replace('_', '-')} • {formatCurrency(monthlyEquivalent(source))} / month
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
              <Tooltip title="Edit income source">
                <IconButton size="small" onClick={() => openForEdit(source)}>
                  <Edit fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete income source">
                <IconButton size="small" color="error" onClick={() => { void onDelete(source.id); }}>
                  <Delete fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        ))}
        {sources.length === 0 && <Typography variant="body2" color="text.secondary">No income sources configured.</Typography>}
      </Stack>

      <Dialog open={open} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingSource ? 'Edit Income Source' : 'Add Income Source'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" value={name} onChange={(event) => setName(event.target.value)} fullWidth />
            <FormControl fullWidth>
              <InputLabel>Kind</InputLabel>
              <Select value={kind} label="Kind" onChange={(event) => setKind(event.target.value as IncomeSource['kind'])}>
                <MenuItem value="recurring_salary">Recurring Salary</MenuItem>
                <MenuItem value="linked_account">Linked Account</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>User</InputLabel>
              <Select<number | ''> value={userId} label="User" onChange={(event) => setUserId(event.target.value === '' ? '' : Number(event.target.value))}>
                <MenuItem value="">Unassigned</MenuItem>
                {users.map((user) => <MenuItem key={user.id} value={user.id}>{user.display_name}</MenuItem>)}
              </Select>
            </FormControl>
            {kind === 'linked_account' ? (
              <>
                <FormControl fullWidth>
                  <InputLabel>Account</InputLabel>
                  <Select value={accountId} label="Account" onChange={(event) => setAccountId(Number(event.target.value))}>
                    {accounts.map((account) => <MenuItem key={account.id} value={account.id}>{account.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField label="Expected Amount" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} fullWidth helperText="Optional. Leave blank to use actual deposits only." />
                <FormControl fullWidth disabled={!amount}>
                  <InputLabel>Frequency</InputLabel>
                  <Select value={frequency || 'monthly'} label="Frequency" onChange={(event) => setFrequency(event.target.value as IncomeSource['frequency'])}>
                    <MenuItem value="weekly">Weekly</MenuItem>
                    <MenuItem value="biweekly">Biweekly</MenuItem>
                    <MenuItem value="semi_monthly">Semi-monthly</MenuItem>
                    <MenuItem value="monthly">Monthly</MenuItem>
                  </Select>
                </FormControl>
              </>
            ) : (
              <>
                <TextField label="Amount" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} fullWidth />
                <FormControl fullWidth>
                  <InputLabel>Frequency</InputLabel>
                  <Select value={frequency || 'monthly'} label="Frequency" onChange={(event) => setFrequency(event.target.value as IncomeSource['frequency'])}>
                    <MenuItem value="weekly">Weekly</MenuItem>
                    <MenuItem value="biweekly">Biweekly</MenuItem>
                    <MenuItem value="semi_monthly">Semi-monthly</MenuItem>
                    <MenuItem value="monthly">Monthly</MenuItem>
                  </Select>
                </FormControl>
              </>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Start Date" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
              <TextField label="End Date" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
            </Stack>
            <TextField label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} fullWidth multiline minRows={2} />
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="body2">Active</Typography>
              <Switch checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? 'Saving...' : editingSource ? 'Save' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}