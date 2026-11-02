'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';

import type { Account, Loan, LoanInput, LoanStatus, LoanType, Project, User } from '@/types/database';
import { LOAN_STATUS_OPTIONS, LOAN_TYPE_OPTIONS } from './loanPresentation';

interface LoanFormState {
  name: string;
  loan_type: LoanType;
  status: LoanStatus;
  owner_user_id: string;
  project_id: string;
  account_id: string;
  lender: string;
  opened_date: string;
  original_principal: string;
  interest_rate: string;
  term_months: string;
  expected_payment: string;
  payment_due_day: string;
  first_payment_date: string;
  allows_full_payoff: boolean;
  prepayment_terms: string;
  promo_end_date: string;
  deferred_interest_rate: string;
  notes: string;
}

const EMPTY_FORM: LoanFormState = {
  name: '',
  loan_type: 'installment',
  status: 'active',
  owner_user_id: '',
  project_id: '',
  account_id: '',
  lender: '',
  opened_date: '',
  original_principal: '',
  interest_rate: '',
  term_months: '',
  expected_payment: '',
  payment_due_day: '',
  first_payment_date: '',
  allows_full_payoff: true,
  prepayment_terms: '',
  promo_end_date: '',
  deferred_interest_rate: '',
  notes: '',
};

function formFromLoan(loan: Loan): LoanFormState {
  return {
    name: loan.name,
    loan_type: loan.loan_type,
    status: loan.status,
    owner_user_id: String(loan.owner_user_id),
    project_id: loan.project_id != null ? String(loan.project_id) : '',
    account_id: loan.account_id != null ? String(loan.account_id) : '',
    lender: loan.lender ?? '',
    opened_date: loan.opened_date ?? '',
    original_principal: loan.original_principal != null ? String(loan.original_principal) : '',
    interest_rate: loan.interest_rate != null ? String(loan.interest_rate) : '',
    term_months: loan.term_months != null ? String(loan.term_months) : '',
    expected_payment: loan.expected_payment != null ? String(loan.expected_payment) : '',
    payment_due_day: loan.payment_due_day != null ? String(loan.payment_due_day) : '',
    first_payment_date: loan.first_payment_date ?? '',
    allows_full_payoff: Boolean(loan.allows_full_payoff),
    prepayment_terms: loan.prepayment_terms ?? '',
    promo_end_date: loan.promo_end_date ?? '',
    deferred_interest_rate: loan.deferred_interest_rate != null ? String(loan.deferred_interest_rate) : '',
    notes: loan.notes ?? '',
  };
}

function numberOrNull(text: string, label: string, options: { integer?: boolean } = {}): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) throw new Error(`${label} must be a number`);
  if (options.integer && !Number.isInteger(value)) throw new Error(`${label} must be a whole number`);
  return value;
}

export function loanInputFromForm(form: LoanFormState): LoanInput {
  const ownerId = Number(form.owner_user_id);
  if (!ownerId) throw new Error('Pick who the loan belongs to');
  return {
    name: form.name.trim(),
    loan_type: form.loan_type,
    status: form.status,
    owner_user_id: ownerId,
    project_id: form.project_id ? Number(form.project_id) : null,
    account_id: form.account_id ? Number(form.account_id) : null,
    lender: form.lender.trim() || null,
    opened_date: form.opened_date || null,
    original_principal: numberOrNull(form.original_principal, 'Original amount') ?? 0,
    interest_rate: numberOrNull(form.interest_rate, 'Interest rate'),
    term_months: numberOrNull(form.term_months, 'Term', { integer: true }),
    expected_payment: numberOrNull(form.expected_payment, 'Expected payment'),
    payment_due_day: numberOrNull(form.payment_due_day, 'Payment due day', { integer: true }),
    first_payment_date: form.first_payment_date || null,
    allows_full_payoff: form.allows_full_payoff ? 1 : 0,
    prepayment_terms: form.prepayment_terms.trim() || null,
    promo_end_date: form.loan_type === 'deferred_interest' ? form.promo_end_date || null : form.promo_end_date || null,
    deferred_interest_rate: numberOrNull(form.deferred_interest_rate, 'Deferred interest rate'),
    notes: form.notes.trim() || null,
  };
}

interface LoanFormDialogProps {
  open: boolean;
  loan: Loan | null;
  users: User[];
  projects: Project[];
  accounts: Account[];
  onClose: () => void;
  onSubmit: (input: LoanInput) => Promise<void>;
}

const fieldSx = { flex: '1 1 200px' } as const;

