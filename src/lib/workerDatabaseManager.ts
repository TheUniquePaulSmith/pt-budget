// Worker-based Database Manager
// This replaces the direct WA-SQLite integration with worker-based communication

import { databaseWorkerService } from './databaseWorkerService';
import type { SQLiteExecutor } from './budgetDbQueries';
import { dbLogger } from './logger';
import type {
  Transaction,
  Category,
  Company,
  Account,
  Budget,
  Project,
  AccountAlias,
} from '../types/database';
import {
  TransactionQueries,
  CategoryQueries,
  CompanyQueries,
  AccountQueries,
  AccountAliasQueries,
  BudgetQueries,
  ProjectQueries,
  AnalyticsQueries,
  DatabaseUtils,
} from './budgetDbQueries';

export class WorkerDatabaseManager implements SQLiteExecutor {
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      dbLogger.info('Initializing database worker...');
      await databaseWorkerService.initialize();
      this.isInitialized = true;
      dbLogger.info('Database worker initialized successfully');
    } catch (error) {
      dbLogger.error('Failed to initialize database worker:', error);
      throw error;
    }
  }

  async openDatabase(filename: string = '/budget-app.db', isNew: boolean = false): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      dbLogger.debug(`Opening database: ${filename}`);
      await databaseWorkerService.openDatabase(filename, isNew);
      dbLogger.debug('Database opened successfully');
    } catch (error) {
      dbLogger.error('Failed to open database:', error);
      throw error;
    }
  }

  async query(sql: string, parameters: any[] = []): Promise<any[]> {
    try {
      return await databaseWorkerService.query(sql, parameters);
    } catch (error) {
      dbLogger.error('Query failed:', error);
      dbLogger.debug(`SQL: ${sql}, Parameters: ${JSON.stringify(parameters)}`);
      throw error;
    }
  }

  async exec(sql: string): Promise<void> {
    try {
      await databaseWorkerService.exec(sql);
    } catch (error) {
      dbLogger.error('Exec failed:', error);
      throw error;
    }
  }

  async openExistingDatabase(): Promise<void> {
    await this.openDatabase(undefined, false);
  }

  async createNewDatabase(): Promise<void> {
    await this.openDatabase(undefined, true);
  }

  async loadDatabaseFromFile(file: File): Promise<void> {
    try {
      dbLogger.info('Loading database from file through worker...');
      
      // Read file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      const fileData = new Uint8Array(arrayBuffer);
      
      // Send to worker for import
      const response = await databaseWorkerService.importDatabase(fileData);
      
      if (!response.isSuccessful) {
        throw new Error(response.sqlResponse?.error || 'Failed to import database');
      }
      
      dbLogger.info('Database loaded successfully from file');
    } catch (error) {
      dbLogger.error('Failed to load database from file:', error);
      throw error;
    }
  }

  async exportDatabase(): Promise<Uint8Array> {
    try {
      dbLogger.info('Exporting database through worker...');
      
      const data = await databaseWorkerService.exportDatabase();
      
      dbLogger.info('Database exported successfully');
      return data;
    } catch (error) {
      dbLogger.error('Failed to export database:', error);
      throw error;
    }
  }

  // Method to clear corrupted database and start fresh
  async clearAndRecreateDatabase(): Promise<void> {
    try {
      dbLogger.warn('Clearing corrupted database...');
      
      // This will need to be implemented in the worker
      // For now, we'll try to create a new database
      await this.openDatabase('/budget-app.db', true);
      
      dbLogger.info('Database cleared and recreated successfully');
    } catch (error) {
      dbLogger.error('Failed to clear and recreate database:', error);
      throw error;
    }
  }

  // Get the worker service instance for status monitoring
  getWorkerService() {
    return databaseWorkerService;
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

  async deleteAccountAsync(id: string): Promise<void> {
    return AccountQueries.delete(this, id);
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

  // Account Alias operations - delegated to query classes
  async getAccountAliasesAsync(): Promise<AccountAlias[]> {
    return AccountAliasQueries.getAll(this);
  }

  async getAccountAliasesByAccountIdAsync(accountId: string): Promise<AccountAlias[]> {
    return AccountAliasQueries.getByAccountId(this, accountId);
  }

  async findAccountAliasesByLastFourAsync(lastFour: string): Promise<AccountAlias[]> {
    return AccountAliasQueries.findByLastFour(this, lastFour);
  }

  async addAccountAliasAsync(alias: Omit<AccountAlias, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    return AccountAliasQueries.create(this, alias);
  }

  async updateAccountAliasAsync(id: string, alias: Partial<Omit<AccountAlias, 'id' | 'created_at' | 'updated_at'>>): Promise<void> {
    return AccountAliasQueries.update(this, id, alias);
  }

  async deleteAccountAliasAsync(id: string): Promise<void> {
    return AccountAliasQueries.delete(this, id);
  }

  async deleteAccountAliasesByAccountIdAsync(accountId: string): Promise<void> {
    return AccountAliasQueries.deleteByAccountId(this, accountId);
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
