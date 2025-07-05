"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from "react";

import type {
  Transaction,
  Category,
  Company,
  Account,
  Budget,
  Project,
} from "../types/database";
import { dbLogger, appLogger } from "../lib/logger";

// WA-SQLite Database Manager using OPFSAnyContextVFS
class WaSQLiteDatabaseManager {
  private sqlite3: any = null;
  private db: number = 0;
  private vfs: any = null;
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // Only initialize in browser context
    if (typeof window === 'undefined') {
      throw new Error('WA-SQLite requires browser environment');
    }

    try {
      dbLogger.info('Loading WA-SQLite modules...');
      
      // Use dynamic function to avoid build-time module resolution
      const importModule = new Function('path', 'return import(path)');
      
      dbLogger.info('Loading SQLite async module...');
      const sqliteModule = await importModule('/wa-sqlite/wa-sqlite-async.mjs');
      const SQLiteModule = sqliteModule.default;
      
      dbLogger.info('Loading SQLite API...');
      const apiModule = await importModule('/wa-sqlite/src/sqlite-api.js');
      const { Factory } = apiModule;
      
      dbLogger.info('Loading IDB Atomic VFS...');
      const vfsModule = await importModule('/wa-sqlite/src/examples/IDBBatchAtomicVFS.js');
      const { IDBBatchAtomicVFS } = vfsModule;

      dbLogger.info('Initializing SQLite WASM module...');
      const wasmModule = await SQLiteModule();
      
      dbLogger.info('Creating SQLite API...');
      this.sqlite3 = Factory(wasmModule);

      dbLogger.info('Creating IDB VFS...');
      this.vfs = await IDBBatchAtomicVFS.create('ptbudgetapp', wasmModule);

      dbLogger.info('Registering IDB VFS...');
      this.sqlite3.vfs_register(this.vfs, true);
      
      this.isInitialized = true;
      dbLogger.info('Initialization complete');
    } catch (error) {
      dbLogger.error('Initialization failed:', error);
      throw new Error(`Failed to initialize WA-SQLite: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  
  async openDatabase(filename: string = '/budget-app.db'): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      dbLogger.info(`Opening database: ${filename}`);
      
      this.db = await this.sqlite3.open_v2(
        filename,
        this.sqlite3.SQLITE_OPEN_CREATE | this.sqlite3.SQLITE_OPEN_READWRITE,
        this.vfs.name
      );
      
      if (!this.db) {
        throw new Error('Failed to open database');
      }

      dbLogger.info(`Database opened successfully with handle: ${this.db}`);
      
      // Configure database for optimal performance and consistency
      await this.sqlite3.exec(this.db, 'PRAGMA journal_mode=DELETE');
      await this.sqlite3.exec(this.db, 'PRAGMA synchronous=NORMAL');
      await this.sqlite3.exec(this.db, 'PRAGMA foreign_keys=ON');
      
      await this.createTables();
      dbLogger.info('Database ready for use');
    } catch (error) {
      dbLogger.error('Failed to open database:', error);
      throw error;
    }
  }

  private async createTables(): Promise<void> {
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
        last_four TEXT NOT NULL,
        type TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
        category_id INTEGER,
        company_id INTEGER,
        project_id INTEGER,
        account_last_four TEXT,
        type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories (id),
        FOREIGN KEY (company_id) REFERENCES companies (id),
        FOREIGN KEY (project_id) REFERENCES projects (id)
      )`
    ];

    for (const sql of tables) {
      await this.sqlite3.exec(this.db, sql);
    }

    // Insert default categories if none exist
    const categoryCount = await this.query('SELECT COUNT(*) as count FROM categories');
    if (categoryCount[0]?.count === 0) {
      dbLogger.info('No categories found, inserting default categories...');
      await this.insertDefaultCategories();
    } else {
      dbLogger.info(`Found ${categoryCount[0].count} existing categories`);
    }
    
    // Log available categories for debugging
    const allCategories = await this.query('SELECT id, name, type FROM categories');
    dbLogger.debug('Available categories:', allCategories);
  }

