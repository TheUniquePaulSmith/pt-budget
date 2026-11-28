// Trip business expenses (schema v8): the business part of each trip expense
// and the reimbursements received. Owned by the trips feature; re-exported
// from the sqlQueries.ts hub.
//
// An allocation counts only while its transaction is still an expense on the
// same trip (the join below checks trip_id), and its business part is capped
// at the charge, so an edited amount can never make business exceed it. The
// service prunes stale rows (PRUNE) after every change that can create them.

import { rateExpr, spendExpr } from './sqlMoneyExpressions';

/** The allocation's business part in the account currency, capped at the charge; NULL = none. */
const CAPPED_BUSINESS = `CASE WHEN t.type = 'expense' AND ea.transaction_id IS NOT NULL
      THEN MIN(ea.business_amount, -t.amount) END`;

const ROW_COLUMNS = `
  t.id AS transaction_id,
  t.trip_id,
  t.date,
  t.description,
  t.type,
  t.is_excluded,
  t.amount,
  t.account_id,
  a.currency AS account_currency,
  COALESCE(card.user_id, a.owner_user_id) AS user_id,
  COALESCE(card_user.display_name, owner_user.display_name) AS user_name,
  t.category_id,
  c.name AS category_name,
  c.color AS category_color,
  t.company_id,
  comp.name AS company_name,
  ${spendExpr('t')} AS gross_spend,
  ${rateExpr('t')} AS rate,
  ${CAPPED_BUSINESS} AS business_amount,
  CASE WHEN t.type = 'expense' AND ea.transaction_id IS NOT NULL THEN ea.status END AS status,
  ea.note AS note
`;

const ROW_FROM = `
  FROM transactions t
  LEFT JOIN accounts a ON a.id = t.account_id
  LEFT JOIN account_cards card ON card.id = t.card_id
  LEFT JOIN users card_user ON card_user.id = card.user_id
  LEFT JOIN users owner_user ON owner_user.id = a.owner_user_id
  LEFT JOIN categories c ON c.id = t.category_id
  LEFT JOIN companies comp ON comp.id = t.company_id
  LEFT JOIN trip_expense_allocations ea ON ea.transaction_id = t.id AND ea.trip_id = t.trip_id
`;

const RECEIPT_COLUMNS = `
  r.id, r.trip_id, r.amount, r.received_date, r.transaction_id, r.note, r.created_at,
  t.description AS transaction_description,
  t.date AS transaction_date,
  t.amount AS transaction_amount,
  t.account_id AS transaction_account_id,
  a.currency AS transaction_account_currency,
  t.type AS transaction_type
`;

const RECEIPT_FROM = `
  FROM trip_reimbursements r
  LEFT JOIN transactions t ON t.id = r.transaction_id
  LEFT JOIN accounts a ON a.id = t.account_id
`;

