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
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { Account, Loan, LoanInput, LoanStatus, LoanType, Project, User } from '@/types/database';
import { LOAN_STATUS_OPTIONS, LOAN_TYPE_VALUES, loanTypeDescription, loanTypeLabel } from './loanPresentation';

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

function numberOrNull(t: TFunction<'loans'>, text: string, label: string, options: { integer?: boolean } = {}): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) throw new Error(t('formDialog.mustBeNumber', { label }));
  if (options.integer && !Number.isInteger(value)) throw new Error(t('formDialog.mustBeWholeNumber', { label }));
  return value;
}

/** Validates the form; throws a user-facing (translated) message when a field is invalid. */
export function loanInputFromForm(form: LoanFormState, t: TFunction<'loans'>): LoanInput {
  const ownerId = Number(form.owner_user_id);
  if (!ownerId) throw new Error(t('formDialog.pickOwner'));
  return {
    name: form.name.trim(),
    loan_type: form.loan_type,
    status: form.status,
    owner_user_id: ownerId,
    project_id: form.project_id ? Number(form.project_id) : null,
    account_id: form.account_id ? Number(form.account_id) : null,
    lender: form.lender.trim() || null,
    opened_date: form.opened_date || null,
    original_principal: numberOrNull(t, form.original_principal, t('formDialog.fieldOriginalAmount')) ?? 0,
    interest_rate: numberOrNull(t, form.interest_rate, t('formDialog.fieldInterestRate')),
    term_months: numberOrNull(t, form.term_months, t('formDialog.fieldTerm'), { integer: true }),
    expected_payment: numberOrNull(t, form.expected_payment, t('formDialog.fieldExpectedPayment')),
    payment_due_day: numberOrNull(t, form.payment_due_day, t('formDialog.fieldPaymentDueDay'), { integer: true }),
    first_payment_date: form.first_payment_date || null,
    allows_full_payoff: form.allows_full_payoff ? 1 : 0,
    prepayment_terms: form.prepayment_terms.trim() || null,
    promo_end_date: form.loan_type === 'deferred_interest' ? form.promo_end_date || null : form.promo_end_date || null,
    deferred_interest_rate: numberOrNull(t, form.deferred_interest_rate, t('formDialog.fieldDeferredInterestRate')),
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
  const { t } = useTranslation('loans');
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

  const handleSubmit = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError(t('formDialog.nameRequired'));
      return;
    }
    if (isDeferred && !form.promo_end_date) {
      setError(t('formDialog.promoEndRequired'));
      return;
    }
    let input: LoanInput;
    try {
      input = loanInputFromForm(form, t);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('formDialog.checkDetails'));
      return;
    }
    setSaving(true);
    try {
      await onSubmit(input);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('formDialog.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>{loan ? t('formDialog.editTitle', { name: loan.name }) : t('formDialog.addTitle')}</DialogTitle>
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} data-testid="loan-form-error">
            {error}
          </Alert>
        )}

        <Typography variant="subtitle2" color="text.secondary" sx={{ mt: 1, mb: 1 }}>
          {t('formDialog.basics')}
        </Typography>
        <Box display="flex" flexWrap="wrap" gap={2} mb={3}>
          <TextField
            label={t('formDialog.name')}
            value={form.name}
            onChange={set('name')}
            required
            autoFocus
            size="small"
            sx={{ flex: '2 1 260px' }}
            slotProps={{ htmlInput: { 'data-testid': 'loan-name' } }}
          />
          <TextField select label={t('formDialog.type')} value={form.loan_type} onChange={set('loan_type')} size="small" sx={fieldSx} helperText={loanTypeDescription(t, form.loan_type)}>
            {LOAN_TYPE_VALUES.map((value) => (
              <MenuItem key={value} value={value}>
                {loanTypeLabel(t, value)}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label={t('formDialog.owner')} value={form.owner_user_id} onChange={set('owner_user_id')} size="small" required sx={fieldSx}>
            {users.map((user) => (
              <MenuItem key={user.id} value={String(user.id)}>
                {user.display_name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t('formDialog.lender')}
            value={form.lender}
            onChange={set('lender')}
            size="small"
            sx={fieldSx}
            helperText={t('formDialog.lenderHelp')}
          />
          <TextField select label={t('formDialog.project')} value={form.project_id} onChange={set('project_id')} size="small" sx={fieldSx} helperText={t('formDialog.projectHelp')}>
            <MenuItem value="">{t('formDialog.none')}</MenuItem>
            {projects.map((project) => (
              <MenuItem key={project.id} value={String(project.id)}>
                {project.name}
                {project.company_name ? ` — ${project.company_name}` : ''}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label={t('formDialog.linkedAccount')}
            value={form.account_id}
            onChange={set('account_id')}
            size="small"
            sx={fieldSx}
            helperText={t('formDialog.linkedAccountHelp')}
          >
            <MenuItem value="">{t('formDialog.none')}</MenuItem>
            {liabilityAccounts.map((account) => (
              <MenuItem key={account.id} value={String(account.id)}>
                {account.name}
              </MenuItem>
            ))}
          </TextField>
          {loan && (
            <TextField select label={t('formDialog.status')} value={form.status} onChange={set('status')} size="small" sx={fieldSx}>
              {LOAN_STATUS_OPTIONS.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {t(`status.${option.value}`)}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Box>

        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          {t('formDialog.terms')}
        </Typography>
        <Box display="flex" flexWrap="wrap" gap={2} mb={3}>
          <TextField
            label={t('formDialog.opened')}
            type="date"
            value={form.opened_date}
            onChange={set('opened_date')}
            size="small"
            sx={fieldSx}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            label={t('formDialog.originalAmount')}
            value={form.original_principal}
            onChange={set('original_principal')}
            size="small"
            sx={fieldSx}
            slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'loan-original-principal' } }}
          />
          <TextField
            label={isDeferred ? t('formDialog.promoApr') : t('formDialog.apr')}
            value={form.interest_rate}
            onChange={set('interest_rate')}
            size="small"
            sx={fieldSx}
            helperText={isDeferred ? t('formDialog.promoAprHelp') : t('formDialog.aprHelp')}
            slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          />
          <TextField
            label={t('formDialog.termMonths')}
            value={form.term_months}
            onChange={set('term_months')}
            size="small"
            sx={fieldSx}
            slotProps={{ htmlInput: { inputMode: 'numeric' } }}
          />
          <TextField
            label={t('formDialog.expectedPayment')}
            value={form.expected_payment}
            onChange={set('expected_payment')}
            size="small"
            sx={fieldSx}
            helperText={t('formDialog.expectedPaymentHelp')}
            slotProps={{ htmlInput: { inputMode: 'decimal', 'data-testid': 'loan-expected-payment' } }}
          />
          <TextField
            label={t('formDialog.dueDay')}
            value={form.payment_due_day}
            onChange={set('payment_due_day')}
            size="small"
            sx={fieldSx}
            slotProps={{ htmlInput: { inputMode: 'numeric', min: 1, max: 31 } }}
          />
          <TextField
            label={t('formDialog.firstPayment')}
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
              {t('formDialog.deferredInterest')}
            </Typography>
            <Box display="flex" flexWrap="wrap" gap={2} mb={3}>
              <TextField
                label={t('formDialog.payOffBy')}
                type="date"
                value={form.promo_end_date}
                onChange={set('promo_end_date')}
                size="small"
                required
                sx={fieldSx}
                helperText={t('formDialog.payOffByHelp')}
                slotProps={{ inputLabel: { shrink: true }, htmlInput: { 'data-testid': 'loan-promo-end' } }}
              />
              <TextField
                label={t('formDialog.deferredApr')}
                value={form.deferred_interest_rate}
                onChange={set('deferred_interest_rate')}
                size="small"
                sx={fieldSx}
                helperText={t('formDialog.deferredAprHelp')}
                slotProps={{ htmlInput: { inputMode: 'decimal' } }}
              />
            </Box>
          </>
        )}

        <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 1 }}>
          {t('formDialog.payoffAndNotes')}
        </Typography>
        <Box display="flex" flexWrap="wrap" gap={2} alignItems="flex-start">
          <FormControlLabel
            control={
              <Switch
                checked={form.allows_full_payoff}
                onChange={(event) => setForm((previous) => ({ ...previous, allows_full_payoff: event.target.checked }))}
              />
            }
            label={t('formDialog.fullPayoffAllowed')}
            sx={{ flex: '1 1 240px' }}
          />
          {!form.allows_full_payoff && (
            <TextField
              label={t('formDialog.prepaymentTerms')}
              value={form.prepayment_terms}
              onChange={set('prepayment_terms')}
              size="small"
              sx={{ flex: '2 1 260px' }}
              helperText={t('formDialog.prepaymentTermsHelp')}
            />
          )}
          <TextField label={t('formDialog.notes')} value={form.notes} onChange={set('notes')} size="small" fullWidth multiline minRows={2} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('formDialog.cancel')}
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving} data-testid="loan-form-save">
          {saving ? t('formDialog.saving') : loan ? t('formDialog.save') : t('formDialog.addTitle')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
