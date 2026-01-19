'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Autocomplete,
  Chip,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { useDatabaseContext } from '@/contexts/DatabaseContext';
import { Transaction, Category, Company, Account, Project } from '@/types/database';

interface AddTransactionProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddTransaction({ open, onClose, onSuccess }: AddTransactionProps) {
  const { 
    addTransaction, 
    addCategory, 
    addCompany, 
    addAccount,
    categories,
    companies,
    accounts,
    projects
  } = useDatabaseContext();  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    date: new Date(),
    type: 'expense' as 'income' | 'expense',
    category_id: null as number | null,
    company_id: null as number | null,
    project_id: null as number | null,
    account_id: 0,
    is_recurring: false,
  });
  const [loading, setLoading] = useState(false);
  const [companyInput, setCompanyInput] = useState('');
  const [categoryInput, setCategoryInput] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    try {      // Validate required fields
      if (!formData.description.trim()) {
        throw new Error('Description is required');
      }
      if (!formData.amount || parseFloat(formData.amount) <= 0) {
        throw new Error('Amount must be greater than 0');
      }
      if (!formData.account_id) {
        throw new Error('Please select an account');
      }

      // Handle new category creation
      let categoryId = formData.category_id;
      if (!categoryId && categoryInput.trim()) {
        categoryId = await addCategory({
          name: categoryInput.trim(),
          type: formData.type,
          color: generateRandomColor(),
        });
      }

      // If no category is selected and no new category is created, 
      // we'll allow the transaction without a category (null)
      
      // Handle new company creation
      let companyId = formData.company_id;
      if (!companyId && companyInput.trim()) {
        companyId = await addCompany(companyInput.trim());
      }

      // Create the transaction
      const transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'> = {
        description: formData.description,
        amount: formData.type === 'expense' ? -Math.abs(parseFloat(formData.amount)) : Math.abs(parseFloat(formData.amount)),
        date: formData.date.toISOString().split('T')[0],
        type: formData.type,
        category_id: categoryId || null,
        company_id: companyId || null,
        project_id: formData.project_id || null,
        account_id: formData.account_id,
        trip_id: null, // Trip association handled separately
      };

      await addTransaction(transaction);
      onSuccess();
      handleClose();
    } catch (error) {
      console.error('Error adding transaction:', error);
    } finally {
      setLoading(false);
    }
  };
  const handleClose = () => {
    setFormData({
      description: '',
      amount: '',
      date: new Date(),
      type: 'expense',
      category_id: null,
      company_id: null,
      project_id: null,
      account_id: 0,
      is_recurring: false,
    });
    setCompanyInput('');
    setCategoryInput('');
    onClose();
  };

  const generateRandomColor = () => {
    const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722'];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  const filteredCategories = categories.filter(cat => cat.type === formData.type);

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>Add New Transaction</DialogTitle>
        <form onSubmit={handleSubmit}>
          <DialogContent>
            <Box display="flex" flexDirection="column" gap={2}>              <FormControl fullWidth>
                <InputLabel>Transaction Type</InputLabel>
                <Select
                  value={formData.type}
                  label="Transaction Type"
                  onChange={(e) =>                  setFormData({ 
                    ...formData, 
                    type: e.target.value as 'income' | 'expense', 
                    category_id: null,
                    project_id: e.target.value === 'income' ? null : formData.project_id
                  })}
                >
                  <MenuItem value="expense">Expense</MenuItem>
                  <MenuItem value="income">Income</MenuItem>
                </Select>
              </FormControl>

              <TextField
                label="Description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                required
                fullWidth
              />

              <TextField
                label="Amount"
                type="number"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                required
                fullWidth
                inputProps={{ step: 0.01, min: 0 }}
              />              <DatePicker
                label="Date"
                value={formData.date}
                onChange={(date: Date | null) => setFormData({ ...formData, date: date || new Date() })}
                slotProps={{ textField: { fullWidth: true } }}
              />

              <Autocomplete
                freeSolo
                options={filteredCategories}
                getOptionLabel={(option) => typeof option === 'string' ? option : option.name}
                value={filteredCategories.find(cat => cat.id === formData.category_id) || null}
                onChange={(_, value) => {
                  if (value && typeof value !== 'string') {
                    setFormData({ ...formData, category_id: value.id });
                    setCategoryInput('');
                  } else {
                    setFormData({ ...formData, category_id: null });
                  }
                }}
                inputValue={categoryInput}
                onInputChange={(_, value) => setCategoryInput(value)}
                renderInput={(params) => (
                  <TextField {...params} label="Category" helperText="Type to create a new category" />
                )}                renderTags={(value, getTagProps) =>
                  value.map((option, index) => {
                    const { key, ...chipProps } = getTagProps({ index });
                    return (
                      <Chip
                        key={key}
                        label={typeof option === 'string' ? option : option.name}
                        {...chipProps}
                      />
                    );
                  })
                }
              />              <Autocomplete
                freeSolo
                options={companies}
                getOptionLabel={(option) => typeof option === 'string' ? option : option.name}
                value={companies.find(comp => comp.id === formData.company_id) || null}
                onChange={(_, value) => {
                  if (value && typeof value !== 'string') {
                    setFormData({ ...formData, company_id: value.id });
                    setCompanyInput('');
                  } else {
                    setFormData({ ...formData, company_id: null });
                  }
                }}
                inputValue={companyInput}
                onInputChange={(_, value) => setCompanyInput(value)}
                renderInput={(params) => (
                  <TextField {...params} label="Company (Optional)" helperText="Type to create a new company" />
                )}
              />              {formData.type === 'expense' && (
                <Autocomplete
                  options={projects.filter(project => project.status !== 'completed')}
                  getOptionLabel={(option) => `${option.name} - ${option.company_name}`}
                  value={projects.find(proj => proj.id === formData.project_id) || null}
                  onChange={(_, value) => {
                    setFormData({ ...formData, project_id: value ? value.id : null });
                  }}
                  renderInput={(params) => (
                    <TextField 
                      {...params} 
                      label="House Project (Optional)" 
                      helperText="Link this expense to a house project" 
                    />
                  )}                  renderOption={(props, option) => {
                    const { key, ...otherProps } = props;
                    return (
                      <Box component="li" key={key} {...otherProps}>
                        <Box>
                          <Box sx={{ fontWeight: 'bold' }}>{option.name}</Box>
                          <Box sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
                            {option.company_name} • {option.status.replace('_', ' ')}
                          </Box>
                        </Box>
                      </Box>
                    );
                  }}
                />
              )}

              <FormControl fullWidth>
                <InputLabel>Account</InputLabel>
                <Select
                  value={formData.account_id}
                  label="Account"
                  onChange={(e) => setFormData({ ...formData, account_id: e.target.value })}
                  required
                >
                  {accounts.map((account) => (
                    <MenuItem key={account.id} value={account.id}>
                      {account.name} ({account.type})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControlLabel
                control={
                  <Checkbox
                    checked={formData.is_recurring}
                    onChange={(e) => setFormData({ ...formData, is_recurring: e.target.checked })}
                  />
                }
                label="Recurring Transaction"
              />
            </Box>
          </DialogContent>
          <DialogActions>
            <Button onClick={handleClose}>Cancel</Button>
            <Button type="submit" variant="contained" disabled={loading}>
              {loading ? 'Adding...' : 'Add Transaction'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </LocalizationProvider>
  );
}
