/**
 * Budget Database Query Operations
 * 
 * This module contains all SQL CRUD operations and queries for the budget application.
 * It provides a clean interface for database interactions, separating business logic
 * from the React context implementation.
 */

import type {
  Transaction,
  Category,
  Company,
  Account,
  AccountAlias,
  Budget,
  Project,
} from "../types/database";
import { dbLogger } from "./logger";

/**
 * Core database interface for executing SQL queries
 */
export interface SQLiteExecutor {
  sqlite3: any;
  db: number;
  query: (sql: string, parameters?: any[]) => Promise<any[]>;
  exec: (sql: string) => Promise<void>;
}

/**
 * Database schema creation and initialization
 */
export class DatabaseSchema {
  static async createTables(executor: SQLiteExecutor): Promise<void> {
    // // Check if we need to run migrations
    // await DatabaseSchema.runMigrations(executor);
    
    const tables = [
      `CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        color TEXT DEFAULT '#3b82f6',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS companies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS account_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        last_four TEXT NOT NULL,
        alias_name TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts (id) ON DELETE CASCADE,
        UNIQUE(account_id, last_four)
      )`,
      `CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        company_name TEXT NOT NULL,
        contact_details TEXT,
        project_category TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'planning',
        start_date TEXT,
        end_date TEXT,
        estimated_cost REAL,
        actual_cost REAL,
        notes TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS budgets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        period TEXT NOT NULL,
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories (id)
      )`,
      `CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        amount REAL NOT NULL,
        description TEXT NOT NULL,
        transaction_hash TEXT NOT NULL UNIQUE,
        category_id INTEGER,
        company_id INTEGER,
        project_id INTEGER,
        account_id INTEGER,
        account_label TEXT,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES accounts (id),
        FOREIGN KEY (category_id) REFERENCES categories (id),
        FOREIGN KEY (company_id) REFERENCES companies (id),
        FOREIGN KEY (project_id) REFERENCES projects (id)
      )`
    ];

    for (const sql of tables) {
      await executor.exec(sql);
    }

    // Insert default categories if none exist
    const categoryCount = await executor.query('SELECT COUNT(*) as count FROM categories');
    if (categoryCount[0]?.count === 0) {
      dbLogger.info('No categories found, inserting default categories...');
      await DatabaseSchema.insertDefaultCategories(executor);
    } else {
      dbLogger.debug(`Found ${categoryCount[0].count} existing categories`);
    }
    
    // Insert default accounts if none exist
    const accountCount = await executor.query('SELECT COUNT(*) as count FROM accounts');
    if (accountCount[0]?.count === 0) {
      dbLogger.info('No accounts found, inserting default account...');
      await DatabaseSchema.insertDefaultAccounts(executor);
    } else {
      dbLogger.debug(`Found ${accountCount[0].count} existing accounts`);
    }
    
    // Log available categories for debugging
    const allCategories = await executor.query('SELECT id, name, type FROM categories');
    dbLogger.debug('Available categories:', allCategories);
  }

  private static async insertDefaultCategories(executor: SQLiteExecutor): Promise<void> {
    const defaultCategories = [
      { name: 'Salary', type: 'income', color: '#58D68D' },
      { name: 'Freelance', type: 'income', color: '#52BE80' },
      { name: 'Investment', type: 'income', color: '#48C9B0' },
      { name: 'Mortgage/Rent', type: 'expense', color: '#FF6B6B' },
      { name: 'Insurance', type: 'expense', color: '#4ECDC4' },
      { name: 'Food & Dining', type: 'expense', color: '#45B7D1' },
      { name: 'Utilities', type: 'expense', color: '#FFA07A' },
      { name: 'Transportation', type: 'expense', color: '#98D8C8' },
      { name: 'Entertainment', type: 'expense', color: '#F7DC6F' },
      { name: 'Healthcare', type: 'expense', color: '#BB8FCE' },
      { name: 'Shopping', type: 'expense', color: '#85C1E9' },
    ];

    for (const category of defaultCategories) {
      await executor.exec(
        `INSERT INTO categories (name, type, color) VALUES ('${category.name}', '${category.type}', '${category.color}')`
      );
    }
  }

