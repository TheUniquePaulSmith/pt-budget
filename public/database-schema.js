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
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,
  
  ACCOUNTS: `
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('checking', 'savings', 'credit', 'joint')) NOT NULL,
      owner_user_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `,
  
  ACCOUNT_CARDS: `
    CREATE TABLE IF NOT EXISTS account_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      last_four TEXT NOT NULL UNIQUE,
      nickname TEXT,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    )
  `,
  
  TRANSACTIONS: `
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date DATE NOT NULL,
      amount REAL NOT NULL,
      description TEXT NOT NULL,
      comment TEXT,
      account_id INTEGER NOT NULL,
      card_id INTEGER,
      category_id INTEGER,
      company_id INTEGER,
      project_id INTEGER,
      trip_id INTEGER,
      type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
      transaction_hash TEXT UNIQUE,
      hash_variation_seed INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts (id),
      FOREIGN KEY (card_id) REFERENCES account_cards (id) ON DELETE SET NULL,
      FOREIGN KEY (category_id) REFERENCES categories (id),
      FOREIGN KEY (company_id) REFERENCES companies (id),
      FOREIGN KEY (project_id) REFERENCES projects (id),
      FOREIGN KEY (trip_id) REFERENCES trips (id)
    )
  `,
  
  BUDGET_PLANS: `
    CREATE TABLE IF NOT EXISTS budget_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      effective_month TEXT NOT NULL UNIQUE CHECK(effective_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
      total_amount REAL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,

  BUDGET_PLAN_CATEGORIES: `
    CREATE TABLE IF NOT EXISTS budget_plan_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_id) REFERENCES budget_plans (id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories (id)
    )
  `,

  INCOME_SOURCES: `
    CREATE TABLE IF NOT EXISTS income_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      kind TEXT CHECK(kind IN ('linked_account','recurring_salary')) NOT NULL,
      user_id INTEGER,
      account_id INTEGER,
      amount REAL,
      frequency TEXT CHECK(frequency IN ('weekly','biweekly','semi_monthly','monthly')),
      start_date DATE,
      end_date DATE,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
      FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
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
      comment TEXT,
      account_id INTEGER NOT NULL,
      card_id INTEGER,
      category_id INTEGER,
      company_id INTEGER,
      project_id INTEGER,
      trip_id INTEGER,
      type TEXT CHECK(type IN ('income', 'expense')) NOT NULL,
      transaction_hash TEXT,
      hash_variation_seed INTEGER DEFAULT 0
    )
  `,

  MERCHANT_RULES: `
    CREATE TABLE IF NOT EXISTS merchant_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_key TEXT NOT NULL UNIQUE,
      source TEXT CHECK(source IN ('community', 'user')) NOT NULL DEFAULT 'user',
      pattern TEXT NOT NULL,
      match_type TEXT CHECK(match_type IN ('exact', 'prefix', 'contains')) NOT NULL DEFAULT 'prefix',
      priority INTEGER NOT NULL DEFAULT 100,
      merchant_name TEXT NOT NULL,
      service_name TEXT,
      default_kind TEXT CHECK(default_kind IN ('subscription', 'bill', 'purchase', 'unknown')) NOT NULL DEFAULT 'unknown',
      enabled INTEGER NOT NULL DEFAULT 1,
      user_modified INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,

  RECURRING_SERIES: `
    CREATE TABLE IF NOT EXISTS recurring_series (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      company_id INTEGER,
      rule_id INTEGER,
      kind TEXT CHECK(kind IN ('subscription', 'bill')) NOT NULL DEFAULT 'subscription',
      cadence TEXT CHECK(cadence IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'irregular')) NOT NULL DEFAULT 'monthly',
      expected_amount REAL,
      amount_is_variable INTEGER NOT NULL DEFAULT 0,
      status TEXT CHECK(status IN ('candidate', 'active', 'inactive', 'ignored')) NOT NULL DEFAULT 'candidate',
      match_key TEXT NOT NULL UNIQUE,
      last_seen_date DATE,
      next_expected_date DATE,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (company_id) REFERENCES companies (id) ON DELETE SET NULL,
      FOREIGN KEY (rule_id) REFERENCES merchant_rules (id) ON DELETE SET NULL
    )
  `,

  TRANSACTION_SERIES_LINKS: `
    CREATE TABLE IF NOT EXISTS transaction_series_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaction_id INTEGER NOT NULL UNIQUE,
      series_id INTEGER NOT NULL,
      match_source TEXT CHECK(match_source IN ('rule', 'heuristic', 'ai', 'manual')) NOT NULL DEFAULT 'rule',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (transaction_id) REFERENCES transactions (id) ON DELETE CASCADE,
      FOREIGN KEY (series_id) REFERENCES recurring_series (id) ON DELETE CASCADE
    )
  `,

  APP_METADATA: `
    CREATE TABLE IF NOT EXISTS app_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `
};

