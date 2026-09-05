'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Alert,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  FormControl,
  FormHelperText,
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
import { parseISO } from 'date-fns';
import { useTransactionComposerSlice } from '@/contexts/useDatabaseSlices';
import { toLocalDateOnly } from '@/lib/dateOnly';
import { Transaction, TransactionType, AccountCard } from '@/types/database';

interface AddTransactionProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** 'edit' prefills the form from `transaction` and saves changes to that row. */
  mode?: 'add' | 'edit';
  transaction?: Transaction | null;
}

type TransferDirection = 'out' | 'in';

// Categories are income or expense; refunds file under the expense category
// they reverse, and transfers have no category of their own.
function categoryTypeFor(type: TransactionType): 'income' | 'expense' {
  return type === 'income' ? 'income' : 'expense';
}

function signedAmount(type: TransactionType, amount: number, direction: TransferDirection): number {
  const magnitude = Math.abs(amount);
  if (type === 'expense') return -magnitude;
  if (type === 'income' || type === 'refund') return magnitude;
  return direction === 'out' ? -magnitude : magnitude;
}

const EMPTY_FORM = {
  description: '',
  amount: '',
  date: new Date(),
  type: 'expense' as TransactionType,
  direction: 'out' as TransferDirection,
  category_id: null as number | null,
  company_id: null as number | null,
  project_id: null as number | null,
  account_id: '' as number | '',
  card_id: null as number | null,
  is_recurring: false,
};

