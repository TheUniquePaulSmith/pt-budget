// Statement import (schema v7): saved file layouts, what files call each
// account, and the per-run details on import_batches. Owned by the imports
// domain; re-exported from the sqlQueries.ts hub. Staging and the bulk insert
// reuse TRANSACTION_QUERIES / IMPORT_BATCH_QUERIES from the hub.

const PROFILE_SELECT = `
  SELECT p.*, a.name AS account_name
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
  FIND_CARDS_BY_FULL_NUMBER: `SELECT id AS card_id, account_id FROM account_cards WHERE full_number = ? ORDER BY id`,
  FIND_CARDS_BY_LAST_FOUR: `SELECT id AS card_id, account_id FROM account_cards WHERE last_four = ? ORDER BY id`,
  FIND_IDENTIFIERS_BY_VALUE: `SELECT account_id FROM account_identifiers WHERE kind = ? AND value = ? ORDER BY id`,
  FIND_IDENTIFIERS_BY_LAST_FOUR: `
    SELECT account_id FROM account_identifiers WHERE kind = 'number' AND last_four = ? ORDER BY id`,

  // --- import runs ---
  SET_BATCH_DETAILS: `UPDATE import_batches SET profile_id = ?, file_format = ?, issues_json = ? WHERE id = ?`,
  LIST_BATCHES: `
    SELECT b.*, p.name AS profile_name
      FROM import_batches b
      LEFT JOIN import_profiles p ON p.id = b.profile_id
     ORDER BY b.imported_at DESC, b.id DESC
     LIMIT ?`,
} as const;