  private static async insertDefaultAccounts(executor: SQLiteExecutor): Promise<void> {
    // Insert default account
    await executor.exec(
      `INSERT INTO accounts (name, type) VALUES ('Default Account', 'checking')`
    );
    
    // Get the inserted account ID
    const result = await executor.query("SELECT id FROM accounts WHERE name = 'Default Account' LIMIT 1");
    if (result.length > 0) {
      const accountId = result[0].id;
      // Insert default alias using parameterized query
      await executor.query(
        `INSERT INTO account_aliases (account_id, last_four) VALUES (?, '0000')`,
        [accountId]
      );
    }
  }

  /**
   * Run database migrations to update schema
   */
  // static async runMigrations(executor: SQLiteExecutor): Promise<void> {
  //   try {
  //     // Check if transactions table has account_id column
  //     const tableInfo = await executor.query("PRAGMA table_info(transactions)");
  //     const hasAccountIdColumn = tableInfo.some(col => col.name === 'account_id');
      
  //     if (!hasAccountIdColumn) {
  //       dbLogger.info('Adding account_id column to transactions table...');
  //       await executor.exec('ALTER TABLE transactions ADD COLUMN account_id INTEGER');
  //       await executor.exec('ALTER TABLE transactions ADD COLUMN account_label TEXT');
        
  //       // Set default account_id for existing transactions
  //       await executor.exec("UPDATE transactions SET account_id = 1 WHERE account_id IS NULL");
        
  //       dbLogger.info('Migration completed: Added account_id column to transactions table');
  //     }
  //   } catch (error) {
  //     // If transactions table doesn't exist yet, migrations will be handled by table creation
  //     if (error instanceof Error && !error.message.includes('no such table: transactions')) {
  //       dbLogger.warn('Migration warning:', error);
  //     }
  //   }
  // }
}

/**
 * Transaction CRUD operations
 */
