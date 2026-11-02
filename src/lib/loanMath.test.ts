import { describe, expect, it } from 'vitest';

import {
  amortizingPayment,
  computeLoanSummary,
  daysBetweenISO,
  monthlyLoanCommitment,
  nextLoanDueDate,
  type LedgerPayment,
  type LoanTerms,
} from './loanMath';

const baseLoan: LoanTerms = {
  id: 1,
  loan_type: 'installment',
  opened_date: '2026-01-01',
  original_principal: 1200,
  interest_rate: 12,
  term_months: null,
  expected_payment: 100,
  payment_due_day: 31,
  first_payment_date: null,
  promo_end_date: null,
  deferred_interest_rate: null,
};

function payment(overrides: Partial<LedgerPayment> & Pick<LedgerPayment, 'id' | 'payment_date' | 'amount'>): LedgerPayment {
  return {
    transaction_id: null,
    principal_amount: null,
    interest_amount: null,
    split_source: 'computed',
    match_source: 'manual',
    ...overrides,
  };
}

describe('loanMath helpers', () => {
  it('counts days and computes amortizing payments', () => {
    expect(daysBetweenISO('2026-01-01', '2026-01-31')).toBe(30);
    expect(daysBetweenISO('2026-03-01', '2026-02-01')).toBe(-28);
    expect(amortizingPayment(10000, 6, 12)).toBe(860.66);
    expect(amortizingPayment(1200, 0, 12)).toBe(100);
    expect(amortizingPayment(1200, 5, 0)).toBe(0);
  });

  it('finds the next due date from the due day, the first payment date or the last payment', () => {
    expect(nextLoanDueDate({ payment_due_day: 15, first_payment_date: null }, '2026-03-10', null)).toBe('2026-03-15');
    expect(nextLoanDueDate({ payment_due_day: 15, first_payment_date: null }, '2026-03-15', null)).toBe('2026-03-15');
    expect(nextLoanDueDate({ payment_due_day: 15, first_payment_date: null }, '2026-03-16', null)).toBe('2026-04-15');
    expect(nextLoanDueDate({ payment_due_day: 31, first_payment_date: null }, '2026-02-10', null)).toBe('2026-02-28');
    expect(nextLoanDueDate({ payment_due_day: null, first_payment_date: '2026-05-20' }, '2026-03-01', null)).toBe('2026-05-20');
    expect(nextLoanDueDate({ payment_due_day: null, first_payment_date: '2026-01-20' }, '2026-03-25', null)).toBe('2026-04-20');
    expect(nextLoanDueDate({ payment_due_day: null, first_payment_date: null }, '2026-03-25', '2026-01-03')).toBe('2026-04-03');
    expect(nextLoanDueDate({ payment_due_day: null, first_payment_date: null }, '2026-03-25', null)).toBeNull();
    // A payment on (or shortly before) the due day covers that cycle.
    expect(nextLoanDueDate({ payment_due_day: 15, first_payment_date: null }, '2026-03-15', '2026-03-15')).toBe('2026-04-15');
    expect(nextLoanDueDate({ payment_due_day: 15, first_payment_date: null }, '2026-03-10', '2026-03-08')).toBe('2026-04-15');
    expect(nextLoanDueDate({ payment_due_day: 15, first_payment_date: null }, '2026-03-10', '2026-02-16')).toBe('2026-03-15');
  });

  it('sums expected payments of active loans only', () => {
    expect(
      monthlyLoanCommitment([
        { status: 'active', expected_payment: 250 },
        { status: 'active', expected_payment: null },
        { status: 'paid_off', expected_payment: 400 },
        { status: 'active', expected_payment: 100.5 },
      ])
    ).toBe(350.5);
  });
});

