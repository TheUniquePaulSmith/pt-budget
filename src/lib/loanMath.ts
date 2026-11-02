/**
 * Loan math (schema v5). Pure: takes a loan's terms and its payment ledger,
 * returns balances, each payment's principal / interest split, a payoff
 * projection and, for promotional financing, the deferred-interest picture.
 *
 * Accrual model: simple daily interest, actual/365, on the outstanding
 * principal between events. A payment first clears the interest accrued
 * since the previous payment, the rest reduces principal. A payment whose
 * split the user typed from the statement (split_source = 'manual') is taken
 * as given and never recomputed.
 *
 * Deferred-interest promos: while the promo runs, interest accrues at the
 * contract rate (normally 0) and, in the shadow, at the deferred rate. If a
 * balance remains after promo_end_date, the shadow interest is added to the
 * balance on that date (the lender's retroactive charge) and interest then
 * accrues at the deferred rate. Paying the balance off inside the promo
 * forgives the shadow interest.
 */

import { addMonthsISO, todayLocalISO } from './dateOnly';
import type { Loan, LoanPayment } from '../types/database';
import type {
  DeferredInterestStatus,
  LoanLedgerEntry,
  LoanProjection,
  LoanProjectionEntry,
  LoanSummary,
} from '../types/loans';

export type LoanTerms = Pick<
  Loan,
  | 'id'
  | 'loan_type'
  | 'opened_date'
  | 'original_principal'
  | 'interest_rate'
  | 'term_months'
  | 'expected_payment'
  | 'payment_due_day'
  | 'first_payment_date'
  | 'promo_end_date'
  | 'deferred_interest_rate'
>;

export type LedgerPayment = Pick<
  LoanPayment,
  'id' | 'transaction_id' | 'payment_date' | 'amount' | 'principal_amount' | 'interest_amount' | 'split_source' | 'match_source'
> & Partial<Pick<LoanPayment, 'description' | 'account_name' | 'notes'>>;

/** Projection horizon; a balance still standing after this is "never pays off". */
export const MAX_PROJECTION_MONTHS = 600;
/** Consecutive projected payments that fail to reduce principal before giving up. */
const STALLED_PAYMENTS_LIMIT = 12;
const CENT = 0.005;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function splitIso(iso: string): [number, number, number] {
  const [year, month, day] = iso.split('-').map(Number);
  return [year, month, day];
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetweenISO(from: string, to: string): number {
  const [fy, fm, fd] = splitIso(from);
  const [ty, tm, td] = splitIso(to);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000);
}

/** Daily simple-interest rate for an APR given in percent (6.49 = 6.49%). */
export function dailyRate(aprPercent: number | null | undefined): number {
  const apr = Number(aprPercent);
  return Number.isFinite(apr) && apr > 0 ? apr / 100 / 365 : 0;
}

/** Standard amortizing monthly payment; principal / term when there is no interest. */
export function amortizingPayment(principal: number, aprPercent: number | null | undefined, termMonths: number): number {
  if (!(termMonths > 0) || !(principal > 0)) return 0;
  const monthly = (Number(aprPercent) || 0) / 100 / 12;
  if (monthly <= 0) return roundMoney(principal / termMonths);
  const factor = Math.pow(1 + monthly, termMonths);
  return roundMoney((principal * monthly * factor) / (factor - 1));
}

