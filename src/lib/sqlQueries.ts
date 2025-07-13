/**
 * SQL Query Definitions
 * 
 * This file contains all raw SQL strings used throughout the application.
 * Keeping them centralized helps with debugging and maintenance.
 */

// Database Schema Creation
export const CREATE_TABLES = {
  CATEGORIES: `
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      color TEXT DEFAULT '#1976d2',
      type TEXT CHECK(type IN ('income', 'expense')) NOT NULL DEFAULT 'expense',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
  
  COMPANIES: `
    CREATE TABLE IF NOT EXISTS companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
  
  ACCOUNTS: `
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('checking', 'savings', 'credit', 'investment', 'other')) NOT NULL,
      institution TEXT,
      balance REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
  
  TRANSACTIONS: `
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      account_id TEXT NOT NULL,
      category_id INTEGER,
      company_id INTEGER,
      project_id INTEGER,
      type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
      transaction_hash TEXT UNIQUE,
      account_last_four TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories (id),
      FOREIGN KEY (company_id) REFERENCES companies (id),
      FOREIGN KEY (project_id) REFERENCES projects (id)
    )
  `,
  
  BUDGETS: `
    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      period TEXT CHECK(period IN ('weekly', 'monthly', 'yearly')) NOT NULL DEFAULT 'monthly',
      start_date DATE NOT NULL,
      end_date DATE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories (id)
    )
  `,
  
  PROJECTS: `
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company_name TEXT,
      contact_details TEXT,
      project_category TEXT CHECK(project_category IN ('plumbing', 'electrical', 'hvac', 'roofing', 'flooring', 'painting', 'landscaping', 'general_contractor', 'other')) DEFAULT 'other',
      status TEXT CHECK(status IN ('planning', 'in_progress', 'completed', 'on_hold')) DEFAULT 'planning',
      start_date DATE,
      end_date DATE,
      estimated_cost REAL DEFAULT 0,
      actual_cost REAL DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
  
  ACCOUNT_ALIASES: `
    CREATE TABLE IF NOT EXISTS account_aliases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      last_four TEXT,
      alias_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
    )
  `
};

// Default Data Inserts
export const DEFAULT_DATA = {
  CATEGORIES: `
    INSERT OR IGNORE INTO categories (id, name, color, type) VALUES
    (1, 'Groceries', '#4caf50', 'expense'),
    (2, 'Utilities', '#ff9800', 'expense'),
    (3, 'Transportation', '#2196f3', 'expense'),
    (4, 'Entertainment', '#9c27b0', 'expense'),
    (5, 'Healthcare', '#f44336', 'expense'),
    (6, 'Dining Out', '#ff5722', 'expense'),
    (7, 'Shopping', '#795548', 'expense'),
    (8, 'Education', '#607d8b', 'expense'),
    (9, 'Travel', '#00bcd4', 'expense'),
    (10, 'Other Expenses', '#9e9e9e', 'expense'),
    (11, 'Salary', '#4caf50', 'income'),
    (12, 'Freelance', '#8bc34a', 'income'),
    (13, 'Investment', '#cddc39', 'income'),
    (14, 'Other Income', '#ffeb3b', 'income')
  `,
  
  ACCOUNTS: `
    INSERT OR IGNORE INTO accounts (id, name, type, institution) VALUES
    (1, 'Primary Checking', 'checking', 'Default Bank'),
    (2, 'Savings Account', 'savings', 'Default Bank'),
    (3, 'Credit Card', 'credit', 'Default Bank')
  `
};

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
      p.name as project_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN companies comp ON t.company_id = comp.id
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN projects p ON t.project_id = p.id
    ORDER BY t.date DESC, t.id DESC
  `,
  
  CREATE: `
    INSERT INTO transactions (date, amount, description, account_id, category_id, company_id, project_id, type, transaction_hash, account_last_four)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
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
  
  GET_BY_DATE_RANGE: `
    SELECT 
      t.*,
      c.name as category_name,
      c.color as category_color,
      c.type as category_type,
      comp.name as company_name,
      a.name as account_name,
      a.type as account_type,
      p.name as project_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN companies comp ON t.company_id = comp.id
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN projects p ON t.project_id = p.id
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
      p.name as project_name
    FROM transactions t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN companies comp ON t.company_id = comp.id
    LEFT JOIN accounts a ON t.account_id = a.id
    LEFT JOIN projects p ON t.project_id = p.id
    WHERE t.date BETWEEN ? AND ? AND c.type = ?
    ORDER BY t.date DESC, t.id DESC
  `,
  
  CHECK_HASH_EXISTS: `
    SELECT COUNT(*) as count FROM transactions WHERE transaction_hash = ?
  `
};