export default function LoanFormDialog({ open, loan, users, projects, accounts, onClose, onSubmit }: LoanFormDialogProps) {
  const [form, setForm] = useState<LoanFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (loan) {
      setForm(formFromLoan(loan));
    } else {
      const primary = users.find((user) => user.is_primary) ?? users[0];
      setForm({ ...EMPTY_FORM, owner_user_id: primary ? String(primary.id) : '' });
    }
    setError(null);
  }, [loan, open, users]);

  const liabilityAccounts = useMemo(
    () => accounts.filter((account) => account.type === 'loan' || account.type === 'credit'),
    [accounts]
  );

  const set = (field: keyof LoanFormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((previous) => ({ ...previous, [field]: event.target.value }));
  };

  const isDeferred = form.loan_type === 'deferred_interest';
  const typeOption = LOAN_TYPE_OPTIONS.find((option) => option.value === form.loan_type);

  const handleSubmit = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError('A loan needs a name');
      return;
    }
    if (isDeferred && !form.promo_end_date) {
      setError('Enter the date the balance must be paid by to avoid deferred interest');
      return;
    }
    let input: LoanInput;
    try {
      input = loanInputFromForm(form);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check the loan details');
      return;
    }
    setSaving(true);
    try {
      await onSubmit(input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save loan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{loan ? `Edit ${loan.name}` : 'Add Loan'}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} data-testid="loan-form-error">
            {error}
          </Alert>
        )}

        <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1, mb: 1 }}>
          Basics
        </Typography>
        <Box display="flex" flexWrap="wrap" gap={2} mb={3}>
          <TextField
            label="Name"
            value={form.name}
            onChange={set('name')}
            required
            autoFocus
            size="small"
            sx={{ flex: '2 1 260px' }}
            slotProps={{ htmlInput: { 'data-testid': 'loan-name' } }}
          />
          <TextField select label="Type" value={form.loan_type} onChange={set('loan_type')} size="small" sx={fieldSx} helperText={typeOption?.description}>
            {LOAN_TYPE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Owner" value={form.owner_user_id} onChange={set('owner_user_id')} size="small" required sx={fieldSx}>
            {users.map((user) => (
              <MenuItem key={user.id} value={String(user.id)}>
                {user.display_name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Lender"
            value={form.lender}
            onChange={set('lender')}
            size="small"
            sx={fieldSx}
            helperText="Who the loan is through (bank, Synchrony, dealer…)"
          />
          <TextField select label="Project" value={form.project_id} onChange={set('project_id')} size="small" sx={fieldSx} helperText="Optional: the work this loan paid for">
            <MenuItem value="">None</MenuItem>
            {projects.map((project) => (
              <MenuItem key={project.id} value={String(project.id)}>
                {project.name}
                {project.company_name ? ` — ${project.company_name}` : ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Linked account"
            value={form.account_id}
            onChange={set('account_id')}
            size="small"
            sx={fieldSx}
            helperText="Optional: a tracked loan / credit account whose balance follows this loan"
          >
            <MenuItem value="">None</MenuItem>
            {liabilityAccounts.map((account) => (
              <MenuItem key={account.id} value={String(account.id)}>
                {account.name}
              </MenuItem>
            ))}
          </TextField>
          {loan && (
            <TextField select label="Status" value={form.status} onChange={set('status')} size="small" sx={fieldSx}>
              {LOAN_STATUS_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Box>

        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          Terms
        </Typography>
        <Box display="flex" flexWrap="wrap" gap={2} mb={3}>
          <TextField
            label="Opened"
            type="date"
            value={form.opened_date}
            onChange={set('opened_date')}
            size="small"
            sx={fieldSx}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label="Original amount"
            value={form.original_principal}
            onChange={set('original_principal')}
            size="small"
            sx={fieldSx}
            slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'loan-original-principal' } }}
          />
          <TextField
            label={isDeferred ? 'Promo APR (%)' : 'APR (%)'}
            value={form.interest_rate}
            onChange={set('interest_rate')}
            size="small"
            sx={fieldSx}
            helperText={isDeferred ? 'Usually 0 during the promo' : 'Leave empty for no interest'}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          <TextField
            label="Term (months)"
            value={form.term_months}
            onChange={set('term_months')}
            size="small"
            sx={fieldSx}
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          />
          <TextField
            label="Expected payment"
            value={form.expected_payment}
            onChange={set('expected_payment')}
            size="small"
            sx={fieldSx}
            helperText="Scheduled monthly payment; drives the projection"
            slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'loan-expected-payment' } }}
          />
          <TextField
            label="Due day of month"
            value={form.payment_due_day}
            onChange={set('payment_due_day')}
            size="small"
            sx={fieldSx}
            slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 31 } }}
          />
          <TextField
            label="First payment"
            type="date"
            value={form.first_payment_date}
            onChange={set('first_payment_date')}
            size="small"
            sx={fieldSx}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>

        {isDeferred && (
          <>
            <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
              Deferred interest
            </Typography>
            <Box display="flex" flexWrap="wrap" gap={2} mb={3}>
              <TextField
                label="Pay off by"
                type="date"
                value={form.promo_end_date}
                onChange={set('promo_end_date')}
                size="small"
                required
                sx={fieldSx}
                helperText="Balance must be zero by this date to avoid the charge"
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'data-testid': 'loan-promo-end' } }}
              />
              <TextField
                label="Deferred APR (%)"
                value={form.deferred_interest_rate}
                onChange={set('deferred_interest_rate')}
                size="small"
                sx={fieldSx}
                helperText="Charged back from the opening date if the promo is missed"
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
            </Box>
          </>
        )}

        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          Payoff and notes
        </Typography>
        <Box display="flex" flexWrap="wrap" gap={2} alignItems="flex-start">
          <FormControlLabel
            control={
              <Switch
                checked={form.allows_full_payoff}
                onChange={(event) => setForm((previous) => ({ ...previous, allows_full_payoff: event.target.checked }))}
              />
            }
            label="Full payoff allowed at any time"
            sx={{ flex: '1 1 240px' }}
          />
          {!form.allows_full_payoff && (
            <TextField
              label="Prepayment terms"
              value={form.prepayment_terms}
              onChange={set('prepayment_terms')}
              size="small"
              sx={{ flex: '2 1 260px' }}
              helperText="Penalty or restriction the lender applies"
            />
          )}
          <TextField label="Notes" value={form.notes} onChange={set('notes')} size="small" fullWidth multiline minRows={2} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving} data-testid="loan-form-save">
          {saving ? 'Saving…' : loan ? 'Save' : 'Add Loan'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
