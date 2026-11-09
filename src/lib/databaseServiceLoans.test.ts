import { describe, expect, it, vi } from 'vitest';

import { LoansService, loanRuleMatches, mapToLoan, mapToLoanPayment, matchLoanRule } from './databaseServiceLoans';
import { LOAN_QUERIES } from './sqlQueriesLoans';
import type { LoanMatchRule } from '../types/database';

type Rows = Record<string, unknown[] | ((params?: unknown[]) => unknown[])>;

function createWorker(rowsBySql: Rows = {}) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    const entry = rowsBySql[sql];
    if (typeof entry === 'function') return entry(params);
    return entry ?? [];
  });
  return { query };
}

const loanRow = {
  id: 7,
  name: 'Furnace financing',
  loan_type: 'deferred_interest',
  status: 'active',
  owner_user_id: 1,
  project_id: 3,
  account_id: null,
  lender: 'Synchrony',
  opened_date: '2026-01-01',
  original_principal: 3000,
  interest_rate: 0,
  term_months: null,
  expected_payment: 250,
  payment_due_day: 15,
  first_payment_date: null,
  allows_full_payoff: 1,
  prepayment_terms: null,
  promo_end_date: '2026-12-31',
  deferred_interest_rate: 29.99,
  notes: null,
  created_at: 'now',
  updated_at: 'now',
  owner_display_name: 'Paul',
  project_name: 'HVAC replacement',
  project_company_name: 'Acme Heating',
  account_name: null,
  payment_count: 2,
  total_paid: 500,
  last_payment_date: '2026-02-15',
  rule_count: 1,
};

const rule = (overrides: Partial<LoanMatchRule>): LoanMatchRule => ({
  id: 1,
  loan_id: 7,
  pattern: 'SYNCHRONY',
  match_type: 'contains',
  account_id: null,
  enabled: 1,
  notes: null,
  created_at: '',
  updated_at: '',
  ...overrides,
});

describe('loan row mapping and matching', () => {
  it('maps loan rows with joined names and stats', () => {
    expect(mapToLoan(loanRow)).toMatchObject({
      id: 7,
      loan_type: 'deferred_interest',
      project_id: 3,
      account_id: null,
      deferred_interest_rate: 29.99,
      owner_display_name: 'Paul',
      project_company_name: 'Acme Heating',
      payment_count: 2,
      total_paid: 500,
      rule_count: 1,
    });
    expect(mapToLoan({ ...loanRow, loan_type: 'bogus', status: 'bogus' })).toMatchObject({ loan_type: 'other', status: 'active' });
  });

  it('maps payments with an absolute amount', () => {
    expect(mapToLoanPayment({ id: 1, loan_id: 7, transaction_id: 9, payment_date: '2026-02-15', amount: -250, principal_amount: null, interest_amount: null, split_source: 'computed', match_source: 'rule' })).toMatchObject({
      amount: 250,
      transaction_id: 9,
      split_source: 'computed',
      match_source: 'rule',
    });
  });

  it('matches by pattern type and account scope, longest pattern first', () => {
    expect(loanRuleMatches('SYNCHRONY BANK PAYMENT', 1, rule({}))).toBe(true);
    expect(loanRuleMatches('SYNCHRONY BANK PAYMENT', 1, rule({ match_type: 'exact' }))).toBe(false);
    expect(loanRuleMatches('SYNCHRONY BANK PAYMENT', 1, rule({ match_type: 'prefix' }))).toBe(true);
    expect(loanRuleMatches('SYNCHRONY BANK PAYMENT', 2, rule({ account_id: 1 }))).toBe(false);
    expect(loanRuleMatches('SYNCHRONY BANK PAYMENT', 1, rule({ enabled: 0 }))).toBe(false);

    const rules = [rule({ id: 2, loan_id: 8, pattern: 'SYNCHRONY BANK PAYMENT' }), rule({ id: 1, loan_id: 7 })];
    expect(matchLoanRule('SYNCHRONY BANK PAYMENT', 1, rules)?.loan_id).toBe(8);
    expect(matchLoanRule('SYNCHRONY CARD', 1, rules)?.loan_id).toBe(7);
    expect(matchLoanRule('WELLS FARGO', 1, rules)).toBeNull();
  });
});

