'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { DatabaseManager, Transaction, Category, Company, Account, Budget } from '../lib/database';

interface DatabaseContextType {
  // Database instance
  db: DatabaseManager | null;
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

  // Database operations
  initializeDatabase: () => Promise<void>;
  createNewDatabase: () => void;
  loadDatabaseFromFile: (file: File) => Promise<void>;
  exportDatabase: () => Uint8Array | null;

  // Transaction operations
  addTransaction: (transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>) => Promise<string>;
  refreshTransactions: () => void;

  // Category operations
  addCategory: (category: Omit<Category, 'id' | 'created_at' | 'updated_at'>) => Promise<string>;
  refreshCategories: () => void;

  // Company operations
  addCompany: (name: string) => Promise<string>;
  findOrCreateCompany: (name: string) => Promise<string>;
  refreshCompanies: () => void;

  // Account operations
  addAccount: (account: Omit<Account, 'id' | 'created_at' | 'updated_at'>) => Promise<string>;
  refreshAccounts: () => void;

  // Budget operations
  addBudget: (budget: Omit<Budget, 'id' | 'created_at' | 'updated_at'>) => Promise<string>;
  refreshBudgets: () => void;

  // Analytics
  getTransactionsByDateRange: (startDate: string, endDate: string, type?: 'income' | 'expense') => Transaction[];
  getSpendingByCategory: (startDate: string, endDate: string) => { category_id: string; category_name: string; total: number; color: string }[];
  getIncomeByCategory: (startDate: string, endDate: string) => { category_id: string; category_name: string; total: number; color: string }[];
  getMonthlyTrends: (months?: number) => { month: string; income: number; expense: number }[];
}

const DatabaseContext = createContext<DatabaseContextType | null>(null);

export const useDatabaseContext = () => {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabaseContext must be used within a DatabaseProvider');
  }
  return context;
};

interface DatabaseProviderProps {
  children: ReactNode;
}

