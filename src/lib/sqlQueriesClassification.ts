// Transaction classification (schema v4): classification_rules CRUD, the row
// sets the classifier scans, and the writes that apply its decisions. Owned by
// the classification feature; re-exported from the sqlQueries.ts hub.

const CLASSIFIABLE_COLUMNS = `
  t.id, t.account_id, a.type AS account_type, t.date, t.amount, t.description,
  t.type, t.type_locked, t.type_source, t.transfer_group_id
`;

export const CLASSIFICATION_QUERIES = {
  // --- classification_rules ---
  GET_ALL_RULES: `
    SELECT r.*, a.name AS account_name, ca.name AS counterpart_account_name
    FROM classification_rules r
    LEFT JOIN accounts a ON a.id = r.account_id
    LEFT JOIN accounts ca ON ca.id = r.counterpart_account_id
    ORDER BY r.priority, LENGTH(r.pattern) DESC, r.rule_key
  `,
  GET_ENABLED_RULES: `
    SELECT * FROM classification_rules
    WHERE enabled = 1
    ORDER BY priority, LENGTH(pattern) DESC, rule_key
  `,
  GET_RULE_BY_ID: `SELECT * FROM classification_rules WHERE id = ?`,
  CREATE_RULE: `
    INSERT INTO classification_rules (rule_key, source, pattern, match_type, priority, type, account_id, counterpart_account_id, enabled, notes)
    VALUES (?, 'user', ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `,
  UPDATE_RULE: `
    UPDATE classification_rules
    SET pattern = ?, match_type = ?, priority = ?, type = ?, account_id = ?, counterpart_account_id = ?,
        enabled = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  DELETE_RULE: `DELETE FROM classification_rules WHERE id = ?`,

  // --- classifier inputs ---
  /** Every stored row, for a full scan. */
  GET_ALL_CLASSIFIABLE: `
    SELECT ${CLASSIFIABLE_COLUMNS}
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    ORDER BY t.date, t.id
  `,
  /** Stored rows in a date range: the import's pairing and refund context. */
  GET_CLASSIFIABLE_IN_RANGE: `
    SELECT ${CLASSIFIABLE_COLUMNS}
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.date BETWEEN ? AND ?
    ORDER BY t.date, t.id
  `,
  /**
   * The staged import rows, in the shape the classifier reads. Rows the bulk
   * insert will skip as duplicates (same predicate as BULK_INSERT_FROM_TEMP)
   * are left out so they cannot claim a counterpart they will never land next to.
   */
  GET_STAGED_CLASSIFIABLE: `
    SELECT
      tmp.id, tmp.account_id, a.type AS account_type, tmp.date, tmp.amount, tmp.description,
      tmp.type, 0 AS type_locked, tmp.type_source, tmp.transfer_group_id
    FROM temp_import_transactions tmp
    JOIN accounts a ON a.id = tmp.account_id
    WHERE NOT EXISTS (
      SELECT 1 FROM transactions t WHERE t.transaction_hash = tmp.transaction_hash
    )
    AND NOT EXISTS (
      SELECT 1 FROM transactions t
      WHERE tmp.external_id IS NOT NULL
        AND t.external_id = tmp.external_id
        AND t.account_id = tmp.account_id
        AND t.amount = tmp.amount
    )
    ORDER BY tmp.date, tmp.id
  `,
  STAGED_DATE_RANGE: `SELECT MIN(date) AS min_date, MAX(date) AS max_date FROM temp_import_transactions`,
  /** Rows the rule editor previews against (account scope + sign are checked in code). */
  GET_RULE_PREVIEW_ROWS: `SELECT account_id, amount, description FROM transactions`,

  // --- applying decisions ---
  UPDATE_STAGED_CLASSIFICATION: `
    UPDATE temp_import_transactions
    SET type = ?, transfer_group_id = ?, type_source = ?, type_confidence = ?
    WHERE id = ?
  `,
  /** Automatic sources never override a type the user chose. */
  APPLY_CLASSIFICATION: `
    UPDATE transactions
    SET type = ?, transfer_group_id = ?, type_source = ?, type_confidence = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND type_locked = 0
  `,
  /** A locked transfer may still gain its counterpart. */
  SET_TRANSFER_GROUP_ON_LOCKED_TRANSFER: `
    UPDATE transactions
    SET transfer_group_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND type_locked = 1 AND type = 'transfer'
  `,

  // --- manual decisions ---
  /** Keeps the automatic type but makes it the user's decision. */
  CONFIRM_TYPE: `
    UPDATE transactions
    SET type_locked = 1, type_source = 'manual', type_confidence = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  /** Links a leg by hand: transfer, locked, in the given group. */
  LINK_TRANSFER_LEG: `
    UPDATE transactions
    SET type = 'transfer', type_locked = 1, type_source = 'manual', type_confidence = NULL,
        transfer_group_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  CLEAR_TRANSFER_GROUP: `
    UPDATE transactions
    SET transfer_group_id = NULL, updated_at = CURRENT_TIMESTAMP
    WHERE transfer_group_id = ?
  `,
  GET_LINK_ROW: `SELECT id, account_id, amount, type, type_locked, transfer_group_id FROM transactions WHERE id = ?`,
  GET_ACCOUNT_NAMES: `SELECT id, name FROM accounts`,
  /**
   * Candidate counterparts for linking by hand: the opposite direction in
   * another account within the date window, exact amount matches first.
   * Parameters: account_id, amount (signed, of the row being linked),
   * date, date, abs(amount), date.
   */
  GET_TRANSFER_CANDIDATES: `
    SELECT
      t.id, t.account_id, a.name AS account_name, t.date, t.amount, t.description,
      t.type, t.type_locked, t.transfer_group_id
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    WHERE t.account_id != ?
      AND ((? < 0 AND t.amount > 0) OR (? > 0 AND t.amount < 0))
      AND t.date BETWEEN date(?, '-14 days') AND date(?, '+14 days')
      AND NOT (t.type_locked = 1 AND t.type != 'transfer')
    ORDER BY (ABS(t.amount) = ?) DESC, ABS(julianday(t.date) - julianday(?)) ASC, t.id DESC
    LIMIT 50
  `,

  // --- review ---
  COUNT_NEEDS_REVIEW: `
    SELECT COUNT(*) AS count FROM transactions
    WHERE type_locked = 0 AND type_source != 'sign'
  `,
};
