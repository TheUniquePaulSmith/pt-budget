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
import {
  DatabaseSchema,
  TransactionQueries,
  CategoryQueries,
  CompanyQueries,
  AccountQueries,
  BudgetQueries,
  ProjectQueries,
  AnalyticsQueries,
  DatabaseUtils,
  type SQLiteExecutor,
} from "../lib/budgetDbQueries";

// WA-SQLite Database Manager using OPFSAnyContextVFS
class WaSQLiteDatabaseManager implements SQLiteExecutor {
  sqlite3: any = null;
  db: number = 0;
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

      dbLogger.debug('Loading SQLite async module...');
      const sqliteModule = await importModule('/wa-sqlite/wa-sqlite-async.mjs');
      const SQLiteModule = sqliteModule.default;

      dbLogger.debug('Loading SQLite API...');
      const apiModule = await importModule('/wa-sqlite/src/sqlite-api.js');
      const { Factory } = apiModule;

      dbLogger.debug('Loading IDB Atomic VFS...');
      const vfsModule = await importModule('/wa-sqlite/src/examples/IDBBatchAtomicVFS.js');
      const { IDBBatchAtomicVFS } = vfsModule;

      dbLogger.debug('Initializing SQLite WASM module...');
      const wasmModule = await SQLiteModule();

      dbLogger.debug('Creating SQLite API...');
      this.sqlite3 = Factory(wasmModule);

      dbLogger.debug('Creating IDB VFS...');
      this.vfs = await IDBBatchAtomicVFS.create('ptbudgetapp', wasmModule);

      dbLogger.debug('Registering IDB VFS...');
      this.sqlite3.vfs_register(this.vfs, true);
      