// Indexes — run on every open (IF NOT EXISTS makes them idempotent)
export const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_transactions_date_id ON transactions(date DESC, id DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_bpc_plan_category ON budget_plan_categories(plan_id, category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_budget_plans_month ON budget_plans(effective_month)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_card ON transactions(card_id) WHERE card_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions(type, date)`,
  `CREATE INDEX IF NOT EXISTS idx_temp_import_transactions_hash ON temp_import_transactions(transaction_hash) WHERE transaction_hash IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_merchant_rules_enabled ON merchant_rules(enabled, priority)`,
  `CREATE INDEX IF NOT EXISTS idx_recurring_series_status ON recurring_series(status, kind)`,
  `CREATE INDEX IF NOT EXISTS idx_tsl_series ON transaction_series_links(series_id)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_company_null ON transactions(company_id) WHERE company_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_category_null ON transactions(category_id) WHERE category_id IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_project_null ON transactions(project_id) WHERE project_id IS NULL`,
  // account_id has no index despite being an FK: supports list filtering by
  // account (account_id IN (...)) and the account/income analytics joins.
  `CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id)`,
  // trip_id is usually NULL, so a partial index stays small while accelerating
  // trip transaction lookups and trip cost rollups.
  `CREATE INDEX IF NOT EXISTS idx_transactions_trip_id ON transactions(trip_id) WHERE trip_id IS NOT NULL`,
];

// Schema versioning — applied by runMigrations() in database-worker.js.
// Each migration's statements must be idempotent (IF NOT EXISTS) because a
// fresh database may already have the tables from createTables().
export const SCHEMA_VERSION = 1;
export const MIGRATIONS = [
  {
    version: 1,
    statements: [
      CREATE_TABLES.MERCHANT_RULES,
      CREATE_TABLES.RECURRING_SERIES,
      CREATE_TABLES.TRANSACTION_SERIES_LINKS,
      CREATE_TABLES.APP_METADATA,
    ],
  },
];

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
    INSERT OR IGNORE INTO users (id, display_name, is_primary) VALUES
    (1, 'Default User', 1)
  `,
  
  ACCOUNTS: `
    INSERT OR IGNORE INTO accounts (id, name, type, owner_user_id) VALUES
    (1, 'Primary Checking', 'checking', 1),
    (2, 'Savings Account', 'savings', 1),
    (3, 'Credit Card', 'credit', 1)
  `,
  
  ACCOUNT_CARDS: `
    INSERT OR IGNORE INTO account_cards (id, account_id, last_four, nickname, user_id) VALUES
    (1, 1, '1234', 'Main Debit Card', 1),
    (2, 2, '5678', NULL, 1),
    (3, 3, '9012', 'Primary Credit Card', 1)
  `,
  
  TRIPS: `
    INSERT OR IGNORE INTO trips (id, name, destination, purpose, trip_category, status) VALUES
    (1, 'Summer Vacation 2024', 'Hawaii', 'Family vacation', 'vacation', 'planning'),
    (2, 'Business Conference NYC', 'New York', 'Annual company conference', 'business', 'planning')
  `
};