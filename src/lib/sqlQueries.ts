/**
 * SQL Query Definitions
 *
 * This file contains all raw SQL strings used throughout the application.
 * Keeping them centralized helps with debugging and maintenance.
 */

// Transaction Queries
export const TRANSACTION_QUERIES = {
  GET_ALL: `
    SELECT 
      t.*,
      c.name as category_name,
      c.color as category_color,
      c.type as category_type,
      comp.name as company_name,
      a.name as account_name,
      a.type as account_type,
      p.name as project_name,
      tr.name as trip_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN companies comp ON t.company_id = comp.id
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN trips tr ON t.trip_id = tr.id
    ORDER BY t.date DESC, t.id DESC
  `,

  CREATE: `
    INSERT INTO transactions (date, amount, description, comment, account_id, card_id, category_id, company_id, project_id, trip_id, type, transaction_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `,

  SET_CATEGORY: `
    UPDATE transactions
    SET category_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,

  SET_COMPANY: `
    UPDATE transactions
    SET company_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,

  SET_COMMENT: `
    UPDATE transactions
    SET comment = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,

  UPDATE_PROJECT_TRIP: `
    UPDATE transactions 
    SET project_id = ?, trip_id = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `,

  UPDATE_CLASSIFICATION: `
    UPDATE transactions
    SET category_id = ?, company_id = ?, project_id = ?, trip_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,

  GET_BY_PROJECT: `
    SELECT 
      t.*,
      c.name as category_name,
      c.color as category_color,
      c.type as category_type,
      comp.name as company_name,
      a.name as account_name,
      a.type as account_type
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN companies comp ON t.company_id = comp.id
    LEFT JOIN accounts a ON t.account_id = a.id
    WHERE t.project_id = ?
    ORDER BY t.date DESC, t.id DESC
  `,

  GET_BY_TRIP: `
    SELECT 
      t.*,
      c.name as category_name,
      c.color as category_color,
      c.type as category_type,
      comp.name as company_name,
      a.name as account_name,
      a.type as account_type
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN companies comp ON t.company_id = comp.id
    LEFT JOIN accounts a ON t.account_id = a.id
    WHERE t.trip_id = ?
    ORDER BY t.date DESC, t.id DESC
  `,

  GET_BY_DATE_RANGE: `
    SELECT 
      t.*,
      c.name as category_name,
      c.color as category_color,
      c.type as category_type,
      comp.name as company_name,
      a.name as account_name,
      a.type as account_type,
      p.name as project_name,
      tr.name as trip_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN companies comp ON t.company_id = comp.id
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN trips tr ON t.trip_id = tr.id
    WHERE t.date BETWEEN ? AND ?
    ORDER BY t.date DESC, t.id DESC
  `,

  GET_BY_DATE_RANGE_AND_TYPE: `
    SELECT 
      t.*,
      c.name as category_name,
      c.color as category_color,
      c.type as category_type,
      comp.name as company_name,
      a.name as account_name,
      a.type as account_type,
      p.name as project_name,
      tr.name as trip_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN companies comp ON t.company_id = comp.id
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN trips tr ON t.trip_id = tr.id
    WHERE t.date BETWEEN ? AND ? AND c.type = ?
    ORDER BY t.date DESC, t.id DESC
  `,

  CHECK_HASH_EXISTS: `
    SELECT COUNT(*) as count FROM transactions WHERE transaction_hash = ?
    `,
  
  GET_RECENT: `
    SELECT
      t.*,
      c.name as category_name,
      c.color as category_color,
      c.type as category_type,
      comp.name as company_name,
      a.name as account_name,
      a.type as account_type,
      p.name as project_name,
      tr.name as trip_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN companies comp ON t.company_id = comp.id
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN projects p ON t.project_id = p.id
    LEFT JOIN trips tr ON t.trip_id = tr.id
    ORDER BY t.date DESC, t.id DESC
    LIMIT ?
  `,

  GET_COUNT_BY_PROJECT: `
    SELECT COUNT(*) as total FROM transactions WHERE project_id = ?
  `,

  GET_COUNT_BY_TRIP: `
    SELECT COUNT(*) as total FROM transactions WHERE trip_id = ?
  `,

  GET_ALL_HASHES: `
    SELECT transaction_hash FROM transactions
  `,

  TRUNCATE_IMPORT_TABLE: `
    DELETE FROM temp_import_transactions
  `,

  INSERT_TEMP_TRANSACTION: `
    INSERT INTO temp_import_transactions (date, amount, description, comment, account_id, card_id, category_id, company_id, project_id, trip_id, type, transaction_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  CHECK_DUPLICATES_IN_TEMP: `
    SELECT t.transaction_hash 
    FROM transactions t
    WHERE EXISTS (
      SELECT 1 FROM temp_import_transactions tmp WHERE tmp.transaction_hash = t.transaction_hash
    )
  `,

  BULK_INSERT_FROM_TEMP: `
    INSERT INTO transactions (date, amount, description, comment, account_id, card_id, category_id, company_id, project_id, trip_id, type, transaction_hash, hash_variation_seed)
    SELECT date, amount, description, comment, account_id, card_id, category_id, company_id, project_id, trip_id, type, transaction_hash, hash_variation_seed
    FROM temp_import_transactions
    WHERE NOT EXISTS (
      SELECT 1 FROM transactions t WHERE t.transaction_hash = temp_import_transactions.transaction_hash
    )
  `,

  COUNT_TEMP_TRANSACTIONS: `
    SELECT COUNT(*) as count FROM temp_import_transactions
  `,

  DELETE_TEMP_TRANSACTIONS_BY_IDS: `
    DELETE FROM temp_import_transactions WHERE id IN (__IDS__)
  `,
};

// Category Queries
export const CATEGORY_QUERIES = {
  GET_ALL: `SELECT * FROM categories ORDER BY type, name`,
  CREATE: `INSERT INTO categories (name, color, type) VALUES (?, ?, ?) RETURNING id`,
  FIND_BY_NAME: `SELECT * FROM categories WHERE LOWER(name) = LOWER(?) LIMIT 1`,
  GET_BY_ID: `SELECT * FROM categories WHERE id = ?`,
  UPDATE: `UPDATE categories SET name = ?, color = ?, type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  DELETE: `DELETE FROM categories WHERE id = ?`,
};