function clampedDate(year: number, month: number, day: number): string {
  const normalized = new Date(Date.UTC(year, month - 1, 1));
  const lastDay = new Date(Date.UTC(normalized.getUTCFullYear(), normalized.getUTCMonth() + 1, 0)).getUTCDate();
  const y = normalized.getUTCFullYear();
  const m = normalized.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/** A payment made this close before a due date is taken as that cycle's payment. */
const EARLY_PAYMENT_WINDOW_DAYS = 15;

/**
 * The next scheduled payment date on or after `notBefore`: the loan's
 * payment_due_day, else the day of first_payment_date, else one month after
 * the last payment. A due date the last payment already covered (paid on it,
 * or within EARLY_PAYMENT_WINDOW_DAYS before it) rolls to the next cycle.
 * Null when nothing fixes a schedule.
 */
export function nextLoanDueDate(
  loan: Pick<LoanTerms, 'payment_due_day' | 'first_payment_date'>,
  notBefore: string,
  lastPaymentDate: string | null
): string | null {
  const candidate = nextScheduledDate(loan, notBefore, lastPaymentDate);
  if (candidate == null || lastPaymentDate == null) return candidate;
  if (daysBetweenISO(lastPaymentDate, candidate) < EARLY_PAYMENT_WINDOW_DAYS) {
    return nextScheduledDate(loan, addMonthsISO(candidate, 1), lastPaymentDate) ?? candidate;
  }
  return candidate;
}

function nextScheduledDate(
  loan: Pick<LoanTerms, 'payment_due_day' | 'first_payment_date'>,
  notBefore: string,
  lastPaymentDate: string | null
): string | null {
  const [year, month] = splitIso(notBefore);
  const anchorDay =
    loan.payment_due_day != null && loan.payment_due_day >= 1 && loan.payment_due_day <= 31
      ? loan.payment_due_day
      : loan.first_payment_date
        ? splitIso(loan.first_payment_date)[2]
        : null;

  if (anchorDay != null) {
    if (loan.first_payment_date && loan.first_payment_date >= notBefore) return loan.first_payment_date;
    let candidate = clampedDate(year, month, anchorDay);
    if (candidate < notBefore) candidate = clampedDate(year, month + 1, anchorDay);
    return candidate;
  }

  if (lastPaymentDate) {
    let candidate = addMonthsISO(lastPaymentDate, 1);
    for (let guard = 0; candidate < notBefore && guard < MAX_PROJECTION_MONTHS; guard++) {
      candidate = addMonthsISO(candidate, 1);
    }
    return candidate;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Accrual engine shared by the ledger and the projection
// ---------------------------------------------------------------------------

interface AccrualState {
  balance: number;
  /** Unpaid interest at the contract rate, absorbed by the next payment. */
  accrued: number;
  /** Deferred-rate interest accrued inside a promo; charged if the promo is missed, forgiven if not. */
  shadow: number;
  cursor: string;
  charged: boolean;
  chargedAmount: number;
  balanceAtCharge: number;
}

function isDeferredPromo(loan: LoanTerms): boolean {
  return loan.loan_type === 'deferred_interest' && Boolean(loan.promo_end_date);
}

function contractRate(loan: LoanTerms, state: AccrualState): number {
  if (isDeferredPromo(loan) && state.charged) {
    return dailyRate(loan.deferred_interest_rate ?? loan.interest_rate);
  }
  return dailyRate(loan.interest_rate);
}

function accrueSpan(loan: LoanTerms, state: AccrualState, to: string): void {
  const days = daysBetweenISO(state.cursor, to);
  if (days > 0 && state.balance > CENT) {
    state.accrued += state.balance * contractRate(loan, state) * days;
    if (isDeferredPromo(loan) && !state.charged) {
      state.shadow += state.balance * dailyRate(loan.deferred_interest_rate) * days;
    }
  }
  if (days > 0) state.cursor = to;
}

/**
 * Accrues interest through `to`. Crossing a missed promo end capitalizes
 * the shadow interest; the returned amount (if any) is that charge, dated
 * on the promo end.
 */
function accrueTo(loan: LoanTerms, state: AccrualState, to: string): { amount: number; date: string } | null {
  const promoEnd = loan.promo_end_date;
  if (isDeferredPromo(loan) && promoEnd && !state.charged && state.cursor <= promoEnd && to > promoEnd) {
    accrueSpan(loan, state, promoEnd);
    let charge: { amount: number; date: string } | null = null;
    if (state.balance > CENT) {
      state.balanceAtCharge = state.balance;
      state.chargedAmount = state.shadow;
      state.balance += state.shadow;
      charge = { amount: state.shadow, date: promoEnd };
    }
    state.charged = true;
    state.shadow = 0;
    accrueSpan(loan, state, to);
    return charge;
  }
  accrueSpan(loan, state, to);
  return null;
}

function applyPayment(
  state: AccrualState,
  amount: number,
  manual: { principal: number | null; interest: number | null } | null
): { principal: number; interest: number } {
  let principal: number;
  let interest: number;
  if (manual && (manual.principal != null || manual.interest != null)) {
    interest = manual.interest != null ? manual.interest : Math.max(0, amount - (manual.principal ?? 0));
    principal = manual.principal != null ? manual.principal : Math.max(0, amount - interest);
    state.accrued = Math.max(0, state.accrued - interest);
  } else {
    interest = Math.min(amount, state.accrued);
    principal = amount - interest;
    state.accrued -= interest;
  }
  state.balance -= principal;
  if (state.balance <= CENT) {
    state.balance = 0;
    state.accrued = 0;
    state.shadow = 0;
  }
  return { principal, interest };
}

function cloneState(state: AccrualState): AccrualState {
  return { ...state };
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

function sortPayments(payments: ReadonlyArray<LedgerPayment>): LedgerPayment[] {
  return [...payments].sort((a, b) => (a.payment_date < b.payment_date ? -1 : a.payment_date > b.payment_date ? 1 : a.id - b.id));
}

/** The whole picture for one loan as of `asOf` (today by default). */
export function computeLoanSummary(loan: LoanTerms, payments: ReadonlyArray<LedgerPayment>, asOf: string = todayLocalISO()): LoanSummary {
  const sorted = sortPayments(payments);
  const start = loan.opened_date ?? sorted[0]?.payment_date ?? asOf;
  const state: AccrualState = {
    balance: Math.max(0, Number(loan.original_principal) || 0),
    accrued: 0,
    shadow: 0,
    cursor: start,
    charged: false,
    chargedAmount: 0,
    balanceAtCharge: 0,
  };
  const ledger: LoanLedgerEntry[] = [];

  const pushCharge = (charge: { amount: number; date: string } | null) => {
    if (!charge) return;
    ledger.push({
      kind: 'deferred_interest_charge',
      payment_id: null,
      transaction_id: null,
      date: charge.date,
      amount: roundMoney(charge.amount),
      principal: 0,
      interest: roundMoney(charge.amount),
      balance_after: roundMoney(state.balance),
      split_source: 'computed',
      match_source: 'manual',
    });
  };

  let totalPaid = 0;
  let totalPrincipalPaid = 0;
  let totalInterestPaid = 0;

  for (const payment of sorted) {
    const amount = Math.abs(Number(payment.amount) || 0);
    pushCharge(accrueTo(loan, state, payment.payment_date));
    const manual = payment.split_source === 'manual'
      ? { principal: payment.principal_amount, interest: payment.interest_amount }
      : null;
    const split = applyPayment(state, amount, manual);
    totalPaid += amount;
    totalPrincipalPaid += split.principal;
    totalInterestPaid += split.interest;
    ledger.push({
      kind: 'payment',
      payment_id: payment.id,
      transaction_id: payment.transaction_id,
      date: payment.payment_date,
      amount: roundMoney(amount),
      principal: roundMoney(split.principal),
      interest: roundMoney(split.interest),
      balance_after: roundMoney(state.balance),
      split_source: payment.split_source,
      match_source: payment.match_source,
      description: payment.description ?? null,
      account_name: payment.account_name ?? null,
      notes: payment.notes ?? null,
    });
  }

  if (asOf > state.cursor) pushCharge(accrueTo(loan, state, asOf));

  const isPaidOff = state.balance <= CENT;
  const lastPaymentDate = sorted.length > 0 ? sorted[sorted.length - 1].payment_date : null;
  const nextDueDate = isPaidOff ? null : nextLoanDueDate(loan, asOf, lastPaymentDate);
  const projection = isPaidOff ? null : computeProjection(loan, cloneState(state), asOf, nextDueDate);
  const deferred = isDeferredPromo(loan)
    ? computeDeferredStatus(loan, cloneState(state), asOf, nextDueDate, projection?.assumedPayment ?? 0)
    : null;

  return {
    loanId: loan.id,
    asOf,
    originalPrincipal: roundMoney(Number(loan.original_principal) || 0),
    balance: roundMoney(state.balance),
    accruedInterest: roundMoney(state.accrued),
    payoffAmount: roundMoney(state.balance + state.accrued),
    totalPaid: roundMoney(totalPaid),
    totalPrincipalPaid: roundMoney(totalPrincipalPaid),
    totalInterestPaid: roundMoney(totalInterestPaid),
    paymentCount: sorted.length,
    lastPaymentDate,
    nextDueDate,
    isPaidOff,
    ledger,
    projection,
    deferred,
  };
}

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/** The payment the projection assumes: the entered one, else the amortizing payment for the term. */
export function assumedMonthlyPayment(loan: LoanTerms): { amount: number; derived: boolean } | null {
  if (loan.expected_payment != null && loan.expected_payment > 0) {
    return { amount: Number(loan.expected_payment), derived: false };
  }
  if (loan.term_months != null && loan.term_months > 0 && loan.original_principal > 0) {
    return { amount: amortizingPayment(loan.original_principal, loan.interest_rate, loan.term_months), derived: true };
  }
  return null;
}

function computeProjection(loan: LoanTerms, state: AccrualState, asOf: string, firstDue: string | null): LoanProjection | null {
  const assumed = assumedMonthlyPayment(loan);
  if (!assumed || assumed.amount <= 0) return null;

  const schedule: LoanProjectionEntry[] = [];
  const anchor = firstDue ?? addMonthsISO(asOf, 1);
  let totalInterest = 0;
  let stalled = 0;
  let neverPaysOff = false;

  for (let index = 0; index < MAX_PROJECTION_MONTHS; index++) {
    const due = addMonthsISO(anchor, index);
    const charge = accrueTo(loan, state, due);
    if (charge) {
      totalInterest += charge.amount;
      schedule.push({
        date: charge.date,
        amount: roundMoney(charge.amount),
        principal: 0,
        interest: roundMoney(charge.amount),
        balance_after: roundMoney(state.balance),
        deferred_charge: true,
      });
    }
    const payment = Math.min(assumed.amount, state.balance + state.accrued);
    const split = applyPayment(state, payment, null);
    totalInterest += split.interest;
    schedule.push({
      date: due,
      amount: roundMoney(payment),
      principal: roundMoney(split.principal),
      interest: roundMoney(split.interest),
      balance_after: roundMoney(state.balance),
    });
    if (state.balance <= CENT) break;
    stalled = split.principal <= CENT ? stalled + 1 : 0;
    if (stalled >= STALLED_PAYMENTS_LIMIT) {
      neverPaysOff = true;
      break;
    }
  }
  if (state.balance > CENT) neverPaysOff = true;

  const payments = schedule.filter((entry) => !entry.deferred_charge);
  return {
    assumedPayment: roundMoney(assumed.amount),
    paymentDerivedFromTerm: assumed.derived,
    payoffDate: neverPaysOff ? null : payments[payments.length - 1]?.date ?? null,
    monthsRemaining: neverPaysOff ? null : payments.length,
    totalInterestRemaining: roundMoney(totalInterest),
    neverPaysOff,
    schedule,
  };
}

// ---------------------------------------------------------------------------
// Deferred interest
// ---------------------------------------------------------------------------

function computeDeferredStatus(
  loan: LoanTerms,
  state: AccrualState,
  asOf: string,
  nextDue: string | null,
  assumedPayment: number
): DeferredInterestStatus {
  const promoEnd = loan.promo_end_date as string;
  const daysUntilPromoEnd = daysBetweenISO(asOf, promoEnd);

  if (state.chargedAmount > 0) {
    return {
      promoEndDate: promoEnd,
      daysUntilPromoEnd,
      deferredInterestAccrued: roundMoney(state.chargedAmount),
      projectedBalanceAtPromoEnd: roundMoney(state.balanceAtCharge),
      deferredInterestAtRisk: roundMoney(state.chargedAmount),
      onTrack: false,
      requiredMonthlyToAvoid: null,
      paymentsRemainingInPromo: 0,
      charged: true,
      chargedAmount: roundMoney(state.chargedAmount),
    };
  }

  if (state.balance <= CENT) {
    return {
      promoEndDate: promoEnd,
      daysUntilPromoEnd,
      deferredInterestAccrued: 0,
      projectedBalanceAtPromoEnd: 0,
      deferredInterestAtRisk: 0,
      onTrack: true,
      requiredMonthlyToAvoid: null,
      paymentsRemainingInPromo: 0,
      charged: false,
      chargedAmount: 0,
    };
  }

  // Payment dates still inside the promo.
  const dueDates: string[] = [];
  if (nextDue && nextDue <= promoEnd) {
    for (let index = 0; index < MAX_PROJECTION_MONTHS; index++) {
      const due = addMonthsISO(nextDue, index);
      if (due > promoEnd) break;
      dueDates.push(due);
    }
  }

  const accruedSoFar = state.shadow;
  const projected = cloneState(state);
  for (const due of dueDates) {
    accrueTo(loan, projected, due);
    const payment = Math.min(assumedPayment, projected.balance + projected.accrued);
    if (payment > 0) applyPayment(projected, payment, null);
    if (projected.balance <= CENT) break;
  }
  if (projected.balance > CENT && projected.cursor < promoEnd) accrueTo(loan, projected, promoEnd);

  const onTrack = projected.balance <= CENT;
  const payoffToday = state.balance + state.accrued;
  const requiredMonthlyToAvoid =
    daysUntilPromoEnd < 0 ? null : dueDates.length > 0 ? roundMoney(payoffToday / dueDates.length) : roundMoney(payoffToday);

  return {
    promoEndDate: promoEnd,
    daysUntilPromoEnd,
    deferredInterestAccrued: roundMoney(accruedSoFar),
    projectedBalanceAtPromoEnd: roundMoney(Math.max(0, projected.balance)),
    deferredInterestAtRisk: onTrack ? 0 : roundMoney(projected.shadow),
    onTrack,
    requiredMonthlyToAvoid,
    paymentsRemainingInPromo: dueDates.length,
    charged: false,
    chargedAmount: 0,
  };
}

// ---------------------------------------------------------------------------
// Rollups for the page
// ---------------------------------------------------------------------------

/** Sum of expected payments across active loans: the household's monthly loan commitment. */
export function monthlyLoanCommitment(loans: ReadonlyArray<Pick<Loan, 'status' | 'expected_payment'>>): number {
  return roundMoney(
    loans
      .filter((loan) => loan.status === 'active')
      .reduce((total, loan) => total + (loan.expected_payment != null && loan.expected_payment > 0 ? Number(loan.expected_payment) : 0), 0)
  );
}