      this.isInitialized = true;
      dbLogger.debug('Initialization complete');
    } catch (error) {
      dbLogger.error('Initialization failed:', error);
      throw new Error(`Failed to initialize WA-SQLite: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  
  async openDatabase(filename: string = '/budget-app.db', isNew: boolean = false): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      dbLogger.debug(`Opening database: ${filename}`);
      
      this.db = await this.sqlite3.open_v2(
        filename,
        this.sqlite3.SQLITE_OPEN_CREATE | this.sqlite3.SQLITE_OPEN_READWRITE | this.sqlite3.SQLITE_OPEN_FULLMUTEX,
        this.vfs.name
      );
      
      if (!this.db) {
        throw new Error('Failed to open database');
      }

      dbLogger.debug(`Database opened successfully with handle: ${this.db}`);
      if (isNew) {
      console.log(`is new ${isNew}`);
      // Configure database for optimal performance and consistency
      await this.sqlite3.exec(this.db, 'PRAGMA locking_mode=NORMAL');
      dbLogger.debug('Setting PRAGMA locking_mode=NORMAL');
      //await this.sqlite3.exec(this.db, 'PRAGMA journal_mode=DELETE');
      //dbLogger.debug('Setting PRAGMA journal_mode=DELETE');
      await this.sqlite3.exec(this.db, 'PRAGMA synchronous=NORMAL');
      dbLogger.debug('Setting PRAGMA synchronous=NORMAL');
      await this.sqlite3.exec(this.db, 'PRAGMA foreign_keys=ON');
      dbLogger.debug('Setting PRAGMA foreign_keys=ON');     
      }
      await DatabaseSchema.createTables(this);
      dbLogger.debug('Database ready for use');
    } catch (error) {
      dbLogger.error('Failed to open database:', error);
      throw error;
    }
  }

  async query(sql: string, parameters: any[] = []): Promise<any[]> {
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

  async exec(sql: string): Promise<void> {
    await this.sqlite3.exec(this.db, sql);
  }

  lastInsertRowId(): number {
    return this.sqlite3.last_insert_rowid(this.db);
  }

  // Database interface methods required by the context
  async hasExistingDatabase(): Promise<boolean> {
    return this.isInitialized && this.db !== 0;
  }

  async checkForExistingIndexedDB(): Promise<boolean> {
    return DatabaseUtils.checkForExistingIndexedDB();
  }

  async openExistingDatabase(): Promise<void> {
    await this.openDatabase(undefined, false);
  }

  async createNewDatabase(): Promise<void> {
    await this.openDatabase(undefined, true);
  }

  async loadDatabaseFromFile(file: File): Promise<void> {
    throw new Error('File loading not yet implemented');
  }

  async exportDatabase(): Promise<Uint8Array> {
    throw new Error('Database export not yet implemented');
  }

  // Transaction operations - delegated to query classes
  async addTransactionAsync(transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    return TransactionQueries.create(this, transaction);
  }

  async getTransactionsAsync(): Promise<Transaction[]> {
    return TransactionQueries.getAll(this);
  }

  // Category operations - delegated to query classes
  async getCategoriesAsync(): Promise<Category[]> {
    return CategoryQueries.getAll(this);
  }

  async addCategoryAsync(category: Omit<Category, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    return CategoryQueries.create(this, category);
  }

  // Company operations - delegated to query classes
  async getCompaniesAsync(): Promise<Company[]> {
    return CompanyQueries.getAll(this);
  }

  async addCompanyAsync(name: string): Promise<string> {
    return CompanyQueries.create(this, name);
  }

  async findCompanyByNameAsync(name: string): Promise<Company | null> {
    return CompanyQueries.findByName(this, name);
  }

  // Account operations - delegated to query classes
  async getAccountsAsync(): Promise<Account[]> {
    return AccountQueries.getAll(this);
  }

  async addAccountAsync(account: Omit<Account, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    return AccountQueries.create(this, account);
  }

  // Budget operations - delegated to query classes
  async getBudgetsAsync(): Promise<Budget[]> {
    return BudgetQueries.getAll(this);
  }

  async addBudgetAsync(budget: Omit<Budget, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    return BudgetQueries.create(this, budget);
  }

  // Project operations - delegated to query classes
  async getProjectsAsync(): Promise<Project[]> {
    return ProjectQueries.getAll(this);
  }

  async addProjectAsync(project: Omit<Project, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    return ProjectQueries.create(this, project);
  }

  async getProjectByIdAsync(id: string): Promise<Project | null> {
    return ProjectQueries.getById(this, id);
  }

  async updateProjectAsync(id: string, updates: Partial<Omit<Project, 'id' | 'created_at' | 'updated_at'>>): Promise<void> {
    return ProjectQueries.update(this, id, updates);
  }

  async deleteProjectAsync(id: string): Promise<void> {
    return ProjectQueries.delete(this, id);
  }

  async getTransactionsByProjectAsync(projectId: string): Promise<Transaction[]> {
    return TransactionQueries.getByProject(this, projectId);
  }

  async getProjectCostsAsync(projectId: string): Promise<{ estimated: number; actual: number; transactions_total: number }> {
    return ProjectQueries.getCosts(this, projectId);
  }

  // Analytics methods - delegated to query classes
  async getTransactionsByDateRange(startDate: string, endDate: string, type?: 'income' | 'expense'): Promise<Transaction[]> {
    return TransactionQueries.getByDateRange(this, startDate, endDate, type);
  }

  async getSpendingByCategoryAsync(startDate: string, endDate: string): Promise<{ category_id: string; category_name: string; total: number; color: string }[]> {
    return AnalyticsQueries.getSpendingByCategory(this, startDate, endDate);
  }

  async getIncomeByCategoryAsync(startDate: string, endDate: string): Promise<{ category_id: string; category_name: string; total: number; color: string }[]> {
    return AnalyticsQueries.getIncomeByCategory(this, startDate, endDate);
  }

  async getMonthlyTrendsAsync(months: number = 12): Promise<{ month: string; income: number; expense: number }[]> {
    return AnalyticsQueries.getMonthlyTrends(this, months);
  }

  // Custom SQL query execution - delegated to utility class
  async executeCustomQuery(sql: string): Promise<any[]> {
    return DatabaseUtils.executeCustomQuery(this, sql);
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

  const createOrOpenDatabase = useCallback(async (isNew: boolean): Promise<void> => {
    try {
      setIsLoading(true);
      setError(null);

      // Initialize database manager if not already done
      let dbManager = db;
      if (!dbManager || !isInitialized) {
        appLogger.debug('Initializing database manager...');
        dbManager = new WaSQLiteDatabaseManager();
        await dbManager.initialize();
        setDb(dbManager);
        setIsInitialized(true);
      }
      if (isNew) {
        appLogger.info('Creating new database...');
        await dbManager.createNewDatabase();
        setIsDatabaseLoaded(true);
         
        // Load initial data
        refreshAllData();
        appLogger.info('New database created successfully');
      } else {
        appLogger.info('Opening existing database...');
        await dbManager.openExistingDatabase();
        setIsDatabaseLoaded(true);
        
        // Load data from the existing database
        refreshAllData();
        appLogger.info('Existing database opened successfully');
      }
     
    } catch (err) {
      appLogger.error('Failed to create database:', err);
      setError(
        err instanceof Error ? err.message : "Failed to create database"
      );
    } finally {
      setIsLoading(false);
    }
  }, [db, isInitialized]);

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
