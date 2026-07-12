'use client';

import { useEffect, useState } from 'react';
import { Add, Delete } from '@mui/icons-material';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, IconButton, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';

import type { BudgetPlanWithCategories, Category } from '@/types/database';

interface BudgetPlanEditorProps {
  open: boolean;
  onClose: () => void;
  categories: Category[];
  plans: BudgetPlanWithCategories[];
  onSave: (input: { effectiveMonth: string; totalAmount?: number | null; notes?: string | null; categories: Array<{ category_id: number; amount: number }> }) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

export function BudgetPlanEditor({ open, onClose, categories, plans, onSave, onDelete }: BudgetPlanEditorProps) {
  const expenseCategories = categories.filter((category) => category.type === 'expense');
  const [effectiveMonth, setEffectiveMonth] = useState(currentMonth());
  const [totalAmount, setTotalAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState<Array<{ category_id: number | ''; amount: string }>>([{ category_id: '', amount: '' }]);
  const selectedPlan = plans.find((plan) => plan.effective_month === effectiveMonth);

  useEffect(() => {
    if (!selectedPlan) return;
    setTotalAmount(selectedPlan.total_amount == null ? '' : String(selectedPlan.total_amount));
    setNotes(selectedPlan.notes || '');
    setRows(selectedPlan.categories.map((category) => ({ category_id: category.category_id, amount: String(category.amount) })));
  }, [selectedPlan]);

  const handleSave = async () => {
    await onSave({
      effectiveMonth,
      totalAmount: totalAmount ? Number(totalAmount) : null,
      notes: notes || null,
      categories: rows
        .filter((row): row is { category_id: number; amount: string } => typeof row.category_id === 'number' && !!row.amount)
        .map((row) => ({ category_id: row.category_id, amount: Number(row.amount) })),
    });
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Budget Plan</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Effective Month" type="month" value={effectiveMonth} onChange={(event) => setEffectiveMonth(event.target.value)} fullWidth />
          <TextField label="Total Amount" type="number" value={totalAmount} onChange={(event) => setTotalAmount(event.target.value)} fullWidth />
          <Typography variant="body2" color="text.secondary">This plan applies from its effective month until another plan supersedes it.</Typography>
          {rows.map((row, index) => (
            <Box key={index} sx={{ display: 'flex', gap: 1 }}>
              <FormControl fullWidth>
                <InputLabel>Category</InputLabel>
                <Select value={row.category_id} label="Category" onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, category_id: Number(event.target.value) } : item))}>
                  {expenseCategories.map((category) => <MenuItem key={category.id} value={category.id}>{category.name}</MenuItem>)}
                </Select>
              </FormControl>
              <TextField label="Amount" type="number" value={row.amount} onChange={(event) => setRows((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, amount: event.target.value } : item))} sx={{ width: 160 }} />
              <IconButton onClick={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label="Remove category">
                <Delete />
              </IconButton>
            </Box>
          ))}
          <Button startIcon={<Add />} onClick={() => setRows((current) => [...current, { category_id: '', amount: '' }])}>Add Category</Button>
          <TextField label="Notes" value={notes} onChange={(event) => setNotes(event.target.value)} multiline minRows={2} fullWidth />
        </Stack>
      </DialogContent>
      <DialogActions>
        {selectedPlan && <Button color="error" onClick={() => onDelete(selectedPlan.id)}>Delete Plan</Button>}
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}