  private async insertDefaultCategories(): Promise<void> {
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
      await this.sqlite3.exec(this.db, 
        `INSERT INTO categories (name, type, color) VALUES ('${category.name}', '${category.type}', '${category.color}')`
      );
    }
  }

  private async query(sql: string, parameters: any[] = []): Promise<any[]> {
    const results: any[] = [];
    
    // Prepare the statement if parameters are provided
    if (parameters.length > 0) {
      // Use the proper for await loop with statements iterator
      for await (const stmt of this.sqlite3.statements(this.db, sql)) {
        // Bind parameters
        for (let i = 0; i < parameters.length; i++) {
          const param = parameters[i];
          if (param === null || param === undefined) {
            this.sqlite3.bind_null(stmt, i + 1);
          } else if (typeof param === 'number') {
            if (Number.isInteger(param)) {
              this.sqlite3.bind_int(stmt, i + 1, param);
            } else {
              this.sqlite3.bind_double(stmt, i + 1, param);
            }
          } else if (typeof param === 'string') {
            this.sqlite3.bind_text(stmt, i + 1, param);
          } else {
            this.sqlite3.bind_text(stmt, i + 1, String(param));
          }
        }
        
        // Execute and collect results
        const columnNames: string[] = [];
        while (await this.sqlite3.step(stmt) === this.sqlite3.SQLITE_ROW) {
          if (columnNames.length === 0) {
            // Get column names on first row
            const columnCount = this.sqlite3.column_count(stmt);
            for (let i = 0; i < columnCount; i++) {
              columnNames.push(this.sqlite3.column_name(stmt, i));
            }
          }
          
          const row: any = {};
          columnNames.forEach((column, index) => {
            const value = this.sqlite3.column(stmt, index);
            row[column] = value;
          });
          results.push(row);
        }
        // Statement is automatically finalized by the iterator
      }
    } else {
      // Use exec for simple queries without parameters
      await this.sqlite3.exec(this.db, sql, (row: any, columns: string[]) => {
        const rowObj: any = {};
        columns.forEach((column, index) => {
          rowObj[column] = row[index];
        });
        results.push(rowObj);
      });
    }
    
    return results;
  }

  // Database interface methods required by the context
  async hasExistingDatabase(): Promise<boolean> {
    return this.isInitialized && this.db !== 0;
  }

  

  async openExistingDatabase(): Promise<void> {
    await this.openDatabase();
  }

  async createNewDatabase(): Promise<void> {
    await this.openDatabase();
  }

  async loadDatabaseFromFile(file: File): Promise<void> {
    throw new Error('File loading not yet implemented');
  }

  async exportDatabase(): Promise<Uint8Array> {
    throw new Error('Database export not yet implemented');
  }

  // Transaction operations
  async addTransactionAsync(transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>): Promise<void> {
    // Validate foreign key references first
    if (transaction.category_id) {
      const categoryExists = await this.query('SELECT id FROM categories WHERE id = ?', [parseInt(transaction.category_id)]);
      if (categoryExists.length === 0) {
        throw new Error(`Category with ID ${transaction.category_id} does not exist`);
      }
    }

    if (transaction.company_id) {
      const companyExists = await this.query('SELECT id FROM companies WHERE id = ?', [parseInt(transaction.company_id)]);
      if (companyExists.length === 0) {
        throw new Error(`Company with ID ${transaction.company_id} does not exist`);
      }
    }

    if (transaction.project_id) {
      const projectExists = await this.query('SELECT id FROM projects WHERE id = ?', [parseInt(transaction.project_id)]);
      if (projectExists.length === 0) {
        throw new Error(`Project with ID ${transaction.project_id} does not exist`);
      }
    }

    const sql = `INSERT INTO transactions (date, amount, description, category_id, company_id, project_id, account_last_four, type)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    
    dbLogger.debug('Adding transaction with data:', {
      date: transaction.date,
      amount: transaction.amount,
      description: transaction.description,
      category_id: transaction.category_id,
      company_id: transaction.company_id,
      project_id: transaction.project_id,
      account_last_four: transaction.account_last_four,
      type: transaction.type
    });

    // Use the proper for await loop with statements iterator
    for await (const stmt of this.sqlite3.statements(this.db, sql)) {
      this.sqlite3.bind_text(stmt, 1, transaction.date);
      this.sqlite3.bind_double(stmt, 2, transaction.amount);
      this.sqlite3.bind_text(stmt, 3, transaction.description);
      
      if (transaction.category_id) {
        dbLogger.debug('Binding category_id as int', { 
          original: transaction.category_id, 
          parsed: parseInt(transaction.category_id) 
        });
        this.sqlite3.bind_int(stmt, 4, parseInt(transaction.category_id));
      } else {
        dbLogger.debug('Binding category_id as NULL');
        this.sqlite3.bind_null(stmt, 4);
      }
      
      if (transaction.company_id) {
        dbLogger.debug('Binding company_id as int', { 
          original: transaction.company_id, 
          parsed: parseInt(transaction.company_id) 
        });
        this.sqlite3.bind_int(stmt, 5, parseInt(transaction.company_id));
      } else {
        dbLogger.debug('Binding company_id as NULL');
        this.sqlite3.bind_null(stmt, 5);
      }
      
      if (transaction.project_id) {
        dbLogger.debug('Binding project_id as int', { 
          original: transaction.project_id, 
          parsed: parseInt(transaction.project_id) 
        });
        this.sqlite3.bind_int(stmt, 6, parseInt(transaction.project_id));
      } else {
        dbLogger.debug('Binding project_id as NULL');
        this.sqlite3.bind_null(stmt, 6);
      }
      
      this.sqlite3.bind_text(stmt, 7, transaction.account_last_four);
      this.sqlite3.bind_text(stmt, 8, transaction.type);
      
      await this.sqlite3.step(stmt);
      dbLogger.info('Transaction inserted successfully');
      // Statement is automatically finalized by the iterator
      return;
    }
    
    throw new Error('Failed to prepare statement');
  }

  async getTransactionsAsync(): Promise<Transaction[]> {
    const rows = await this.query('SELECT * FROM transactions ORDER BY date DESC, created_at DESC');
    return rows.map(row => ({
      id: row.id.toString(),
      date: row.date,
      amount: row.amount,
      description: row.description,
      category_id: row.category_id?.toString(),
      company_id: row.company_id?.toString(),
      project_id: row.project_id?.toString(),
      account_last_four: row.account_last_four,
      type: row.type,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  // Category operations
  async getCategoriesAsync(): Promise<Category[]> {
    const rows = await this.query('SELECT * FROM categories ORDER BY name');
    return rows.map(row => ({
      id: row.id.toString(),
      name: row.name,
      type: row.type,
      color: row.color,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  async addCategoryAsync(category: Omit<Category, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    const sql = `INSERT INTO categories (name, type, color) VALUES (?, ?, ?)`;
    
    // Use the proper for await loop with statements iterator
    for await (const stmt of this.sqlite3.statements(this.db, sql)) {
      this.sqlite3.bind_text(stmt, 1, category.name);
      this.sqlite3.bind_text(stmt, 2, category.type);
      this.sqlite3.bind_text(stmt, 3, category.color);
      await this.sqlite3.step(stmt);
      // Statement is automatically finalized by the iterator
      return this.sqlite3.last_insert_rowid(this.db).toString();
    }
    
    throw new Error('Failed to prepare statement');
  }

  // Company operations
  async getCompaniesAsync(): Promise<Company[]> {
    const rows = await this.query('SELECT * FROM companies ORDER BY name');
    return rows.map(row => ({
      id: row.id.toString(),
      name: row.name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  async addCompanyAsync(name: string): Promise<string> {
    const sql = `INSERT INTO companies (name) VALUES (?)`;
    
    // Use the proper for await loop with statements iterator
    for await (const stmt of this.sqlite3.statements(this.db, sql)) {
      this.sqlite3.bind_text(stmt, 1, name);
      await this.sqlite3.step(stmt);
      // Statement is automatically finalized by the iterator
      return this.sqlite3.last_insert_rowid(this.db).toString();
    }
    
    throw new Error('Failed to prepare statement');
  }

  async findCompanyByNameAsync(name: string): Promise<Company | null> {
    const rows = await this.query(`SELECT * FROM companies WHERE name = ?`, [name]);
    if (rows.length === 0) return null;
    
    const row = rows[0];
    return {
      id: row.id.toString(),
      name: row.name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }

  // Account operations
  async getAccountsAsync(): Promise<Account[]> {
    const rows = await this.query('SELECT * FROM accounts ORDER BY name');
    return rows.map(row => ({
      id: row.id.toString(),
      name: row.name,
      last_four: row.last_four,
      type: row.type,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  async addAccountAsync(account: Omit<Account, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    await this.sqlite3.exec(this.db,
      `INSERT INTO accounts (name, last_four, type) VALUES ('${account.name}', '${account.last_four}', '${account.type}')`
    );
    return this.sqlite3.last_insert_rowid(this.db).toString();
  }

  // Budget operations
  async getBudgetsAsync(): Promise<Budget[]> {
    const rows = await this.query('SELECT * FROM budgets ORDER BY start_date DESC');
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

  async addBudgetAsync(budget: Omit<Budget, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    await this.sqlite3.exec(this.db,
      `INSERT INTO budgets (category_id, amount, period, start_date, end_date) VALUES (${budget.category_id}, ${budget.amount}, '${budget.period}', '${budget.start_date}', '${budget.end_date}')`
    );
    return this.sqlite3.last_insert_rowid(this.db).toString();
  }

  // Project operations
  async getProjectsAsync(): Promise<Project[]> {
    const rows = await this.query('SELECT * FROM projects ORDER BY name');
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

  async addProjectAsync(project: Omit<Project, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    await this.sqlite3.exec(this.db,
      `INSERT INTO projects (name, company_name, contact_details, project_category, status, start_date, end_date, estimated_cost, actual_cost, notes) 
       VALUES ('${project.name}', '${project.company_name}', '${project.contact_details}', '${project.project_category}', '${project.status}', '${project.start_date || ''}', '${project.end_date || ''}', ${project.estimated_cost || 'NULL'}, ${project.actual_cost || 'NULL'}, '${project.notes || ''}')`
    );
    return this.sqlite3.last_insert_rowid(this.db).toString();
  }

  async getProjectByIdAsync(id: string): Promise<Project | null> {
    const rows = await this.query(`SELECT * FROM projects WHERE id = ${id}`);
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

  async updateProjectAsync(id: string, updates: Partial<Omit<Project, 'id' | 'created_at' | 'updated_at'>>): Promise<void> {
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
    await this.sqlite3.exec(this.db, sql);
  }

  async deleteProjectAsync(id: string): Promise<void> {
    await this.sqlite3.exec(this.db, `DELETE FROM projects WHERE id = ${id}`);
  }

  async getTransactionsByProjectAsync(projectId: string): Promise<Transaction[]> {
    const rows = await this.query(`SELECT * FROM transactions WHERE project_id = ${projectId} ORDER BY date DESC`);
    return rows.map(row => ({
      id: row.id.toString(),
      date: row.date,
      amount: row.amount,
      description: row.description,
      category_id: row.category_id?.toString(),
      company_id: row.company_id?.toString(),
      project_id: row.project_id?.toString(),
      account_last_four: row.account_last_four,
      type: row.type,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  async getProjectCostsAsync(projectId: string): Promise<{ estimated: number; actual: number; transactions_total: number }> {
    const projectRows = await this.query(`SELECT estimated_cost, actual_cost FROM projects WHERE id = ${projectId}`);
    const transactionRows = await this.query(`SELECT SUM(amount) as total FROM transactions WHERE project_id = ${projectId} AND type = 'expense'`);
    
    const project = projectRows[0] || {};
    const transactionTotal = transactionRows[0]?.total || 0;
    
    return {
      estimated: project.estimated_cost || 0,
      actual: project.actual_cost || 0,
      transactions_total: transactionTotal
    };
  }

  // Analytics methods (simplified)
  async getTransactionsByDateRange(startDate: string, endDate: string, type?: 'income' | 'expense'): Promise<Transaction[]> {
    let sql = `SELECT * FROM transactions WHERE date >= '${startDate}' AND date <= '${endDate}'`;
    if (type) {
      sql += ` AND type = '${type}'`;
    }
    sql += ' ORDER BY date DESC';
    
    const rows = await this.query(sql);
    return rows.map(row => ({
      id: row.id.toString(),
      date: row.date,
      amount: row.amount,
      description: row.description,
      category_id: row.category_id?.toString(),
      company_id: row.company_id?.toString(),
      project_id: row.project_id?.toString(),
      account_last_four: row.account_last_four,
      type: row.type,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));
  }

  async getSpendingByCategoryAsync(startDate: string, endDate: string): Promise<{ category_id: string; category_name: string; total: number; color: string }[]> {
    const rows = await this.query(`
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

  async getIncomeByCategoryAsync(startDate: string, endDate: string): Promise<{ category_id: string; category_name: string; total: number; color: string }[]> {
    const rows = await this.query(`
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

  async getMonthlyTrendsAsync(months: number = 12): Promise<{ month: string; income: number; expense: number }[]> {
    // Simplified implementation
    return [];
  }

  // Custom SQL query execution for advanced users
  async executeCustomQuery(sql: string): Promise<any[]> {
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
    return await this.query(sql);
  }
}

interface DatabaseContextType {
  // Database instance
  isInitialized: boolean;
  isDatabaseLoaded: boolean;

  // Loading states
  isLoading: boolean;
  error: string | null;
  
  // Data
  transactions: Transaction[];
  categories: Category[];
  companies: Company[];
  accounts: Account[];
  budgets: Budget[];
  projects: Project[];
  
  // Database operations
  initializeDatabase: () => Promise<void>;
  createOrOpenDatabase: (isNew: boolean) => Promise<void>;
  loadDatabaseFromFile: (file: File) => Promise<void>;
  exportDatabase: () => Promise<Uint8Array | null>;

  // Transaction operations
  addTransaction: (
    transaction: Omit<Transaction, "id" | "created_at" | "updated_at">
  ) => Promise<void>;
  refreshTransactions: () => void;

  // Category operations
  addCategory: (
    category: Omit<Category, "id" | "created_at" | "updated_at">
  ) => Promise<string>;
  refreshCategories: () => void;

  // Company operations
  addCompany: (name: string) => Promise<string>;
  findOrCreateCompany: (name: string) => Promise<string>;
  refreshCompanies: () => void;

  // Account operations
  addAccount: (
    account: Omit<Account, "id" | "created_at" | "updated_at">
  ) => Promise<string>;
  refreshAccounts: () => void;

  // Budget operations
  addBudget: (
    budget: Omit<Budget, "id" | "created_at" | "updated_at">
  ) => Promise<string>;
  refreshBudgets: () => void;

  // Project operations
  addProject: (
    project: Omit<Project, "id" | "created_at" | "updated_at">
  ) => Promise<string>;
  updateProject: (
    id: string,
    updates: Partial<Omit<Project, "id" | "created_at" | "updated_at">>
  ) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  refreshProjects: () => void;
  getProjectById: (id: string) => Promise<Project | null>;
  getTransactionsByProject: (projectId: string) => Promise<Transaction[]>;
  getProjectCosts: (
    projectId: string
  ) => Promise<{
    estimated: number;
    actual: number;
    transactions_total: number;
  }>;

  // Analytics
  getTransactionsByDateRange: (
    startDate: string,
    endDate: string,
    type?: "income" | "expense"
  ) => Promise<Transaction[]>;
  getSpendingByCategory: (
    startDate: string,
    endDate: string
  ) => Promise<{
    category_id: string;
    category_name: string;
    total: number;
    color: string;
  }[]>;
  getIncomeByCategory: (
    startDate: string,
    endDate: string
  ) => Promise<{
    category_id: string;
    category_name: string;
    total: number;
    color: string;
  }[]>;
  getMonthlyTrends: (
    months?: number
  ) => Promise<{ month: string; income: number; expense: number }[]>;

  // Custom SQL query execution
  executeCustomQuery: (sql: string) => Promise<any[]>;
}

const DatabaseContext = createContext<DatabaseContextType | null>(null);

export const useDatabaseContext = () => {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error(
      "useDatabaseContext must be used within a DatabaseProvider"
    );
  }
  return context;
};

interface DatabaseProviderProps {
  children: ReactNode;
}

export const DatabaseProvider: React.FC<DatabaseProviderProps> = ({
  children,
}) => {
  const [db, setDb] = useState<WaSQLiteDatabaseManager | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isDatabaseLoaded, setIsDatabaseLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Data states
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);

  const initializeDatabase = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const dbManager = new WaSQLiteDatabaseManager();
      await dbManager.initialize();

      setDb(dbManager);
      setIsInitialized(true);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to initialize database"
      );
    } finally {
      setIsLoading(false);
    }
  };


  const createOrOpenDatabase = async (isNew: boolean): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      // Initialize database manager if not already done
      let dbManager = db;
      if (!dbManager || !isInitialized) {
        appLogger.info('Initializing database manager...');
        dbManager = new WaSQLiteDatabaseManager();
        await dbManager.initialize();
        setDb(dbManager);
        setIsInitialized(true);
      }

      appLogger.info('Creating new database...');
      await dbManager.createNewDatabase();
      setIsDatabaseLoaded(true);

      // Load initial data
      refreshAllData();
      appLogger.info('New database created successfully');
    } catch (err) {
      appLogger.error('Failed to create database:', err);
      setError(
        err instanceof Error ? err.message : "Failed to create database"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const loadDatabaseFromFile = async (file: File) => {
    if (!db || !isInitialized) {
      setError("Database not initialized");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      await db.loadDatabaseFromFile(file);
      setIsDatabaseLoaded(true);
      
      // Load data from the imported database
      refreshAllData();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load database file"
      );
    } finally {
      setIsLoading(false);
    }
  };

  const exportDatabase = useCallback(async (): Promise<Uint8Array | null> => {
    if (!db || !isDatabaseLoaded) {
      setError("No database loaded to export");
      return null;
    }

    try {
      return await db.exportDatabase();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to export database"
      );
      return null;
    }
  }, [db, isDatabaseLoaded]);

  const refreshAllData = useCallback(async () => {
    if (!db || !isDatabaseLoaded) return;

    try {
      const [transactionsData, categoriesData, companiesData, accountsData, budgetsData, projectsData] = await Promise.all([
        db.getTransactionsAsync(),
        db.getCategoriesAsync(),
        db.getCompaniesAsync(),
        db.getAccountsAsync(),
        db.getBudgetsAsync(),
        db.getProjectsAsync()
      ]);

      setTransactions(transactionsData);
      setCategories(categoriesData);
      setCompanies(companiesData);
      setAccounts(accountsData);
      setBudgets(budgetsData);
      setProjects(projectsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh data");
    }
  }, [db, isDatabaseLoaded]);

  // Transaction operations
  const addTransaction = async (
    transaction: Omit<Transaction, "id" | "created_at" | "updated_at">
  ): Promise<void> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error("Database not loaded");
    }
    try {
      await db.addTransactionAsync(transaction);
      await refreshTransactions();
      // Data is automatically persisted to OPFS by sqlite-wasm
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to add transaction";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const refreshTransactions = useCallback(async () => {
    if (!db || !isDatabaseLoaded) return;
    try {
      const transactionsData = await db.getTransactionsAsync();
      setTransactions(transactionsData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to refresh transactions"
      );
    }
  }, [db, isDatabaseLoaded]);

  // Category operations
  const addCategory = async (
    category: Omit<Category, "id" | "created_at" | "updated_at">
  ): Promise<string> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error("Database not loaded");
    }

    try {
      const id = await db.addCategoryAsync(category);
      await refreshCategories();
      return id;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to add category";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const refreshCategories = useCallback(async () => {
    if (!db || !isDatabaseLoaded) return;
    try {
      const categoriesData = await db.getCategoriesAsync();
      setCategories(categoriesData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to refresh categories"
      );
    }
  }, [db, isDatabaseLoaded]);

  // Company operations
  const addCompany = async (name: string): Promise<string> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error("Database not loaded");
    }

    try {
      const id = await db.addCompanyAsync(name);
      await refreshCompanies();
      return id;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to add company";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };

  const findOrCreateCompany = async (name: string): Promise<string> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error("Database not loaded");
    }

    try {
      // First try to find existing company
      const existing = await db.findCompanyByNameAsync(name);
      if (existing) {
        return existing.id;
      }

      // If not found, create new one
      return await addCompany(name);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to find or create company";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const refreshCompanies = useCallback(async () => {
    if (!db || !isDatabaseLoaded) return;
    try {
      const companiesData = await db.getCompaniesAsync();
      setCompanies(companiesData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to refresh companies"
      );
    }
  }, [db, isDatabaseLoaded]);

  // Account operations
  const addAccount = async (
    account: Omit<Account, "id" | "created_at" | "updated_at">
  ): Promise<string> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error("Database not loaded");
    }

    try {
      const id = await db.addAccountAsync(account);
      await refreshAccounts();
      return id;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to add account";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const refreshAccounts = useCallback(async () => {
    if (!db || !isDatabaseLoaded) return;
    try {
      const accountsData = await db.getAccountsAsync();
      setAccounts(accountsData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to refresh accounts"
      );
    }
  }, [db, isDatabaseLoaded]);

  // Budget operations
  const addBudget = async (
    budget: Omit<Budget, "id" | "created_at" | "updated_at">
  ): Promise<string> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error("Database not loaded");
    }

    try {
      const id = await db.addBudgetAsync(budget);
      await refreshBudgets();
      return id;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to add budget";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const refreshBudgets = useCallback(async () => {
    if (!db || !isDatabaseLoaded) return;
    try {
      const budgetsData = await db.getBudgetsAsync();
      setBudgets(budgetsData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to refresh budgets"
      );
    }
  }, [db, isDatabaseLoaded]);

  // Project operations
  const addProject = async (
    project: Omit<Project, "id" | "created_at" | "updated_at">
  ): Promise<string> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error("Database not loaded");
    }

    try {
      const id = await db.addProjectAsync(project);
      await refreshProjects();
      return id;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to add project";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const updateProject = async (
    id: string,
    updates: Partial<Omit<Project, "id" | "created_at" | "updated_at">>
  ): Promise<void> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error("Database not loaded");
    }

    try {
      appLogger.debug('Updating project', { id, updates });
      await db.updateProjectAsync(id, updates);
      await refreshProjects();
    } catch (err) {
      appLogger.error('DatabaseContext updateProject error:', err);
      const errorMessage =
        err instanceof Error ? err.message : "Failed to update project";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };

  const deleteProject = async (id: string): Promise<void> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error("Database not loaded");
    }

    try {
      await db.deleteProjectAsync(id);
      await refreshProjects();
      await refreshTransactions(); // Refresh transactions as project references may have been cleared
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to delete project";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };

  const refreshProjects = useCallback(async () => {
    if (!db || !isDatabaseLoaded) return;
    try {
      const projectsData = await db.getProjectsAsync();
      setProjects(projectsData);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to refresh projects"
      );
    }
  }, [db, isDatabaseLoaded]);

  const getProjectById = async (id: string): Promise<Project | null> => {
    if (!db || !isDatabaseLoaded) return null;
    try {
      return await db.getProjectByIdAsync(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get project");
      return null;
    }
  };

  const getTransactionsByProject = async (projectId: string): Promise<Transaction[]> => {
    if (!db || !isDatabaseLoaded) return [];
    try {
      return await db.getTransactionsByProjectAsync(projectId);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to get transactions for project"
      );
      return [];
    }
  };

  const getProjectCosts = async (
    projectId: string
  ): Promise<{ estimated: number; actual: number; transactions_total: number }> => {
    if (!db || !isDatabaseLoaded)
      return { estimated: 0, actual: 0, transactions_total: 0 };
    try {
      return await db.getProjectCostsAsync(projectId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to get project costs"
      );
      return { estimated: 0, actual: 0, transactions_total: 0 };
    }
  };

  // Analytics operations
  const getTransactionsByDateRange = async (
    startDate: string,
    endDate: string,
    type?: "income" | "expense"
  ): Promise<Transaction[]> => {
    if (!db || !isDatabaseLoaded) return [];
    try {
      return await db.getTransactionsByDateRange(startDate, endDate, type);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to get transactions by date range"
      );
      return [];
    }
  };

  const getSpendingByCategory = async (startDate: string, endDate: string) => {
    if (!db || !isDatabaseLoaded) return [];
    try {
      return await db.getSpendingByCategoryAsync(startDate, endDate);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to get spending by category"
      );
      return [];
    }
  };

  const getIncomeByCategory = async (startDate: string, endDate: string) => {
    if (!db || !isDatabaseLoaded) return [];
    try {
      return await db.getIncomeByCategoryAsync(startDate, endDate);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to get income by category"
      );
      return [];
    }
  };

  const getMonthlyTrends = async (months: number = 12) => {
    if (!db || !isDatabaseLoaded) return [];
    try {
      return await db.getMonthlyTrendsAsync(months);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to get monthly trends"
      );
      return [];
    }
  };

  const executeCustomQuery = async (sql: string): Promise<any[]> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error("Database not loaded");
    }
    try {
      return await db.executeCustomQuery(sql);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to execute query";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };

  const contextValue: DatabaseContextType = {
    isInitialized,
    isDatabaseLoaded,
    isLoading,
    error,
    transactions,
    categories,
    companies,
    accounts,
    budgets,
    projects,
    initializeDatabase,
    createOrOpenDatabase,
    loadDatabaseFromFile,
    exportDatabase,
    addTransaction,
    refreshTransactions,
    addCategory,
    refreshCategories,
    addCompany,
    findOrCreateCompany,
    refreshCompanies,
    addAccount,
    refreshAccounts,
    addBudget,
    refreshBudgets,
    addProject,
    updateProject,
    deleteProject,
    refreshProjects,
    getProjectById,
    getTransactionsByProject,
    getProjectCosts,
    getTransactionsByDateRange,
    getSpendingByCategory,
    getIncomeByCategory,
    getMonthlyTrends,
    executeCustomQuery,
  };

  return (
    <DatabaseContext.Provider value={contextValue}>
      {children}
    </DatabaseContext.Provider>
  );
};