// Category Queries
export const CATEGORY_QUERIES = {
  GET_ALL: `SELECT * FROM categories ORDER BY type, name`,
  CREATE: `INSERT INTO categories (name, color, type) VALUES (?, ?, ?) RETURNING id`,
  GET_BY_ID: `SELECT * FROM categories WHERE id = ?`,
  UPDATE: `UPDATE categories SET name = ?, color = ?, type = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  DELETE: `DELETE FROM categories WHERE id = ?`
};

// Company Queries
export const COMPANY_QUERIES = {
  GET_ALL: `SELECT * FROM companies ORDER BY name`,
  CREATE: `INSERT INTO companies (name) VALUES (?) RETURNING id`,
  FIND_BY_NAME: `SELECT * FROM companies WHERE LOWER(name) = LOWER(?) LIMIT 1`,
  GET_BY_ID: `SELECT * FROM companies WHERE id = ?`,
  UPDATE: `UPDATE companies SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  DELETE: `DELETE FROM companies WHERE id = ?`
};

// Account Queries
export const ACCOUNT_QUERIES = {
  GET_ALL: `SELECT * FROM accounts ORDER BY name`,
  CREATE: `INSERT INTO accounts (name, type, institution, balance) VALUES (?, ?, ?, ?) RETURNING id`,
  GET_BY_ID: `SELECT * FROM accounts WHERE id = ?`,
  UPDATE: `UPDATE accounts SET name = ?, type = ?, institution = ?, balance = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  DELETE: `DELETE FROM accounts WHERE id = ?`
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
  DELETE: `DELETE FROM budgets WHERE id = ?`
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
  `
};

// Account Alias Queries
export const ACCOUNT_ALIAS_QUERIES = {
  GET_ALL: `
    SELECT 
      aa.*,
      a.name as account_name,
      a.type as account_type
    FROM account_aliases aa
    LEFT JOIN accounts a ON aa.account_id = a.id
    ORDER BY a.name, aa.alias_name
  `,
  CREATE: `INSERT INTO account_aliases (account_id, last_four, alias_name) VALUES (?, ?, ?) RETURNING id`,
  GET_BY_ACCOUNT_ID: `SELECT * FROM account_aliases WHERE account_id = ? ORDER BY alias_name`,
  FIND_BY_LAST_FOUR: `SELECT * FROM account_aliases WHERE last_four = ?`,
  GET_BY_ID: `SELECT * FROM account_aliases WHERE id = ?`,
  UPDATE: `UPDATE account_aliases SET account_id = ?, last_four = ?, alias_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  DELETE: `DELETE FROM account_aliases WHERE id = ?`,
  DELETE_BY_ACCOUNT_ID: `DELETE FROM account_aliases WHERE account_id = ?`
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
  `
};

// Utility Queries
export const UTILITY_QUERIES = {
  GET_TABLE_INFO: `PRAGMA table_info(?)`,
  GET_DATABASE_VERSION: `PRAGMA user_version`,
  SET_DATABASE_VERSION: `PRAGMA user_version = ?`,
  VACUUM: `VACUUM`,
  ANALYZE: `ANALYZE`
};