export const TRIP_EXPENSE_QUERIES = {
  /** Every row linked to one trip, with its spend and business share in the default currency. */
  ROWS_FOR_TRIP: `SELECT ${ROW_COLUMNS} ${ROW_FROM}
    WHERE t.trip_id = ?
    ORDER BY t.date DESC, t.id DESC`,

  /** Every trip-linked row, for the per-trip totals on the Trips list. */
  ROWS_ALL_TRIPS: `SELECT ${ROW_COLUMNS} ${ROW_FROM}
    WHERE t.trip_id IS NOT NULL`,

  /** The linked expense rows and their stored allocations, for validation. */
  EXPENSE_FOR_ALLOCATION: `
    SELECT t.id, t.trip_id, t.type, t.amount, ea.status, ea.note, ea.business_amount
      FROM transactions t
      LEFT JOIN trip_expense_allocations ea ON ea.transaction_id = t.id AND ea.trip_id = t.trip_id
     WHERE t.id = ?`,

  UPSERT_ALLOCATION: `
    INSERT INTO trip_expense_allocations (transaction_id, trip_id, business_amount, status, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    ON CONFLICT(transaction_id) DO UPDATE SET
      trip_id = excluded.trip_id,
      business_amount = excluded.business_amount,
      status = excluded.status,
      note = excluded.note,
      updated_at = datetime('now')`,

  /** Status applies to a business part only; an all-personal row has none to claim. */
  SET_STATUS: `
    UPDATE trip_expense_allocations
       SET status = ?, updated_at = datetime('now')
     WHERE transaction_id = ? AND business_amount > 0`,

  MARK_REIMBURSED: `
    UPDATE trip_expense_allocations
       SET status = 'reimbursed', updated_at = datetime('now')
     WHERE transaction_id = ? AND trip_id = ? AND business_amount > 0`,

  /**
   * A business trip's newly linked expense is fully business. INSERT OR
   * IGNORE keeps a choice the user already made for the row.
   */
  INSERT_DEFAULT_BUSINESS: `
    INSERT OR IGNORE INTO trip_expense_allocations (transaction_id, trip_id, business_amount, status, created_at, updated_at)
    SELECT t.id, t.trip_id, -t.amount, 'pending', datetime('now'), datetime('now')
      FROM transactions t
      JOIN trips tr ON tr.id = t.trip_id
     WHERE t.id = ? AND tr.expense_mode = 'business' AND t.type = 'expense' AND t.amount < 0`,

  /** Drops allocations whose transaction is gone, left the trip or is no longer an expense. */
  PRUNE: `
    DELETE FROM trip_expense_allocations
     WHERE NOT EXISTS (
       SELECT 1 FROM transactions t
        WHERE t.id = trip_expense_allocations.transaction_id
          AND t.trip_id = trip_expense_allocations.trip_id
          AND t.type = 'expense')`,

  /** Puts a row on a trip (clearing its project) or takes it off (keeping the project). */
  ASSIGN_TRIP: `
    UPDATE transactions
       SET trip_id = ?1,
           project_id = CASE WHEN ?1 IS NULL THEN project_id ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
     WHERE id = ?2`,

  GET_TRIP_ID: `SELECT trip_id FROM transactions WHERE id = ?`,

  /** Expenses and refunds in a date window that are not on this trip yet. */
  CANDIDATES: `
    SELECT t.id AS transaction_id, t.date, t.description, t.amount, t.account_id, t.project_id,
           a.currency AS account_currency,
           COALESCE(card_user.display_name, owner_user.display_name) AS user_name,
           c.name AS category_name,
           comp.name AS company_name
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id
      LEFT JOIN account_cards card ON card.id = t.card_id
      LEFT JOIN users card_user ON card_user.id = card.user_id
      LEFT JOIN users owner_user ON owner_user.id = a.owner_user_id
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN companies comp ON comp.id = t.company_id
     WHERE t.type IN ('expense', 'refund')
       AND t.trip_id IS NULL
       AND t.date >= ? AND t.date <= ?
     ORDER BY t.date ASC, t.id ASC
     LIMIT 500`,

  /** Money that came in during a date window: where a reimbursement may have landed. */
  DEPOSIT_CANDIDATES: `
    SELECT t.id AS transaction_id, t.date, t.description, t.amount, t.type, t.account_id,
           a.currency AS account_currency
      FROM transactions t
      LEFT JOIN accounts a ON a.id = t.account_id
     WHERE t.type IN ('income', 'refund') AND t.amount > 0
       AND t.date >= ? AND t.date <= ?
     ORDER BY t.date DESC, t.id DESC
     LIMIT 200`,

  RECEIPTS_FOR_TRIP: `SELECT ${RECEIPT_COLUMNS} ${RECEIPT_FROM}
    WHERE r.trip_id = ?
    ORDER BY COALESCE(r.received_date, r.created_at) DESC, r.id DESC`,

  RECEIPTS_ALL: `SELECT ${RECEIPT_COLUMNS} ${RECEIPT_FROM}`,

  GET_RECEIPT: `SELECT * FROM trip_reimbursements WHERE id = ?`,

  CREATE_RECEIPT: `
    INSERT INTO trip_reimbursements (trip_id, amount, received_date, transaction_id, note, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    RETURNING id`,

  UPDATE_RECEIPT: `
    UPDATE trip_reimbursements
       SET amount = ?, received_date = ?, transaction_id = ?, note = ?
     WHERE id = ?`,

  DELETE_RECEIPT: `DELETE FROM trip_reimbursements WHERE id = ?`,

  GET_DEPOSIT: `SELECT id, type, amount, transfer_group_id FROM transactions WHERE id = ?`,

  /**
   * The deposit is only the reimbursement: a manually typed refund off any
   * trip, so it nets spending app-wide without counting twice in the trip.
   */
  MARK_DEPOSIT_REFUND: `
    UPDATE transactions
       SET type = 'refund', type_locked = 1, type_source = 'manual', type_confidence = NULL,
           trip_id = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND amount > 0`,

  // Cleanup when the rows they point at go away (foreign keys are off on
  // reopened databases, so ON DELETE never runs there).
  DELETE_ALLOCATIONS_FOR_TRIP: `DELETE FROM trip_expense_allocations WHERE trip_id = ?`,
  DELETE_RECEIPTS_FOR_TRIP: `DELETE FROM trip_reimbursements WHERE trip_id = ?`,
  UNLINK_TRIP_TRANSACTIONS: `UPDATE transactions SET trip_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE trip_id = ?`,
  DELETE_ALLOCATION_FOR_TRANSACTION: `DELETE FROM trip_expense_allocations WHERE transaction_id = ?`,
  UNLINK_RECEIPTS_FOR_TRANSACTION: `UPDATE trip_reimbursements SET transaction_id = NULL WHERE transaction_id = ?`,
  DELETE_ALLOCATIONS_FOR_BATCH: `
    DELETE FROM trip_expense_allocations
     WHERE transaction_id IN (SELECT id FROM transactions WHERE import_batch_id = ?)`,
  UNLINK_RECEIPTS_FOR_BATCH: `
    UPDATE trip_reimbursements SET transaction_id = NULL
     WHERE transaction_id IN (SELECT id FROM transactions WHERE import_batch_id = ?)`,
} as const;
