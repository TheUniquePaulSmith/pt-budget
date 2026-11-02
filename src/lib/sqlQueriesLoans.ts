// Loans (schema v5): loans, loan-owned payment rules and the payment ledger.
// Owned by the loans feature; re-exported from the sqlQueries.ts hub.

const LOAN_LIST_COLUMNS = `
  l.*,
  u.display_name AS owner_display_name,
  p.name AS project_name,
  p.company_name AS project_company_name,
  a.name AS account_name,
  a.currency AS account_currency,
  (SELECT COUNT(*) FROM loan_payments lp WHERE lp.loan_id = l.id) AS payment_count,
  (SELECT COALESCE(SUM(COALESCE(ABS(t.amount), lp.amount)), 0)
     FROM loan_payments lp LEFT JOIN transactions t ON t.id = lp.transaction_id
     WHERE lp.loan_id = l.id) AS total_paid,
  (SELECT MAX(COALESCE(t.date, lp.payment_date))
     FROM loan_payments lp LEFT JOIN transactions t ON t.id = lp.transaction_id
     WHERE lp.loan_id = l.id) AS last_payment_date,
  (SELECT COUNT(*) FROM loan_match_rules r WHERE r.loan_id = l.id AND r.enabled = 1) AS rule_count
`;

const LOAN_LIST_FROM = `
  FROM loans l
  JOIN users u ON u.id = l.owner_user_id
  LEFT JOIN projects p ON p.id = l.project_id
  LEFT JOIN accounts a ON a.id = l.account_id
`;

// A linked payment mirrors its transaction's date and amount (so editing the
// transaction moves the payment); a manual payment carries its own.
const PAYMENT_COLUMNS = `
  lp.id, lp.loan_id, lp.transaction_id,
  COALESCE(t.date, lp.payment_date) AS payment_date,
  COALESCE(ABS(t.amount), lp.amount) AS amount,
  lp.principal_amount, lp.interest_amount, lp.split_source, lp.match_source, lp.notes,
  lp.created_at, lp.updated_at,
  t.description, t.account_id, a.name AS account_name
`;

const PAYMENT_FROM = `
  FROM loan_payments lp
  LEFT JOIN transactions t ON t.id = lp.transaction_id
  LEFT JOIN accounts a ON a.id = t.account_id
`;

/** Outgoing transactions that are not yet a payment on any loan. */
const UNLINKED_OUTFLOW = `
  t.amount < 0
  AND NOT EXISTS (SELECT 1 FROM loan_payments lp WHERE lp.transaction_id = t.id)
`;

