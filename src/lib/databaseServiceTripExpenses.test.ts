import { describe, expect, it, vi } from 'vitest';

import { DatabaseService, type DatabaseWorkerTransport } from './databaseService';
import { TripExpensesService, mapToTripInsightRow, mapToTripReimbursement } from './databaseServiceTripExpenses';
import { TRANSACTION_QUERIES } from './sqlQueries';
import { TRIP_EXPENSE_QUERIES } from './sqlQueriesTripExpenses';

type Rows = Record<string, unknown[] | ((params?: unknown[]) => unknown[])>;

function createWorker(rowsBySql: Rows = {}) {
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    const entry = rowsBySql[sql];
    if (typeof entry === 'function') return entry(params);
    return entry ?? [];
  });
  return { query };
}

const issued = (worker: ReturnType<typeof createWorker>) => worker.query.mock.calls.map((call) => call[0]);

const sqlRow = {
  transaction_id: 1,
  trip_id: 3,
  date: '2026-10-10',
  description: 'Hotel',
  type: 'expense',
  is_excluded: 0,
  amount: -900,
  account_id: 2,
  account_currency: 'EUR',
  user_id: null,
  user_name: null,
  category_id: 11,
  category_name: 'Lodging',
  category_color: '#000',
  company_id: null,
  company_name: null,
  gross_spend: 990,
  rate: 1.1,
  business_amount: 600,
  status: 'pending',
  note: null,
};

describe('mapping', () => {
  it('maps a trip row and converts its business part to the default currency', () => {
    expect(mapToTripInsightRow(sqlRow)).toMatchObject({
      transaction_id: 1,
      trip_id: 3,
      is_excluded: false,
      account_currency: 'EUR',
      user_id: null,
      gross_spend: 990,
      business_amount: 600,
      business_share: 600 * 1.1,
      denied_share: 0,
      status: 'pending',
    });
  });

  it('treats an unknown status as none and a missing rate as unknown', () => {
    expect(mapToTripInsightRow({ ...sqlRow, status: 'bogus', business_amount: null })).toMatchObject({
      status: null,
      business_share: 0,
    });
    expect(mapToTripInsightRow({ ...sqlRow, rate: null, gross_spend: null })).toMatchObject({
      gross_spend: null,
      business_share: null,
    });
  });

  it('maps a reimbursement with and without a linked deposit', () => {
    expect(mapToTripReimbursement({ id: 4, trip_id: 3, amount: '1100.5', received_date: null, transaction_id: null })).toMatchObject({
      id: 4,
      amount: 1100.5,
      transaction_id: null,
      transaction_description: null,
    });
  });
});

describe('TripExpensesService reading', () => {
  it('builds a trip detail from its rows and receipts', async () => {
    const worker = createWorker({
      [TRIP_EXPENSE_QUERIES.ROWS_FOR_TRIP]: [sqlRow],
      [TRIP_EXPENSE_QUERIES.RECEIPTS_FOR_TRIP]: [{ id: 1, trip_id: 3, amount: 600 }],
    });
    const detail = await new TripExpensesService(worker).getDetail(3);
    expect(worker.query).toHaveBeenCalledWith(TRIP_EXPENSE_QUERIES.ROWS_FOR_TRIP, [3]);
    expect(detail.summary).toMatchObject({ gross_spend: 990, business_share: 660, personal_share: 330, received: 600, outstanding: 60 });
  });

  it('groups summaries by trip, including a trip that has only a receipt', async () => {
    const worker = createWorker({
      [TRIP_EXPENSE_QUERIES.ROWS_ALL_TRIPS]: [sqlRow, { ...sqlRow, transaction_id: 2, trip_id: 5, business_amount: null, status: null }],
      [TRIP_EXPENSE_QUERIES.RECEIPTS_ALL]: [{ id: 1, trip_id: 7, amount: 50 }],
    });
    const summaries = await new TripExpensesService(worker).getAllSummaries();
    expect(Object.keys(summaries).sort()).toEqual(['3', '5', '7']);
    expect(summaries[5]).toMatchObject({ gross_spend: 990, business_share: 0 });
    expect(summaries[7]).toMatchObject({ gross_spend: 0, received: 50, outstanding: -50 });
  });

  it('passes the date window to the candidate searches', async () => {
    const worker = createWorker({
      [TRIP_EXPENSE_QUERIES.CANDIDATES]: [{ transaction_id: 9, date: '2026-10-09', description: 'Cab', amount: -20, account_id: 1, project_id: 4 }],
      [TRIP_EXPENSE_QUERIES.DEPOSIT_CANDIDATES]: [{ transaction_id: 10, date: '2026-10-30', description: 'Payroll', amount: 3000, type: 'income', account_id: 1 }],
    });
    const service = new TripExpensesService(worker);
    expect(await service.findCandidates('2026-10-07', '2026-10-15')).toEqual([
      expect.objectContaining({ transaction_id: 9, project_id: 4, account_currency: 'USD' }),
    ]);
    expect(await service.findDepositCandidates('2026-10-15', '2026-12-15')).toEqual([
      expect.objectContaining({ transaction_id: 10, type: 'income' }),
    ]);
    expect(worker.query).toHaveBeenCalledWith(TRIP_EXPENSE_QUERIES.CANDIDATES, ['2026-10-07', '2026-10-15']);
  });
});

