import type { DatabaseWorkerTransport } from './databaseService';
import { LOAN_QUERIES } from './sqlQueriesLoans';
import { normalizeDescription } from './merchantMatchingService';
import { computeLoanSummary, roundMoney } from './loanMath';
import { todayLocalISO } from './dateOnly';
import { logger } from './logging';
import type {
  Loan,
  LoanInput,
  LoanManualPaymentInput,
  LoanMatchRule,
  LoanMatchRuleInput,
  LoanPayment,
  LoanStatus,
  LoanType,
  MerchantRuleMatchType,
} from '../types/database';
import type { LoanLinkCandidate, LoanRuleScanSummary, LoanSummary } from '../types/loans';

type LoansTransport = Pick<DatabaseWorkerTransport, 'query'>;

const log = logger.child({ component: 'LoansService' });

const LOAN_TYPES: ReadonlySet<string> = new Set<LoanType>(['installment', 'deferred_interest', 'line_of_credit', 'other']);
const LOAN_STATUSES: ReadonlySet<string> = new Set<LoanStatus>(['active', 'paid_off', 'closed']);
const MATCH_TYPES: ReadonlySet<string> = new Set<MerchantRuleMatchType>(['exact', 'prefix', 'contains']);

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function numberOrNull(value: unknown): number | null {
  return value == null || value === '' ? null : Number(value);
}

export function mapToLoan(row: any): Loan {
  return {
    id: Number(row.id),
    name: String(row.name),
    loan_type: LOAN_TYPES.has(row.loan_type) ? row.loan_type : 'other',
    status: LOAN_STATUSES.has(row.status) ? row.status : 'active',
    owner_user_id: Number(row.owner_user_id),
    project_id: numberOrNull(row.project_id),
    account_id: numberOrNull(row.account_id),
    lender: row.lender ?? null,
    opened_date: row.opened_date ?? null,
    original_principal: Number(row.original_principal ?? 0),
    interest_rate: numberOrNull(row.interest_rate),
    term_months: numberOrNull(row.term_months),
    expected_payment: numberOrNull(row.expected_payment),
    payment_due_day: numberOrNull(row.payment_due_day),
    first_payment_date: row.first_payment_date ?? null,
    allows_full_payoff: Number(row.allows_full_payoff ?? 1),
    prepayment_terms: row.prepayment_terms ?? null,
    promo_end_date: row.promo_end_date ?? null,
    deferred_interest_rate: numberOrNull(row.deferred_interest_rate),
    notes: row.notes ?? null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    owner_display_name: row.owner_display_name ?? undefined,
    project_name: row.project_name ?? undefined,
    project_company_name: row.project_company_name ?? null,
    account_name: row.account_name ?? undefined,
    account_currency: row.account_currency ?? null,
    payment_count: row.payment_count != null ? Number(row.payment_count) : undefined,
    total_paid: row.total_paid != null ? Number(row.total_paid) : undefined,
    last_payment_date: row.last_payment_date ?? null,
    rule_count: row.rule_count != null ? Number(row.rule_count) : undefined,
  };
}

export function mapToLoanMatchRule(row: any): LoanMatchRule {
  return {
    id: Number(row.id),
    loan_id: Number(row.loan_id),
    pattern: String(row.pattern),
    match_type: MATCH_TYPES.has(row.match_type) ? row.match_type : 'contains',
    account_id: numberOrNull(row.account_id),
    enabled: Number(row.enabled ?? 1),
    notes: row.notes ?? null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    account_name: row.account_name ?? null,
    loan_name: row.loan_name ?? undefined,
  };
}

export function mapToLoanPayment(row: any): LoanPayment {
  return {
    id: Number(row.id),
    loan_id: Number(row.loan_id),
    transaction_id: numberOrNull(row.transaction_id),
    payment_date: String(row.payment_date),
    amount: Math.abs(Number(row.amount ?? 0)),
    principal_amount: numberOrNull(row.principal_amount),
    interest_amount: numberOrNull(row.interest_amount),
    split_source: row.split_source === 'manual' ? 'manual' : 'computed',
    match_source: row.match_source === 'rule' ? 'rule' : 'manual',
    notes: row.notes ?? null,
    created_at: String(row.created_at ?? ''),
    updated_at: String(row.updated_at ?? ''),
    description: row.description ?? null,
    account_id: numberOrNull(row.account_id),
    account_name: row.account_name ?? null,
  };
}