export default function AddTransaction({
  open,
  onClose,
  onSuccess,
  mode = 'add',
  transaction = null,
}: AddTransactionProps) {
  const {
    addTransaction,
    updateTransaction,
    addCategory,
    addCompany,
    categories,
    companies,
    accounts,
    getAccountCards,
    projects
  } = useTransactionComposerSlice();
  const isEdit = mode === 'edit' && transaction != null;
  const [formData, setFormData] = useState({ ...EMPTY_FORM, date: new Date() });
  const [accountCards, setAccountCards] = useState<AccountCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [companyInput, setCompanyInput] = useState('');
  const [categoryInput, setCategoryInput] = useState('');

  // Prefill from the row being edited whenever the dialog opens in edit mode.
  useEffect(() => {
    if (!open || !isEdit || !transaction) return;
    setFormData({
      description: transaction.description,
      amount: String(Math.abs(transaction.amount)),
      date: parseISO(transaction.date),
      type: transaction.type,
      direction: transaction.amount < 0 ? 'out' : 'in',
      category_id: transaction.category_id ?? null,
      company_id: transaction.company_id ?? null,
      project_id: transaction.project_id ?? null,
      account_id: transaction.account_id,
      card_id: transaction.card_id ?? null,
      is_recurring: false,
    });
    setSubmitError(null);
  }, [open, isEdit, transaction]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    setSubmitError(null);
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
          type: categoryTypeFor(formData.type),
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

      const amount = signedAmount(formData.type, parseFloat(formData.amount), formData.direction);
      // Local calendar date: toISOString() would roll an evening entry to tomorrow.
      const date = toLocalDateOnly(formData.date);

      if (isEdit && transaction) {
        await updateTransaction(transaction.id, {
          description: formData.description,
          amount,
          date,
          type: formData.type,
          category_id: categoryId || null,
          company_id: companyId || null,
          project_id: formData.project_id || null,
          account_id: Number(formData.account_id),
          card_id: formData.card_id,
        });
      } else {
        const newTransaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'> = {
          description: formData.description,
          amount,
          date,
          type: formData.type,
          category_id: categoryId || null,
          company_id: companyId || null,
          project_id: formData.project_id || null,
          account_id: Number(formData.account_id),
          card_id: formData.card_id,
          trip_id: null, // Trip association handled separately
        };
        await addTransaction(newTransaction);
      }
      onSuccess();
      handleClose();
    } catch (error) {
      console.error(isEdit ? 'Error updating transaction:' : 'Error adding transaction:', error);
      setSubmitError(error instanceof Error ? error.message : 'The transaction could not be saved');
    } finally {
      setLoading(false);
    }
  };
  const handleClose = () => {
    setFormData({ ...EMPTY_FORM, date: new Date() });
    setAccountCards([]);
    setCompanyInput('');
    setCategoryInput('');
    setSubmitError(null);
    onClose();
  };

  const generateRandomColor = () => {
    const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50', '#8bc34a', '#cddc39', '#ffeb3b', '#ffc107', '#ff9800', '#ff5722'];
    return colors[Math.floor(Math.random() * colors.length)];
  };

  const filteredCategories = categories.filter(cat => cat.type === categoryTypeFor(formData.type));

  useEffect(() => {
    if (!formData.account_id) {
      setAccountCards([]);
      setFormData((current) => ({ ...current, card_id: null }));
      return;
    }

    let cancelled = false;
    getAccountCards(Number(formData.account_id))
      .then((cards) => {
        if (cancelled) return;
        setAccountCards(cards);
        setFormData((current) => ({
          ...current,
          card_id: cards.some((card) => card.id === current.card_id)
            ? current.card_id
            : cards[0]?.id ?? null,
        }));
      })
      .catch((error) => {
        console.error('Failed to load account cards:', error);
        if (!cancelled) setAccountCards([]);
      });

    return () => {
      cancelled = true;
    };
  }, [formData.account_id, getAccountCards]);

  return (
    <LocalizationProvider dateAdapter={AdapterDateFns}>
      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle>{isEdit ? 'Edit Transaction' : 'Add New Transaction'}</DialogTitle>
        <form onSubmit={handleSubmit}>
          <DialogContent>
            <Box display="flex" flexDirection="column" gap={2}>
              {submitError && <Alert severity="error">{submitError}</Alert>}
              <FormControl fullWidth>
                <InputLabel>Transaction Type</InputLabel>
                <Select
                  value={formData.type}
                  label="Transaction Type"
                  onChange={(e) => {
                    const nextType = e.target.value as TransactionType;
                    setFormData({
                      ...formData,
                      type: nextType,
                      category_id: categoryTypeFor(nextType) === categoryTypeFor(formData.type) ? formData.category_id : null,
                      project_id: nextType === 'income' || nextType === 'transfer' ? null : formData.project_id,
                    });
                  }}
                >
                  <MenuItem value="expense">Expense</MenuItem>
                  <MenuItem value="income">Income</MenuItem>
                  <MenuItem value="refund">Refund (money back from a merchant)</MenuItem>
                  <MenuItem value="transfer">Transfer (between your own accounts)</MenuItem>
                </Select>
                {formData.type === 'refund' && (
                  <FormHelperText>Counts against spending in its category, not as income.</FormHelperText>
                )}
                {formData.type === 'transfer' && (
                  <FormHelperText>Card payments, savings moves and loan payments. Counts as neither income nor spending.</FormHelperText>
                )}
              </FormControl>
              {formData.type === 'transfer' && (
                <FormControl fullWidth>
                  <InputLabel>Direction</InputLabel>
                  <Select
                    value={formData.direction}
                    label="Direction"
                    onChange={(e) => setFormData({ ...formData, direction: e.target.value as TransferDirection })}
                  >
                    <MenuItem value="out">Money out of this account</MenuItem>
                    <MenuItem value="in">Money into this account</MenuItem>
                  </Select>
                </FormControl>
              )}

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
                <InputLabel id="add-transaction-account-label">Account</InputLabel>
                <Select<number | ''>
                  labelId="add-transaction-account-label"
                  value={formData.account_id}
                  label="Account"
                  onChange={(e) => {
                    const value = e.target.value;
                    setFormData({
                      ...formData,
                      account_id: value === '' ? '' : Number(value),
                      card_id: null,
                    });
                  }}
                  required
                >
                  <MenuItem value="">
                    <em>Select an account</em>
                  </MenuItem>
                  {accounts.map((account) => (
                    <MenuItem key={account.id} value={account.id}>
                      {account.name} ({account.type})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl fullWidth disabled={!formData.account_id || accountCards.length === 0}>
                <InputLabel id="add-transaction-card-label">Card</InputLabel>
                <Select<number | ''>
                  labelId="add-transaction-card-label"
                  value={formData.card_id ?? ''}
                  label="Card"
                  onChange={(e) => {
                    const value = e.target.value;
                    setFormData({
                      ...formData,
                      card_id: value === '' ? null : Number(value),
                    });
                  }}
                >
                  <MenuItem value="">
                    <em>No card</em>
                  </MenuItem>
                  {accountCards.map((card) => (
                    <MenuItem key={card.id} value={card.id}>
                      {card.nickname ? `${card.nickname} - ` : ''}••{card.last_four}
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
              {loading ? (isEdit ? 'Saving...' : 'Adding...') : isEdit ? 'Save Changes' : 'Add Transaction'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </LocalizationProvider>
  );
}