export const DatabaseProvider: React.FC<DatabaseProviderProps> = ({ children }) => {
  const [db, setDb] = useState<DatabaseManager | null>(null);
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

  const initializeDatabase = async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const dbManager = new DatabaseManager();
      await dbManager.initialize();
      
      setDb(dbManager);
      setIsInitialized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to initialize database');
    } finally {
      setIsLoading(false);
    }
  };

  const createNewDatabase = () => {
    if (!db || !isInitialized) {
      setError('Database not initialized');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      db.createNewDatabase();
      setIsDatabaseLoaded(true);
      
      // Load initial data
      refreshAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create database');
    } finally {
      setIsLoading(false);
    }
  };

  const loadDatabaseFromFile = async (file: File) => {
    if (!db || !isInitialized) {
      setError('Database not initialized');
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const arrayBuffer = await file.arrayBuffer();
      db.loadFromFile(arrayBuffer);
      setIsDatabaseLoaded(true);
      
      // Load data from the imported database
      refreshAllData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load database file');
    } finally {
      setIsLoading(false);
    }
  };

  const exportDatabase = (): Uint8Array | null => {
    if (!db || !isDatabaseLoaded) {
      setError('No database loaded to export');
      return null;
    }

    try {
      return db.exportToFile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export database');
      return null;
    }
  };
  const refreshAllData = useCallback(() => {
    if (!db || !isDatabaseLoaded) return;

    try {
      setTransactions(db.getTransactions());
      setCategories(db.getCategories());
      setCompanies(db.getCompanies());
      setAccounts(db.getAccounts());
      setBudgets(db.getBudgets());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh data');
    }
  }, [db, isDatabaseLoaded]);

  // Transaction operations
  const addTransaction = async (transaction: Omit<Transaction, 'id' | 'created_at' | 'updated_at'>): Promise<string> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error('Database not loaded');
    }

    try {
      const id = db.addTransaction(transaction);
      refreshTransactions();
      return id;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add transaction';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const refreshTransactions = useCallback(() => {
    if (!db || !isDatabaseLoaded) return;
    try {
      setTransactions(db.getTransactions());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh transactions');
    }
  }, [db, isDatabaseLoaded]);

  // Category operations
  const addCategory = async (category: Omit<Category, 'id' | 'created_at' | 'updated_at'>): Promise<string> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error('Database not loaded');
    }

    try {
      const id = db.addCategory(category);
      refreshCategories();
      return id;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add category';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const refreshCategories = useCallback(() => {
    if (!db || !isDatabaseLoaded) return;
    try {
      setCategories(db.getCategories());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh categories');
    }
  }, [db, isDatabaseLoaded]);

  // Company operations
  const addCompany = async (name: string): Promise<string> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error('Database not loaded');
    }

    try {
      const id = db.addCompany(name);
      refreshCompanies();
      return id;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add company';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };

  const findOrCreateCompany = async (name: string): Promise<string> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error('Database not loaded');
    }

    try {
      // First try to find existing company
      const existing = db.findCompanyByName(name);
      if (existing) {
        return existing.id;
      }

      // If not found, create new one
      return await addCompany(name);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to find or create company';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const refreshCompanies = useCallback(() => {
    if (!db || !isDatabaseLoaded) return;
    try {
      setCompanies(db.getCompanies());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh companies');
    }
  }, [db, isDatabaseLoaded]);

  // Account operations
  const addAccount = async (account: Omit<Account, 'id' | 'created_at' | 'updated_at'>): Promise<string> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error('Database not loaded');
    }

    try {
      const id = db.addAccount(account);
      refreshAccounts();
      return id;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add account';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const refreshAccounts = useCallback(() => {
    if (!db || !isDatabaseLoaded) return;
    try {
      setAccounts(db.getAccounts());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh accounts');
    }
  }, [db, isDatabaseLoaded]);

  // Budget operations
  const addBudget = async (budget: Omit<Budget, 'id' | 'created_at' | 'updated_at'>): Promise<string> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error('Database not loaded');
    }

    try {
      const id = db.addBudget(budget);
      refreshBudgets();
      return id;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to add budget';
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const refreshBudgets = useCallback(() => {
    if (!db || !isDatabaseLoaded) return;
    try {
      setBudgets(db.getBudgets());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh budgets');
    }
  }, [db, isDatabaseLoaded]);

  // Analytics operations
  const getTransactionsByDateRange = (startDate: string, endDate: string, type?: 'income' | 'expense'): Transaction[] => {
    if (!db || !isDatabaseLoaded) return [];
    try {
      return db.getTransactionsByDateRange(startDate, endDate, type);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get transactions by date range');
      return [];
    }
  };

  const getSpendingByCategory = (startDate: string, endDate: string) => {
    if (!db || !isDatabaseLoaded) return [];
    try {
      return db.getSpendingByCategory(startDate, endDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get spending by category');
      return [];
    }
  };

  const getIncomeByCategory = (startDate: string, endDate: string) => {
    if (!db || !isDatabaseLoaded) return [];
    try {
      return db.getIncomeByCategory(startDate, endDate);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get income by category');
      return [];
    }
  };

  const getMonthlyTrends = (months: number = 12) => {
    if (!db || !isDatabaseLoaded) return [];
    try {
      return db.getMonthlyTrends(months);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get monthly trends');
      return [];
    }
  };

  const contextValue: DatabaseContextType = {
    db,
    isInitialized,
    isDatabaseLoaded,
    isLoading,
    error,
    transactions,
    categories,
    companies,
    accounts,
    budgets,
    initializeDatabase,
    createNewDatabase,
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
    getTransactionsByDateRange,
    getSpendingByCategory,
    getIncomeByCategory,
    getMonthlyTrends,
  };

  return (
    <DatabaseContext.Provider value={contextValue}>
      {children}
    </DatabaseContext.Provider>
  );
};
