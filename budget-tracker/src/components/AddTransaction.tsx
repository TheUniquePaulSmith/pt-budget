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
import { Transaction, Category, Company, Account } from '@/lib/database';

interface AddTransactionProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function AddTransaction({ open, onClose, onSuccess }: AddTransactionProps) {
  const { db } = useDatabaseContext();
  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    date: new Date(),
    type: 'expense' as 'income' | 'expense',
    category_id: '',
    company_id: null as string | null,
    account_last_four: '',
    is_recurring: false,
  });

  const [categories, setCategories] = useState<Category[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);  const [companyInput, setCompanyInput] = useState('');
  const [categoryInput, setCategoryInput] = useState('');

  const loadFormData = useCallback(async () => {
    if (!db) return;

    try {
      const [categoriesData, companiesData, accountsData] = await Promise.all([
        db.getCategories(),
        db.getCompanies(),
        db.getAccounts(),
      ]);

      setCategories(categoriesData);
      setCompanies(companiesData);
      setAccounts(accountsData);
    } catch (error) {
      console.error('Error loading form data:', error);
    }
  }, [db]);

  useEffect(() => {
    if (open && db) {
      loadFormData();
    }
  }, [open, db, loadFormData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!db) return;

    setLoading(true);
    try {      // Handle new category creation
      let categoryId = formData.category_id;
      if (!categoryId && categoryInput.trim()) {
        categoryId = await db.addCategory({
          name: categoryInput.trim(),
          type: formData.type,
          color: generateRandomColor(),
        });
      }

      // Handle new company creation
      let companyId = formData.company_id;
      if (!companyId && companyInput.trim()) {
        companyId = await db.addCompany(companyInput.trim());
      }      // Handle new account creation
      const accountLastFour = formData.account_last_four;
      if (accountLastFour && !accounts.find(acc => acc.last_four === accountLastFour)) {
        await db.addAccount({
          name: `Account ending in ${accountLastFour}`,
          last_four: accountLastFour,
          type: formData.type === 'income' ? 'checking' : 'credit',
        });
      }      // Create the transaction
      const transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'> = {
        description: formData.description,
        amount: formData.type === 'expense' ? -Math.abs(parseFloat(formData.amount)) : Math.abs(parseFloat(formData.amount)),
        date: formData.date.toISOString().split('T')[0],
        type: formData.type,
        category_id: categoryId || 'cat-1', // fallback to default category
        company_id: companyId || undefined,
        account_last_four: accountLastFour || '0000', // fallback to default
      };

      await db.addTransaction(transaction);
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
      category_id: '',
      company_id: null,
      account_last_four: '',
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
            <Box display="flex" flexDirection="column" gap={2}>
              <FormControl fullWidth>
                <InputLabel>Transaction Type</InputLabel>
                <Select
                  value={formData.type}
                  label="Transaction Type"
                  onChange={(e) => setFormData({ ...formData, type: e.target.value as 'income' | 'expense', category_id: '' })}
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
                    setFormData({ ...formData, category_id: '' });
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
              />

              <Autocomplete
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
              />

              <Autocomplete
                freeSolo
                options={accounts}
                getOptionLabel={(option) => typeof option === 'string' ? option : option.last_four}
                value={accounts.find(acc => acc.last_four === formData.account_last_four) || null}
                onChange={(_, value) => {
                  if (value && typeof value !== 'string') {
                    setFormData({ ...formData, account_last_four: value.last_four });
                  }
                }}
                inputValue={formData.account_last_four}
                onInputChange={(_, value) => setFormData({ ...formData, account_last_four: value })}
                renderInput={(params) => (
                  <TextField 
                    {...params} 
                    label="Account Last 4 Digits (Optional)" 
                    helperText="Enter last 4 digits of account number"
                    inputProps={{
                      ...params.inputProps,
                      maxLength: 4,
                      pattern: '[0-9]{4}',
                    }}
                  />
                )}
              />

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
