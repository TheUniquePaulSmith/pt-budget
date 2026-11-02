import type { Loan, LoanStatus, LoanType } from '@/types/database';

export const CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const formatCurrency = (value: number | null | undefined): string =>
  value == null || Number.isNaN(value) ? '—' : CURRENCY.format(value);

export const formatPercent = (value: number | null | undefined): string =>
  value == null || Number.isNaN(value) ? '—' : `${Number(value).toFixed(2)}%`;

export const LOAN_TYPE_OPTIONS: ReadonlyArray<{ value: LoanType; label: string; description: string }> = [
  {
    value: 'installment',
    label: 'Installment loan',
    description: 'Fixed APR and term with a scheduled payment (auto, personal, mortgage, financed work).',
  },
  {
    value: 'deferred_interest',
    label: 'Deferred-interest financing',
    description: 'No interest if the balance is paid by the promo end date; otherwise interest since opening is charged back.',
  },
  {
    value: 'line_of_credit',
    label: 'Line of credit',
    description: 'Revolving balance (HELOC, store credit line); interest accrues on what is outstanding.',
  },
  { value: 'other', label: 'Other', description: 'Tracked by its payments only.' },
];

export const LOAN_STATUS_OPTIONS: ReadonlyArray<{ value: LoanStatus; label: string; color: 'success' | 'default' | 'warning' }> = [
  { value: 'active', label: 'Active', color: 'success' },
  { value: 'paid_off', label: 'Paid off', color: 'default' },
  { value: 'closed', label: 'Closed', color: 'warning' },
];

export function loanTypeLabel(type: LoanType): string {
  return LOAN_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

export function loanStatusOption(status: LoanStatus) {
  return LOAN_STATUS_OPTIONS.find((option) => option.value === status) ?? LOAN_STATUS_OPTIONS[0];
}

/** "Lender · Owner" style secondary line for a loan. */
export function loanSubtitle(loan: Loan): string {
  return [loan.lender, loan.owner_display_name].filter(Boolean).join(' · ');
}

export function daysLabel(days: number): string {
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  if (days < 0) return `${Math.abs(days)} days ago`;
  return `in ${days} days`;
}
