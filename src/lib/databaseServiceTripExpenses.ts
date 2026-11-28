// Trip business expenses (schema v8): which part of each trip expense is
// business, the reimbursement status of that part, and the money received
// back. SQL in sqlQueriesTripExpenses.ts, the maths in tripInsights.ts.
//
// An allocation is only valid while its transaction is an expense on the same
// trip. Every path that moves a row between trips, changes its type or
// deletes it calls `syncAfterLabelChange` / the cleanup helpers, which prune
// stale rows; ON DELETE is never relied upon (foreign keys are off on
// reopened databases).

import type { DatabaseWorkerTransport } from './databaseService';
import { logger } from './logging';
import { TRIP_EXPENSE_QUERIES } from './sqlQueriesTripExpenses';
import { businessParts, summarizeTrip } from './tripInsights';
import type {
  TripAllocationInput,
  TripCandidateTransaction,
  TripDepositCandidate,
  TripExpenseSummary,
  TripInsightRow,
  TripReimbursement,
  TripReimbursementInput,
  TripReimbursementStatus,
} from '../types/tripExpenses';
import { TRIP_REIMBURSEMENT_STATUSES } from '../types/tripExpenses';

type TripExpensesTransport = Pick<DatabaseWorkerTransport, 'query'>;

const log = logger.child({ component: 'TripExpensesService' });

const round2 = (value: number) => Math.round(value * 100) / 100;
const numberOrNull = (value: unknown) => (value == null || value === '' ? null : Number(value));
const textOrNull = (value: unknown) => (value == null ? null : String(value));

function asStatus(value: unknown): TripReimbursementStatus | null {
  return TRIP_REIMBURSEMENT_STATUSES.includes(value as TripReimbursementStatus)
    ? (value as TripReimbursementStatus)
    : null;
}

export function mapToTripInsightRow(row: any): TripInsightRow {
  const base = {
    transaction_id: Number(row.transaction_id),
    trip_id: Number(row.trip_id),
    date: String(row.date ?? ''),
    description: String(row.description ?? ''),
    type: String(row.type ?? ''),
    is_excluded: Number(row.is_excluded ?? 0) === 1,
    amount: Number(row.amount ?? 0),
    account_id: Number(row.account_id),
    account_currency: String(row.account_currency ?? 'USD'),
    user_id: numberOrNull(row.user_id),
    user_name: textOrNull(row.user_name),
    category_id: numberOrNull(row.category_id),
    category_name: textOrNull(row.category_name),
    category_color: textOrNull(row.category_color),
    company_id: numberOrNull(row.company_id),
    company_name: textOrNull(row.company_name),
    gross_spend: numberOrNull(row.gross_spend),
    rate: numberOrNull(row.rate),
    business_amount: numberOrNull(row.business_amount),
    status: asStatus(row.status),
    note: textOrNull(row.note),
  };
  const { business, denied } = businessParts(base);
  return { ...base, business_share: business, denied_share: denied };
}

export function mapToTripReimbursement(row: any): TripReimbursement {
  return {
    id: Number(row.id),
    trip_id: Number(row.trip_id),
    amount: Number(row.amount ?? 0),
    received_date: textOrNull(row.received_date),
    transaction_id: numberOrNull(row.transaction_id),
    note: textOrNull(row.note),
    created_at: String(row.created_at ?? ''),
    transaction_description: textOrNull(row.transaction_description),
    transaction_date: textOrNull(row.transaction_date),
    transaction_amount: numberOrNull(row.transaction_amount),
    transaction_account_id: numberOrNull(row.transaction_account_id),
    transaction_account_currency: textOrNull(row.transaction_account_currency),
    transaction_type: textOrNull(row.transaction_type),
  };
}

function mapToCandidate(row: any): TripCandidateTransaction {
  return {
    transaction_id: Number(row.transaction_id),
    date: String(row.date ?? ''),
    description: String(row.description ?? ''),
    amount: Number(row.amount ?? 0),
    account_id: Number(row.account_id),
    account_currency: String(row.account_currency ?? 'USD'),
    user_name: textOrNull(row.user_name),
    category_name: textOrNull(row.category_name),
    company_name: textOrNull(row.company_name),
    project_id: numberOrNull(row.project_id),
  };
}