export class TransactionQueries {
  // Generate a hash for duplicate detection based on account_id, date, amount, and description
  private static generateTransactionHash(transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>): string {
    const hashData = `${transaction.account_id}|${transaction.date}|${transaction.amount}|${transaction.description}`;
    // Simple hash function - in a real app you might want to use crypto.subtle.digest
    let hash = 0;
    for (let i = 0; i < hashData.length; i++) {
      const char = hashData.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  // Public method to generate transaction hash with custom fields for CSV import
  static generateTransactionHashFromFields(
    accountId: string,
    date: string,
    amount: number,
    description: string,
    uniqueIdentifier?: string
  ): string {
    const hashData = uniqueIdentifier 
      ? `${accountId}|${date}|${amount}|${description}|${uniqueIdentifier}`
      : `${accountId}|${date}|${amount}|${description}`;
    
    // Simple hash function - in a real app you might want to use crypto.subtle.digest
    let hash = 0;
    for (let i = 0; i < hashData.length; i++) {
      const char = hashData.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  // Check if a transaction hash already exists
  static async checkTransactionHashExists(
    executor: SQLiteExecutor,
    transactionHash: string
  ): Promise<boolean> {
    const existingTransaction = await executor.query('SELECT id FROM transactions WHERE transaction_hash = ?', [transactionHash]);
    return existingTransaction.length > 0;
  }

  static async create(
    executor: SQLiteExecutor,
    transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>
  ): Promise<string> {
    // Generate transaction hash for duplicate detection
    const transactionHash = transaction.transaction_hash || TransactionQueries.generateTransactionHash(transaction);
    
    // Check for duplicates
    const existingTransaction = await executor.query('SELECT id FROM transactions WHERE transaction_hash = ?', [transactionHash]);
    if (existingTransaction.length > 0) {
      throw new Error('This transaction already exists (duplicate detected)');
    }

    // Validate foreign key references first
    if (transaction.category_id) {
      const categoryExists = await executor.query('SELECT id FROM categories WHERE id = ?', [parseInt(transaction.category_id)]);
      if (categoryExists.length === 0) {
        throw new Error(`Category with ID ${transaction.category_id} does not exist`);
      }
    }

    if (transaction.company_id) {
      const companyExists = await executor.query('SELECT id FROM companies WHERE id = ?', [parseInt(transaction.company_id)]);
      if (companyExists.length === 0) {
        throw new Error(`Company with ID ${transaction.company_id} does not exist`);
      }
    }

    if (transaction.project_id) {
      const projectExists = await executor.query('SELECT id FROM projects WHERE id = ?', [parseInt(transaction.project_id)]);
      if (projectExists.length === 0) {
        throw new Error(`Project with ID ${transaction.project_id} does not exist`);
      }
    }

    const sql = `INSERT INTO transactions (date, amount, description, transaction_hash, category_id, company_id, project_id, account_id, type)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`;
    
    dbLogger.debug('Adding transaction with data:', {
      date: transaction.date,
      amount: transaction.amount,
      description: transaction.description,
      category_id: transaction.category_id,
      company_id: transaction.company_id,
      project_id: transaction.project_id,
      account_id: transaction.account_id,
      type: transaction.type
    });

    // Use the proper for await loop with statements iterator
    for await (const stmt of executor.sqlite3.statements(executor.db, sql)) {
      executor.sqlite3.bind_text(stmt, 1, transaction.date);
      executor.sqlite3.bind_double(stmt, 2, transaction.amount);
      executor.sqlite3.bind_text(stmt, 3, transaction.description);
      executor.sqlite3.bind_text(stmt, 4, transactionHash);
      
      if (transaction.category_id) {
        dbLogger.debug('Binding category_id as int', { 
          original: transaction.category_id, 
          parsed: parseInt(transaction.category_id) 
        });
        executor.sqlite3.bind_int(stmt, 5, parseInt(transaction.category_id));
      } else {
        dbLogger.debug('Binding category_id as NULL');
        executor.sqlite3.bind_null(stmt, 5);
      }
      
      if (transaction.company_id) {
        dbLogger.debug('Binding company_id as int', { 
          original: transaction.company_id, 
          parsed: parseInt(transaction.company_id) 
        });
        executor.sqlite3.bind_int(stmt, 6, parseInt(transaction.company_id));
      } else {
        dbLogger.debug('Binding company_id as NULL');
        executor.sqlite3.bind_null(stmt, 6);
      }
      
      if (transaction.project_id) {
        dbLogger.debug('Binding project_id as int', { 
          original: transaction.project_id, 
          parsed: parseInt(transaction.project_id) 
        });
        executor.sqlite3.bind_int(stmt, 7, parseInt(transaction.project_id));
      } else {
        dbLogger.debug('Binding project_id as NULL');
        executor.sqlite3.bind_null(stmt, 7);
      }
      
      if (transaction.account_id) {
        dbLogger.debug('Binding account_id as int', { 
          original: transaction.account_id, 
          parsed: parseInt(transaction.account_id) 
        });
        executor.sqlite3.bind_int(stmt, 8, parseInt(transaction.account_id));
      } else {
        dbLogger.debug('Binding account_id as NULL');
        executor.sqlite3.bind_null(stmt, 8);
      }
      
      executor.sqlite3.bind_text(stmt, 9, transaction.type);
      
      const result = await executor.sqlite3.step(stmt);
      
      const columnCount = executor.sqlite3.column_count(stmt);
      if (columnCount > 0) {
        const id = executor.sqlite3.column_int(stmt, 0);
        if (id && id > 0) {
          dbLogger.info(`Transaction inserted successfully with ID: ${id}`);
          return id.toString();
        }
      }
    }
    
    throw new Error('Failed to prepare statement');
  }

  static async getAll(executor: SQLiteExecutor): Promise<Transaction[]> {
    const rows = await executor.query('SELECT * FROM transactions ORDER BY date DESC, created_at DESC');
    return rows.map(row => ({
      id: row.id.toString(),
      date: row.date,
      amount: row.amount,
      description: row.description,
      category_id: row.category_id?.toString(),
      company_id: row.company_id?.toString(),
      project_id: row.project_id?.toString(),
      account_id: row.account_id?.toString() || '1', // fallback to default account
      account_last_four: row.account_last_four,
      transaction_hash: row.transaction_hash,
      type: row.type,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  static async getByDateRange(
    executor: SQLiteExecutor,
    startDate: string,
    endDate: string,
    type?: 'income' | 'expense'
  ): Promise<Transaction[]> {
    let sql = `SELECT * FROM transactions WHERE date >= '${startDate}' AND date <= '${endDate}'`;
    if (type) {
      sql += ` AND type = '${type}'`;
    }
    sql += ' ORDER BY date DESC';
    
    const rows = await executor.query(sql);
    return rows.map(row => ({
      id: row.id.toString(),
      date: row.date,
      amount: row.amount,
      description: row.description,
      category_id: row.category_id?.toString(),
      company_id: row.company_id?.toString(),
      project_id: row.project_id?.toString(),
      account_id: row.account_id?.toString() || '1', // fallback to default account
      account_last_four: row.account_last_four,
      transaction_hash: row.transaction_hash,
      type: row.type,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  static async getByProject(executor: SQLiteExecutor, projectId: string): Promise<Transaction[]> {
    const rows = await executor.query(`SELECT * FROM transactions WHERE project_id = ${projectId} ORDER BY date DESC`);
    return rows.map(row => ({
      id: row.id.toString(),
      date: row.date,
      amount: row.amount,
      description: row.description,
      category_id: row.category_id?.toString(),
      company_id: row.company_id?.toString(),
      project_id: row.project_id?.toString(),
      account_id: row.account_id?.toString() || '1', // fallback to default account
      account_last_four: row.account_last_four,
      transaction_hash: row.transaction_hash,
      type: row.type,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }
}

/**
 * Category CRUD operations
 */
export class CategoryQueries {
  static async getAll(executor: SQLiteExecutor): Promise<Category[]> {
    const rows = await executor.query('SELECT * FROM categories ORDER BY name');
    return rows.map(row => ({
      id: row.id.toString(),
      name: row.name,
      type: row.type,
      color: row.color,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  static async create(
    executor: SQLiteExecutor,
    category: Omit<Category, 'id' | 'created_at' | 'updated_at'>
  ): Promise<string> {
    const sql = `INSERT INTO categories (name, type, color) VALUES (?, ?, ?) RETURNING id`;
    
    for await (const stmt of executor.sqlite3.statements(executor.db, sql)) {
      executor.sqlite3.bind_text(stmt, 1, category.name);
      executor.sqlite3.bind_text(stmt, 2, category.type);
      executor.sqlite3.bind_text(stmt, 3, category.color);
      
      const result = await executor.sqlite3.step(stmt);
      
      const columnCount = executor.sqlite3.column_count(stmt);
      if (columnCount > 0) {
        const id = executor.sqlite3.column_int(stmt, 0);
        if (id && id > 0) {
          dbLogger.debug(`Category created with ID: ${id}`);
          return id.toString();
        }
      }
    }

    throw new Error('Failed to create category or retrieve ID');
  }
}

/**
 * Company CRUD operations
 */
export class CompanyQueries {
  static async getAll(executor: SQLiteExecutor): Promise<Company[]> {
    const rows = await executor.query('SELECT * FROM companies ORDER BY name');
    return rows.map(row => ({
      id: row.id.toString(),
      name: row.name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  static async create(executor: SQLiteExecutor, name: string): Promise<string> {
    const sql = `INSERT INTO companies (name) VALUES (?) RETURNING id`;
    
    for await (const stmt of executor.sqlite3.statements(executor.db, sql)) {
      executor.sqlite3.bind_text(stmt, 1, name);
      
      const result = await executor.sqlite3.step(stmt);
      
      const columnCount = executor.sqlite3.column_count(stmt);
      if (columnCount > 0) {
        const id = executor.sqlite3.column_int(stmt, 0);
        if (id && id > 0) {
          dbLogger.debug(`Company created with ID: ${id}`);
          return id.toString();
        }
      }
    }

    throw new Error('Failed to create company or retrieve ID');
  }

  static async findByName(executor: SQLiteExecutor, name: string): Promise<Company | null> {
    const rows = await executor.query(`SELECT * FROM companies WHERE name = ?`, [name]);
    if (rows.length === 0) return null;
    
    const row = rows[0];
    return {
      id: row.id.toString(),
      name: row.name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

/**
 * Account CRUD operations
 */
export class AccountQueries {
  static async getAll(executor: SQLiteExecutor): Promise<Account[]> {
    const rows = await executor.query('SELECT * FROM accounts ORDER BY name');
    return rows.map(row => ({
      id: row.id.toString(),
      name: row.name,
      type: row.type,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  static async create(
    executor: SQLiteExecutor,
    account: Omit<Account, 'id' | 'created_at' | 'updated_at'>
  ): Promise<string> {
    // First, try the RETURNING approach
    const sqlWithReturning = `INSERT INTO accounts (name, type) VALUES (?, ?) RETURNING id`;
    
    try {
      for await (const stmt of executor.sqlite3.statements(executor.db, sqlWithReturning)) {
        executor.sqlite3.bind_text(stmt, 1, account.name);
        executor.sqlite3.bind_text(stmt, 2, account.type);
        
        const result = await executor.sqlite3.step(stmt);
        
        // Check if we have columns regardless of the step result
        const columnCount = executor.sqlite3.column_count(stmt);
        
        if (columnCount > 0) {
          const id = executor.sqlite3.column_int(stmt, 0);
          
          if (id && id > 0) {
            dbLogger.debug(`Account created with ID via RETURNING: ${id}`);
            return id.toString();
          }
          
          const idText = executor.sqlite3.column_text(stmt, 0);
          
          if (idText) {
            dbLogger.debug(`Account created with ID via RETURNING (text): ${idText}`);
            return idText;
          }
        }
      }
    } catch (error) {
      dbLogger.warn('RETURNING clause failed, trying fallback method:', error);
    }
    
    // Fallback: Insert without RETURNING and then query for the ID
    const sqlInsert = `INSERT INTO accounts (name, type) VALUES (?, ?)`;
    
    for await (const stmt of executor.sqlite3.statements(executor.db, sqlInsert)) {
      executor.sqlite3.bind_text(stmt, 1, account.name);
      executor.sqlite3.bind_text(stmt, 2, account.type);
      
      await executor.sqlite3.step(stmt);
    }
    
    // Query for the most recently inserted account with matching data
    const newAccounts = await executor.query(
      'SELECT id FROM accounts WHERE name = ? AND type = ? ORDER BY id DESC LIMIT 1',
      [account.name, account.type]
    );
    
    if (newAccounts.length > 0) {
      const id = newAccounts[0].id;
      dbLogger.debug('Account created with ID via fallback:', id);
      return id.toString();
    }

    throw new Error('Failed to create account or retrieve ID');
  }

  static async delete(executor: SQLiteExecutor, id: string): Promise<void> {
    // First check if there are any transactions linked to this account
    const linkedTransactions = await executor.query('SELECT COUNT(*) as count FROM transactions WHERE account_id = ?', [parseInt(id)]);
    
    if (linkedTransactions[0]?.count > 0) {
      throw new Error(`Cannot delete account. It has ${linkedTransactions[0].count} linked transactions. Please delete or reassign the transactions first.`);
    }

    await executor.exec(`DELETE FROM accounts WHERE id = ${parseInt(id)}`);
    dbLogger.debug(`Account with ID ${id} deleted successfully`);
  }
}

/**
 * Budget CRUD operations
 */
export class BudgetQueries {
  static async getAll(executor: SQLiteExecutor): Promise<Budget[]> {
    const rows = await executor.query('SELECT * FROM budgets ORDER BY start_date DESC');
    return rows.map(row => ({
      id: row.id.toString(),
      category_id: row.category_id.toString(),
      amount: row.amount,
      period: row.period,
      start_date: row.start_date,
      end_date: row.end_date,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  static async create(
    executor: SQLiteExecutor,
    budget: Omit<Budget, 'id' | 'created_at' | 'updated_at'>
  ): Promise<string> {
    const sql = `INSERT INTO budgets (category_id, amount, period, start_date, end_date) VALUES (?, ?, ?, ?, ?) RETURNING id`;
    
    for await (const stmt of executor.sqlite3.statements(executor.db, sql)) {
      executor.sqlite3.bind_int(stmt, 1, parseInt(budget.category_id));
      executor.sqlite3.bind_double(stmt, 2, budget.amount);
      executor.sqlite3.bind_text(stmt, 3, budget.period);
      executor.sqlite3.bind_text(stmt, 4, budget.start_date);
      executor.sqlite3.bind_text(stmt, 5, budget.end_date);
      
      const result = await executor.sqlite3.step(stmt);
      
      const columnCount = executor.sqlite3.column_count(stmt);
      if (columnCount > 0) {
        const id = executor.sqlite3.column_int(stmt, 0);
        if (id && id > 0) {
          dbLogger.debug(`Budget created with ID: ${id}`);
          return id.toString();
        }
      }
    }

    throw new Error('Failed to create budget or retrieve ID');
  }
}

/**
 * Project CRUD operations
 */
export class ProjectQueries {
  static async getAll(executor: SQLiteExecutor): Promise<Project[]> {
    const rows = await executor.query('SELECT * FROM projects ORDER BY name');
    return rows.map(row => ({
      id: row.id.toString(),
      name: row.name,
      company_name: row.company_name,
      contact_details: row.contact_details,
      project_category: row.project_category,
      status: row.status,
      start_date: row.start_date,
      end_date: row.end_date,
      estimated_cost: row.estimated_cost,
      actual_cost: row.actual_cost,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  static async create(
    executor: SQLiteExecutor,
    project: Omit<Project, 'id' | 'created_at' | 'updated_at'>
  ): Promise<string> {
    const sql = `INSERT INTO projects (name, company_name, contact_details, project_category, status, start_date, end_date, estimated_cost, actual_cost, notes) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`;
    
    for await (const stmt of executor.sqlite3.statements(executor.db, sql)) {
      executor.sqlite3.bind_text(stmt, 1, project.name);
      executor.sqlite3.bind_text(stmt, 2, project.company_name);
      executor.sqlite3.bind_text(stmt, 3, project.contact_details || '');
      executor.sqlite3.bind_text(stmt, 4, project.project_category);
      executor.sqlite3.bind_text(stmt, 5, project.status);
      executor.sqlite3.bind_text(stmt, 6, project.start_date || '');
      executor.sqlite3.bind_text(stmt, 7, project.end_date || '');
      
      if (project.estimated_cost !== null && project.estimated_cost !== undefined) {
        executor.sqlite3.bind_double(stmt, 8, project.estimated_cost);
      } else {
        executor.sqlite3.bind_null(stmt, 8);
      }
      
      if (project.actual_cost !== null && project.actual_cost !== undefined) {
        executor.sqlite3.bind_double(stmt, 9, project.actual_cost);
      } else {
        executor.sqlite3.bind_null(stmt, 9);
      }
      
      executor.sqlite3.bind_text(stmt, 10, project.notes || '');
      
      const result = await executor.sqlite3.step(stmt);
      
      const columnCount = executor.sqlite3.column_count(stmt);
      if (columnCount > 0) {
        const id = executor.sqlite3.column_int(stmt, 0);
        if (id && id > 0) {
          dbLogger.debug(`Project created with ID: ${id}`);
          return id.toString();
        }
      }
    }

    throw new Error('Failed to create project or retrieve ID');
  }

  static async getById(executor: SQLiteExecutor, id: string): Promise<Project | null> {
    const rows = await executor.query(`SELECT * FROM projects WHERE id = ${id}`);
    if (rows.length === 0) return null;
    
    const row = rows[0];
    return {
      id: row.id.toString(),
      name: row.name,
      company_name: row.company_name,
      contact_details: row.contact_details,
      project_category: row.project_category,
      status: row.status,
      start_date: row.start_date,
      end_date: row.end_date,
      estimated_cost: row.estimated_cost,
      actual_cost: row.actual_cost,
      notes: row.notes,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  static async update(
    executor: SQLiteExecutor,
    id: string,
    updates: Partial<Omit<Project, 'id' | 'created_at' | 'updated_at'>>
  ): Promise<void> {
    const setParts: string[] = [];
    if (updates.name) setParts.push(`name = '${updates.name}'`);
    if (updates.company_name) setParts.push(`company_name = '${updates.company_name}'`);
    if (updates.contact_details !== undefined) setParts.push(`contact_details = '${updates.contact_details}'`);
    if (updates.project_category) setParts.push(`project_category = '${updates.project_category}'`);
    if (updates.status) setParts.push(`status = '${updates.status}'`);
    if (updates.start_date !== undefined) setParts.push(`start_date = '${updates.start_date}'`);
    if (updates.end_date !== undefined) setParts.push(`end_date = '${updates.end_date}'`);
    if (updates.estimated_cost !== undefined) setParts.push(`estimated_cost = ${updates.estimated_cost || 'NULL'}`);
    if (updates.actual_cost !== undefined) setParts.push(`actual_cost = ${updates.actual_cost || 'NULL'}`);
    if (updates.notes !== undefined) setParts.push(`notes = '${updates.notes}'`);
    setParts.push(`updated_at = '${new Date().toISOString()}'`);
    
    const sql = `UPDATE projects SET ${setParts.join(', ')} WHERE id = ${id}`;
    await executor.exec(sql);
  }

  static async delete(executor: SQLiteExecutor, id: string): Promise<void> {
    await executor.exec(`DELETE FROM projects WHERE id = ${id}`);
  }

  static async getCosts(
    executor: SQLiteExecutor,
    projectId: string
  ): Promise<{ estimated: number; actual: number; transactions_total: number }> {
    const projectRows = await executor.query(`SELECT estimated_cost, actual_cost FROM projects WHERE id = ${projectId}`);
    const transactionRows = await executor.query(`SELECT SUM(amount) as total FROM transactions WHERE project_id = ${projectId} AND type = 'expense'`);
    
    const project = projectRows[0] || {};
    const transactionTotal = transactionRows[0]?.total || 0;
    
    return {
      estimated: project.estimated_cost || 0,
      actual: project.actual_cost || 0,
      transactions_total: transactionTotal
    };
  }
}

/**
 * Analytics and reporting queries
 */
export class AnalyticsQueries {
  static async getSpendingByCategory(
    executor: SQLiteExecutor,
    startDate: string,
    endDate: string
  ): Promise<{ category_id: string; category_name: string; total: number; color: string }[]> {
    const rows = await executor.query(`
      SELECT c.id as category_id, c.name as category_name, c.color, SUM(t.amount) as total
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE t.date >= '${startDate}' AND t.date <= '${endDate}' AND t.type = 'expense'
      GROUP BY c.id, c.name, c.color
      ORDER BY total DESC
    `);
    
    return rows.map(row => ({
      category_id: row.category_id.toString(),
      category_name: row.category_name,
      total: row.total,
      color: row.color
    }));
  }

  static async getIncomeByCategory(
    executor: SQLiteExecutor,
    startDate: string,
    endDate: string
  ): Promise<{ category_id: string; category_name: string; total: number; color: string }[]> {
    const rows = await executor.query(`
      SELECT c.id as category_id, c.name as category_name, c.color, SUM(t.amount) as total
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      WHERE t.date >= '${startDate}' AND t.date <= '${endDate}' AND t.type = 'income'
      GROUP BY c.id, c.name, c.color
      ORDER BY total DESC
    `);
    
    return rows.map(row => ({
      category_id: row.category_id.toString(),
      category_name: row.category_name,
      total: row.total,
      color: row.color
    }));
  }

  static async getMonthlyTrends(
    executor: SQLiteExecutor,
    months: number = 12
  ): Promise<{ month: string; income: number; expense: number }[]> {
    // TODO: Implement monthly trends analysis
    // This is a placeholder for the monthly trends functionality
    return [];
  }
}

/**
 * Utility functions for database operations
 */
export class DatabaseUtils {
  static async executeCustomQuery(executor: SQLiteExecutor, sql: string): Promise<any[]> {
    // Sanitize the query to prevent dangerous operations
    const trimmedSql = sql.trim().toLowerCase();
    
    // Block potentially dangerous operations
    const dangerousKeywords = ['drop', 'delete', 'update', 'insert', 'alter', 'create', 'truncate'];
    const isDangerous = dangerousKeywords.some(keyword => 
      trimmedSql.includes(keyword + ' ') || trimmedSql.startsWith(keyword)
    );
    
    if (isDangerous) {
      throw new Error('Only SELECT queries are allowed for security reasons');
    }

    // Execute the query
    return await executor.query(sql);
  }

  static async checkForExistingIndexedDB(): Promise<boolean> {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return false;
    }

    try {
      const databases = await indexedDB.databases();
      return databases.some(db => db.name === 'ptbudgetapp');
    } catch (error) {
      dbLogger.warn('Failed to check for existing IndexedDB databases:', error);
      return false;
    }
  }
}

/**
 * Account Alias CRUD operations
 */
export class AccountAliasQueries {
  static async getAll(executor: SQLiteExecutor): Promise<AccountAlias[]> {
    const rows = await executor.query('SELECT * FROM account_aliases ORDER BY account_id, last_four');
    return rows.map(row => ({
      id: row.id.toString(),
      account_id: row.account_id.toString(),
      last_four: row.last_four,
      alias_name: row.alias_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  static async getByAccountId(executor: SQLiteExecutor, accountId: string): Promise<AccountAlias[]> {
    const rows = await executor.query('SELECT * FROM account_aliases WHERE account_id = ? ORDER BY last_four', [parseInt(accountId)]);
    return rows.map(row => ({
      id: row.id.toString(),
      account_id: row.account_id.toString(),
      last_four: row.last_four,
      alias_name: row.alias_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  static async findByLastFour(executor: SQLiteExecutor, lastFour: string): Promise<AccountAlias[]> {
    const rows = await executor.query('SELECT * FROM account_aliases WHERE last_four = ?', [lastFour]);
    return rows.map(row => ({
      id: row.id.toString(),
      account_id: row.account_id.toString(),
      last_four: row.last_four,
      alias_name: row.alias_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  static async create(
    executor: SQLiteExecutor,
    alias: Omit<AccountAlias, 'id' | 'created_at' | 'updated_at'>
  ): Promise<string> {
    // First, try the RETURNING approach
    const sqlWithReturning = `INSERT INTO account_aliases (account_id, last_four, alias_name) VALUES (?, ?, ?) RETURNING id`;
    
    try {
      for await (const stmt of executor.sqlite3.statements(executor.db, sqlWithReturning)) {
        executor.sqlite3.bind_int(stmt, 1, parseInt(alias.account_id));
        executor.sqlite3.bind_text(stmt, 2, alias.last_four);
        executor.sqlite3.bind_text(stmt, 3, alias.alias_name || null);
        
        const result = await executor.sqlite3.step(stmt);
        
        // Check if we have columns regardless of the step result
        const columnCount = executor.sqlite3.column_count(stmt);
        
        if (columnCount > 0) {
          const id = executor.sqlite3.column_int(stmt, 0);
          
          if (id && id > 0) {
            dbLogger.debug(`Account alias created with ID via RETURNING: ${id}`);
            return id.toString();
          }
          
          const idText = executor.sqlite3.column_text(stmt, 0);
          
          if (idText) {
            dbLogger.debug(`Account alias created with ID via RETURNING (text): ${idText}`);
            return idText;
          }
        }
      }
    } catch (error) {
      dbLogger.warn('RETURNING clause failed, trying fallback method:', error);
    }
    
    // Fallback: Insert without RETURNING and then query for the ID
    const sqlInsert = `INSERT INTO account_aliases (account_id, last_four, alias_name) VALUES (?, ?, ?)`;
    
    for await (const stmt of executor.sqlite3.statements(executor.db, sqlInsert)) {
      executor.sqlite3.bind_int(stmt, 1, parseInt(alias.account_id));
      executor.sqlite3.bind_text(stmt, 2, alias.last_four);
      executor.sqlite3.bind_text(stmt, 3, alias.alias_name || null);
      
      await executor.sqlite3.step(stmt);
    }
    
    // Query for the most recently inserted alias with matching data
    const newAliases = await executor.query(
      'SELECT id FROM account_aliases WHERE account_id = ? AND last_four = ? ORDER BY id DESC LIMIT 1',
      [parseInt(alias.account_id), alias.last_four]
    );
    
    if (newAliases.length > 0) {
      const id = newAliases[0].id;
      dbLogger.debug('Account alias created with ID via fallback:', id);
      return id.toString();
    }

    throw new Error('Failed to create account alias or retrieve ID');
  }

  static async update(
    executor: SQLiteExecutor,
    id: string,
    alias: Partial<Omit<AccountAlias, 'id' | 'created_at' | 'updated_at'>>
  ): Promise<void> {
    const updates: string[] = [];
    const values: any[] = [];

    if (alias.last_four !== undefined) {
      updates.push('last_four = ?');
      values.push(alias.last_four);
    }

    if (alias.alias_name !== undefined) {
      updates.push('alias_name = ?');
      values.push(alias.alias_name);
    }

    if (updates.length === 0) {
      throw new Error('No fields to update');
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(parseInt(id));

    const sql = `UPDATE account_aliases SET ${updates.join(', ')} WHERE id = ?`;
    await executor.exec(sql);
  }

  static async delete(executor: SQLiteExecutor, id: string): Promise<void> {
    await executor.exec(`DELETE FROM account_aliases WHERE id = ${parseInt(id)}`);
    dbLogger.debug(`Account alias with ID ${id} deleted successfully`);
  }

  static async deleteByAccountId(executor: SQLiteExecutor, accountId: string): Promise<void> {
    await executor.exec(`DELETE FROM account_aliases WHERE account_id = ${parseInt(accountId)}`);
    dbLogger.debug(`All aliases for account ID ${accountId} deleted successfully`);
  }
}
