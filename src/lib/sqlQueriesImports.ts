// Statement import (schema v7): saved file layouts, what files call each
// account, and the per-run details on import_batches. Owned by the imports
// domain; re-exported from the sqlQueries.ts hub. Staging and the bulk insert
// reuse TRANSACTION_QUERIES / IMPORT_BATCH_QUERIES from the hub.

// PRAGMA foreign_keys is on for a new database only, not for a reopened one,
// so ON DELETE CASCADE / SET NULL cannot be relied on: a deleted account can
// leave its cards, identifiers and a saved layout's account_id behind. Every
// read below therefore goes through `accounts`, so a row that points at an
// account that no longer exists is never offered (account ids are never
// reused: AUTOINCREMENT).
const PROFILE_SELECT = `
  SELECT p.id, p.name, p.format, p.fingerprint, p.institution, p.config_json,
         p.use_count, p.last_used_at, p.created_at, p.updated_at,
         a.id AS account_id, a.name AS account_name
    FROM import_profiles p
    LEFT JOIN accounts a ON a.id = p.account_id`;

const IDENTIFIER_SELECT = `
  SELECT i.*, a.name AS account_name
    FROM account_identifiers i
    JOIN accounts a ON a.id = i.account_id`;

export const IMPORT_QUERIES = {
  // --- saved layouts ---
  // Most recently used first: when several layouts share a fingerprint (two
  // accounts at one bank), the wizard offers the one used last.
  LIST_PROFILES: `${PROFILE_SELECT}
   ORDER BY COALESCE(p.last_used_at, p.created_at) DESC, p.id DESC`,
  FIND_PROFILES_BY_FINGERPRINT: `${PROFILE_SELECT}
   WHERE p.fingerprint = ?
   ORDER BY COALESCE(p.last_used_at, p.created_at) DESC, p.id DESC`,
  CREATE_PROFILE: `
    INSERT INTO import_profiles (name, format, fingerprint, institution, account_id, config_json)
    VALUES (?, ?, ?, ?, ?, ?)
    RETURNING id`,
  UPDATE_PROFILE: `
    UPDATE import_profiles
       SET name = ?, format = ?, fingerprint = ?, institution = ?, account_id = ?, config_json = ?,
           updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  // The account a layout was last imported into is what the next import of
  // the same file shape assumes.
  RECORD_PROFILE_USE: `
    UPDATE import_profiles
       SET use_count = use_count + 1, last_used_at = CURRENT_TIMESTAMP, account_id = ?
     WHERE id = ?`,
  // The import runs that used a layout outlive it; they just no longer name it.
  CLEAR_PROFILE_ON_BATCHES: `UPDATE import_batches SET profile_id = NULL WHERE profile_id = ?`,
  DELETE_PROFILE: `DELETE FROM import_profiles WHERE id = ?`,

  // --- account identifiers ---
  LIST_IDENTIFIERS: `${IDENTIFIER_SELECT}
   ORDER BY a.name COLLATE NOCASE, i.id`,
  LIST_IDENTIFIERS_FOR_ACCOUNT: `${IDENTIFIER_SELECT}
   WHERE i.account_id = ?
   ORDER BY i.id`,
  // Confirming the same account for the same file twice is not an error: the
  // existing row is returned (idx_account_identifiers_account_value).
  ADD_IDENTIFIER: `
    INSERT INTO account_identifiers (account_id, kind, value, last_four, source)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT (account_id, kind, value) DO UPDATE SET last_four = excluded.last_four
    RETURNING id`,
  DELETE_IDENTIFIER: `DELETE FROM account_identifiers WHERE id = ?`,

  // --- which account does a value in a file mean? ---
  // Cards are looked up first: they also say which card the rows attach to.
  // Joined to accounts: only an account that still exists can be matched.
  FIND_CARDS_BY_FULL_NUMBER: `
    SELECT c.id AS card_id, c.account_id
      FROM account_cards c
      JOIN accounts a ON a.id = c.account_id
     WHERE c.full_number = ?
     ORDER BY c.id`,
  FIND_CARDS_BY_LAST_FOUR: `
    SELECT c.id AS card_id, c.account_id
      FROM account_cards c
      JOIN accounts a ON a.id = c.account_id
     WHERE c.last_four = ?
     ORDER BY c.id`,
  FIND_IDENTIFIERS_BY_VALUE: `
    SELECT i.account_id
      FROM account_identifiers i
      JOIN accounts a ON a.id = i.account_id
     WHERE i.kind = ? AND i.value = ?
     ORDER BY i.id`,
  FIND_IDENTIFIERS_BY_LAST_FOUR: `
    SELECT i.account_id
      FROM account_identifiers i
      JOIN accounts a ON a.id = i.account_id
     WHERE i.kind = 'number' AND i.last_four = ?
     ORDER BY i.id`,

  // A value that matches nothing is compared with these by name, as a hint only.
  LIST_ACCOUNTS_FOR_HINTS: `SELECT id, name, institution FROM accounts ORDER BY id`,

  // --- what is already stored for an account ---
  // One row per account that has transactions. last_import_through is the
  // latest max_date among the import batches that wrote to the account.
  // __IDS__ is replaced with a list of integer ids by the service.
  ACCOUNT_COVERAGE: `
    SELECT t.account_id,
           MIN(t.date) AS first_date,
           MAX(t.date) AS last_date,
           COUNT(*) AS transaction_count,
           (SELECT MAX(b.max_date)
              FROM import_batches b
             WHERE b.id IN (SELECT bt.import_batch_id
                              FROM transactions bt
                             WHERE bt.account_id = t.account_id AND bt.import_batch_id IS NOT NULL)
           ) AS last_import_through
      FROM transactions t
     WHERE t.account_id IN (__IDS__)
     GROUP BY t.account_id`,

  // --- staging ---
  // In file order (ids ascend with the rows handed to staging).
  GET_STAGED_ROWS: `
    SELECT id, account_id, date, amount, description, transaction_hash, hash_variation_seed
      FROM temp_import_transactions
     ORDER BY id`,
  RESEED_STAGED_ROW: `UPDATE temp_import_transactions SET transaction_hash = ?, hash_variation_seed = ? WHERE id = ?`,

  // --- import runs ---
  SET_BATCH_DETAILS: `UPDATE import_batches SET profile_id = ?, file_format = ?, issues_json = ? WHERE id = ?`,
  COUNT_BATCH_TRANSACTIONS: `SELECT COUNT(*) AS count FROM transactions WHERE import_batch_id = ?`,
  GET_BATCH: `SELECT id FROM import_batches WHERE id = ?`,
  LIST_BATCHES: `
    SELECT b.*, p.name AS profile_name
      FROM import_batches b
      LEFT JOIN import_profiles p ON p.id = b.profile_id
     ORDER BY b.imported_at DESC, b.id DESC
     LIMIT ?`,

  // --- undo ---
  // What removing a batch takes with it. "Edited" means the row carries
  // something the user added after the import: a category, a project or trip,
  // a note, a flag, an exclusion, a type they chose or confirmed, or a series
  // they linked by hand. updated_at is no use here: the subscription scan and
  // later classification passes touch it too.
  BATCH_IMPACT: `
    WITH batch_rows AS (SELECT * FROM transactions WHERE import_batch_id = ?)
    SELECT
      (SELECT COUNT(*) FROM batch_rows) AS transactions,
      (SELECT COUNT(*) FROM batch_rows t
        WHERE t.type_locked = 1
           OR t.category_id IS NOT NULL
           OR t.project_id IS NOT NULL
           OR t.trip_id IS NOT NULL
           OR COALESCE(t.comment, '') != ''
           OR t.is_flagged = 1
           OR t.is_excluded = 1
           OR EXISTS (SELECT 1 FROM transaction_series_links l
                       WHERE l.transaction_id = t.id AND l.match_source = 'manual')
      ) AS edited_since_import,
      (SELECT COUNT(*) FROM loan_payments lp
        WHERE lp.transaction_id IN (SELECT id FROM batch_rows)) AS loan_payments,
      (SELECT COUNT(DISTINCT transfer_group_id) FROM batch_rows
        WHERE transfer_group_id IS NOT NULL) AS transfer_pairs`,
  // Loans that lose a payment when the batch goes: their linked account's
  // balance snapshot has to be recomputed afterwards.
  BATCH_LOAN_IDS: `
    SELECT DISTINCT lp.loan_id
      FROM loan_payments lp
      JOIN transactions t ON t.id = lp.transaction_id
     WHERE t.import_batch_id = ?
     ORDER BY lp.loan_id`,
  // Children are removed by hand: PRAGMA foreign_keys is off on reopened
  // databases, so ON DELETE CASCADE cannot be relied upon.
  DELETE_BATCH_SERIES_LINKS: `
    DELETE FROM transaction_series_links
     WHERE transaction_id IN (SELECT id FROM transactions WHERE import_batch_id = ?)`,
  DELETE_BATCH_LOAN_PAYMENTS: `
    DELETE FROM loan_payments
     WHERE transaction_id IN (SELECT id FROM transactions WHERE import_batch_id = ?)`,
  // The other leg of a transfer whose counterpart is being removed. A leg the
  // pairing typed goes back to what its sign says (what the classifier does
  // with an unpaired row); parameters: batch id, batch id.
  REVERT_SURVIVING_PAIRED_LEGS: `
    UPDATE transactions
       SET type = CASE WHEN amount > 0 THEN 'income' ELSE 'expense' END,
           type_source = 'sign', type_confidence = NULL, transfer_group_id = NULL,
           updated_at = CURRENT_TIMESTAMP
     WHERE (import_batch_id IS NULL OR import_batch_id != ?)
       AND type_locked = 0 AND type_source = 'pair'
       AND transfer_group_id IN (
         SELECT transfer_group_id FROM transactions
          WHERE import_batch_id = ? AND transfer_group_id IS NOT NULL)`,
  // A leg the user typed keeps its type and only loses the pairing;
  // parameters: batch id, batch id.
  CLEAR_SURVIVING_TRANSFER_GROUPS: `
    UPDATE transactions
       SET transfer_group_id = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE (import_batch_id IS NULL OR import_batch_id != ?)
       AND transfer_group_id IN (
         SELECT transfer_group_id FROM transactions
          WHERE import_batch_id = ? AND transfer_group_id IS NOT NULL)`,
  DELETE_BATCH_TRANSACTIONS: `DELETE FROM transactions WHERE import_batch_id = ?`,
} as const;