describe('TripExpensesService linking', () => {
  it('assigns rows in one transaction, starts each moved row afresh and prunes', async () => {
    const worker = createWorker({
      [TRIP_EXPENSE_QUERIES.GET_TRIP_ID]: (params) => [{ trip_id: params?.[0] === 1 ? 3 : null }],
    });
    await new TripExpensesService(worker).assignTransactions([1, 2, 2], 3);
    expect(issued(worker)).toEqual([
      'BEGIN TRANSACTION',
      TRIP_EXPENSE_QUERIES.GET_TRIP_ID,
      TRIP_EXPENSE_QUERIES.ASSIGN_TRIP,
      TRIP_EXPENSE_QUERIES.GET_TRIP_ID,
      TRIP_EXPENSE_QUERIES.ASSIGN_TRIP,
      // Row 1 was already on trip 3: its business part is kept. Row 2 is new.
      TRIP_EXPENSE_QUERIES.DELETE_ALLOCATION_FOR_TRANSACTION,
      TRIP_EXPENSE_QUERIES.INSERT_DEFAULT_BUSINESS,
      TRIP_EXPENSE_QUERIES.PRUNE,
      'COMMIT',
    ]);
    expect(worker.query).toHaveBeenCalledWith(TRIP_EXPENSE_QUERIES.ASSIGN_TRIP, [3, 2]);
    expect(worker.query).toHaveBeenCalledWith(TRIP_EXPENSE_QUERIES.INSERT_DEFAULT_BUSINESS, [2]);
  });

  it('takes rows off their trip without defaults', async () => {
    const worker = createWorker({ [TRIP_EXPENSE_QUERIES.GET_TRIP_ID]: [{ trip_id: 3 }] });
    await new TripExpensesService(worker).assignTransactions([1], null);
    expect(worker.query).toHaveBeenCalledWith(TRIP_EXPENSE_QUERIES.ASSIGN_TRIP, [null, 1]);
    expect(issued(worker)).not.toContain(TRIP_EXPENSE_QUERIES.INSERT_DEFAULT_BUSINESS);
    expect(issued(worker)).toContain(TRIP_EXPENSE_QUERIES.PRUNE);
  });

  it('rolls back when a row is missing and does nothing for an empty list', async () => {
    const worker = createWorker();
    const service = new TripExpensesService(worker);
    await expect(service.assignTransactions([5], 3)).rejects.toThrow('Transaction 5 was not found');
    expect(issued(worker)).toContain('ROLLBACK');
    worker.query.mockClear();
    await service.assignTransactions([], 3);
    expect(worker.query).not.toHaveBeenCalled();
  });
});