// Company Queries
export const COMPANY_QUERIES = {
  GET_ALL: `SELECT * FROM companies ORDER BY name`,
  CREATE: `INSERT INTO companies (name) VALUES (?) RETURNING id`,
  FIND_BY_NAME: `SELECT * FROM companies WHERE LOWER(name) = LOWER(?) LIMIT 1`,
  GET_BY_ID: `SELECT * FROM companies WHERE id = ?`,
  UPDATE: `UPDATE companies SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  DELETE: `DELETE FROM companies WHERE id = ?`,
};

// User Queries
export const USER_QUERIES = {
  GET_ALL: `SELECT * FROM users ORDER BY is_primary DESC, display_name`,
  CREATE: `INSERT INTO users (display_name, is_primary) VALUES (?, ?) RETURNING id`,
  GET_PRIMARY: `SELECT * FROM users WHERE is_primary = 1 ORDER BY id LIMIT 1`,
  RENAME_PRIMARY: `UPDATE users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE is_primary = 1`,
  GET_BY_ID: `SELECT * FROM users WHERE id = ?`,
  UPDATE: `UPDATE users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  DELETE: `DELETE FROM users WHERE id = ?`,
};

// Account Queries
export const ACCOUNT_QUERIES = {
  GET_ALL: `
    SELECT 
      a.*, 
      u.display_name as owner_display_name
    FROM accounts a
    LEFT JOIN users u ON a.owner_user_id = u.id
    ORDER BY a.name
  `,
  CREATE: `INSERT INTO accounts (name, type, owner_user_id) VALUES (?, ?, ?) RETURNING id`,
  GET_BY_ID: `
    SELECT 
      a.*, 
      u.display_name as owner_display_name
    FROM accounts a
    LEFT JOIN users u ON a.owner_user_id = u.id
    WHERE a.id = ?
  `,
  GET_BY_USER_ID: `
    SELECT a.*, u.display_name as owner_display_name
    FROM accounts a
    LEFT JOIN users u ON a.owner_user_id = u.id
    WHERE a.owner_user_id = ?
    ORDER BY a.name
  `,
  UPDATE: `UPDATE accounts SET name = ?, type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  DELETE: `DELETE FROM accounts WHERE id = ?`,
};

// Account Card Queries
export const ACCOUNT_CARD_QUERIES = {
  GET_ALL: `SELECT * FROM account_cards ORDER BY account_id, created_at`,
  GET_BY_ACCOUNT_ID: `
    SELECT 
      ac.*,
      u.display_name as user_display_name
    FROM account_cards ac
    LEFT JOIN users u ON ac.user_id = u.id
    WHERE ac.account_id = ?
    ORDER BY ac.created_at
  `,
  GET_BY_LAST_FOUR: `
    SELECT 
      ac.*,
      a.name as account_name,
      a.type as account_type
    FROM account_cards ac
    JOIN accounts a ON ac.account_id = a.id
    WHERE ac.last_four = ?
  `,
  CREATE: `INSERT INTO account_cards (account_id, last_four, nickname, user_id) VALUES (?, ?, ?, ?) RETURNING id`,
  UPDATE: `UPDATE account_cards SET last_four = ?, nickname = ?, user_id = ? WHERE id = ?`,
  DELETE: `DELETE FROM account_cards WHERE id = ?`,
  FIND_ACCOUNT_BY_LAST_FOUR: `
    SELECT DISTINCT
      a.*, u.display_name as owner_display_name
    FROM account_cards ac
    JOIN accounts a ON ac.account_id = a.id
    LEFT JOIN users u ON a.owner_user_id = u.id
    WHERE ac.last_four = ?
  `,
};

// Account-User junction removed; ownership is via accounts.owner_user_id

// Budget Plan Queries
export const BUDGET_PLAN_QUERIES = {
  GET_ALL_PLANS: `SELECT * FROM budget_plans ORDER BY effective_month DESC`,
  GET_PLAN_BY_MONTH: `SELECT * FROM budget_plans WHERE effective_month = ?`,
  GET_EFFECTIVE_PLAN_FOR_MONTH: `
    SELECT * FROM budget_plans
    WHERE effective_month <= ?
    ORDER BY effective_month DESC
    LIMIT 1
  `,
  UPSERT_PLAN: `
    INSERT INTO budget_plans (effective_month, total_amount, notes)
    VALUES (?, ?, ?)
    ON CONFLICT(effective_month) DO UPDATE SET
      total_amount = excluded.total_amount,
      notes = excluded.notes,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id
  `,
  DELETE_PLAN: `DELETE FROM budget_plans WHERE id = ?`,
  GET_ALL_PLAN_CATEGORIES: `
    SELECT
      bpc.*,
      c.name as category_name,
      c.color as category_color
    FROM budget_plan_categories bpc
    LEFT JOIN categories c ON bpc.category_id = c.id
    ORDER BY bpc.plan_id, c.name
  `,
  DELETE_PLAN_CATEGORIES: `DELETE FROM budget_plan_categories WHERE plan_id = ?`,
  INSERT_PLAN_CATEGORY: `
    INSERT INTO budget_plan_categories (plan_id, category_id, amount)
    VALUES (?, ?, ?)
  `,
  ACTUAL_EXPENSES_BY_MONTH_CATEGORY: `
    SELECT
      strftime('%Y-%m', date) as month,
      category_id,
      SUM(ABS(amount)) as total
    FROM transactions
    WHERE type = 'expense' AND date BETWEEN ? AND ?
    GROUP BY strftime('%Y-%m', date), category_id
  `,
  ACTUAL_INCOME_LINKED_BY_MONTH: `
    SELECT
      strftime('%Y-%m', t.date) as month,
      SUM(t.amount) as total
    FROM transactions t
    JOIN accounts a ON a.id = t.account_id
    JOIN income_sources src ON src.kind = 'linked_account' AND src.account_id = t.account_id AND src.is_active = 1
    WHERE t.type = 'income' AND a.type != 'credit' AND t.date BETWEEN ? AND ?
    GROUP BY strftime('%Y-%m', t.date)
  `,
};

export const INCOME_SOURCE_QUERIES = {
  GET_ALL: `
    SELECT src.*, a.name as account_name, source_user.display_name as user_display_name, owner_user.display_name as owner_display_name
    FROM income_sources src
    LEFT JOIN accounts a ON src.account_id = a.id
    LEFT JOIN users source_user ON src.user_id = source_user.id
    LEFT JOIN users owner_user ON a.owner_user_id = owner_user.id
    ORDER BY src.is_active DESC, src.name
  `,
  CREATE: `
    INSERT INTO income_sources (name, kind, user_id, account_id, amount, frequency, start_date, end_date, is_active, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `,
  UPDATE: `
    UPDATE income_sources
    SET name = ?, kind = ?, user_id = ?, account_id = ?, amount = ?, frequency = ?, start_date = ?, end_date = ?, is_active = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  DELETE: `DELETE FROM income_sources WHERE id = ?`,
  SET_ACTIVE: `UPDATE income_sources SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
};

// Project Queries
export const PROJECT_QUERIES = {
  GET_ALL: `SELECT * FROM projects ORDER BY created_at DESC`,
  CREATE: `INSERT INTO projects (name, company_name, contact_details, project_category, status, start_date, end_date, estimated_cost, actual_cost, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  GET_BY_ID: `SELECT * FROM projects WHERE id = ?`,
  UPDATE: `UPDATE projects SET name = ?, company_name = ?, contact_details = ?, project_category = ?, status = ?, start_date = ?, end_date = ?, estimated_cost = ?, actual_cost = ?, notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  DELETE: `DELETE FROM projects WHERE id = ?`,
  GET_COSTS: `
    SELECT
      p.estimated_cost,
      p.actual_cost,
      COALESCE(SUM(CASE WHEN t.type = 'expense' THEN ABS(t.amount) ELSE 0 END), 0) as transactions_total
    FROM projects p
    LEFT JOIN transactions t ON p.id = t.project_id
    WHERE p.id = ?
    GROUP BY p.id, p.estimated_cost, p.actual_cost
  `,

  GET_ALL_COSTS: `
    SELECT
      p.id as project_id,
      COALESCE(p.estimated_cost, 0) as estimated,
      COALESCE(p.actual_cost, 0) as actual,
      COALESCE(SUM(CASE WHEN t.type = 'expense' THEN ABS(t.amount) ELSE 0 END), 0) as transactions_total
    FROM projects p
    LEFT JOIN transactions t ON p.id = t.project_id
    GROUP BY p.id, p.estimated_cost, p.actual_cost
  `,
};

// Trip Queries
export const TRIP_QUERIES = {
  GET_ALL: `
    SELECT * FROM trips 
    ORDER BY name ASC
  `,

  CREATE: `
    INSERT INTO trips (name, destination, purpose, trip_category, status, start_date, end_date, estimated_cost, actual_cost, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `,

  GET_BY_ID: `
    SELECT * FROM trips WHERE id = ?
  `,

  UPDATE: `
    UPDATE trips 
    SET name = ?, destination = ?, purpose = ?, trip_category = ?, status = ?, start_date = ?, end_date = ?, estimated_cost = ?, actual_cost = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,

  DELETE: `
    DELETE FROM trips WHERE id = ?
  `,

  GET_COSTS: `
    SELECT 
      COALESCE(t.estimated_cost, 0) as estimated,
      COALESCE(t.actual_cost, 0) as actual,
      COALESCE(SUM(ABS(tr.amount)), 0) as transactions_total
    FROM trips t
    LEFT JOIN transactions tr ON tr.trip_id = t.id
    WHERE t.id = ?
    GROUP BY t.id
  `
};

// Analytics Queries
export const ANALYTICS_QUERIES = {
  SPENDING_BY_CATEGORY: `
    SELECT 
      c.id as category_id,
      c.name as category_name,
      c.color,
      SUM(ABS(t.amount)) as total
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    /*__FILTER_JOINS__*/
    WHERE t.date BETWEEN ? AND ? AND c.type = 'expense'
    /*__FILTERS__*/
    GROUP BY c.id, c.name, c.color
    HAVING total > 0
    ORDER BY total DESC
  `,

  SPENDING_BY_COMPANY_SERVICE: `
    SELECT
      COALESCE(comp.id, 'unassigned') as company_id,
      COALESCE(comp.name, 'No Company') as company_name,
      mr.service_name as service_name,
      SUM(ABS(t.amount)) as total
    FROM transactions t
    LEFT JOIN companies comp ON t.company_id = comp.id
    LEFT JOIN transaction_series_links tsl ON tsl.transaction_id = t.id
    LEFT JOIN recurring_series rs ON rs.id = tsl.series_id
    LEFT JOIN merchant_rules mr ON mr.id = rs.rule_id
    LEFT JOIN accounts a ON t.account_id = a.id
    /*__FILTER_JOINS__*/
    WHERE t.type = 'expense' AND t.date BETWEEN ? AND ?
    /*__FILTERS__*/
    GROUP BY comp.id, comp.name, mr.service_name
    HAVING total > 0
    ORDER BY total DESC
  `,

  SPENDING_BY_RECURRING_SERIES: `
    SELECT
      rs.id as series_id,
      rs.name as series_name,
      rs.kind,
      SUM(ABS(t.amount)) as total
    FROM transaction_series_links tsl
    JOIN recurring_series rs ON rs.id = tsl.series_id
    JOIN transactions t ON t.id = tsl.transaction_id
    LEFT JOIN accounts a ON t.account_id = a.id
    /*__FILTER_JOINS__*/
    WHERE t.type = 'expense' AND t.date BETWEEN ? AND ?
    /*__FILTERS__*/
    GROUP BY rs.id, rs.name, rs.kind
    HAVING total > 0
    ORDER BY total DESC
  `,

  INCOME_BY_CATEGORY: `
    SELECT 
      c.id as category_id,
      c.name as category_name,
      c.color,
      SUM(t.amount) as total
    FROM transactions t
    JOIN categories c ON t.category_id = c.id
    /*__FILTER_JOINS__*/
    WHERE t.date BETWEEN ? AND ? AND c.type = 'income'
    /*__FILTERS__*/
    GROUP BY c.id, c.name, c.color
    HAVING total > 0
    ORDER BY total DESC
  `,

  MONTHLY_TRENDS: `
    SELECT
      strftime('%Y-%m', t.date) as month,
      SUM(CASE WHEN c.type = 'income' THEN t.amount ELSE 0 END) as income,
      SUM(CASE WHEN c.type = 'expense' THEN ABS(t.amount) ELSE 0 END) as expense
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    /*__FILTER_JOINS__*/
    WHERE t.date >= date('now', ? || ' months')
    /*__FILTERS__*/
    GROUP BY strftime('%Y-%m', t.date)
    ORDER BY month DESC
  `,

  DASHBOARD_SUMMARY: `
    SELECT
      COUNT(*) as transaction_count,
      SUM(CASE WHEN t.type = 'income' AND a.type != 'credit' THEN t.amount ELSE 0 END) as total_income,
      SUM(CASE WHEN t.type = 'expense' THEN ABS(t.amount) ELSE 0 END) as total_expenses
    FROM transactions t
    LEFT JOIN accounts a ON t.account_id = a.id
    /*__FILTER_JOINS__*/
    WHERE t.date BETWEEN ? AND ?
    /*__FILTERS__*/
  `,

  INCOME_BY_SOURCE: `
    SELECT
      a.id as account_id,
      a.name as account_name,
      u.display_name as user_display_name,
      c.id as category_id,
      c.name as category_name,
      c.color as category_color,
      SUM(t.amount) as total
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id
    LEFT JOIN users u ON a.owner_user_id = u.id
    LEFT JOIN categories c ON t.category_id = c.id
    /*__FILTER_JOINS__*/
    WHERE t.type = 'income' AND a.type != 'credit' AND t.date BETWEEN ? AND ?
    /*__FILTERS__*/
    GROUP BY a.id, c.id
    HAVING total > 0
    ORDER BY total DESC
  `,

  TRENDS_BY_DATE_RANGE: `
    SELECT
      strftime('%Y-%m', t.date) as month,
      SUM(CASE WHEN t.type = 'income' AND a.type != 'credit' THEN t.amount ELSE 0 END) as income,
      SUM(CASE WHEN t.type = 'expense' THEN ABS(t.amount) ELSE 0 END) as expense
    FROM transactions t
    LEFT JOIN accounts a ON t.account_id = a.id
    /*__FILTER_JOINS__*/
    WHERE t.date BETWEEN ? AND ?
    /*__FILTERS__*/
    GROUP BY strftime('%Y-%m', t.date)
    ORDER BY month ASC
  `,

  ACCOUNT_ANALYSIS: `
    SELECT
      a.id as account_id,
      a.name as account_name,
      u.display_name as user_display_name,
      SUM(CASE WHEN t.type = 'income' AND a.type != 'credit' THEN t.amount ELSE 0 END) as income,
      SUM(CASE WHEN t.type = 'expense' THEN ABS(t.amount) ELSE 0 END) as expenses
    FROM transactions t
    JOIN accounts a ON t.account_id = a.id
    LEFT JOIN users u ON a.owner_user_id = u.id
    /*__FILTER_JOINS__*/
    WHERE t.date BETWEEN ? AND ?
    /*__FILTERS__*/
    GROUP BY a.id
    ORDER BY (income + expenses) DESC
  `,
};

// Subscription / Merchant Rule Queries
export const SUBSCRIPTION_QUERIES = {
  // --- merchant_rules ---
  GET_ALL_RULES: `SELECT * FROM merchant_rules ORDER BY priority, LENGTH(pattern) DESC, rule_key`,
  GET_ENABLED_RULES: `SELECT * FROM merchant_rules WHERE enabled = 1 ORDER BY priority, LENGTH(pattern) DESC, rule_key`,
  GET_RULE_BY_ID: `SELECT * FROM merchant_rules WHERE id = ?`,
  CREATE_RULE: `
    INSERT INTO merchant_rules (rule_key, source, pattern, match_type, priority, merchant_name, service_name, default_kind, enabled, user_modified, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
  `,
  UPDATE_RULE: `
    UPDATE merchant_rules
    SET pattern = ?, match_type = ?, priority = ?, merchant_name = ?, service_name = ?, default_kind = ?, enabled = ?, notes = ?,
        user_modified = CASE WHEN source = 'community' THEN 1 ELSE user_modified END,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  DELETE_RULE: `DELETE FROM merchant_rules WHERE id = ? AND source = 'user'`,
  DISABLE_RULE: `UPDATE merchant_rules SET enabled = 0, user_modified = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  // Community reseed upsert: respects user edits via the user_modified guard
  UPSERT_COMMUNITY_RULE: `
    INSERT INTO merchant_rules (rule_key, source, pattern, match_type, priority, merchant_name, service_name, default_kind, enabled)
    VALUES (?, 'community', ?, ?, ?, ?, ?, ?, 1)
    ON CONFLICT(rule_key) DO UPDATE SET
      pattern = excluded.pattern,
      match_type = excluded.match_type,
      priority = excluded.priority,
      merchant_name = excluded.merchant_name,
      service_name = excluded.service_name,
      default_kind = excluded.default_kind,
      updated_at = CURRENT_TIMESTAMP
    WHERE merchant_rules.user_modified = 0
  `,
  COUNT_RULES_BY_SOURCE: `SELECT source, COUNT(*) as count FROM merchant_rules GROUP BY source`,

  // --- recurring_series ---
  GET_SERIES_WITH_STATS: `
    SELECT
      rs.*,
      comp.name as company_name,
      COUNT(t.id) as transaction_count,
      COALESCE(SUM(ABS(t.amount)), 0) as total_spent
    FROM recurring_series rs
    LEFT JOIN companies comp ON rs.company_id = comp.id
    LEFT JOIN transaction_series_links tsl ON tsl.series_id = rs.id
    LEFT JOIN transactions t ON t.id = tsl.transaction_id
      AND (? IS NULL OR t.date >= ?)
      AND (? IS NULL OR t.date <= ?)
    GROUP BY rs.id
    ORDER BY rs.status, rs.kind, rs.name
  `,
  GET_SERIES_BY_ID: `SELECT * FROM recurring_series WHERE id = ?`,
  GET_SERIES_BY_MATCH_KEY: `SELECT * FROM recurring_series WHERE match_key = ?`,
  CREATE_SERIES: `
    INSERT INTO recurring_series (name, company_id, rule_id, kind, cadence, expected_amount, amount_is_variable, status, match_key, last_seen_date, next_expected_date, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id
  `,
  // Scan refresh: updates detection-derived fields only; never touches user-owned name/kind/status/notes
  UPDATE_SERIES_DETECTION: `
    UPDATE recurring_series
    SET cadence = ?, expected_amount = ?, amount_is_variable = ?, last_seen_date = ?, next_expected_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  UPDATE_SERIES: `
    UPDATE recurring_series
    SET name = ?, kind = ?, cadence = ?, expected_amount = ?, status = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `,
  UPDATE_SERIES_STATUS: `UPDATE recurring_series SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  DELETE_SERIES: `DELETE FROM recurring_series WHERE id = ?`,

  // --- transaction_series_links ---
  LINK_TRANSACTION: `INSERT OR IGNORE INTO transaction_series_links (transaction_id, series_id, match_source) VALUES (?, ?, ?)`,
  LINK_TRANSACTION_MANUAL: `
    INSERT INTO transaction_series_links (transaction_id, series_id, match_source)
    VALUES (?, ?, 'manual')
    ON CONFLICT(transaction_id) DO UPDATE SET series_id = excluded.series_id, match_source = 'manual'
  `,
  DELETE_LINKS_FOR_SERIES: `DELETE FROM transaction_series_links WHERE series_id = ?`,
  DELETE_LINK_FOR_TRANSACTION: `DELETE FROM transaction_series_links WHERE transaction_id = ?`,
  GET_SERIES_TRANSACTIONS: `
    SELECT t.*, comp.name as company_name, a.name as account_name,
      card.last_four AS card_last_four,
      card.nickname AS card_nickname,
      COALESCE(card.user_id, a.owner_user_id) AS effective_user_id,
      COALESCE(card_user.display_name, owner_user.display_name) AS effective_user_name,
      owner_user.display_name AS account_owner_name
    FROM transaction_series_links tsl
    JOIN transactions t ON t.id = tsl.transaction_id
    LEFT JOIN companies comp ON t.company_id = comp.id
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN account_cards card ON t.card_id = card.id
    LEFT JOIN users card_user ON card.user_id = card_user.id
    LEFT JOIN users owner_user ON a.owner_user_id = owner_user.id
    WHERE tsl.series_id = ?
    ORDER BY t.date DESC
  `,
  GET_ALL_LINKED_TRANSACTION_IDS: `SELECT transaction_id, series_id FROM transaction_series_links`,

  // --- scan inputs ---
  GET_UNMATCHED_TRANSACTIONS: `SELECT id, description FROM transactions WHERE company_id IS NULL`,
  GET_EXPENSE_TRANSACTIONS_FOR_SCAN: `
    SELECT t.id, t.date, t.amount, t.description, t.company_id
    FROM transactions t
    WHERE t.type = 'expense'
    ORDER BY t.date ASC
  `,
  UPDATE_TRANSACTION_COMPANY: `
    UPDATE transactions SET company_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND company_id IS NULL
  `,

  // --- app_metadata ---
  GET_METADATA: `SELECT value FROM app_metadata WHERE key = ?`,
  SET_METADATA: `
    INSERT INTO app_metadata (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `,
};

// Utility Queries
export const UTILITY_QUERIES = {
  GET_TABLE_INFO: `PRAGMA table_info(?)`,
  VACUUM: `VACUUM`,
  ANALYZE: `ANALYZE`,
};

// Sample Data Loading Queries
export const SAMPLE_DATA_QUERIES = {
  // Insert with explicit ID using REPLACE to handle conflicts (SQLite allows this when AUTOINCREMENT is used)
  INSERT_USER: `INSERT OR REPLACE INTO users (id, display_name, is_primary, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
  INSERT_ACCOUNT: `INSERT OR REPLACE INTO accounts (id, name, type, owner_user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  INSERT_ACCOUNT_CARD: `INSERT OR REPLACE INTO account_cards (id, account_id, last_four, nickname, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  INSERT_CATEGORY: `INSERT OR REPLACE INTO categories (id, name, color, type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  INSERT_COMPANY: `INSERT OR REPLACE INTO companies (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
  INSERT_TRANSACTION: `INSERT OR REPLACE INTO transactions (id, date, amount, description, comment, account_id, card_id, category_id, company_id, project_id, trip_id, type, transaction_hash, hash_variation_seed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  INSERT_PROJECT: `INSERT OR REPLACE INTO projects (id, name, company_name, contact_details, project_category, status, start_date, end_date, estimated_cost, actual_cost, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  INSERT_TRIP: `INSERT OR REPLACE INTO trips (id, name, destination, purpose, trip_category, status, start_date, end_date, estimated_cost, actual_cost, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  INSERT_BUDGET_PLAN: `INSERT OR REPLACE INTO budget_plans (id, effective_month, total_amount, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  INSERT_BUDGET_PLAN_CATEGORY: `INSERT OR REPLACE INTO budget_plan_categories (id, plan_id, category_id, amount, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  INSERT_INCOME_SOURCE: `INSERT OR REPLACE INTO income_sources (id, name, kind, user_id, account_id, amount, frequency, start_date, end_date, is_active, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  
  // Reset auto-increment sequences after bulk insert
  RESET_SEQUENCE: `UPDATE sqlite_sequence SET seq = ? WHERE name = ?`,
};
