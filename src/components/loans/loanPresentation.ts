import type { TFunction } from 'i18next';

import type { Loan, LoanStatus, LoanType } from '@/types/database';

/** Loan types in the order they are offered; labels resolve through `loans:loanType.<value>`. */
export const LOAN_TYPE_VALUES: ReadonlyArray<LoanType> = ['installment', 'deferred_interest', 'line_of_credit', 'other'];

/** Loan statuses in the order they are offered, with the chip colour for each. */
export const LOAN_STATUS_OPTIONS: ReadonlyArray<{ value: LoanStatus; color: 'success' | 'default' | 'warning' }> = [
  { value: 'active', color: 'success' },
  { value: 'paid_off', color: 'default' },
  { value: 'closed', color: 'warning' },
];

export function loanTypeLabel(t: TFunction<'loans'>, type: LoanType): string {
  return t(`loanType.${type}`, { defaultValue: type });
}

export function loanTypeDescription(t: TFunction<'loans'>, type: LoanType): string {
  return t(`loanTypeDescription.${type}`, { defaultValue: '' });
}

export function loanStatusOption(t: TFunction<'loans'>, status: LoanStatus): { value: LoanStatus; label: string; color: 'success' | 'default' | 'warning' } {
  const option = LOAN_STATUS_OPTIONS.find((candidate) => candidate.value === status) ?? LOAN_STATUS_OPTIONS[0];
  return { ...option, label: t(`status.${option.value}`) };
}

/** "Lender · Owner" style secondary line for a loan. */
export function loanSubtitle(loan: Loan): string {
  return [loan.lender, loan.owner_display_name].filter(Boolean).join(' · ');
}

/** "today" / "tomorrow" / "in 3 days" / "2 days ago" for a day offset. */
export function daysLabel(t: TFunction<'loans'>, days: number): string {
  if (days === 0) return t('days.today');
  if (days === 1) return t('days.tomorrow');
  if (days === -1) return t('days.yesterday');
  if (days < 0) return t('days.ago', { count: Math.abs(days) });
  return t('days.in', { count: days });
}
