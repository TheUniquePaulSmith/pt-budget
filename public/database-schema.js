// Database Schema Creation
//
// Source of truth for the SQLite schema. `createTables()` in database-worker.js
// runs every CREATE_TABLES entry on a brand-new database; existing databases
// are brought up to date by `runMigrations()` from the MIGRATIONS list below.
//
// Money conventions: transactions.amount is signed (negative = money out,
// positive = money in). transactions.type says what the movement *means*:
//   expense  — spending (amount < 0)
//   income   — earnings arriving in a depository account (amount > 0)
//   refund   — money back from a merchant; nets against spending (amount > 0)
//   transfer — movement between the household's own accounts (card payment,
//              savings transfer, loan payment, investment contribution); counts
//              toward neither income nor spending. Both legs share
//              transfer_group_id when both accounts are tracked.
// transactions.type_source records how the type was decided (schema v4):
//   sign     — defaulted from the amount sign (import / manual entry default)
//   rule     — a classification_rules row matched the description
//   pair     — matched to the opposite leg in another account (transfer)
//   inferred — heuristic (e.g. money back from a merchant on a credit card)
//   manual   — the user chose it; type_locked = 1 and nothing automatic may
//              change it again
// type_confidence (0..1) is the detector's confidence for automatic sources
// and NULL for sign/manual.
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

  // `type` is the kind of account; `ownership` says whether it is held by one
  // person or jointly (it used to be a fourth `type` value, 'joint').
  // opening_balance + SUM(amount since opening_balance_date) is the running
  // balance for depository and credit accounts; investment/retirement/loan
  // balances come from account_balance_snapshots instead.
  ACCOUNTS: `
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT CHECK(type IN ('checking', 'savings', 'credit', 'loan', 'investment', 'retirement')) NOT NULL,
      ownership TEXT CHECK(ownership IN ('individual', 'joint')) NOT NULL DEFAULT 'individual',
      owner_user_id INTEGER NOT NULL,
      institution TEXT,
      opening_balance REAL NOT NULL DEFAULT 0,
      opening_balance_date DATE,
      credit_limit REAL,
      is_active INTEGER NOT NULL DEFAULT 1,
      include_in_net_worth INTEGER NOT NULL DEFAULT 1,
      import_sign_inverted INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `,

  ACCOUNT_CARDS: `
    CREATE TABLE IF NOT EXISTS account_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      last_four TEXT NOT NULL,
      full_number TEXT,
      nickname TEXT,
      user_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    )
  `,

  // One row per import run, so the app can say when data was last brought in,
  // through what date, and undo an import.
  IMPORT_BATCHES: `
    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      imported_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      source TEXT CHECK(source IN ('csv', 'manual', 'sample')) NOT NULL DEFAULT 'csv',
      file_name TEXT,
      account_ids_json TEXT,
      total_rows INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      duplicate_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      rejected_count INTEGER NOT NULL DEFAULT 0,
      min_date DATE,
      max_date DATE
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
      type TEXT CHECK(type IN ('income', 'expense', 'refund', 'transfer')) NOT NULL,
      transaction_hash TEXT UNIQUE,
      hash_variation_seed INTEGER DEFAULT 0,
      external_id TEXT,
      transfer_group_id TEXT,
      type_locked INTEGER NOT NULL DEFAULT 0,
      type_source TEXT CHECK(type_source IN ('sign', 'rule', 'pair', 'inferred', 'manual')) NOT NULL DEFAULT 'sign',
      type_confidence REAL,
      is_excluded INTEGER NOT NULL DEFAULT 0,
      is_flagged INTEGER NOT NULL DEFAULT 0,
      import_batch_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts (id),
      FOREIGN KEY (card_id) REFERENCES account_cards (id) ON DELETE SET NULL,
      FOREIGN KEY (category_id) REFERENCES categories (id),
      FOREIGN KEY (company_id) REFERENCES companies (id),
      FOREIGN KEY (project_id) REFERENCES projects (id),
      FOREIGN KEY (trip_id) REFERENCES trips (id),
      FOREIGN KEY (import_batch_id) REFERENCES import_batches (id) ON DELETE SET NULL
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
      -- Roll-over of unused (surplus) or overspent (deficit) budget into the
      -- following month; carry_reset = 1 zeroes the carried balance from this
      -- plan's effective_month onward.
      carry_mode TEXT CHECK(carry_mode IN ('none', 'surplus', 'deficit', 'both')) NOT NULL DEFAULT 'none',
      carry_reset INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (plan_id) REFERENCES budget_plans (id) ON DELETE CASCADE,
      FOREIGN KEY (category_id) REFERENCES categories (id)
    )
  `,

  // deposit_account_id: where the pay lands (NULL = an account the app does
  // not track). match_pattern: description text that identifies the payroll
  // deposit so received pay can be matched to scheduled paydays.
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
      deposit_account_id INTEGER,
      match_pattern TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL,
      FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
      FOREIGN KEY (deposit_account_id) REFERENCES accounts (id) ON DELETE SET NULL
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
      -- Optional savings fund: contributions accrue monthly into the linked
      -- budget category from contribution_start_month ('YYYY-MM').
      budget_category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
      monthly_contribution REAL,
      contribution_start_month TEXT,
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
      -- Optional savings fund (see projects).
      budget_category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL,
      monthly_contribution REAL,
      contribution_start_month TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,

  // Staging area for CSV import. Cleared before and after every import, so a
  // migration that changes its shape can simply drop and recreate it. The
  // classification columns are filled by the import's detection step and
  // copied into transactions by BULK_INSERT_FROM_TEMP.
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
      type TEXT CHECK(type IN ('income', 'expense', 'refund', 'transfer')) NOT NULL,
      transaction_hash TEXT,
      hash_variation_seed INTEGER DEFAULT 0,
      external_id TEXT,
      transfer_group_id TEXT,
      type_source TEXT CHECK(type_source IN ('sign', 'rule', 'pair', 'inferred', 'manual')) NOT NULL DEFAULT 'sign',
      type_confidence REAL
    )
  `,

  // Statement balances for accounts that are valued rather than transacted
  // (investment, retirement, loan). Latest snapshot per account feeds net worth.
  ACCOUNT_BALANCE_SNAPSHOTS: `
    CREATE TABLE IF NOT EXISTS account_balance_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      as_of_date DATE NOT NULL,
      balance REAL NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (account_id, as_of_date),
      FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE
    )
  `,

  // default_category_id lets a rule categorize matching rows at import time,
  // not just name the merchant.
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
      default_category_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (default_category_id) REFERENCES categories (id) ON DELETE SET NULL
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
      -- Payment reminders: non-autopay series are surfaced as notifications;
      -- due_day (1-31) overrides the detected next_expected_date when set.
      is_autopay INTEGER NOT NULL DEFAULT 0,
      due_day INTEGER,
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
  `,

  // Reminders (user-created: birthdays, anniversaries, seasonal chores) and
  // alerts (system-generated: overdue non-autopay payments, budget overspend).
  // A reminder's due_date is its next occurrence; `recurrence` advances it.
  // System alerts upsert on dedupe_key so rescans are idempotent.
  NOTIFICATIONS: `
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT CHECK(kind IN ('reminder', 'alert')) NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      due_date DATE,
      recurrence TEXT CHECK(recurrence IN ('once', 'monthly', 'yearly')) NOT NULL DEFAULT 'once',
      lead_days INTEGER,
      status TEXT CHECK(status IN ('active', 'snoozed', 'dismissed', 'done')) NOT NULL DEFAULT 'active',
      snoozed_until DATE,
      source TEXT CHECK(source IN ('user', 'system')) NOT NULL DEFAULT 'user',
      dedupe_key TEXT UNIQUE,
      entity_table TEXT,
      entity_id INTEGER,
      payload_json TEXT,
      last_notified_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,

  // Per-type notification defaults; `type` uses the notifications.type
  // vocabulary. Missing rows fall back to built-in defaults in the app.
  NOTIFICATION_SETTINGS: `
    CREATE TABLE IF NOT EXISTS notification_settings (
      type TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      lead_days INTEGER NOT NULL DEFAULT 7,
      os_notify INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,

  // User-imported AI tool packs (declarative MCP-style tool definitions).
  // Built-in packs ship as static JSON and are not stored here.
  AI_TOOL_PACKS: `
    CREATE TABLE IF NOT EXISTS ai_tool_packs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pack_key TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      version TEXT,
      source TEXT CHECK(source IN ('builtin', 'user')) NOT NULL DEFAULT 'user',
      enabled INTEGER NOT NULL DEFAULT 1,
      definition_json TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,

  // Per-tool enable flag and persisted consent policy; pack_key is NULL for
  // built-in TypeScript tools. 'ask' prompts inline, 'always' skips the
  // prompt, 'deny' blocks the tool entirely.
  AI_TOOL_SETTINGS: `
    CREATE TABLE IF NOT EXISTS ai_tool_settings (
      tool_name TEXT PRIMARY KEY,
      pack_key TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      consent TEXT CHECK(consent IN ('ask', 'always', 'deny')) NOT NULL DEFAULT 'ask',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `,

  // Version 4: user-defined rules that decide a transaction's type from its
  // description ("PYMT BY FUNDS TRANSFER" → transfer, "EXT TRANSFER TO
  // HUNTINGTON" → transfer, "REFUND" → refund). Banks word these differently,
  // so the list is per household; patterns are matched against the normalized
  // description exactly like merchant_rules. account_id scopes a rule to one
  // account (NULL = any); counterpart_account_id names the other side of a
  // transfer when it is known, which the pairing step uses as a strong hint.
  CLASSIFICATION_RULES: `
    CREATE TABLE IF NOT EXISTS classification_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_key TEXT NOT NULL UNIQUE,
      source TEXT CHECK(source IN ('community', 'user')) NOT NULL DEFAULT 'user',
      pattern TEXT NOT NULL,
      match_type TEXT CHECK(match_type IN ('exact', 'prefix', 'contains')) NOT NULL DEFAULT 'contains',
      priority INTEGER NOT NULL DEFAULT 100,
      type TEXT CHECK(type IN ('income', 'expense', 'refund', 'transfer')) NOT NULL,
      account_id INTEGER,
      counterpart_account_id INTEGER,
      enabled INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
      FOREIGN KEY (counterpart_account_id) REFERENCES accounts (id) ON DELETE SET NULL
    )
  `
};

// Indexes — run on every open (IF NOT EXISTS makes them idempotent). A table
// rebuilt by a migration loses its indexes with the old table; ensureIndexes()
// runs after migrations and recreates them on the new one.
export const CREATE_INDEXES = [
  `CREATE INDEX IF NOT EXISTS idx_transactions_date_id ON transactions(date DESC, id DESC)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_bpc_plan_category ON budget_plan_categories(plan_id, category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_budget_plans_month ON budget_plans(effective_month)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_card ON transactions(card_id) WHERE card_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions(type, date)`,
  `CREATE INDEX IF NOT EXISTS idx_temp_import_transactions_hash ON temp_import_transactions(transaction_hash) WHERE transaction_hash IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_temp_import_transactions_external_id ON temp_import_transactions(account_id, external_id) WHERE external_id IS NOT NULL`,
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
  // Transfer pairing, import history and review flags are all sparse.
  `CREATE INDEX IF NOT EXISTS idx_transactions_transfer_group ON transactions(transfer_group_id) WHERE transfer_group_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_import_batch ON transactions(import_batch_id) WHERE import_batch_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_account_external_id ON transactions(account_id, external_id) WHERE external_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_flagged ON transactions(is_flagged) WHERE is_flagged = 1`,
  // Replaces the old single-column UNIQUE on last_four: still blocks true
  // dupes on the same account, but now allows different accounts to share a
  // last_four (disambiguated, when needed, by full_number below).
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_account_cards_account_last_four ON account_cards(account_id, last_four)`,
  // full_number is optional (used only to disambiguate cards that share a
  // last_four); unique only when present so most rows are unaffected.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_account_cards_full_number ON account_cards(full_number) WHERE full_number IS NOT NULL`,
  // last_four is only the trailing column of the composite unique index
  // above, so restore a plain leading index for lookup-by-last-four alone.
  `CREATE INDEX IF NOT EXISTS idx_account_cards_last_four ON account_cards(last_four)`,
  // Version 3: notifications, payment reminders, budget funds, AI tool packs.
  `CREATE INDEX IF NOT EXISTS idx_notifications_status_due ON notifications(status, due_date)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_table, entity_id) WHERE entity_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_recurring_series_autopay ON recurring_series(is_autopay, status)`,
  `CREATE INDEX IF NOT EXISTS idx_projects_budget_category ON projects(budget_category_id) WHERE budget_category_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_trips_budget_category ON trips(budget_category_id) WHERE budget_category_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_ai_tool_settings_pack ON ai_tool_settings(pack_key) WHERE pack_key IS NOT NULL`,
  // Version 4: transaction classification. Automatically typed rows awaiting
  // confirmation are sparse; the amount index serves transfer-pair lookups
  // (the opposite leg has the negated amount within a few days).
  `CREATE INDEX IF NOT EXISTS idx_transactions_type_review ON transactions(type_source) WHERE type_locked = 0 AND type_source != 'sign'`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_amount_date ON transactions(amount, date)`,
  `CREATE INDEX IF NOT EXISTS idx_classification_rules_enabled ON classification_rules(enabled, priority)`,
];

// Schema versioning — applied by runMigrations() in database-worker.js.
//
// A fresh database gets every table from createTables() and is stamped with
// SCHEMA_VERSION directly; migrations only ever run against databases created
// by an older build. Each migration runs inside one transaction with foreign
// keys switched off (so rebuilding a parent table does not cascade-delete its
// children) and is verified with PRAGMA foreign_key_check before it commits.
//
// A migration's `statements` may contain:
//   - a SQL string (must be idempotent: CREATE TABLE IF NOT EXISTS, ...)
//   - { op: 'addColumn', table, column, ddl }        skipped if the column exists
//   - { op: 'dropTable', table }
//   - { op: 'rebuild', table, guardColumn, create, columnExpressions }
//       Recreates `table` from `create` (its CREATE_TABLES entry) to change
//       constraints: CREATE <table>_new -> INSERT ... SELECT (columns the old
//       table also has, or a SQL expression from columnExpressions) -> DROP old
//       -> RENAME. Skipped when the table already has `guardColumn`.
//   - { op: 'rehashTransactions' }                     recomputes legacy hashes
//   - an UPDATE ... WHERE string is allowed too when it is a no-op on rerun
export const SCHEMA_VERSION = 4;
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
  {
    version: 2,
    statements: [
      // Tables that shipped after version 1 without a migration entry.
      CREATE_TABLES.BUDGET_PLANS,
      CREATE_TABLES.BUDGET_PLAN_CATEGORIES,
      CREATE_TABLES.INCOME_SOURCES,
      // New in version 2.
      CREATE_TABLES.IMPORT_BATCHES,
      CREATE_TABLES.ACCOUNT_BALANCE_SNAPSHOTS,
      // accounts: 'joint' stops being a type and becomes an ownership; the type
      // list widens to loan / investment / retirement; balance and import
      // settings are added.
      {
        op: 'rebuild',
        table: 'accounts',
        guardColumn: 'ownership',
        create: CREATE_TABLES.ACCOUNTS,
        columnExpressions: {
          type: `CASE WHEN type = 'joint' THEN 'checking' ELSE type END`,
          ownership: `CASE WHEN type = 'joint' THEN 'joint' ELSE 'individual' END`,
        },
      },
      // transactions: type gains 'refund' and 'transfer'; review/exclusion
      // flags, transfer pairing, bank reference id and import batch are added.
      {
        op: 'rebuild',
        table: 'transactions',
        guardColumn: 'is_excluded',
        create: CREATE_TABLES.TRANSACTIONS,
        columnExpressions: {},
      },
      // The staging table carries its own type CHECK and is empty between imports.
      { op: 'dropTable', table: 'temp_import_transactions' },
      CREATE_TABLES.TEMP_IMPORT_TRANSACTIONS,
      {
        op: 'addColumn',
        table: 'income_sources',
        column: 'deposit_account_id',
        ddl: 'deposit_account_id INTEGER REFERENCES accounts (id) ON DELETE SET NULL',
      },
      { op: 'addColumn', table: 'income_sources', column: 'match_pattern', ddl: 'match_pattern TEXT' },
      {
        op: 'addColumn',
        table: 'merchant_rules',
        column: 'default_category_id',
        ddl: 'default_category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL',
      },
      // Version-1 hashes were 32-bit and keyed differently on the CSV path;
      // recompute every legacy hash as SHA-256 keyed on the numeric account id.
      { op: 'rehashTransactions' },
    ],
  },
  {
    version: 3,
    statements: [
      // Notifications / reminders and the AI tool registry.
      CREATE_TABLES.NOTIFICATIONS,
      CREATE_TABLES.NOTIFICATION_SETTINGS,
      CREATE_TABLES.AI_TOOL_PACKS,
      CREATE_TABLES.AI_TOOL_SETTINGS,
      // recurring_series: autopay flag and explicit due day for payment reminders.
      { op: 'addColumn', table: 'recurring_series', column: 'is_autopay', ddl: 'is_autopay INTEGER NOT NULL DEFAULT 0' },
      { op: 'addColumn', table: 'recurring_series', column: 'due_day', ddl: 'due_day INTEGER' },
      // budget_plan_categories: per-category roll-over mode and reset marker.
      {
        op: 'addColumn',
        table: 'budget_plan_categories',
        column: 'carry_mode',
        ddl: "carry_mode TEXT CHECK(carry_mode IN ('none', 'surplus', 'deficit', 'both')) NOT NULL DEFAULT 'none'",
      },
      { op: 'addColumn', table: 'budget_plan_categories', column: 'carry_reset', ddl: 'carry_reset INTEGER NOT NULL DEFAULT 0' },
      // projects / trips: optional savings fund linked to a budget category.
      {
        op: 'addColumn',
        table: 'projects',
        column: 'budget_category_id',
        ddl: 'budget_category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL',
      },
      { op: 'addColumn', table: 'projects', column: 'monthly_contribution', ddl: 'monthly_contribution REAL' },
      { op: 'addColumn', table: 'projects', column: 'contribution_start_month', ddl: 'contribution_start_month TEXT' },
      {
        op: 'addColumn',
        table: 'trips',
        column: 'budget_category_id',
        ddl: 'budget_category_id INTEGER REFERENCES categories (id) ON DELETE SET NULL',
      },
      { op: 'addColumn', table: 'trips', column: 'monthly_contribution', ddl: 'monthly_contribution REAL' },
      { op: 'addColumn', table: 'trips', column: 'contribution_start_month', ddl: 'contribution_start_month TEXT' },
    ],
  },
  {
    version: 4,
    statements: [
      // Transaction classification: description rules plus provenance and
      // confidence for automatically decided types.
      CREATE_TABLES.CLASSIFICATION_RULES,
      {
        op: 'addColumn',
        table: 'transactions',
        column: 'type_source',
        ddl: "type_source TEXT CHECK(type_source IN ('sign', 'rule', 'pair', 'inferred', 'manual')) NOT NULL DEFAULT 'sign'",
      },
      { op: 'addColumn', table: 'transactions', column: 'type_confidence', ddl: 'type_confidence REAL' },
      // Types the user already chose by hand (type_locked = 1) were manual decisions.
      `UPDATE transactions SET type_source = 'manual' WHERE type_locked = 1 AND type_source = 'sign'`,
      // The staging table gains the same columns; it is empty between imports.
      { op: 'dropTable', table: 'temp_import_transactions' },
      CREATE_TABLES.TEMP_IMPORT_TRANSACTIONS,
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
    INSERT OR IGNORE INTO accounts (id, name, type, ownership, owner_user_id) VALUES
    (1, 'Primary Checking', 'checking', 'individual', 1),
    (2, 'Savings Account', 'savings', 'individual', 1),
    (3, 'Credit Card', 'credit', 'individual', 1)
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
