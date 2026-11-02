'use client';

import { useEffect, useState } from 'react';
import { Add, Delete } from '@mui/icons-material';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

import type { BudgetPlanInput } from '@/contexts/useDatabaseBudgetSlice';
import { BUDGET_CARRY_MODES, currentMonthKey, isBudgetCarryMode } from '@/lib/budgetCarry';
import type { BudgetCarryMode, BudgetPlanWithCategories, Category } from '@/types/database';

interface BudgetPlanEditorProps {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  plans: BudgetPlanWithCategories[];
  onSave: (input: BudgetPlanInput) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

interface EditorRow {
  category_id: number | '';
  amount: string;
  carry_mode: BudgetCarryMode;
  carry_reset: boolean;
}

const emptyRow = (): EditorRow => ({ category_id: '', amount: '', carry_mode: 'none', carry_reset: false });

export function BudgetPlanEditor({ open, onClose, categories, plans, onSave, onDelete }: BudgetPlanEditorProps) {
  const { t } = useTranslation(['budget', 'common']);
  const expenseCategories = categories.filter((category) => category.type === 'expense');
  const [effectiveMonth, setEffectiveMonth] = useState(currentMonthKey());
  const [totalAmount, setTotalAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<EditorRow[]>([emptyRow()]);
  const selectedPlan = plans.find((plan) => plan.effective_month === effectiveMonth);

  useEffect(() => {
    if (!selectedPlan) return;
    setTotalAmount(selectedPlan.total_amount == null ? '' : String(selectedPlan.total_amount));
    setNotes(selectedPlan.notes || '');
    setRows(selectedPlan.categories.map((category) => ({
      category_id: category.category_id,
      amount: String(category.amount),
      carry_mode: isBudgetCarryMode(category.carry_mode) ? category.carry_mode : 'none',
      carry_reset: Number(category.carry_reset) === 1,
    })));
  }, [selectedPlan]);

  const updateRow = (index: number, patch: Partial<EditorRow>) =>
    setRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));

  const handleSave = async () => {
    await onSave({
      effectiveMonth,
      totalAmount: totalAmount ? Number(totalAmount) : null,
      notes: notes || null,
      categories: rows
        .filter((row): row is EditorRow & { category_id: number } => typeof row.category_id === 'number' && !!row.amount)
        .map((row) => ({
          category_id: row.category_id,
          amount: Number(row.amount),
          carry_mode: row.carry_mode,
          carry_reset: row.carry_reset,
        })),
    });
    onClose();
  };

  const anyCarry = rows.some((row) => row.carry_mode !== 'none' || row.carry_reset);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('planEditor.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label={t('planEditor.effectiveMonth')} type="month" value={effectiveMonth} onChange={(event) => setEffectiveMonth(event.target.value)} fullWidth />
          <TextField label={t('planEditor.totalAmount')} type="number" value={totalAmount} onChange={(event) => setTotalAmount(event.target.value)} fullWidth />
          <Typography variant="body2" color="text.secondary">{t('planEditor.appliesHelp')}</Typography>
          {rows.map((row, index) => {
            const carryLabelId = `budget-plan-row-${index}-carry-label`;
            return (
              <Box key={index} data-testid={`budget-plan-row-${index}`} sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                <FormControl sx={{ flex: '1 1 180px', minWidth: 180 }}>
                  <InputLabel id={`budget-plan-row-${index}-category-label`}>{t('common:fields.category')}</InputLabel>
                  <Select
                    labelId={`budget-plan-row-${index}-category-label`}
                    value={row.category_id}
                    label={t('common:fields.category')}
                    onChange={(event) => updateRow(index, { category_id: Number(event.target.value) })}
                  >
                    {expenseCategories.map((category) => <MenuItem key={category.id} value={category.id}>{category.name}</MenuItem>)}
                  </Select>
                </FormControl>
                <TextField
                  label={t('common:fields.amount')}
                  type="number"
                  value={row.amount}
                  onChange={(event) => updateRow(index, { amount: event.target.value })}
                  sx={{ width: 140 }}
                />
                <FormControl sx={{ width: 170 }}>
                  <InputLabel id={carryLabelId}>{t('planEditor.carryOver')}</InputLabel>
                  <Select
                    labelId={carryLabelId}
                    value={row.carry_mode}
                    label={t('planEditor.carryOver')}
                    onChange={(event) => updateRow(index, { carry_mode: event.target.value as BudgetCarryMode })}
                  >
                    {BUDGET_CARRY_MODES.map((mode) => (
                      <MenuItem key={mode.value} value={mode.value} title={t(`carryModeDescription.${mode.value}`)}>
                        {t(`carryMode.${mode.value}`)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Tooltip describeChild title={t('planEditor.resetTooltip')}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={row.carry_reset}
                        onChange={(event) => updateRow(index, { carry_reset: event.target.checked })}
                        inputProps={{ 'aria-label': t('planEditor.resetAria') }}
                      />
                    }
                    label={t('planEditor.resetLabel')}
                    sx={{ mr: 0 }}
                  />
                </Tooltip>
                <IconButton onClick={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={t('planEditor.removeCategory')}>
                  <Delete />
                </IconButton>
              </Box>
            );
          })}
          <Button startIcon={<Add />} onClick={() => setRows((current) => [...current, emptyRow()])} sx={{ alignSelf: 'flex-start' }}>{t('planEditor.addCategory')}</Button>
          {anyCarry && (
            <Typography variant="caption" color="text.secondary">
              {t('planEditor.carryHelp')}
            </Typography>
          )}
          <TextField label={t('common:fields.notes')} value={notes} onChange={(event) => setNotes(event.target.value)} multiline minRows={2} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        {selectedPlan && <Button color="error" onClick={() => onDelete(selectedPlan.id)}>{t('planEditor.deletePlan')}</Button>}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>{t('common:actions.cancel')}</Button>
        <Button variant="contained" onClick={handleSave}>{t('common:actions.save')}</Button>
      </DialogActions>
    </Dialog>
  );
}