export const LOAN_QUERIES = {
  // --- loans ---
  GET_ALL: `
    SELECT ${LOAN_LIST_COLUMNS}
    ${LOAN_LIST_FROM}
    ORDER BY (l.status = 'active') DESC, l.name COLLATE NOCASE
  `,
  GET_BY_ID: `
    SELECT ${LOAN_LIST_COLUMNS}
    ${LOAN_LIST_FROM}
    WHERE l.id = ?
  `,
  CREATE: `
    INSERT INTO loans (
      name, loan_type, status, owner_user_id, project_id, account_id, lender, opened_date,
      original_principal, interest_rate, term_months, expected_payment, payment_due_day,
      first_payment_date, allows_full_payoff, prepayment_terms, promo_end_date,
      deferred_interest_rate, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `,
  UPDATE: `
    UPDATE loans
    SET name = ?, loan_type = ?, status = ?, owner_user_id = ?, project_id = ?, account_id = ?,
        lender = ?, opened_date = ?, original_principal = ?, interest_rate = ?, term_months = ?,
        expected_payment = ?, payment_due_day = ?, first_payment_date = ?, allows_full_payoff = ?,
        prepayment_terms = ?, promo_end_date = ?, deferred_interest_rate = ?, notes = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  DELETE: `DELETE FROM loans WHERE id = ?`,
  SET_STATUS: `UPDATE loans SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,

  // --- loan_match_rules ---
  GET_ALL_RULES: `
    SELECT r.*, a.name AS account_name, l.name AS loan_name
    FROM loan_match_rules r
    JOIN loans l ON l.id = r.loan_id
    LEFT JOIN accounts a ON a.id = r.account_id
    ORDER BY r.loan_id, LENGTH(r.pattern) DESC, r.id
  `,
  GET_RULES_FOR_LOAN: `
    SELECT r.*, a.name AS account_name, l.name AS loan_name
    FROM loan_match_rules r
    JOIN loans l ON l.id = r.loan_id
    LEFT JOIN accounts a ON a.id = r.account_id
    WHERE r.loan_id = ?
    ORDER BY LENGTH(r.pattern) DESC, r.id
  `,
  /** Longest pattern first so the most specific rule wins across loans. */
  GET_ENABLED_RULES: `
    SELECT r.*, a.name AS account_name, l.name AS loan_name
    FROM loan_match_rules r
    JOIN loans l ON l.id = r.loan_id
    LEFT JOIN accounts a ON a.id = r.account_id
    WHERE r.enabled = 1 AND l.status != 'closed'
    ORDER BY LENGTH(r.pattern) DESC, r.id
  `,
  CREATE_RULE: `
    INSERT INTO loan_match_rules (loan_id, pattern, match_type, account_id, enabled, notes)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING id
  `,
  UPDATE_RULE: `
    UPDATE loan_match_rules
    SET pattern = ?, match_type = ?, account_id = ?, enabled = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  DELETE_RULE: `DELETE FROM loan_match_rules WHERE id = ?`,

  // --- loan_payments ---
  GET_PAYMENTS_FOR_LOAN: `
    SELECT ${PAYMENT_COLUMNS}
    ${PAYMENT_FROM}
    WHERE lp.loan_id = ?
    ORDER BY payment_date, lp.id
  `,
  GET_PAYMENT_BY_ID: `
    SELECT ${PAYMENT_COLUMNS}
    ${PAYMENT_FROM}
    WHERE lp.id = ?
  `,
  /** Every transaction that is a loan payment: the subscription scan skips these. */
  GET_LINKED_TRANSACTION_IDS: `SELECT transaction_id FROM loan_payments WHERE transaction_id IS NOT NULL`,
  CREATE_PAYMENT: `
    INSERT INTO loan_payments (
      loan_id, transaction_id, payment_date, amount, principal_amount, interest_amount,
      split_source, match_source, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `,
  UPDATE_PAYMENT: `
    UPDATE loan_payments
    SET payment_date = ?, amount = ?, principal_amount = ?, interest_amount = ?, split_source = ?,
        notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  DELETE_PAYMENT: `DELETE FROM loan_payments WHERE id = ?`,
  DELETE_PAYMENTS_BY_RULE_FOR_LOAN: `DELETE FROM loan_payments WHERE loan_id = ? AND match_source = 'rule'`,

  // --- matching ---
  /** Rule-scan input: outgoing transactions that are not yet loan payments. */
  GET_RULE_CANDIDATES: `
    SELECT t.id, t.date, t.amount, t.description, t.account_id, a.name AS account_name
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE ${UNLINKED_OUTFLOW}
    ORDER BY t.date, t.id
  `,
  GET_TRANSACTION_FOR_LINK: `
    SELECT t.id, t.date, t.amount, t.description, t.account_id, a.name AS account_name
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE t.id = ?
  `,
  /** Link dialog: newest unlinked outflows whose description contains the search text. Parameters: search, search. */
  SEARCH_LINK_CANDIDATES: `
    SELECT t.id, t.date, t.amount, t.description, t.account_id, a.name AS account_name
    FROM transactions t
    LEFT JOIN accounts a ON a.id = t.account_id
    WHERE ${UNLINKED_OUTFLOW}
      AND (? = '' OR t.description LIKE '%' || ? || '%')
    ORDER BY t.date DESC, t.id DESC
    LIMIT 50
  `,

  // --- linked account balance ---
  /** Keeps a tracked loan/credit account's statement balance in step with the computed balance. */
  UPSERT_ACCOUNT_SNAPSHOT: `
    INSERT INTO account_balance_snapshots (account_id, as_of_date, balance, note)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(account_id, as_of_date) DO UPDATE SET balance = excluded.balance, note = excluded.note
  `,
};