describe('TripExpensesService business parts', () => {
  const expense = { id: 1, trip_id: 3, type: 'expense', amount: -900, status: 'submitted', note: 'Room', business_amount: 900 };

  it('caps the business part at the charge and keeps the stored status and note', async () => {
    const worker = createWorker({ [TRIP_EXPENSE_QUERIES.EXPENSE_FOR_ALLOCATION]: [expense] });
    await new TripExpensesService(worker).setAllocations([{ transactionId: 1, businessAmount: 1200 }]);
    expect(worker.query).toHaveBeenCalledWith(TRIP_EXPENSE_QUERIES.UPSERT_ALLOCATION, [1, 3, 900, 'submitted', 'Room']);
  });

  it('stores 0 for all personal and takes a new status and note', async () => {
    const worker = createWorker({ [TRIP_EXPENSE_QUERIES.EXPENSE_FOR_ALLOCATION]: [{ ...expense, status: null, note: null }] });
    await new TripExpensesService(worker).setAllocations([{ transactionId: 1, businessAmount: 0, note: '  ' }]);
    expect(worker.query).toHaveBeenCalledWith(TRIP_EXPENSE_QUERIES.UPSERT_ALLOCATION, [1, 3, 0, 'pending', null]);
  });

  it('rejects rows that are not a trip expense and negative amounts', async () => {
    const refund = createWorker({ [TRIP_EXPENSE_QUERIES.EXPENSE_FOR_ALLOCATION]: [{ ...expense, type: 'refund', amount: 50 }] });
    await expect(new TripExpensesService(refund).setAllocations([{ transactionId: 1, businessAmount: 5 }])).rejects.toThrow(
      'TRIP_ALLOCATION_NOT_TRIP_EXPENSE'
    );
    const offTrip = createWorker({ [TRIP_EXPENSE_QUERIES.EXPENSE_FOR_ALLOCATION]: [{ ...expense, trip_id: null }] });
    await expect(new TripExpensesService(offTrip).setAllocations([{ transactionId: 1, businessAmount: 5 }])).rejects.toThrow(
      'TRIP_ALLOCATION_NOT_TRIP_EXPENSE'
    );
    const negative = createWorker({ [TRIP_EXPENSE_QUERIES.EXPENSE_FOR_ALLOCATION]: [expense] });
    await expect(new TripExpensesService(negative).setAllocations([{ transactionId: 1, businessAmount: -1 }])).rejects.toThrow(
      'TRIP_ALLOCATION_AMOUNT_INVALID'
    );
    expect(issued(negative)).toContain('ROLLBACK');
  });

  it('sets the status of each business part once', async () => {
    const worker = createWorker();
    const service = new TripExpensesService(worker);
    await service.setStatus([1, 1, 2], 'submitted');
    expect(worker.query.mock.calls.filter((call) => call[0] === TRIP_EXPENSE_QUERIES.SET_STATUS)).toEqual([
      [TRIP_EXPENSE_QUERIES.SET_STATUS, ['submitted', 1]],
      [TRIP_EXPENSE_QUERIES.SET_STATUS, ['submitted', 2]],
    ]);
    await expect(service.setStatus([1], 'lost' as never)).rejects.toThrow('TRIP_STATUS_INVALID');
  });
});

describe('TripExpensesService reimbursements', () => {
  it('records a receipt linked to a paycheck without changing the paycheck', async () => {
    const worker = createWorker({
      [TRIP_EXPENSE_QUERIES.GET_DEPOSIT]: [{ id: 20, type: 'income', amount: 4200 }],
      [TRIP_EXPENSE_QUERIES.CREATE_RECEIPT]: [{ id: 7 }],
    });
    const id = await new TripExpensesService(worker).addReimbursement({
      tripId: 3,
      amount: 1099.999,
      receivedDate: '2026-10-31',
      transactionId: 20,
      note: ' On payslip ',
      markReimbursedIds: [1, 1, 2],
    });
    expect(id).toBe(7);
    expect(worker.query).toHaveBeenCalledWith(TRIP_EXPENSE_QUERIES.CREATE_RECEIPT, [3, 1100, '2026-10-31', 20, 'On payslip']);
    expect(issued(worker)).not.toContain(TRIP_EXPENSE_QUERIES.MARK_DEPOSIT_REFUND);
    expect(worker.query.mock.calls.filter((call) => call[0] === TRIP_EXPENSE_QUERIES.MARK_REIMBURSED)).toHaveLength(2);
  });

  it('turns a reimbursement-only deposit into a refund when asked', async () => {
    const worker = createWorker({
      [TRIP_EXPENSE_QUERIES.GET_DEPOSIT]: [{ id: 21, type: 'income', amount: 1100 }],
      [TRIP_EXPENSE_QUERIES.CREATE_RECEIPT]: [{ id: 8 }],
    });
    await new TripExpensesService(worker).addReimbursement({ tripId: 3, amount: 1100, transactionId: 21, countDepositAsRefund: true });
    expect(worker.query).toHaveBeenCalledWith(TRIP_EXPENSE_QUERIES.MARK_DEPOSIT_REFUND, [21]);
  });

  it('rejects a bad amount or a deposit that is not money in', async () => {
    const service = new TripExpensesService(createWorker());
    await expect(service.addReimbursement({ tripId: 3, amount: 0 })).rejects.toThrow('TRIP_REIMBURSEMENT_AMOUNT_INVALID');
    await expect(service.addReimbursement({ tripId: 3, amount: Number.NaN })).rejects.toThrow('TRIP_REIMBURSEMENT_AMOUNT_INVALID');
    const expenseDeposit = createWorker({ [TRIP_EXPENSE_QUERIES.GET_DEPOSIT]: [{ id: 22, type: 'expense', amount: -5 }] });
    await expect(
      new TripExpensesService(expenseDeposit).addReimbursement({ tripId: 3, amount: 5, transactionId: 22 })
    ).rejects.toThrow('TRIP_DEPOSIT_INVALID');
    expect(issued(expenseDeposit)).toContain('ROLLBACK');
  });

  it('updates and deletes a receipt', async () => {
    const worker = createWorker({ [TRIP_EXPENSE_QUERIES.GET_RECEIPT]: [{ id: 7, trip_id: 3 }] });
    const service = new TripExpensesService(worker);
    await service.updateReimbursement(7, { amount: 500, receivedDate: null, transactionId: null, markReimbursedIds: [4] });
    expect(worker.query).toHaveBeenCalledWith(TRIP_EXPENSE_QUERIES.UPDATE_RECEIPT, [500, null, null, null, 7]);
    expect(worker.query).toHaveBeenCalledWith(TRIP_EXPENSE_QUERIES.MARK_REIMBURSED, [4, 3]);
    await service.deleteReimbursement(7);
    expect(worker.query).toHaveBeenCalledWith(TRIP_EXPENSE_QUERIES.DELETE_RECEIPT, [7]);

    const missing = new TripExpensesService(createWorker());
    await expect(missing.updateReimbursement(9, { amount: 5 })).rejects.toThrow('TRIP_REIMBURSEMENT_NOT_FOUND');
  });
});

