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
  
  USERS: `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
  
  ACCOUNTS: `
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('checking', 'savings', 'credit')) NOT NULL,
      last_four TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `,
  
  TRANSACTIONS: `
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      category_id INTEGER,
      company_id INTEGER,
      project_id INTEGER,
      trip_id INTEGER,
      type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
      transaction_hash TEXT UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts (id),
      FOREIGN KEY (category_id) REFERENCES categories (id),
      FOREIGN KEY (company_id) REFERENCES companies (id),
      FOREIGN KEY (project_id) REFERENCES projects (id),
      FOREIGN KEY (trip_id) REFERENCES trips (id)
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
  
  TRIPS: `
    CREATE TABLE IF NOT EXISTS trips (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      destination TEXT,
      purpose TEXT,
      trip_category TEXT CHECK(trip_category IN ('business', 'vacation', 'family', 'medical', 'education', 'other')) DEFAULT 'other',
      status TEXT CHECK(status IN ('planning', 'in_progress', 'completed', 'cancelled')) DEFAULT 'planning',
      start_date DATE,
      end_date DATE,
      estimated_cost REAL DEFAULT 0,
      actual_cost REAL DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,

  TEMP_IMPORT_TRANSACTIONS: `
    CREATE TABLE IF NOT EXISTS temp_import_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      account_id INTEGER NOT NULL,
      category_id INTEGER,
      company_id INTEGER,
      project_id INTEGER,
      trip_id INTEGER,
      type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
      transaction_hash TEXT
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
  
  USERS: `
    INSERT OR IGNORE INTO users (id, display_name) VALUES
    (1, 'Default User')
  `,
  
  ACCOUNTS: `
    INSERT OR IGNORE INTO accounts (id, user_id, name, type, last_four) VALUES
    (1, 1, 'Primary Checking', 'checking', '1234'),
    (2, 1, 'Savings Account', 'savings', '5678'),
    (3, 1, 'Credit Card', 'credit', '9012')
  `,
  
  TRIPS: `
    INSERT OR IGNORE INTO trips (id, name, destination, purpose, trip_category, status) VALUES
    (1, 'Summer Vacation 2024', 'Hawaii', 'Family vacation', 'vacation', 'planning'),
    (2, 'Business Conference NYC', 'New York', 'Annual company conference', 'business', 'planning')
  `
};