describe('computeLoanSummary: installment loans', () => {
  it('splits each payment into accrued interest and principal', () => {
    const summary = computeLoanSummary(baseLoan, [payment({ id: 1, payment_date: '2026-01-31', amount: 100 })], '2026-01-31');
    // 1200 × 12% / 365 × 30 days = 11.84 interest
    expect(summary.ledger).toHaveLength(1);
    expect(summary.ledger[0]).toMatchObject({ kind: 'payment', interest: 11.84, principal: 88.16, balance_after: 1111.84 });
    expect(summary.balance).toBe(1111.84);
    expect(summary.totalPaid).toBe(100);
    expect(summary.totalInterestPaid).toBe(11.84);
    expect(summary.totalPrincipalPaid).toBe(88.16);
    expect(summary.accruedInterest).toBe(0);
    expect(summary.isPaidOff).toBe(false);
    expect(summary.nextDueDate).toBe('2026-02-28');
  });

  it('keeps a manual split and carries unpaid interest to the next payment', () => {
    const summary = computeLoanSummary(
      baseLoan,
      [
        payment({ id: 1, payment_date: '2026-01-31', amount: 100, split_source: 'manual', principal_amount: 90, interest_amount: 10 }),
        payment({ id: 2, payment_date: '2026-03-02', amount: 100 }),
      ],
      '2026-03-02'
    );
    expect(summary.ledger[0]).toMatchObject({ principal: 90, interest: 10, balance_after: 1110, split_source: 'manual' });
    // 1.8356 of January interest stayed unpaid, plus 1110 × 12% / 365 × 30 = 10.9479
    expect(summary.ledger[1].interest).toBe(12.78);
    expect(summary.ledger[1].principal).toBe(87.22);
    expect(summary.balance).toBe(1022.78);
  });

  it('reports accrued interest since the last payment and a payoff amount', () => {
    const summary = computeLoanSummary(baseLoan, [payment({ id: 1, payment_date: '2026-01-31', amount: 100 })], '2026-02-15');
    // 1111.84 × 12% / 365 × 15 = 5.48
    expect(summary.accruedInterest).toBe(5.48);
    expect(summary.payoffAmount).toBe(1117.32);
  });

  it('projects the payoff from the expected payment', () => {
    const summary = computeLoanSummary(baseLoan, [], '2026-01-01');
    expect(summary.projection).not.toBeNull();
    const projection = summary.projection!;
    expect(projection.assumedPayment).toBe(100);
    expect(projection.paymentDerivedFromTerm).toBe(false);
    expect(projection.neverPaysOff).toBe(false);
    expect(projection.monthsRemaining).toBe(13);
    expect(projection.payoffDate).toBe('2027-01-31');
    expect(projection.schedule[0]).toMatchObject({ date: '2026-01-31', amount: 100 });
    expect(projection.schedule.at(-1)!.balance_after).toBe(0);
    expect(projection.totalInterestRemaining).toBeGreaterThan(70);
    expect(projection.totalInterestRemaining).toBeLessThan(85);
  });

  it('derives the payment from the term when none is entered', () => {
    const summary = computeLoanSummary({ ...baseLoan, expected_payment: null, term_months: 12 }, [], '2026-01-01');
    expect(summary.projection?.paymentDerivedFromTerm).toBe(true);
    expect(summary.projection?.assumedPayment).toBe(106.62);
    expect(summary.projection?.monthsRemaining).toBe(12);
  });

  it('flags a payment that never covers the interest', () => {
    const summary = computeLoanSummary({ ...baseLoan, original_principal: 100000, expected_payment: 50 }, [], '2026-01-01');
    expect(summary.projection?.neverPaysOff).toBe(true);
    expect(summary.projection?.payoffDate).toBeNull();
  });

  it('has no projection without a payment or term, and none once paid off', () => {
    expect(computeLoanSummary({ ...baseLoan, expected_payment: null, term_months: null }, [], '2026-01-01').projection).toBeNull();
    const paid = computeLoanSummary(baseLoan, [payment({ id: 1, payment_date: '2026-01-01', amount: 1200 })], '2026-06-01');
    expect(paid.isPaidOff).toBe(true);
    expect(paid.balance).toBe(0);
    expect(paid.accruedInterest).toBe(0);
    expect(paid.projection).toBeNull();
    expect(paid.nextDueDate).toBeNull();
  });

  it('orders payments by date regardless of input order', () => {
    const summary = computeLoanSummary(
      baseLoan,
      [payment({ id: 2, payment_date: '2026-03-02', amount: 100 }), payment({ id: 1, payment_date: '2026-01-31', amount: 100 })],
      '2026-03-02'
    );
    expect(summary.ledger.map((entry) => entry.payment_id)).toEqual([1, 2]);
    expect(summary.lastPaymentDate).toBe('2026-03-02');
  });
});