function mapToCandidate(row: any): LoanLinkCandidate {
  return {
    id: Number(row.id),
    date: String(row.date),
    amount: Number(row.amount),
    description: String(row.description ?? ''),
    account_id: Number(row.account_id),
    account_name: row.account_name ?? null,
  };
}

// ---------------------------------------------------------------------------
// Pure matching (exported for tests)
// ---------------------------------------------------------------------------

export function loanRuleMatches(
  normalizedDescription: string,
  accountId: number | null,
  rule: Pick<LoanMatchRule, 'pattern' | 'match_type' | 'account_id' | 'enabled'>
): boolean {
  if (!rule.enabled) return false;
  if (rule.account_id != null && accountId !== rule.account_id) return false;
  switch (rule.match_type) {
    case 'exact':
      return normalizedDescription === rule.pattern;
    case 'prefix':
      return normalizedDescription.startsWith(rule.pattern);
    case 'contains':
      return normalizedDescription.includes(rule.pattern);
    default:
      return false;
  }
}

/** First matching rule; callers pass rules ordered longest pattern first. */
export function matchLoanRule(
  normalizedDescription: string,
  accountId: number | null,
  rules: ReadonlyArray<LoanMatchRule>
): LoanMatchRule | null {
  for (const rule of rules) {
    if (loanRuleMatches(normalizedDescription, accountId, rule)) return rule;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function optionalNonNegative(value: number | null | undefined, label: string): number | null {
  if (value == null || (value as unknown) === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be zero or more`);
  return parsed;
}

function optionalDate(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed;
}

function normalizeLoanInput(input: LoanInput, existing?: Loan): Omit<Loan, 'id' | 'created_at' | 'updated_at'> {
  const merged = { ...(existing ?? {}), ...input } as LoanInput & Partial<Loan>;
  const name = merged.name?.trim() ?? '';
  if (!name) throw new Error('A loan needs a name');
  if (!merged.owner_user_id) throw new Error('A loan needs an owner');
  const loanType = merged.loan_type ?? 'installment';
  if (!LOAN_TYPES.has(loanType)) throw new Error(`Unknown loan type: ${loanType}`);
  const status = merged.status ?? 'active';
  if (!LOAN_STATUSES.has(status)) throw new Error(`Unknown loan status: ${status}`);
  const dueDay = merged.payment_due_day == null ? null : Number(merged.payment_due_day);
  if (dueDay != null && (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31)) {
    throw new Error('Payment due day must be a whole number between 1 and 31');
  }
  const termMonths = merged.term_months == null ? null : Number(merged.term_months);
  if (termMonths != null && (!Number.isInteger(termMonths) || termMonths < 0)) {
    throw new Error('Term must be a whole number of months');
  }
  const promoEnd = optionalDate(merged.promo_end_date);
  if (loanType === 'deferred_interest' && !promoEnd) {
    throw new Error('A deferred-interest loan needs the date the balance must be paid by');
  }

  return {
    name,
    loan_type: loanType,
    status,
    owner_user_id: Number(merged.owner_user_id),
    project_id: merged.project_id ?? null,
    account_id: merged.account_id ?? null,
    lender: merged.lender?.trim() || null,
    opened_date: optionalDate(merged.opened_date),
    original_principal: optionalNonNegative(merged.original_principal, 'Original amount') ?? 0,
    interest_rate: optionalNonNegative(merged.interest_rate, 'Interest rate'),
    term_months: termMonths,
    expected_payment: optionalNonNegative(merged.expected_payment, 'Expected payment'),
    payment_due_day: dueDay,
    first_payment_date: optionalDate(merged.first_payment_date),
    allows_full_payoff: merged.allows_full_payoff == null ? 1 : Number(Boolean(merged.allows_full_payoff)),
    prepayment_terms: merged.prepayment_terms?.trim() || null,
    promo_end_date: promoEnd,
    deferred_interest_rate: optionalNonNegative(merged.deferred_interest_rate, 'Deferred interest rate'),
    notes: merged.notes?.trim() || null,
  };
}

function loanWriteParams(loan: Omit<Loan, 'id' | 'created_at' | 'updated_at'>): unknown[] {
  return [
    loan.name,
    loan.loan_type,
    loan.status,
    loan.owner_user_id,
    loan.project_id,
    loan.account_id,
    loan.lender,
    loan.opened_date,
    loan.original_principal,
    loan.interest_rate,
    loan.term_months,
    loan.expected_payment,
    loan.payment_due_day,
    loan.first_payment_date,
    loan.allows_full_payoff,
    loan.prepayment_terms,
    loan.promo_end_date,
    loan.deferred_interest_rate,
    loan.notes,
  ];
}

function normalizeRuleInput(input: LoanMatchRuleInput): { pattern: string; match_type: MerchantRuleMatchType; account_id: number | null; enabled: number; notes: string | null } {
  const pattern = normalizeDescription(input.pattern);
  if (!pattern) throw new Error('A rule needs a description pattern');
  if (!MATCH_TYPES.has(input.match_type)) throw new Error(`Unknown match type: ${input.match_type}`);
  return {
    pattern,
    match_type: input.match_type,
    account_id: input.account_id ?? null,
    enabled: input.enabled === undefined ? 1 : Number(Boolean(input.enabled)),
    notes: input.notes?.trim() || null,
  };
}

export interface LoanPaymentUpdate {
  /** Manual payments only; ignored for linked transactions. */
  payment_date?: string;
  amount?: number;
  /** Both null (or omitted together) returns the payment to the computed split. */
  principal_amount?: number | null;
  interest_amount?: number | null;
  notes?: string | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Loans (schema v5): terms, loan-owned payment rules, the payment ledger and
 * the computed summary. Loan rules take precedence over subscription
 * detection: the subscription scan asks getLinkedTransactionIds() and skips
 * those rows.
 */
export class LoansService {
  constructor(private readonly worker: LoansTransport) {}

  // --- loans ---

  async list(): Promise<Loan[]> {
    const rows = await this.worker.query(LOAN_QUERIES.GET_ALL);
    return rows.map(mapToLoan);
  }

  async getById(id: number): Promise<Loan | null> {
    const rows = await this.worker.query(LOAN_QUERIES.GET_BY_ID, [id]);
    return rows.length > 0 ? mapToLoan(rows[0]) : null;
  }

  async create(input: LoanInput): Promise<number> {
    const loan = normalizeLoanInput(input);
    const rows = await this.worker.query(LOAN_QUERIES.CREATE, loanWriteParams(loan));
    const id = Number(rows[0].id);
    await this.syncAccountSnapshot(id);
    return id;
  }

  async update(id: number, input: Partial<LoanInput>): Promise<void> {
    const existing = await this.getById(id);
    if (!existing) throw new Error('Loan not found');
    const loan = normalizeLoanInput({ ...input, name: input.name ?? existing.name, owner_user_id: input.owner_user_id ?? existing.owner_user_id }, existing);
    await this.worker.query(LOAN_QUERIES.UPDATE, [...loanWriteParams(loan), id]);
    await this.syncAccountSnapshot(id);
  }

  async setStatus(id: number, status: LoanStatus): Promise<void> {
    if (!LOAN_STATUSES.has(status)) throw new Error(`Unknown loan status: ${status}`);
    await this.worker.query(LOAN_QUERIES.SET_STATUS, [status, id]);
  }

  async remove(id: number): Promise<void> {
    await this.worker.query(LOAN_QUERIES.DELETE, [id]);
  }

  // --- rules ---

  async listRules(loanId?: number): Promise<LoanMatchRule[]> {
    const rows = loanId == null
      ? await this.worker.query(LOAN_QUERIES.GET_ALL_RULES)
      : await this.worker.query(LOAN_QUERIES.GET_RULES_FOR_LOAN, [loanId]);
    return rows.map(mapToLoanMatchRule);
  }

  async addRule(input: LoanMatchRuleInput): Promise<number> {
    if (!input.loan_id) throw new Error('A rule needs a loan');
    const rule = normalizeRuleInput(input);
    const rows = await this.worker.query(LOAN_QUERIES.CREATE_RULE, [
      input.loan_id,
      rule.pattern,
      rule.match_type,
      rule.account_id,
      rule.enabled,
      rule.notes,
    ]);
    return Number(rows[0].id);
  }

  async updateRule(id: number, input: Omit<LoanMatchRuleInput, 'loan_id'>): Promise<void> {
    const rule = normalizeRuleInput({ ...input, loan_id: -1 });
    await this.worker.query(LOAN_QUERIES.UPDATE_RULE, [
      rule.pattern,
      rule.match_type,
      rule.account_id,
      rule.enabled,
      rule.notes,
      id,
    ]);
  }

  async deleteRule(id: number): Promise<void> {
    await this.worker.query(LOAN_QUERIES.DELETE_RULE, [id]);
  }

  /** Dry-run for the rule editor: unlinked outflows the rule would claim. */
  async previewRuleMatches(rule: { pattern: string; match_type: MerchantRuleMatchType; account_id?: number | null }): Promise<LoanLinkCandidate[]> {
    const pattern = normalizeDescription(rule.pattern);
    if (!pattern) return [];
    const probe = { pattern, match_type: rule.match_type, account_id: rule.account_id ?? null, enabled: 1 };
    const rows = await this.worker.query(LOAN_QUERIES.GET_RULE_CANDIDATES);
    return rows
      .filter((row: any) => loanRuleMatches(normalizeDescription(String(row.description ?? '')), Number(row.account_id), probe))
      .map(mapToCandidate);
  }

  /**
   * Links every unlinked outflow that matches an enabled rule as a payment
   * on that rule's loan. Idempotent: rows already linked are never revisited.
   */
  async applyRules(): Promise<LoanRuleScanSummary> {
    const rules = (await this.worker.query(LOAN_QUERIES.GET_ENABLED_RULES)).map(mapToLoanMatchRule);
    const summary: LoanRuleScanSummary = { scanned: 0, linked: 0, byLoan: {} };
    if (rules.length === 0) return summary;

    const candidates = await this.worker.query(LOAN_QUERIES.GET_RULE_CANDIDATES);
    summary.scanned = candidates.length;
    const hits: Array<{ loanId: number; row: any }> = [];
    for (const row of candidates) {
      const rule = matchLoanRule(normalizeDescription(String(row.description ?? '')), Number(row.account_id), rules);
      if (rule) hits.push({ loanId: rule.loan_id, row });
    }
    if (hits.length === 0) return summary;

    await this.worker.query('BEGIN TRANSACTION');
    try {
      for (const { loanId, row } of hits) {
        await this.worker.query(LOAN_QUERIES.CREATE_PAYMENT, [
          loanId,
          Number(row.id),
          String(row.date),
          Math.abs(Number(row.amount)),
          null,
          null,
          'computed',
          'rule',
          null,
        ]);
        summary.linked++;
        summary.byLoan[loanId] = (summary.byLoan[loanId] ?? 0) + 1;
      }
      await this.worker.query('COMMIT');
    } catch (error) {
      await this.worker.query('ROLLBACK');
      log.error('Failed to apply loan rules', { operation: 'applyRules', error });
      throw error;
    }

    for (const loanId of Object.keys(summary.byLoan)) {
      await this.syncAccountSnapshot(Number(loanId));
    }
    return summary;
  }

  // --- payments ---

  async listPayments(loanId: number): Promise<LoanPayment[]> {
    const rows = await this.worker.query(LOAN_QUERIES.GET_PAYMENTS_FOR_LOAN, [loanId]);
    return rows.map(mapToLoanPayment);
  }

  async getPaymentById(id: number): Promise<LoanPayment | null> {
    const rows = await this.worker.query(LOAN_QUERIES.GET_PAYMENT_BY_ID, [id]);
    return rows.length > 0 ? mapToLoanPayment(rows[0]) : null;
  }

  /** Transactions that are already a payment on some loan. */
  async getLinkedTransactionIds(): Promise<Set<number>> {
    const rows = await this.worker.query(LOAN_QUERIES.GET_LINKED_TRANSACTION_IDS);
    return new Set<number>(rows.map((row: any) => Number(row.transaction_id)));
  }

  async searchLinkCandidates(search: string): Promise<LoanLinkCandidate[]> {
    const text = search.trim();
    const rows = await this.worker.query(LOAN_QUERIES.SEARCH_LINK_CANDIDATES, [text, text]);
    return rows.map(mapToCandidate);
  }

  /** Marks a tracked transaction as a payment on the loan (by hand). */
  async linkTransaction(loanId: number, transactionId: number): Promise<number> {
    const rows = await this.worker.query(LOAN_QUERIES.GET_TRANSACTION_FOR_LINK, [transactionId]);
    if (rows.length === 0) throw new Error('Transaction not found');
    const row = rows[0];
    const amount = Math.abs(Number(row.amount));
    if (!(amount > 0)) throw new Error('A zero-amount transaction cannot be a loan payment');
    const created = await this.worker.query(LOAN_QUERIES.CREATE_PAYMENT, [
      loanId,
      transactionId,
      String(row.date),
      amount,
      null,
      null,
      'computed',
      'manual',
      null,
    ]);
    await this.syncAccountSnapshot(loanId);
    return Number(created[0].id);
  }

  /** Records a payment from an account the app does not track. */
  async addManualPayment(input: LoanManualPaymentInput): Promise<number> {
    const amount = Math.abs(Number(input.amount));
    if (!(amount > 0)) throw new Error('A payment needs an amount');
    const date = optionalDate(input.payment_date);
    if (!date) throw new Error('A payment needs a date');
    const split = resolveSplit(amount, input.principal_amount ?? null, input.interest_amount ?? null);
    const rows = await this.worker.query(LOAN_QUERIES.CREATE_PAYMENT, [
      input.loan_id,
      null,
      date,
      amount,
      split.principal,
      split.interest,
      split.source,
      'manual',
      input.notes?.trim() || null,
    ]);
    await this.syncAccountSnapshot(input.loan_id);
    return Number(rows[0].id);
  }

  /** Edits a payment's split / notes (and date / amount for manual payments). */
  async updatePayment(id: number, update: LoanPaymentUpdate): Promise<void> {
    const existing = await this.getPaymentById(id);
    if (!existing) throw new Error('Payment not found');
    const manual = existing.transaction_id == null;
    const date = manual ? (optionalDate(update.payment_date) ?? existing.payment_date) : existing.payment_date;
    const amount = manual && update.amount != null ? Math.abs(Number(update.amount)) : existing.amount;
    if (!(amount > 0)) throw new Error('A payment needs an amount');
    const principal = update.principal_amount === undefined ? existing.principal_amount : update.principal_amount;
    const interest = update.interest_amount === undefined ? existing.interest_amount : update.interest_amount;
    const split = resolveSplit(amount, principal, interest);
    await this.worker.query(LOAN_QUERIES.UPDATE_PAYMENT, [
      date,
      amount,
      split.principal,
      split.interest,
      split.source,
      update.notes === undefined ? existing.notes : (update.notes?.trim() || null),
      id,
    ]);
    await this.syncAccountSnapshot(existing.loan_id);
  }

  /** Removes the payment; a linked transaction itself is untouched. */
  async deletePayment(id: number): Promise<void> {
    const existing = await this.getPaymentById(id);
    await this.worker.query(LOAN_QUERIES.DELETE_PAYMENT, [id]);
    if (existing) await this.syncAccountSnapshot(existing.loan_id);
  }

  // --- summary ---

  async getSummary(loanId: number, asOf: string = todayLocalISO()): Promise<LoanSummary | null> {
    const loan = await this.getById(loanId);
    if (!loan) return null;
    const payments = await this.listPayments(loanId);
    return computeLoanSummary(loan, payments, asOf);
  }

  /**
   * Writes the computed balance (negative: a liability) as today's statement
   * balance of the linked loan / credit account, so Accounts and net worth
   * see what the ledger says. No-op for loans without an account.
   */
  async syncAccountSnapshot(loanId: number): Promise<void> {
    try {
      const loan = await this.getById(loanId);
      if (!loan || loan.account_id == null) return;
      const summary = computeLoanSummary(loan, await this.listPayments(loanId));
      await this.worker.query(LOAN_QUERIES.UPSERT_ACCOUNT_SNAPSHOT, [
        loan.account_id,
        summary.asOf,
        -roundMoney(summary.payoffAmount),
        `Loan: ${loan.name}`,
      ]);
    } catch (error) {
      // The ledger is the source of truth; a snapshot write must never fail a loan mutation.
      log.warn('Failed to sync loan account snapshot', { operation: 'syncAccountSnapshot', loanId, error });
    }
  }
}

function resolveSplit(
  amount: number,
  principal: number | null,
  interest: number | null
): { principal: number | null; interest: number | null; source: 'computed' | 'manual' } {
  if (principal == null && interest == null) return { principal: null, interest: null, source: 'computed' };
  const resolvedInterest = interest != null ? Number(interest) : roundMoney(amount - Number(principal));
  const resolvedPrincipal = principal != null ? Number(principal) : roundMoney(amount - resolvedInterest);
  if (resolvedInterest < 0 || resolvedPrincipal < 0) throw new Error('Principal and interest must be zero or more');
  if (Math.abs(resolvedPrincipal + resolvedInterest - amount) > 0.011) {
    throw new Error('Principal and interest must add up to the payment amount');
  }
  return { principal: roundMoney(resolvedPrincipal), interest: roundMoney(resolvedInterest), source: 'manual' };
}