describe('TripExpensesService cleanup', () => {
  it('cleans up for a deleted transaction and an undone import', async () => {
    const worker = createWorker();
    const service = new TripExpensesService(worker);
    await service.cleanupForDeletedTransaction(5);
    await service.cleanupForImportBatch(9);
    expect(worker.query.mock.calls).toEqual([
      [TRIP_EXPENSE_QUERIES.DELETE_ALLOCATION_FOR_TRANSACTION, [5]],
      [TRIP_EXPENSE_QUERIES.UNLINK_RECEIPTS_FOR_TRANSACTION, [5]],
      [TRIP_EXPENSE_QUERIES.DELETE_ALLOCATIONS_FOR_BATCH, [9]],
      [TRIP_EXPENSE_QUERIES.UNLINK_RECEIPTS_FOR_BATCH, [9]],
    ]);
  });
});

describe('DatabaseService keeps business parts in step', () => {
  function service(rowsBySql: Rows = {}) {
    const worker = createWorker(rowsBySql);
    return { worker, db: new DatabaseService(worker as unknown as DatabaseWorkerTransport) };
  }

  it('starts a row afresh when a label moves it to another trip', async () => {
    const { worker, db } = service({ [TRANSACTION_QUERIES.GET_RAW_BY_ID]: [{ id: 77, trip_id: 2 }] });
    await db.updateTransactionLabels(77, null, 3);
    expect(worker.query).toHaveBeenCalledWith(TRIP_EXPENSE_QUERIES.INSERT_DEFAULT_BUSINESS, [77]);
    expect(issued(worker)).toContain(TRIP_EXPENSE_QUERIES.PRUNE);
  });

  it('prunes when an edit takes a row off its trip, and not for other edits', async () => {
    const existing = {
      id: 77,
      date: '2026-10-10',
      amount: -50,
      description: 'Cab',
      account_id: 1,
      trip_id: 3,
      type: 'expense',
      transaction_hash: 'h',
      hash_variation_seed: 0,
    };
    const moved = service({ [TRANSACTION_QUERIES.GET_RAW_BY_ID]: [existing] });
    await moved.db.updateTransaction(77, { trip_id: null });
    expect(issued(moved.worker)).toContain(TRIP_EXPENSE_QUERIES.PRUNE);

    const commented = service({ [TRANSACTION_QUERIES.GET_RAW_BY_ID]: [existing] });
    await commented.db.updateTransaction(77, { comment: 'note' });
    expect(issued(commented.worker)).not.toContain(TRIP_EXPENSE_QUERIES.PRUNE);
  });

  it('rolls back a trip delete that fails', async () => {
    const { worker, db } = service({
      [TRIP_EXPENSE_QUERIES.UNLINK_TRIP_TRANSACTIONS]: () => {
        throw new Error('locked');
      },
    });
    await expect(db.deleteTrip(3)).rejects.toThrow('locked');
    expect(issued(worker)).toContain('ROLLBACK');
  });
});