describe('computeLoanSummary: deferred-interest promos', () => {
  const promo: LoanTerms = {
    ...baseLoan,
    id: 2,
    loan_type: 'deferred_interest',
    original_principal: 3000,
    interest_rate: 0,
    expected_payment: 250,
    payment_due_day: 15,
    promo_end_date: '2026-12-31',
    deferred_interest_rate: 29.99,
  };

  function monthlyPayments(months: number): LedgerPayment[] {
    return Array.from({ length: months }, (_, index) =>
      payment({ id: index + 1, payment_date: `2026-${String(index + 1).padStart(2, '0')}-15`, amount: 250 })
    );
  }

  it('charges no interest inside the promo and tracks the deferred interest in the shadow', () => {
    const summary = computeLoanSummary(promo, monthlyPayments(6), '2026-06-15');
    expect(summary.ledger.every((entry) => entry.kind === 'payment' && entry.interest === 0)).toBe(true);
    expect(summary.balance).toBe(1500);
    expect(summary.deferred).not.toBeNull();
    const deferred = summary.deferred!;
    expect(deferred.charged).toBe(false);
    expect(deferred.daysUntilPromoEnd).toBe(199);
    expect(deferred.deferredInterestAccrued).toBeGreaterThan(0);
    // Six more $250 payments (Jul–Dec 15) clear the $1500 before Dec 31.
    expect(deferred.paymentsRemainingInPromo).toBe(6);
    expect(deferred.onTrack).toBe(true);
    expect(deferred.projectedBalanceAtPromoEnd).toBe(0);
    expect(deferred.deferredInterestAtRisk).toBe(0);
    expect(deferred.requiredMonthlyToAvoid).toBe(250);
  });

  it('warns when the expected payment will not clear the balance in time', () => {
    const summary = computeLoanSummary({ ...promo, expected_payment: 100 }, monthlyPayments(6), '2026-06-15');
    const deferred = summary.deferred!;
    expect(deferred.onTrack).toBe(false);
    expect(deferred.projectedBalanceAtPromoEnd).toBe(900);
    expect(deferred.deferredInterestAtRisk).toBeGreaterThan(deferred.deferredInterestAccrued);
    expect(deferred.requiredMonthlyToAvoid).toBe(250);
  });

  it('capitalizes the deferred interest once the promo is missed', () => {
    const summary = computeLoanSummary(promo, [], '2027-02-01');
    // 3000 × 29.99% / 365 × 364 days (Jan 1 → Dec 31) = 897.24
    const charge = summary.ledger.find((entry) => entry.kind === 'deferred_interest_charge');
    expect(charge).toMatchObject({ date: '2026-12-31', amount: 897.24, balance_after: 3897.24 });
    expect(summary.deferred).toMatchObject({ charged: true, chargedAmount: 897.24, onTrack: false, requiredMonthlyToAvoid: null });
    // Interest now accrues at the deferred rate: 3897.24 × 29.99% / 365 × 32 days
    expect(summary.accruedInterest).toBe(102.47);
    expect(summary.balance).toBe(3897.24);
  });

  it('forgives the shadow interest when the balance is cleared inside the promo', () => {
    const summary = computeLoanSummary(promo, [payment({ id: 1, payment_date: '2026-06-01', amount: 3000 })], '2027-02-01');
    expect(summary.isPaidOff).toBe(true);
    expect(summary.ledger.some((entry) => entry.kind === 'deferred_interest_charge')).toBe(false);
    expect(summary.deferred).toMatchObject({ charged: false, onTrack: true, deferredInterestAccrued: 0, deferredInterestAtRisk: 0 });
  });

  it('includes the promo-end charge in the projection when payments are too small', () => {
    const summary = computeLoanSummary({ ...promo, expected_payment: 100 }, [], '2026-06-15');
    const projection = summary.projection!;
    const charge = projection.schedule.find((entry) => entry.deferred_charge);
    expect(charge?.date).toBe('2026-12-31');
    expect(projection.totalInterestRemaining).toBeGreaterThan(charge!.amount);
  });
});
