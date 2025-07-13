/**
 * Database Service
 * 
 * Simplified database service that directly communicates with the worker
 * without unnecessary intermediate layers.
 */

import { databaseWorkerService } from './databaseWorkerService';
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
  CREATE_TABLES,
  DEFAULT_DATA,
  TRANSACTION_QUERIES,
  CATEGORY_QUERIES,
  COMPANY_QUERIES,
  ACCOUNT_QUERIES,
  BUDGET_QUERIES,
  PROJECT_QUERIES,
  ACCOUNT_ALIAS_QUERIES,
  ANALYTICS_QUERIES,
} from './sqlQueries';

export class DatabaseService {
  private isInitialized = false;

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      dbLogger.info('Initializing database service...');
      await databaseWorkerService.initialize();
      this.isInitialized = true;
      dbLogger.info('Database service initialized successfully');
    } catch (error) {
      dbLogger.error('Failed to initialize database service:', error);
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
      
      if (isNew) {
        await this.createTables();
      }
      
      dbLogger.debug('Database opened successfully');
    } catch (error) {
      dbLogger.error('Failed to open database:', error);
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
      
      const arrayBuffer = await file.arrayBuffer();
      const fileData = new Uint8Array(arrayBuffer);
      
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

  async clearAndRecreateDatabase(): Promise<void> {
    try {
      dbLogger.warn('Clearing corrupted database...');
      await this.openDatabase('/budget-app.db', true);
      dbLogger.info('Database cleared and recreated successfully');
    } catch (error) {
      dbLogger.error('Failed to clear and recreate database:', error);
      throw error;
    }
  }

  async checkForExistingDatabase(): Promise<boolean> {
    try {
      return await databaseWorkerService.checkDatabaseExists();
    } catch (error) {
      dbLogger.error('Failed to check for existing database:', error);
      return false;
    }
  }

  getWorkerService() {
    return databaseWorkerService;
  }

  private async createTables(): Promise<void> {
    try {
      dbLogger.info('Creating database tables...');
      
      // Create all tables
      await databaseWorkerService.exec(CREATE_TABLES.CATEGORIES);
      await databaseWorkerService.exec(CREATE_TABLES.COMPANIES);
      await databaseWorkerService.exec(CREATE_TABLES.ACCOUNTS);
      await databaseWorkerService.exec(CREATE_TABLES.TRANSACTIONS);
      await databaseWorkerService.exec(CREATE_TABLES.BUDGETS);
      await databaseWorkerService.exec(CREATE_TABLES.PROJECTS);
      await databaseWorkerService.exec(CREATE_TABLES.ACCOUNT_ALIASES);
      
      // Insert default data
      await databaseWorkerService.exec(DEFAULT_DATA.CATEGORIES);
      await databaseWorkerService.exec(DEFAULT_DATA.ACCOUNTS);
      
      dbLogger.info('Database tables created successfully');
    } catch (error) {
      dbLogger.error('Failed to create tables:', error);
      throw error;
    }
  }

  // Transaction operations
  async addTransaction(transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    try {
      const hash = this.generateTransactionHash(transaction);
      
      // Check for duplicate
      const existingCount = await databaseWorkerService.query(TRANSACTION_QUERIES.CHECK_HASH_EXISTS, [hash]);
      if (existingCount[0]?.count > 0) {
        throw new Error('Duplicate transaction detected');
      }

      const result = await databaseWorkerService.query(TRANSACTION_QUERIES.CREATE, [
        transaction.date,
        transaction.amount,
        transaction.description,
        transaction.account_id,
        transaction.category_id || null,
        transaction.company_id || null,
        transaction.project_id || null,
        transaction.type,
        hash,
        transaction.account_last_four || null
      ]);
      
      return result[0].id.toString();
    } catch (error) {
      dbLogger.error('Failed to add transaction:', error);
      throw error;
    }
  }

  async getTransactions(): Promise<Transaction[]> {
    try {
      const rows = await databaseWorkerService.query(TRANSACTION_QUERIES.GET_ALL);
      return rows.map(this.mapToTransaction);
    } catch (error) {
      dbLogger.error('Failed to get transactions:', error);
      throw error;
    }
  }

  async getTransactionsByProject(projectId: string): Promise<Transaction[]> {
    try {
      const rows = await databaseWorkerService.query(TRANSACTION_QUERIES.GET_BY_PROJECT, [projectId]);
      return rows.map(this.mapToTransaction);
    } catch (error) {
      dbLogger.error('Failed to get transactions by project:', error);
      throw error;
    }
  }

  async getTransactionsByDateRange(startDate: string, endDate: string, type?: 'income' | 'expense'): Promise<Transaction[]> {
    try {
      let rows;
      if (type) {
        rows = await databaseWorkerService.query(TRANSACTION_QUERIES.GET_BY_DATE_RANGE_AND_TYPE, [startDate, endDate, type]);
      } else {
        rows = await databaseWorkerService.query(TRANSACTION_QUERIES.GET_BY_DATE_RANGE, [startDate, endDate]);
      }
      return rows.map(this.mapToTransaction);
    } catch (error) {
      dbLogger.error('Failed to get transactions by date range:', error);
      throw error;
    }
  }

  // Category operations
  async getCategories(): Promise<Category[]> {
    try {
      const rows = await databaseWorkerService.query(CATEGORY_QUERIES.GET_ALL);
      return rows.map(this.mapToCategory);
    } catch (error) {
      dbLogger.error('Failed to get categories:', error);
      throw error;
    }
  }

  async addCategory(category: Omit<Category, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    try {
      const result = await databaseWorkerService.query(CATEGORY_QUERIES.CREATE, [
        category.name,
        category.color || '#1976d2',
        category.type || 'expense'
      ]);
      return result[0].id.toString();
    } catch (error) {
      dbLogger.error('Failed to add category:', error);
      throw error;
    }
  }

  // Company operations
  async getCompanies(): Promise<Company[]> {
    try {
      const rows = await databaseWorkerService.query(COMPANY_QUERIES.GET_ALL);
      return rows.map(this.mapToCompany);
    } catch (error) {
      dbLogger.error('Failed to get companies:', error);
      throw error;
    }
  }

  async addCompany(name: string): Promise<string> {
    try {
      const result = await databaseWorkerService.query(COMPANY_QUERIES.CREATE, [name]);
      return result[0].id.toString();
    } catch (error) {
      dbLogger.error('Failed to add company:', error);
      throw error;
    }
  }

  async findCompanyByName(name: string): Promise<Company | null> {
    try {
      const rows = await databaseWorkerService.query(COMPANY_QUERIES.FIND_BY_NAME, [name]);
      return rows.length > 0 ? this.mapToCompany(rows[0]) : null;
    } catch (error) {
      dbLogger.error('Failed to find company by name:', error);
      throw error;
    }
  }

  async findOrCreateCompany(name: string): Promise<string> {
    try {
      const existing = await this.findCompanyByName(name);
      if (existing) {
        return existing.id;
      }
      return await this.addCompany(name);
    } catch (error) {
      dbLogger.error('Failed to find or create company:', error);
      throw error;
    }
  }

  // Account operations
  async getAccounts(): Promise<Account[]> {
    try {
      const rows = await databaseWorkerService.query(ACCOUNT_QUERIES.GET_ALL);
      return rows.map(this.mapToAccount);
    } catch (error) {
      dbLogger.error('Failed to get accounts:', error);
      throw error;
    }
  }

  async addAccount(account: Omit<Account, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    try {
      const result = await databaseWorkerService.query(ACCOUNT_QUERIES.CREATE, [
        account.name,
        account.type,
        null, // institution (not in current type definition)
        0 // balance (not in current type definition)
      ]);
      return result[0].id.toString();
    } catch (error) {
      dbLogger.error('Failed to add account:', error);
      throw error;
    }
  }

  async deleteAccount(id: string): Promise<void> {
    try {
      await databaseWorkerService.query(ACCOUNT_QUERIES.DELETE, [id]);
    } catch (error) {
      dbLogger.error('Failed to delete account:', error);
      throw error;
    }
  }

  // Budget operations
  async getBudgets(): Promise<Budget[]> {
    try {
      const rows = await databaseWorkerService.query(BUDGET_QUERIES.GET_ALL);
      return rows.map(this.mapToBudget);
    } catch (error) {
      dbLogger.error('Failed to get budgets:', error);
      throw error;
    }
  }

  async addBudget(budget: Omit<Budget, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    try {
      const result = await databaseWorkerService.query(BUDGET_QUERIES.CREATE, [
        budget.category_id,
        budget.amount,
        budget.period || 'monthly',
        budget.start_date,
        budget.end_date || null
      ]);
      return result[0].id.toString();
    } catch (error) {
      dbLogger.error('Failed to add budget:', error);
      throw error;
    }
  }

  // Project operations
  async getProjects(): Promise<Project[]> {
    try {
      const rows = await databaseWorkerService.query(PROJECT_QUERIES.GET_ALL);
      return rows.map(this.mapToProject);
    } catch (error) {
      dbLogger.error('Failed to get projects:', error);
      throw error;
    }
  }

  async addProject(project: Omit<Project, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    try {
      const result = await databaseWorkerService.query(PROJECT_QUERIES.CREATE, [
        project.name,
        project.company_name,
        project.contact_details,
        project.project_category || 'other',
        project.status || 'planning',
        project.start_date || null,
        project.end_date || null,
        project.estimated_cost || 0,
        project.actual_cost || 0,
        project.notes || null
      ]);
      return result[0].id.toString();
    } catch (error) {
      dbLogger.error('Failed to add project:', error);
      throw error;
    }
  }

  async getProjectById(id: string): Promise<Project | null> {
    try {
      const rows = await databaseWorkerService.query(PROJECT_QUERIES.GET_BY_ID, [id]);
      return rows.length > 0 ? this.mapToProject(rows[0]) : null;
    } catch (error) {
      dbLogger.error('Failed to get project by id:', error);
      throw error;
    }
  }

  async updateProject(id: string, updates: Partial<Omit<Project, 'id' | 'created_at' | 'updated_at'>>): Promise<void> {
    try {
      const existing = await this.getProjectById(id);
      if (!existing) {
        throw new Error('Project not found');
      }

      await databaseWorkerService.query(PROJECT_QUERIES.UPDATE, [
        updates.name ?? existing.name,
        updates.company_name ?? existing.company_name,
        updates.contact_details ?? existing.contact_details,
        updates.project_category ?? existing.project_category,
        updates.status ?? existing.status,
        updates.start_date ?? existing.start_date,
        updates.end_date ?? existing.end_date,
        updates.estimated_cost ?? existing.estimated_cost,
        updates.actual_cost ?? existing.actual_cost,
        updates.notes ?? existing.notes,
        id
      ]);
    } catch (error) {
      dbLogger.error('Failed to update project:', error);
      throw error;
    }
  }

  async deleteProject(id: string): Promise<void> {
    try {
      await databaseWorkerService.query(PROJECT_QUERIES.DELETE, [id]);
    } catch (error) {
      dbLogger.error('Failed to delete project:', error);
      throw error;
    }
  }

  async getProjectCosts(projectId: string): Promise<{ estimated: number; actual: number; transactions_total: number }> {
    try {
      const rows = await databaseWorkerService.query(PROJECT_QUERIES.GET_COSTS, [projectId]);
      const result = rows[0] || { estimated_cost: 0, actual_cost: 0, transactions_total: 0 };
      return {
        estimated: result.estimated_cost || 0,
        actual: result.actual_cost || 0,
        transactions_total: result.transactions_total || 0
      };
    } catch (error) {
      dbLogger.error('Failed to get project costs:', error);
      throw error;
    }
  }

  // Account Alias operations
  async getAccountAliases(): Promise<AccountAlias[]> {
    try {
      const rows = await databaseWorkerService.query(ACCOUNT_ALIAS_QUERIES.GET_ALL);
      return rows.map(this.mapToAccountAlias);
    } catch (error) {
      dbLogger.error('Failed to get account aliases:', error);
      throw error;
    }
  }

  async getAccountAliasesByAccountId(accountId: string): Promise<AccountAlias[]> {
    try {
      const rows = await databaseWorkerService.query(ACCOUNT_ALIAS_QUERIES.GET_BY_ACCOUNT_ID, [accountId]);
      return rows.map(this.mapToAccountAlias);
    } catch (error) {
      dbLogger.error('Failed to get account aliases by account id:', error);
      throw error;
    }
  }

  async findAccountAliasesByLastFour(lastFour: string): Promise<AccountAlias[]> {
    try {
      const rows = await databaseWorkerService.query(ACCOUNT_ALIAS_QUERIES.FIND_BY_LAST_FOUR, [lastFour]);
      return rows.map(this.mapToAccountAlias);
    } catch (error) {
      dbLogger.error('Failed to find account aliases by last four:', error);
      throw error;
    }
  }

  async addAccountAlias(alias: Omit<AccountAlias, 'id' | 'created_at' | 'updated_at'>): Promise<string> {
    try {
      const result = await databaseWorkerService.query(ACCOUNT_ALIAS_QUERIES.CREATE, [
        alias.account_id,
        alias.last_four,
        alias.alias_name || null
      ]);
      return result[0].id.toString();
    } catch (error) {
      dbLogger.error('Failed to add account alias:', error);
      throw error;
    }
  }

  async updateAccountAlias(id: string, alias: Partial<Omit<AccountAlias, 'id' | 'created_at' | 'updated_at'>>): Promise<void> {
    try {
      const existing = await databaseWorkerService.query(ACCOUNT_ALIAS_QUERIES.GET_BY_ID, [id]);
      if (existing.length === 0) {
        throw new Error('Account alias not found');
      }

      const current = existing[0];
      await databaseWorkerService.query(ACCOUNT_ALIAS_QUERIES.UPDATE, [
        alias.account_id ?? current.account_id,
        alias.last_four ?? current.last_four,
        alias.alias_name ?? current.alias_name,
        id
      ]);
    } catch (error) {
      dbLogger.error('Failed to update account alias:', error);
      throw error;
    }
  }

  async deleteAccountAlias(id: string): Promise<void> {
    try {
      await databaseWorkerService.query(ACCOUNT_ALIAS_QUERIES.DELETE, [id]);
    } catch (error) {
      dbLogger.error('Failed to delete account alias:', error);
      throw error;
    }
  }

  async deleteAccountAliasesByAccountId(accountId: string): Promise<void> {
    try {
      await databaseWorkerService.query(ACCOUNT_ALIAS_QUERIES.DELETE_BY_ACCOUNT_ID, [accountId]);
    } catch (error) {
      dbLogger.error('Failed to delete account aliases by account id:', error);
      throw error;
    }
  }

  // Analytics operations
  async getSpendingByCategory(startDate: string, endDate: string): Promise<{ category_id: string; category_name: string; total: number; color: string }[]> {
    try {
      const rows = await databaseWorkerService.query(ANALYTICS_QUERIES.SPENDING_BY_CATEGORY, [startDate, endDate]);
      return rows.map(row => ({
        category_id: row.category_id.toString(),
        category_name: row.category_name,
        total: row.total,
        color: row.color
      }));
    } catch (error) {
      dbLogger.error('Failed to get spending by category:', error);
      throw error;
    }
  }

  async getIncomeByCategory(startDate: string, endDate: string): Promise<{ category_id: string; category_name: string; total: number; color: string }[]> {
    try {
      const rows = await databaseWorkerService.query(ANALYTICS_QUERIES.INCOME_BY_CATEGORY, [startDate, endDate]);
      return rows.map(row => ({
        category_id: row.category_id.toString(),
        category_name: row.category_name,
        total: row.total,
        color: row.color
      }));
    } catch (error) {
      dbLogger.error('Failed to get income by category:', error);
      throw error;
    }
  }

  async getMonthlyTrends(months: number = 12): Promise<{ month: string; income: number; expense: number }[]> {
    try {
      const rows = await databaseWorkerService.query(ANALYTICS_QUERIES.MONTHLY_TRENDS, [months]);
      return rows.map(row => ({
        month: row.month,
        income: row.income || 0,
        expense: row.expense || 0
      }));
    } catch (error) {
      dbLogger.error('Failed to get monthly trends:', error);
      throw error;
    }
  }

  // Custom SQL query execution
  async executeCustomQuery(sql: string): Promise<any[]> {
    try {
      dbLogger.debug('Executing custom query:', sql);
      return await databaseWorkerService.query(sql);
    } catch (error) {
      dbLogger.error('Failed to execute custom query:', error);
      throw error;
    }
  }

  // Utility methods for mapping database rows to TypeScript objects
  private mapToTransaction(row: any): Transaction {
    return {
      id: row.id.toString(),
      date: row.date,
      amount: row.amount,
      description: row.description,
      account_id: row.account_id,
      category_id: row.category_id?.toString() || null,
      company_id: row.company_id?.toString() || null,
      project_id: row.project_id?.toString() || null,
      type: row.type,
      transaction_hash: row.transaction_hash || undefined,
      account_last_four: row.account_last_four || undefined,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private mapToCategory(row: any): Category {
    return {
      id: row.id.toString(),
      name: row.name,
      color: row.color,
      type: row.type,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private mapToCompany(row: any): Company {
    return {
      id: row.id.toString(),
      name: row.name,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private mapToAccount(row: any): Account {
    return {
      id: row.id.toString(),
      name: row.name,
      type: row.type,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private mapToBudget(row: any): Budget {
    return {
      id: row.id.toString(),
      category_id: row.category_id.toString(),
      amount: row.amount,
      period: row.period,
      start_date: row.start_date,
      end_date: row.end_date,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private mapToProject(row: any): Project {
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
      updated_at: row.updated_at
    };
  }

  private mapToAccountAlias(row: any): AccountAlias {
    return {
      id: row.id.toString(),
      account_id: row.account_id.toString(),
      last_four: row.last_four,
      alias_name: row.alias_name,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }

  private generateTransactionHash(transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>): string {
    const hashInput = `${transaction.account_id || 'null'}-${transaction.date}-${transaction.amount}-${transaction.description}`;
    
    // Use a simple hash for browser compatibility
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      const char = hashInput.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    
    return Math.abs(hash).toString(16);
  }

  // Static method for generating transaction hash from CSV import
  static generateTransactionHashFromFields(
    accountId: string,
    date: string,
    amount: number,
    description: string,
    uniqueIdentifier?: string
  ): string {
    const hashInput = uniqueIdentifier
      ? `${accountId}-${date}-${amount}-${description}-${uniqueIdentifier}`
      : `${accountId}-${date}-${amount}-${description}`;
    
    let hash = 0;
    for (let i = 0; i < hashInput.length; i++) {
      const char = hashInput.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    return Math.abs(hash).toString(16);
  }
}