describe('LoansService', () => {
  it('validates and writes a loan', async () => {
    const worker = createWorker({ [LOAN_QUERIES.CREATE]: [{ id: 11 }] });
    const service = new LoansService(worker);

    await expect(service.create({ name: '  ', owner_user_id: 1 })).rejects.toThrow(/needs a name/);
    await expect(service.create({ name: 'Car', owner_user_id: 0 })).rejects.toThrow(/needs an owner/);
    await expect(service.create({ name: 'Car', owner_user_id: 1, payment_due_day: 40 })).rejects.toThrow(/between 1 and 31/);
    await expect(service.create({ name: 'Car', owner_user_id: 1, original_principal: -5 })).rejects.toThrow(/zero or more/);
    await expect(service.create({ name: 'Promo', owner_user_id: 1, loan_type: 'deferred_interest' })).rejects.toThrow(/paid by/);

    const id = await service.create({
      name: ' Car loan ',
      owner_user_id: 1,
      lender: ' Credit Union ',
      original_principal: 12000,
      interest_rate: 6.49,
      term_months: 48,
      expected_payment: 284.5,
      payment_due_day: 10,
    });
    expect(id).toBe(11);
    const createCall = worker.query.mock.calls.find(([sql]) => sql === LOAN_QUERIES.CREATE)!;
    expect(createCall[1]).toEqual([
      'Car loan', 'installment', 'active', 1, null, null, 'Credit Union', null,
      12000, 6.49, 48, 284.5, 10, null, 1, null, null, null, null,
    ]);
  });

  it('merges updates over the existing row', async () => {
    const worker = createWorker({ [LOAN_QUERIES.GET_BY_ID]: [loanRow] });
    const service = new LoansService(worker);
    await service.update(7, { expected_payment: 300, notes: 'bumped' });
    const updateCall = worker.query.mock.calls.find(([sql]) => sql === LOAN_QUERIES.UPDATE)!;
    expect(updateCall[1]).toEqual([
      'Furnace financing', 'deferred_interest', 'active', 1, 3, null, 'Synchrony', '2026-01-01',
      3000, 0, null, 300, 15, null, 1, null, '2026-12-31', 29.99, 'bumped', 7,
    ]);
  });

  it('normalizes rule patterns and rejects empty ones', async () => {
    const worker = createWorker({ [LOAN_QUERIES.CREATE_RULE]: [{ id: 4 }] });
    const service = new LoansService(worker);
    await expect(service.addRule({ loan_id: 7, pattern: '   ', match_type: 'contains' })).rejects.toThrow(/pattern/);
    await service.addRule({ loan_id: 7, pattern: 'synchrony bank #1234', match_type: 'contains', account_id: 2 });
    const call = worker.query.mock.calls.find(([sql]) => sql === LOAN_QUERIES.CREATE_RULE)!;
    expect(call[1]).toEqual([7, 'SYNCHRONY BANK', 'contains', 2, 1, null]);
  });

  it('applies rules to unlinked outflows inside one transaction and skips non-matches', async () => {
    const worker = createWorker({
      [LOAN_QUERIES.GET_ENABLED_RULES]: [
        { ...rule({ id: 1, loan_id: 7, pattern: 'SYNCHRONY' }), account_name: null, loan_name: 'Furnace' },
        { ...rule({ id: 2, loan_id: 8, pattern: 'TOYOTA FINANCIAL', account_id: 1 }), account_name: 'Checking', loan_name: 'Car' },
      ],
      [LOAN_QUERIES.GET_RULE_CANDIDATES]: [
        { id: 100, date: '2026-02-15', amount: -250, description: 'SYNCHRONY BANK PAYMENT 1234', account_id: 1, account_name: 'Checking' },
        { id: 101, date: '2026-02-16', amount: -284.5, description: 'TOYOTA FINANCIAL SVC', account_id: 1, account_name: 'Checking' },
        { id: 102, date: '2026-02-16', amount: -284.5, description: 'TOYOTA FINANCIAL SVC', account_id: 2, account_name: 'Savings' },
        { id: 103, date: '2026-02-17', amount: -40, description: 'KROGER', account_id: 1, account_name: 'Checking' },
      ],
      [LOAN_QUERIES.CREATE_PAYMENT]: [{ id: 1 }],
    });
    const service = new LoansService(worker);
    const summary = await service.applyRules();
    expect(summary).toEqual({ scanned: 4, linked: 2, byLoan: { 7: 1, 8: 1 } });

    const sqls = worker.query.mock.calls.map(([sql]) => sql);
    expect(sqls).toContain('BEGIN TRANSACTION');
    expect(sqls).toContain('COMMIT');
    const inserts = worker.query.mock.calls.filter(([sql]) => sql === LOAN_QUERIES.CREATE_PAYMENT);
    expect(inserts.map(([, params]) => params)).toEqual([
      [7, 100, '2026-02-15', 250, null, null, 'computed', 'rule', null],
      [8, 101, '2026-02-16', 284.5, null, null, 'computed', 'rule', null],
    ]);
  });

  it('does nothing when no rule is enabled', async () => {
    const worker = createWorker();
    const service = new LoansService(worker);
    expect(await service.applyRules()).toEqual({ scanned: 0, linked: 0, byLoan: {} });
    expect(worker.query.mock.calls.some(([sql]) => sql === LOAN_QUERIES.GET_RULE_CANDIDATES)).toBe(false);
  });

  it('carries each candidate’s account currency into the link dialog and the rule preview', async () => {
    const rows = [
      { id: 1, date: '2026-03-02', amount: -80, description: 'ACME PYMT', account_id: 4, account_name: 'Maple Chequing', account_currency: 'CAD' },
      { id: 2, date: '2026-03-01', amount: -55, description: 'ACME PYMT', account_id: 1, account_name: 'Checking', account_currency: 'USD' },
    ];
    const worker = createWorker({
      [LOAN_QUERIES.SEARCH_LINK_CANDIDATES]: rows,
      [LOAN_QUERIES.GET_RULE_CANDIDATES]: rows,
    });
    const service = new LoansService(worker);

    const found = await service.searchLinkCandidates('acme');
    expect(found.map((row) => row.account_currency)).toEqual(['CAD', 'USD']);

    const previewed = await service.previewRuleMatches({ pattern: 'acme', match_type: 'prefix' });
    expect(previewed.map((row) => row.account_currency)).toEqual(['CAD', 'USD']);

    expect(LOAN_QUERIES.SEARCH_LINK_CANDIDATES).toContain('a.currency AS account_currency');
    expect(LOAN_QUERIES.GET_RULE_CANDIDATES).toContain('a.currency AS account_currency');
  });

  it('links a transaction by hand using its absolute amount', async () => {
    const worker = createWorker({
      [LOAN_QUERIES.GET_TRANSACTION_FOR_LINK]: (params) => (params?.[0] === 55 ? [{ id: 55, date: '2026-03-01', amount: -120, description: 'PAYMENT', account_id: 1 }] : []),
      [LOAN_QUERIES.CREATE_PAYMENT]: [{ id: 9 }],
    });
    const service = new LoansService(worker);
    await expect(service.linkTransaction(7, 56)).rejects.toThrow(/not found/);
    expect(await service.linkTransaction(7, 55)).toBe(9);
    const insert = worker.query.mock.calls.find(([sql]) => sql === LOAN_QUERIES.CREATE_PAYMENT)!;
    expect(insert[1]).toEqual([7, 55, '2026-03-01', 120, null, null, 'computed', 'manual', null]);
  });

  it('stores manual splits that add up and returns to computed when cleared', async () => {
    const paymentRow = {
      id: 3, loan_id: 7, transaction_id: 55, payment_date: '2026-03-01', amount: 120,
      principal_amount: null, interest_amount: null, split_source: 'computed', match_source: 'manual', notes: null,
    };
    const worker = createWorker({
      [LOAN_QUERIES.GET_PAYMENT_BY_ID]: [paymentRow],
      [LOAN_QUERIES.CREATE_PAYMENT]: [{ id: 4 }],
    });
    const service = new LoansService(worker);

    await expect(service.updatePayment(3, { principal_amount: 100, interest_amount: 10 })).rejects.toThrow(/add up/);
    await service.updatePayment(3, { principal_amount: 100 });
    let update = worker.query.mock.calls.filter(([sql]) => sql === LOAN_QUERIES.UPDATE_PAYMENT).at(-1)!;
    expect(update[1]).toEqual(['2026-03-01', 120, 100, 20, 'manual', null, 3]);

    await service.updatePayment(3, { principal_amount: null, interest_amount: null, notes: ' per statement ' });
    update = worker.query.mock.calls.filter(([sql]) => sql === LOAN_QUERIES.UPDATE_PAYMENT).at(-1)!;
    expect(update[1]).toEqual(['2026-03-01', 120, null, null, 'computed', 'per statement', 3]);

    // Linked payments keep the transaction's date and amount.
    await service.updatePayment(3, { payment_date: '2026-04-01', amount: 999 });
    update = worker.query.mock.calls.filter(([sql]) => sql === LOAN_QUERIES.UPDATE_PAYMENT).at(-1)!;
    expect(update[1]!.slice(0, 2)).toEqual(['2026-03-01', 120]);

    await expect(service.addManualPayment({ loan_id: 7, payment_date: '', amount: 10 })).rejects.toThrow(/date/);
    expect(await service.addManualPayment({ loan_id: 7, payment_date: '2026-05-01', amount: 80, interest_amount: 5 })).toBe(4);
    const insert = worker.query.mock.calls.find(([sql]) => sql === LOAN_QUERIES.CREATE_PAYMENT)!;
    expect(insert[1]).toEqual([7, null, '2026-05-01', 80, 75, 5, 'manual', 'manual', null]);
  });

  it('computes the summary from the loan and its payments', async () => {
    const worker = createWorker({
      [LOAN_QUERIES.GET_BY_ID]: (params) => (params?.[0] === 7 ? [loanRow] : []),
      [LOAN_QUERIES.GET_PAYMENTS_FOR_LOAN]: [
        { id: 1, loan_id: 7, transaction_id: 10, payment_date: '2026-01-15', amount: 250, principal_amount: null, interest_amount: null, split_source: 'computed', match_source: 'rule' },
        { id: 2, loan_id: 7, transaction_id: 11, payment_date: '2026-02-15', amount: 250, principal_amount: null, interest_amount: null, split_source: 'computed', match_source: 'rule' },
      ],
    });
    const service = new LoansService(worker);
    const summary = await service.getSummary(7, '2026-03-01');
    expect(summary?.balance).toBe(2500);
    expect(summary?.paymentCount).toBe(2);
    expect(summary?.deferred?.onTrack).toBe(true);
    expect(await service.getSummary(99, '2026-03-01')).toBeNull();
  });

  it('writes the linked account snapshot as a negative balance after a mutation', async () => {
    const worker = createWorker({
      [LOAN_QUERIES.GET_BY_ID]: [{ ...loanRow, account_id: 5, account_name: 'Synchrony Card' }],
      [LOAN_QUERIES.GET_PAYMENTS_FOR_LOAN]: [],
      [LOAN_QUERIES.CREATE_PAYMENT]: [{ id: 1 }],
    });
    const service = new LoansService(worker);
    await service.addManualPayment({ loan_id: 7, payment_date: '2026-05-01', amount: 80 });
    const snapshot = worker.query.mock.calls.find(([sql]) => sql === LOAN_QUERIES.UPSERT_ACCOUNT_SNAPSHOT)!;
    expect(snapshot[1]![0]).toBe(5);
    expect(snapshot[1]![2]).toBe(-3000);
    expect(snapshot[1]![3]).toBe('Loan: Furnace financing');
  });

  it('exposes linked transaction ids as a set for the subscription scan', async () => {
    const worker = createWorker({ [LOAN_QUERIES.GET_LINKED_TRANSACTION_IDS]: [{ transaction_id: 1 }, { transaction_id: 2 }] });
    const service = new LoansService(worker);
    expect(await service.getLinkedTransactionIds()).toEqual(new Set([1, 2]));
  });
});