function mapToDepositCandidate(row: any): TripDepositCandidate {
  return {
    transaction_id: Number(row.transaction_id),
    date: String(row.date ?? ''),
    description: String(row.description ?? ''),
    amount: Number(row.amount ?? 0),
    type: String(row.type ?? ''),
    account_id: Number(row.account_id),
    account_currency: String(row.account_currency ?? 'USD'),
  };
}

export interface TripExpenseDetail {
  rows: TripInsightRow[];
  receipts: TripReimbursement[];
  summary: TripExpenseSummary;
}

/** A row whose trip may have changed: `previousTripId` is its trip before the change. */
export interface TripLabelChange {
  transactionId: number;
  previousTripId: number | null;
  nextTripId: number | null;
}

function validateReimbursement(input: Pick<TripReimbursementInput, 'amount'>): number {
  const amount = round2(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('TRIP_REIMBURSEMENT_AMOUNT_INVALID');
  return amount;
}

export class TripExpensesService {
  constructor(private readonly worker: TripExpensesTransport) {}

  private async inTransaction<T>(work: () => Promise<T>): Promise<T> {
    await this.worker.query('BEGIN TRANSACTION');
    try {
      const result = await work();
      await this.worker.query('COMMIT');
      return result;
    } catch (error) {
      await this.worker.query('ROLLBACK').catch((rollbackError) => {
        log.warn('Rollback failed', { operation: 'inTransaction', error: rollbackError });
      });
      throw error;
    }
  }

  // --- reading ---

  async getRows(tripId: number): Promise<TripInsightRow[]> {
    return (await this.worker.query(TRIP_EXPENSE_QUERIES.ROWS_FOR_TRIP, [tripId])).map(mapToTripInsightRow);
  }

  async getReimbursements(tripId: number): Promise<TripReimbursement[]> {
    return (await this.worker.query(TRIP_EXPENSE_QUERIES.RECEIPTS_FOR_TRIP, [tripId])).map(mapToTripReimbursement);
  }

  /** Rows, receipts and figures of one trip: what the trip detail view shows. */
  async getDetail(tripId: number): Promise<TripExpenseDetail> {
    const [rows, receipts] = await Promise.all([this.getRows(tripId), this.getReimbursements(tripId)]);
    return { rows, receipts, summary: summarizeTrip(tripId, rows, receipts) };
  }

  /** Figures for every trip that has linked rows or receipts, keyed by trip id. */
  async getAllSummaries(): Promise<Record<number, TripExpenseSummary>> {
    const [rowResults, receiptResults] = await Promise.all([
      this.worker.query(TRIP_EXPENSE_QUERIES.ROWS_ALL_TRIPS),
      this.worker.query(TRIP_EXPENSE_QUERIES.RECEIPTS_ALL),
    ]);
    const rowsByTrip = new Map<number, TripInsightRow[]>();
    for (const row of rowResults.map(mapToTripInsightRow)) {
      rowsByTrip.set(row.trip_id, [...(rowsByTrip.get(row.trip_id) ?? []), row]);
    }
    const receiptsByTrip = new Map<number, TripReimbursement[]>();
    for (const receipt of receiptResults.map(mapToTripReimbursement)) {
      receiptsByTrip.set(receipt.trip_id, [...(receiptsByTrip.get(receipt.trip_id) ?? []), receipt]);
    }
    const tripIds = new Set([...rowsByTrip.keys(), ...receiptsByTrip.keys()]);
    const summaries: Record<number, TripExpenseSummary> = {};
    for (const tripId of tripIds) {
      summaries[tripId] = summarizeTrip(tripId, rowsByTrip.get(tripId) ?? [], receiptsByTrip.get(tripId) ?? []);
    }
    return summaries;
  }

  /** Expenses and refunds between two dates (inclusive) that are on no trip. */
  async findCandidates(startDate: string, endDate: string): Promise<TripCandidateTransaction[]> {
    return (await this.worker.query(TRIP_EXPENSE_QUERIES.CANDIDATES, [startDate, endDate])).map(mapToCandidate);
  }

  /** Income and refunds between two dates: where a reimbursement may have arrived. */
  async findDepositCandidates(startDate: string, endDate: string): Promise<TripDepositCandidate[]> {
    return (await this.worker.query(TRIP_EXPENSE_QUERIES.DEPOSIT_CANDIDATES, [startDate, endDate])).map(
      mapToDepositCandidate
    );
  }

  // --- linking rows ---

  /**
   * Puts rows on a trip (clearing their project: a row is on a project or a
   * trip, not both) or, with `tripId` null, takes them off their trip. On a
   * business trip a newly linked expense becomes fully business.
   */
  async assignTransactions(transactionIds: number[], tripId: number | null): Promise<void> {
    const ids = [...new Set(transactionIds)];
    if (ids.length === 0) return;
    await this.inTransaction(async () => {
      const changes: TripLabelChange[] = [];
      for (const id of ids) {
        const previous = await this.worker.query(TRIP_EXPENSE_QUERIES.GET_TRIP_ID, [id]);
        if (previous.length === 0) throw new Error(`Transaction ${id} was not found`);
        await this.worker.query(TRIP_EXPENSE_QUERIES.ASSIGN_TRIP, [tripId, id]);
        changes.push({ transactionId: id, previousTripId: numberOrNull(previous[0].trip_id), nextTripId: tripId });
      }
      await this.syncAfterLabelChange(changes);
    });
    log.withOperation('assignTripTransactions').info('Assigned transactions to trip', {
      tripId,
      count: ids.length,
    });
  }

  /**
   * Keeps allocations in step after rows changed trip (or type) through any
   * path. Runs inside the caller's transaction when there is one: plain
   * statements only.
   */
  async syncAfterLabelChange(changes: readonly TripLabelChange[]): Promise<void> {
    for (const change of changes) {
      if (change.nextTripId != null && change.nextTripId !== change.previousTripId) {
        // A row moving from one trip to another starts again on the new one.
        await this.worker.query(TRIP_EXPENSE_QUERIES.DELETE_ALLOCATION_FOR_TRANSACTION, [change.transactionId]);
        await this.worker.query(TRIP_EXPENSE_QUERIES.INSERT_DEFAULT_BUSINESS, [change.transactionId]);
      }
    }
    await this.prune();
  }

  /** Drops every allocation whose transaction left its trip or stopped being an expense. */
  async prune(): Promise<void> {
    await this.worker.query(TRIP_EXPENSE_QUERIES.PRUNE);
  }

  // --- business parts ---

  /**
   * Sets the business part of trip expenses. 0 makes a row all personal (the
   * row is kept, so a business trip's default does not come back); a value
   * above the charge is capped at it.
   */
  async setAllocations(items: TripAllocationInput[]): Promise<void> {
    if (items.length === 0) return;
    await this.inTransaction(async () => {
      for (const item of items) {
        const rows = await this.worker.query(TRIP_EXPENSE_QUERIES.EXPENSE_FOR_ALLOCATION, [item.transactionId]);
        const row = rows[0];
        if (!row || row.trip_id == null || row.type !== 'expense' || Number(row.amount) >= 0) {
          throw new Error('TRIP_ALLOCATION_NOT_TRIP_EXPENSE');
        }
        const requested = round2(Number(item.businessAmount));
        if (!Number.isFinite(requested) || requested < 0) throw new Error('TRIP_ALLOCATION_AMOUNT_INVALID');
        const businessAmount = Math.min(requested, round2(-Number(row.amount)));
        const status = item.status ?? asStatus(row.status) ?? 'pending';
        const note = item.note !== undefined ? item.note?.trim() || null : textOrNull(row.note);
        await this.worker.query(TRIP_EXPENSE_QUERIES.UPSERT_ALLOCATION, [
          item.transactionId,
          Number(row.trip_id),
          businessAmount,
          status,
          note,
        ]);
      }
    });
  }

  /** Sets the reimbursement status of business parts (rows without one are left alone). */
  async setStatus(transactionIds: number[], status: TripReimbursementStatus): Promise<void> {
    if (!TRIP_REIMBURSEMENT_STATUSES.includes(status)) throw new Error('TRIP_STATUS_INVALID');
    if (transactionIds.length === 0) return;
    await this.inTransaction(async () => {
      for (const id of new Set(transactionIds)) {
        await this.worker.query(TRIP_EXPENSE_QUERIES.SET_STATUS, [status, id]);
      }
    });
  }

  // --- reimbursements ---

  async addReimbursement(input: TripReimbursementInput): Promise<number> {
    const amount = validateReimbursement(input);
    const id = await this.inTransaction(async () => {
      if (input.transactionId != null) await this.applyDepositChoice(input.transactionId, input.countDepositAsRefund);
      const rows = await this.worker.query(TRIP_EXPENSE_QUERIES.CREATE_RECEIPT, [
        input.tripId,
        amount,
        input.receivedDate || null,
        input.transactionId ?? null,
        input.note?.trim() || null,
      ]);
      for (const transactionId of new Set(input.markReimbursedIds ?? [])) {
        await this.worker.query(TRIP_EXPENSE_QUERIES.MARK_REIMBURSED, [transactionId, input.tripId]);
      }
      return Number(rows[0].id);
    });
    log.withOperation('addTripReimbursement').info('Recorded trip reimbursement', {
      tripId: input.tripId,
      linked: input.transactionId != null,
      depositAsRefund: Boolean(input.countDepositAsRefund),
    });
    return id;
  }

  async updateReimbursement(id: number, input: Omit<TripReimbursementInput, 'tripId'>): Promise<void> {
    const amount = validateReimbursement(input);
    await this.inTransaction(async () => {
      const existing = await this.worker.query(TRIP_EXPENSE_QUERIES.GET_RECEIPT, [id]);
      if (existing.length === 0) throw new Error('TRIP_REIMBURSEMENT_NOT_FOUND');
      if (input.transactionId != null) await this.applyDepositChoice(input.transactionId, input.countDepositAsRefund);
      await this.worker.query(TRIP_EXPENSE_QUERIES.UPDATE_RECEIPT, [
        amount,
        input.receivedDate || null,
        input.transactionId ?? null,
        input.note?.trim() || null,
        id,
      ]);
      const tripId = Number(existing[0].trip_id);
      for (const transactionId of new Set(input.markReimbursedIds ?? [])) {
        await this.worker.query(TRIP_EXPENSE_QUERIES.MARK_REIMBURSED, [transactionId, tripId]);
      }
    });
  }

  /** Removes a receipt. A deposit it turned into a refund keeps that type. */
  async deleteReimbursement(id: number): Promise<void> {
    await this.worker.query(TRIP_EXPENSE_QUERIES.DELETE_RECEIPT, [id]);
  }

  private async applyDepositChoice(transactionId: number, countDepositAsRefund: boolean | undefined): Promise<void> {
    const rows = await this.worker.query(TRIP_EXPENSE_QUERIES.GET_DEPOSIT, [transactionId]);
    const deposit = rows[0];
    if (!deposit || Number(deposit.amount) <= 0 || !['income', 'refund'].includes(String(deposit.type))) {
      throw new Error('TRIP_DEPOSIT_INVALID');
    }
    if (countDepositAsRefund && deposit.type !== 'refund') {
      await this.worker.query(TRIP_EXPENSE_QUERIES.MARK_DEPOSIT_REFUND, [transactionId]);
    }
  }

  // --- cleanup for rows that go away (plain statements: callers own the transaction) ---

  /** Before a trip is deleted: its rows leave it, its allocations and receipts go. */
  async cleanupForDeletedTrip(tripId: number): Promise<void> {
    await this.worker.query(TRIP_EXPENSE_QUERIES.DELETE_ALLOCATIONS_FOR_TRIP, [tripId]);
    await this.worker.query(TRIP_EXPENSE_QUERIES.DELETE_RECEIPTS_FOR_TRIP, [tripId]);
    await this.worker.query(TRIP_EXPENSE_QUERIES.UNLINK_TRIP_TRANSACTIONS, [tripId]);
  }

  /** Before a transaction is deleted: its allocation goes, receipts forget it. */
  async cleanupForDeletedTransaction(transactionId: number): Promise<void> {
    await this.worker.query(TRIP_EXPENSE_QUERIES.DELETE_ALLOCATION_FOR_TRANSACTION, [transactionId]);
    await this.worker.query(TRIP_EXPENSE_QUERIES.UNLINK_RECEIPTS_FOR_TRANSACTION, [transactionId]);
  }

  /** Before an import batch's rows are deleted (undo). */
  async cleanupForImportBatch(batchId: number): Promise<void> {
    await this.worker.query(TRIP_EXPENSE_QUERIES.DELETE_ALLOCATIONS_FOR_BATCH, [batchId]);
    await this.worker.query(TRIP_EXPENSE_QUERIES.UNLINK_RECEIPTS_FOR_BATCH, [batchId]);
  }
}
