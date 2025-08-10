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
    INSERT INTO transactions (date, amount, description, account_id, category_id, company_id, project_id, trip_id, type, transaction_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `,

  UPDATE_PROJECT_TRIP: `
    UPDATE transactions 
    SET project_id = ?, trip_id = ?, updated_at = CURRENT_TIMESTAMP 
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
  
  GET_ALL_HASHES: `
    SELECT transaction_hash FROM transactions
  `,
};

// Category Queries
export const CATEGORY_QUERIES = {
  GET_ALL: `SELECT * FROM categories ORDER BY type, name`,
  CREATE: `INSERT INTO categories (name, color, type) VALUES (?, ?, ?) RETURNING id`,
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
  GET_ALL: `SELECT * FROM users ORDER BY display_name`,
  CREATE: `INSERT INTO users (display_name) VALUES (?) RETURNING id`,
  GET_BY_ID: `SELECT * FROM users WHERE id = ?`,
  UPDATE: `UPDATE users SET display_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  DELETE: `DELETE FROM users WHERE id = ?`,
};

// Account Queries
export const ACCOUNT_QUERIES = {
  GET_ALL: `
    SELECT 
      a.*,
      u.display_name as user_display_name
    FROM accounts a
    LEFT JOIN users u ON a.user_id = u.id
    ORDER BY u.display_name, a.name
  `,
  CREATE: `INSERT INTO accounts (user_id, name, type, last_four) VALUES (?, ?, ?, ?) RETURNING id`,
  GET_BY_ID: `SELECT * FROM accounts WHERE id = ?`,
  GET_BY_USER_ID: `SELECT * FROM accounts WHERE user_id = ? ORDER BY name`,
  UPDATE: `UPDATE accounts SET user_id = ?, name = ?, type = ?, last_four = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  DELETE: `DELETE FROM accounts WHERE id = ?`,
  FIND_BY_LAST_FOUR: `SELECT * FROM accounts WHERE last_four = ?`,
};

// Budget Queries
export const BUDGET_QUERIES = {
  GET_ALL: `
    SELECT 
      b.*,
      c.name as category_name,
      c.color as category_color,
      c.type as category_type
    FROM budgets b
    LEFT JOIN categories c ON b.category_id = c.id
    ORDER BY b.start_date DESC
  `,
  CREATE: `INSERT INTO budgets (category_id, amount, period, start_date, end_date) VALUES (?, ?, ?, ?, ?) RETURNING id`,
  GET_BY_ID: `SELECT * FROM budgets WHERE id = ?`,
  UPDATE: `UPDATE budgets SET category_id = ?, amount = ?, period = ?, start_date = ?, end_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  DELETE: `DELETE FROM budgets WHERE id = ?`,
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
    WHERE t.date BETWEEN ? AND ? AND c.type = 'expense'
    GROUP BY c.id, c.name, c.color
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
    WHERE t.date BETWEEN ? AND ? AND c.type = 'income'
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
    WHERE t.date >= date('now', '-? months')
    GROUP BY strftime('%Y-%m', t.date)
    ORDER BY month DESC
  `,
};

// Utility Queries
export const UTILITY_QUERIES = {
  GET_TABLE_INFO: `PRAGMA table_info(?)`,
  GET_DATABASE_VERSION: `PRAGMA user_version`,
  SET_DATABASE_VERSION: `PRAGMA user_version = ?`,
  VACUUM: `VACUUM`,
  ANALYZE: `ANALYZE`,
};
