'use client';

import { useState } from 'react';
import { Add, Delete, Edit } from '@mui/icons-material';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton, InputLabel, MenuItem, Paper, Select, Stack, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { Account, IncomeSource, User } from '@/types/database';

interface IncomeSourcesManagerProps {
  accounts: Account[];
  users: User[];
  sources: IncomeSource[];
  onAdd: (input: Omit<IncomeSource, 'id' | 'created_at' | 'updated_at' | 'account_name'>) => Promise<void>;
  onUpdate: (id: number, input: Omit<IncomeSource, 'id' | 'created_at' | 'updated_at' | 'account_name'>) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

const FREQUENCIES = ['weekly', 'biweekly', 'semi_monthly', 'monthly'] as const;
type Frequency = (typeof FREQUENCIES)[number];

function isFrequency(value: unknown): value is Frequency {
  return typeof value === 'string' && (FREQUENCIES as ReadonlyArray<string>).includes(value);
}

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
  const { t } = useTranslation(['budget', 'common']);
  // Income-source amounts are in the default currency.
  const { money } = useFormatters();
  const formatCurrency = (value: number | null | undefined) => (value == null ? t('incomeSources.notSet') : money(value));
  const frequencyWord = (frequency: IncomeSource['frequency'] | undefined, fallback?: Frequency) => {
    const key = isFrequency(frequency) ? frequency : fallback;
    return key ? t(`incomeSources.frequency.${key}`) : '';
  };

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

  const frequencyOptions = FREQUENCIES.map((value) => (
    <MenuItem key={value} value={value}>{t(`incomeSources.frequencyOption.${value}`)}</MenuItem>
  ));

  return (
    <Paper sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, mb: 2 }}>
        <Typography variant="h6">{t('incomeSources.title')}</Typography>
        <Button size="small" startIcon={<Add />} onClick={openForAdd}>{t('common:actions.add')}</Button>
      </Box>
      <Stack spacing={1.5}>
        {sources.map((source) => (
          <Box key={source.id} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, alignItems: 'flex-start' }}>
            <Box sx={{ minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.25 }}>
                <Typography variant="body2" fontWeight={700} noWrap>{source.name}</Typography>
                {source.is_active !== 1 && <Chip label={t('common:status.inactive')} size="small" />}
              </Stack>
              <Typography variant="body2" color="text.secondary" noWrap>
                {t('incomeSources.user', { name: source.user_display_name || source.owner_display_name || t('incomeSources.unassigned') })}
              </Typography>
              {source.kind === 'linked_account' ? (
                <Stack spacing={0.25}>
                  <Typography variant="body2" color="text.secondary" noWrap>
                    {t('incomeSources.linkedAccount', { name: source.account_name || t('incomeSources.unknownAccount') })}
                  </Typography>
                  {source.amount != null && (
                    <Typography variant="body2" color="text.secondary">
                      {t('incomeSources.expectedSummary', {
                        amount: formatCurrency(source.amount),
                        frequency: frequencyWord(source.frequency, 'monthly'),
                        monthly: formatCurrency(monthlyEquivalent(source)),
                      })}
                    </Typography>
                  )}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {t('incomeSources.summary', {
                    amount: formatCurrency(source.amount),
                    frequency: frequencyWord(source.frequency),
                    monthly: formatCurrency(monthlyEquivalent(source)),
                  })}
                </Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
              <Tooltip title={t('incomeSources.editTooltip')}>
                <IconButton size="small" onClick={() => openForEdit(source)}>
                  <Edit fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('incomeSources.deleteTooltip')}>
                <IconButton size="small" color="error" onClick={() => { void onDelete(source.id); }}>
                  <Delete fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        ))}
        {sources.length === 0 && <Typography variant="body2" color="text.secondary">{t('incomeSources.empty')}</Typography>}
      </Stack>

      <Dialog open={open} onClose={closeDialog} maxWidth="sm" fullWidth>
        <DialogTitle>{editingSource ? t('incomeSources.editTitle') : t('incomeSources.addTitle')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label={t('common:fields.name')} value={name} onChange={(event) => setName(event.target.value)} fullWidth />
            <FormControl fullWidth>
              <InputLabel>{t('incomeSources.kind')}</InputLabel>
              <Select value={kind} label={t('incomeSources.kind')} onChange={(event) => setKind(event.target.value as IncomeSource['kind'])}>
                <MenuItem value="recurring_salary">{t('incomeSources.kindOption.recurring_salary')}</MenuItem>
                <MenuItem value="linked_account">{t('incomeSources.kindOption.linked_account')}</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>{t('common:fields.user')}</InputLabel>
              <Select<number | ''> value={userId} label={t('common:fields.user')} onChange={(event) => setUserId(event.target.value === '' ? '' : Number(event.target.value))}>
                <MenuItem value="">{t('incomeSources.unassigned')}</MenuItem>
                {users.map((user) => <MenuItem key={user.id} value={user.id}>{user.display_name}</MenuItem>)}
              </Select>
            </FormControl>
            {kind === 'linked_account' ? (
              <>
                <FormControl fullWidth>
                  <InputLabel>{t('common:fields.account')}</InputLabel>
                  <Select value={accountId} label={t('common:fields.account')} onChange={(event) => setAccountId(Number(event.target.value))}>
                    {accounts.map((account) => <MenuItem key={account.id} value={account.id}>{account.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField label={t('incomeSources.expectedAmount')} type="number" value={amount} onChange={(event) => setAmount(event.target.value)} fullWidth helperText={t('incomeSources.expectedAmountHelp')} />
                <FormControl fullWidth disabled={!amount}>
                  <InputLabel>{t('incomeSources.frequencyLabel')}</InputLabel>
                  <Select value={frequency || 'monthly'} label={t('incomeSources.frequencyLabel')} onChange={(event) => setFrequency(event.target.value as IncomeSource['frequency'])}>
                    {frequencyOptions}
                  </Select>
                </FormControl>
              </>
            ) : (
              <>
                <TextField label={t('common:fields.amount')} type="number" value={amount} onChange={(event) => setAmount(event.target.value)} fullWidth />
                <FormControl fullWidth>
                  <InputLabel>{t('incomeSources.frequencyLabel')}</InputLabel>
                  <Select value={frequency || 'monthly'} label={t('incomeSources.frequencyLabel')} onChange={(event) => setFrequency(event.target.value as IncomeSource['frequency'])}>
                    {frequencyOptions}
                  </Select>
                </FormControl>
              </>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label={t('incomeSources.startDate')} type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
              <TextField label={t('incomeSources.endDate')} type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} fullWidth slotProps={{ inputLabel: { shrink: true } }} />
            </Stack>
            <TextField label={t('common:fields.notes')} value={notes} onChange={(event) => setNotes(event.target.value)} fullWidth multiline minRows={2} />
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="body2">{t('common:status.active')}</Typography>
              <Switch checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>{t('common:actions.cancel')}</Button>
          <Button variant="contained" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? t('incomeSources.saving') : editingSource ? t('common:actions.save') : t('common:actions.add')}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}
