/**
 * Simplified Database Context
 * 
 * Combines database initialization and data management in a single context.
 * Eliminates the need for separate DatabaseInitializer component.
 */

"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Box, Typography, Button, CircularProgress, Alert, Paper } from '@mui/material';
import { DatasetOutlined, CreateNewFolder, Upload } from '@mui/icons-material';
import { DatabaseService } from '../lib/databaseService';
import { TestBrowser } from '../components/TestBrowser';
import type { WorkerStatus } from '../lib/databaseWorkerService';
import type {
  Transaction,
  Category,
  Company,
  Account,
  Budget,
  Project,
  User,
  Trip,
} from '../types/database';
//import { appLogger } from '../lib/logger';

interface DatabaseContextType {
  // Database service
  databaseService: DatabaseService | null;
  isInitialized: boolean;
  isDatabaseLoaded: boolean;

  // Loading states
  isLoading: boolean;
  error: string | null;
  
  // Worker status
  workerStatus: WorkerStatus | null;
  
  // Data
  transactions: Transaction[];
  categories: Category[];
  companies: Company[];
  accounts: Account[];
  budgets: Budget[];
  projects: Project[];
  users: User[];
  trips: Trip[];
  
  // Database operations
  createOrOpenDatabase: (isNew: boolean) => Promise<void>;
  loadDatabaseFromFile: (file: File) => Promise<void>;
  exportDatabase: () => Promise<Uint8Array | null>;

  // Data refresh operations
  refreshTransactions: () => Promise<void>;
  refreshCategories: () => Promise<void>;
  refreshCompanies: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  refreshBudgets: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshTrips: () => Promise<void>;
  refreshAll: () => Promise<void>;

  // Transaction operations
  addTransaction: (
    transaction: Omit<Transaction, "id" | "created_at" | "updated_at">
  ) => Promise<void>;

  getAllTransactionHashes: () => Promise<string[]>;
  truncateImportTable: () => Promise<void>;
  insertIntoTempTable: (
    transactions: Array<Omit<Transaction, "id" | "created_at" | "updated_at">>
  ) => Promise<number[]>;
  deleteFromTempTable: (tempIds: number[]) => Promise<void>;
  checkDuplicateTransactions: () => Promise<string[]>;
  bulkInsertFromTempTable: () => Promise<number>;
  addTransactionsBatch: (
    transactions: Array<Omit<Transaction, "id" | "created_at" | "updated_at">>
  ) => Promise<{ success: number; failed: number; errors: string[] }>;

  // Category operations
  addCategory: (
    category: Omit<Category, "id" | "created_at" | "updated_at">
  ) => Promise<string>;

  // Company operations
  addCompany: (name: string) => Promise<number>;
  findOrCreateCompany: (name: string) => Promise<number>;

  // Account operations
  addAccount: (
    account: Omit<Account, "id" | "created_at" | "updated_at">
  ) => Promise<number>;
  deleteAccount: (id: number) => Promise<void>;

  // Budget operations
  addBudget: (
    budget: Omit<Budget, "id" | "created_at" | "updated_at">
  ) => Promise<number>;

  // Project operations
  addProject: (
    project: Omit<Project, "id" | "created_at" | "updated_at">
  ) => Promise<number>;
  updateProject: (
    id: number,
    updates: Partial<Omit<Project, "id" | "created_at" | "updated_at">>
  ) => Promise<void>;
  deleteProject: (id: number) => Promise<void>;
  getProjectById: (id: number) => Promise<Project | null>;
  getTransactionsByProject: (projectId: number) => Promise<Transaction[]>;
  getProjectCosts: (
    projectId: number
  ) => Promise<{
    estimated: number;
    actual: number;
    transactions_total: number;
  }>;

  // User operations
  getUsers: () => Promise<User[]>;
  getUserById: (id: number) => Promise<User | null>;
  addUser: (
    user: Omit<User, "id" | "created_at" | "updated_at">
  ) => Promise<number>;
  updateUser: (
    id: number,
    updates: Partial<Omit<User, "id" | "created_at" | "updated_at">>
  ) => Promise<void>;
  deleteUser: (id: number) => Promise<void>;
  getAccountsByUserId: (userId: number) => Promise<Account[]>;

  // Trip operations
  getTrips: () => Promise<Trip[]>;
  getTripById: (id: number) => Promise<Trip | null>;
  addTrip: (
    trip: Omit<Trip, "id" | "created_at" | "updated_at">
  ) => Promise<number>;
  updateTrip: (
    id: number,
    updates: Partial<Omit<Trip, "id" | "created_at" | "updated_at">>
  ) => Promise<void>;
  deleteTrip: (id: number) => Promise<void>;
  getTransactionsByTrip: (tripId: number) => Promise<Transaction[]>;
  getTripCosts: (
    tripId: number
  ) => Promise<{
    estimated: number;
    actual: number;
    transactions_total: number;
  }>;

  // Transaction labeling
  updateTransactionLabels: (id: number, projectId: number | null, tripId: number | null) => Promise<void>;

  generateTransactionHash: (
    accountId: string,
    date: string,
    amount: number,
    description: string,
    uniqueIdentifier?: string
  ) => string;
  checkTransactionHashExists: (hash: string) => Promise<boolean>;
  findAccountsByLastFour: (lastFour: string) => Account[];
  executeCustomQuery: (sql: string) => Promise<any[]>;
}

const DatabaseContext = createContext<DatabaseContextType | null>(null);

export const useDatabaseContext = () => {
  const context = useContext(DatabaseContext);
  if (!context) {
    throw new Error('useDatabaseContext must be used within a DatabaseProvider');
  }
  return context;
};

type InitializationState = 'checking' | 'testing-browser' | 'needs-setup' | 'initialized' | 'error';

interface DatabaseProviderProps {
  children: React.ReactNode;
}

export const DatabaseProvider: React.FC<DatabaseProviderProps> = ({
  children,
}) => {
  const [databaseService, setDatabaseService] = useState<DatabaseService | null>(null);
  const [initializationState, setInitializationState] = useState<InitializationState>('checking');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const [isBrowserCompatible, setIsBrowserCompatible] = useState<boolean | null>(null);
  
  // Data state
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  
  const hasCheckedDatabase = useRef(false);

   const handleBrowserTestComplete = async (isCompatible: boolean, testResults: any) => {
      
      if (!isCompatible) {
        return;
        // setError('Your browser is not compatible with this application. Please use a modern browser with WebAssembly and SharedWorker support.');
        // setInitializationState('error');
        // return;
      }

      // Browser is compatible, proceed with database initialization
      try {
        const service = new DatabaseService();
      
        console.debug('[DB Context] Calling initialize to worker service...');
        await service.initialize();
        
        // Monitor worker status
        console.info('[DB Context] Monitoring database worker service...');
        const workerService = service.getWorkerService();
        workerService.onStatusChange(setWorkerStatus);
        
        setDatabaseService(service);
        
        // Check for existing database
        if (service.dbExistsBeforeInit) {
          console.info('[DB Context] Found existing database, opening...');
          await service.openExistingDatabase();
          await loadAllData(service);
          setInitializationState('initialized');
        } else {
          console.info('[DB Context] No existing database found');
          setInitializationState('needs-setup');
        }
        
        hasCheckedDatabase.current = true;
      } catch (err) {
        console.error('Failed to initialize database:', err);
        setError(err instanceof Error ? err.message : 'Failed to initialize database');
        setInitializationState('error');
      }
    };

// Initialize database service and check for existing database
  useEffect(() => {
    if (typeof window === 'undefined') return; // SSR guard
    if (hasCheckedDatabase.current) return; // Prevent double execution

    // Initialize the database tester service to check if the browser supports required features
    const initializeAndCheck = async () => {
      // Check if browser test has already passed in a previous session
      const STORAGE_KEY = "budgetApp_browserTestPassed";
      const previousTestResults = localStorage.getItem(STORAGE_KEY);

      if (previousTestResults) {
        try {
          const savedResults = JSON.parse(previousTestResults);
          if (savedResults.overallCompatible) {
            console.log('[DB Context] Using cached browser compatibility results, skipping test');
            // Skip the test UI and proceed directly to database initialization
            await handleBrowserTestComplete(true, savedResults);
            return;
          }
        } catch (err) {
          console.warn('[DB Context] Failed to parse cached test results, running test again', err);
          localStorage.removeItem(STORAGE_KEY);
        }
      }

      // First test browser compatibility
      setInitializationState('testing-browser');
      // Browser testing will trigger the next phase via handleBrowserTestComplete
    };
    
    initializeAndCheck();
  }, []);

  const loadAllData = async (service: DatabaseService) => {
    try {
      const [
        transactionsData,
        categoriesData,
        companiesData,
        accountsData,
        budgetsData,
        projectsData,
        usersData,
        tripsData
      ] = await Promise.all([
        service.getTransactions(),
        service.getCategories(),
        service.getCompanies(),
        service.getAccounts(),
        service.getBudgets(),
        service.getProjects(),
        service.getUsers(),
        service.getTrips()
      ]);

      setTransactions(transactionsData);
      setCategories(categoriesData);
      setCompanies(companiesData);
      setAccounts(accountsData);
      setBudgets(budgetsData);
      setProjects(projectsData);
      setUsers(usersData);
      setTrips(tripsData);
    } catch (err) {
      console.error('Failed to load data:', err);
      throw err;
    }
  };

  const createOrOpenDatabase = async (isNew: boolean) => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    setIsLoading(true);
    setError(null);
    
    try {
      if (isNew) {
        await databaseService.createNewDatabase();
      } else {
        await databaseService.openExistingDatabase();
      }
      
      await loadAllData(databaseService);
      setInitializationState('initialized');
    } catch (err) {
      console.error('Failed to create/open database:', err);
      setError(err instanceof Error ? err.message : 'Failed to open database');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const loadDatabaseFromFile = async (file: File) => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    setIsLoading(true);
    setError(null);
    
    try {
      await databaseService.loadDatabaseFromFile(file);
      await loadAllData(databaseService);
      setInitializationState('initialized');
    } catch (err) {
      console.error('Failed to load database from file:', err);
      setError(err instanceof Error ? err.message : 'Failed to load database file');
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const exportDatabase = async (): Promise<Uint8Array | null> => {
    if (!databaseService) {
      return null;
    }

    try {
      return await databaseService.exportDatabase();
    } catch (err) {
      console.error('Failed to export database:', err);
      setError(err instanceof Error ? err.message : 'Failed to export database');
      return null;
    }
  };

  // Data refresh operations
  const refreshTransactions = useCallback(async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getTransactions();
      setTransactions(data);
    } catch (err) {
      console.error('Failed to refresh transactions:', err);
    }
  }, [databaseService]);

  const refreshCategories = useCallback(async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getCategories();
      setCategories(data);
    } catch (err) {
      console.error('Failed to refresh categories:', err);
    }
  }, [databaseService]);

  const refreshCompanies = useCallback(async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getCompanies();
      setCompanies(data);
    } catch (err) {
      console.error('Failed to refresh companies:', err);
    }
  }, [databaseService]);

  const refreshAccounts = useCallback(async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getAccounts();
      setAccounts(data);
    } catch (err) {
      console.error('Failed to refresh accounts:', err);
    }
  }, [databaseService]);

  const refreshBudgets = useCallback(async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getBudgets();
      setBudgets(data);
    } catch (err) {
      console.error('Failed to refresh budgets:', err);
    }
  }, [databaseService]);

  const refreshProjects = useCallback(async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getProjects();
      setProjects(data);
    } catch (err) {
      console.error('Failed to refresh projects:', err);
    }
  }, [databaseService]);

  const refreshUsers = useCallback(async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getUsers();
      setUsers(data);
    } catch (err) {
      console.error('Failed to refresh users:', err);
    }
  }, [databaseService]);

  const refreshTrips = useCallback(async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getTrips();
      setTrips(data);
    } catch (err) {
      console.error('Failed to refresh trips:', err);
    }
  }, [databaseService]);

  const refreshAll = useCallback(async () => {
    if (!databaseService) return;
    await Promise.all([
      refreshTransactions(),
      refreshCategories(),
      refreshCompanies(),
      refreshAccounts(),
      refreshBudgets(),
      refreshProjects(),
      refreshUsers(),
      refreshTrips(),
    ]);
  }, [databaseService, refreshTransactions, refreshCategories, refreshCompanies, refreshAccounts, refreshBudgets, refreshProjects, refreshUsers, refreshTrips]);

  // Transaction operations
  const addTransaction = async (transaction: Omit<Transaction, "id" | "created_at" | "updated_at">) => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      await databaseService.addTransaction(transaction);
      await refreshTransactions();
    } catch (err) {
      console.error('Failed to add transaction:', err);
      throw err;
    }
  };

  const getAllTransactionHashes = async (): Promise<string[]> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      return await databaseService.getAllTransactionHashes();
    } catch (err) {
      console.error('Failed to get all transaction hashes:', err);
      throw err;
    }
  };

  const truncateImportTable = async (): Promise<void> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      await databaseService.truncateImportTable();
    } catch (err) {
      console.error('Failed to truncate import table:', err);
      throw err;
    }
  };

  const insertIntoTempTable = async (
    transactions: Array<Omit<Transaction, "id" | "created_at" | "updated_at">>
  ): Promise<number[]> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      return await databaseService.insertIntoTempTable(transactions);
    } catch (err) {
      console.error('Failed to insert into temp table:', err);
      throw err;
    }
  };

  const deleteFromTempTable = async (tempIds: number[]): Promise<void> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      await databaseService.deleteFromTempTable(tempIds);
    } catch (err) {
      console.error('Failed to delete from temp table:', err);
      throw err;
    }
  };

  const checkDuplicateTransactions = async (): Promise<string[]> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      return await databaseService.checkDuplicateTransactions();
    } catch (err) {
      console.error('Failed to check duplicate transactions:', err);
      throw err;
    }
  };

  const bulkInsertFromTempTable = async (): Promise<number> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      const count = await databaseService.bulkInsertFromTempTable();
      await refreshTransactions();
      return count;
    } catch (err) {
      console.error('Failed to bulk insert from temp table:', err);
      throw err;
    }
  };

  const dropTempImportTable = async (): Promise<void> => {
    // Remove this method completely - replaced by truncateImportTable
    console.warn('dropTempImportTable is deprecated, use truncateImportTable instead');
  };

  const addTransactionsBatch = async (
    transactions: Array<Omit<Transaction, "id" | "created_at" | "updated_at">>
  ): Promise<{ success: number; failed: number; errors: string[] }> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      const result = await databaseService.addTransactionsBatch(transactions);
      await refreshTransactions();
      return result;
    } catch (err) {
      console.error('Failed to add transactions batch:', err);
      throw err;
    }
  };

  // Category operations
  const addCategory = async (category: Omit<Category, "id" | "created_at" | "updated_at">): Promise<string> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      const id = await databaseService.addCategory(category);
      await refreshCategories();
      return id;
    } catch (err) {
      console.error('Failed to add category:', err);
      throw err;
    }
  };

  // Company operations
  const addCompany = async (name: string): Promise<number> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      const id = await databaseService.addCompany(name);
      await refreshCompanies();
      return id;
    } catch (err) {
      console.error('Failed to add company:', err);
      throw err;
    }
  };

  const findOrCreateCompany = async (name: string): Promise<number> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      const id = await databaseService.findOrCreateCompany(name);
      await refreshCompanies();
      return id;
    } catch (err) {
      console.error('Failed to find or create company:', err);
      throw err;
    }
  };

  // Account operations
  const addAccount = async (account: Omit<Account, "id" | "created_at" | "updated_at">): Promise<number> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      const id = await databaseService.addAccount(account);
      await refreshAccounts();
      return id;
    } catch (err) {
      console.error('Failed to add account:', err);
      throw err;
    }
  };

  const deleteAccount = async (id: number) => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      await databaseService.deleteAccount(id);
      await refreshAccounts();
    } catch (err) {
      console.error('Failed to delete account:', err);
      throw err;
    }
  };

  // Budget operations
  const addBudget = async (budget: Omit<Budget, "id" | "created_at" | "updated_at">): Promise<number> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      const id = await databaseService.addBudget(budget);
      await refreshBudgets();
      return id;
    } catch (err) {
      console.error('Failed to add budget:', err);
      throw err;
    }
  };

  // Project operations
  const addProject = async (project: Omit<Project, "id" | "created_at" | "updated_at">): Promise<number> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      const id = await databaseService.addProject(project);
      await refreshProjects();
      return id;
    } catch (err) {
      console.error('Failed to add project:', err);
      throw err;
    }
  };

  const updateProject = async (id: number, updates: Partial<Omit<Project, "id" | "created_at" | "updated_at">>) => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      await databaseService.updateProject(id, updates);
      await refreshProjects();
    } catch (err) {
      console.error('Failed to update project:', err);
      throw err;
    }
  };

  const deleteProject = async (id: number) => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      await databaseService.deleteProject(id);
      await refreshProjects();
    } catch (err) {
      console.error('Failed to delete project:', err);
      throw err;
    }
  };

  const getProjectById = async (id: number): Promise<Project | null> => {
    if (!databaseService) {
      return null;
    }

    try {
      return await databaseService.getProjectById(id);
    } catch (err) {
      console.error('Failed to get project by id:', err);
      return null;
    }
  };

  const getTransactionsByProject = async (projectId: number): Promise<Transaction[]> => {
    if (!databaseService) {
      return [];
    }

    try {
      return await databaseService.getTransactionsByProject(projectId);
    } catch (err) {
      console.error('Failed to get transactions by project:', err);
      return [];
    }
  };

  const getProjectCosts = async (projectId: number): Promise<{ estimated: number; actual: number; transactions_total: number }> => {
    if (!databaseService) {
      return { estimated: 0, actual: 0, transactions_total: 0 };
    }

    try {
      return await databaseService.getProjectCosts(projectId);
    } catch (err) {
      console.error('Failed to get project costs:', err);
      return { estimated: 0, actual: 0, transactions_total: 0 };
    }
  };

  // User operations
  const getUsers = async (): Promise<User[]> => {
    if (!databaseService) {
      return [];
    }

    try {
      return await databaseService.getUsers();
    } catch (err) {
      console.error('Failed to get users:', err);
      return [];
    }
  };

  const getUserById = async (id: number): Promise<User | null> => {
    if (!databaseService) {
      return null;
    }

    try {
      return await databaseService.getUserById(id);
    } catch (err) {
      console.error('Failed to get user by id:', err);
      return null;
    }
  };

  const addUser = async (user: Omit<User, "id" | "created_at" | "updated_at">): Promise<number> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      const id = await databaseService.addUser(user);
      await refreshUsers();
      return id;
    } catch (err) {
      console.error('Failed to add user:', err);
      throw err;
    }
  };

  const updateUser = async (
    id: number,
    updates: Partial<Omit<User, "id" | "created_at" | "updated_at">>
  ): Promise<void> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      await databaseService.updateUser(id, updates);
      await refreshUsers();
    } catch (err) {
      console.error('Failed to update user:', err);
      throw err;
    }
  };

  const deleteUser = async (id: number): Promise<void> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      await databaseService.deleteUser(id);
      await refreshUsers();
    } catch (err) {
      console.error('Failed to delete user:', err);
      throw err;
    }
  };

  const getAccountsByUserId = async (userId: number): Promise<Account[]> => {
    if (!databaseService) {
      return [];
    }

    try {
      return await databaseService.getAccountsByUserId(userId);
    } catch (err) {
      console.error('Failed to get accounts by user id:', err);
      return [];
    }
  };

  // Helper functions for CSV import
  const generateTransactionHash = (
    accountId: string,
    date: string,
    amount: number,
    description: string,
    uniqueIdentifier?: string
  ): string => {
    return DatabaseService.generateTransactionHashFromFields(
      accountId,
      date,
      amount,
      description,
      uniqueIdentifier
    );
  };

  // Transaction labeling
  const updateTransactionLabels = async (id: number, projectId: number | null, tripId: number | null) => {
    if (!databaseService) throw new Error('Database service not initialized');
    await databaseService.updateTransactionLabels(id, projectId, tripId);
    await refreshTransactions();
  };

  // Trip operations
  const getTrips = async (): Promise<Trip[]> => {
    if (!databaseService) throw new Error('Database service not initialized');
    return await databaseService.getTrips();
  };

  const getTripById = async (id: number): Promise<Trip | null> => {
    if (!databaseService) throw new Error('Database service not initialized');
    return await databaseService.getTripById(id);
  };

  const addTrip = async (trip: Omit<Trip, "id" | "created_at" | "updated_at">): Promise<number> => {
    if (!databaseService) throw new Error('Database service not initialized');
    const id = await databaseService.addTrip(trip);
    await refreshTrips();
    return id;
  };

  const updateTrip = async (
    id: number,
    updates: Partial<Omit<Trip, "id" | "created_at" | "updated_at">>
  ): Promise<void> => {
    if (!databaseService) throw new Error('Database service not initialized');
    await databaseService.updateTrip(id, updates);
    await refreshTrips();
  };

  const deleteTrip = async (id: number): Promise<void> => {
    if (!databaseService) throw new Error('Database service not initialized');
    await databaseService.deleteTrip(id);
    await refreshTrips();
  };

  const getTransactionsByTrip = async (tripId: number): Promise<Transaction[]> => {
    if (!databaseService) throw new Error('Database service not initialized');
    return await databaseService.getTransactionsByTrip(tripId);
  };

  const getTripCosts = async (
    tripId: number
  ): Promise<{
    estimated: number;
    actual: number;
    transactions_total: number;
  }> => {
    if (!databaseService) throw new Error('Database service not initialized');
    return await databaseService.getTripCosts(tripId);
  };

  const checkTransactionHashExists = async (hash: string): Promise<boolean> => {
    if (!databaseService) {
      return false;
    }

    try {
      // Query the database directly to check if hash exists
      const result = await databaseService.getWorkerService().query(
        'SELECT COUNT(*) as count FROM transactions WHERE transaction_hash = ?',
        [hash]
      );
      return result[0]?.count > 0;
    } catch (err) {
      console.error('Failed to check transaction hash:', err);
      return false;
    }
  };

  const findAccountsByLastFour = (lastFour: string): Account[] => {
    try {
      // Find accounts with the matching last four digits directly
      const matchingAccounts = accounts.filter(account => account.last_four === lastFour);
      return matchingAccounts;
    } catch (err) {
      console.error('Failed to find accounts by last four:', err);
      return [];
    }
  };

  // Custom SQL query execution
  const executeCustomQuery = async (sql: string): Promise<any[]> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
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

      // Execute the query using the worker service
      const result = await databaseService.getWorkerService().query(sql);
      return result;
    } catch (err) {
      console.error('Failed to execute custom query:', err);
      throw err;
    }
  };

  // Render setup UI during initialization states
  const handleCreateNew = async () => {
    try {
      await createOrOpenDatabase(true);
    } catch (err) {
      // Error already handled in createOrOpenDatabase
    }
  };

  const handleLoadFromFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.db,.sqlite,.sqlite3';
    
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        try {
          await loadDatabaseFromFile(file);
        } catch (err) {
          // Error already handled in loadDatabaseFromFile
        }
      }
    };
    
    input.click();
  };

  // Show loading screen while checking
  if (initializationState === 'checking') {
    return (
      <Box sx={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        p: 2
      }}>
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress size={60} sx={{ mb: 2 }} />
          <Typography variant="h6">Initializing database...</Typography>
        </Box>
      </Box>
    );
  }

  // Show browser compatibility testing
  if (initializationState === 'testing-browser') {
    return (
      <Box sx={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        p: 2
      }}>
        <TestBrowser onTestComplete={handleBrowserTestComplete} />
      </Box>
    );
  }

  // Show setup UI if no database exists
  if (initializationState === 'needs-setup') {
    return (
      <Box sx={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        p: 2
      }}>
        <Paper sx={{ p: 4, maxWidth: 500, textAlign: 'center' }}>
          <DatasetOutlined sx={{ fontSize: 60, color: 'primary.main', mb: 2 }} />
          <Typography variant="h4" gutterBottom>
            Welcome to Budget Tracker
          </Typography>
          <Typography variant="body1" sx={{ mb: 4 }}>
            To get started, you can create a new database or load an existing one from a file.
          </Typography>
          
          {error && (
            <Alert severity="error" sx={{ mb: 3 }}>
              {error}
            </Alert>
          )}
          
          <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            <Button
              variant="contained"
              startIcon={<CreateNewFolder />}
              onClick={handleCreateNew}
              disabled={isLoading}
              size="large"
            >
              Create New Database
            </Button>
            
            <Button
              variant="outlined"
              startIcon={<Upload />}
              onClick={handleLoadFromFile}
              disabled={isLoading}
              size="large"
            >
              Load from File
            </Button>
          </Box>
          
          {isLoading && (
            <Box sx={{ mt: 3 }}>
              <CircularProgress size={24} />
            </Box>
          )}
        </Paper>
      </Box>
    );
  }

  // Show error state
  if (initializationState === 'error') {
    return (
      <Box sx={{ 
        minHeight: '100vh', 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center',
        p: 2
      }}>
        <Paper sx={{ p: 4, maxWidth: 500, textAlign: 'center' }}>
          <Typography variant="h5" color="error" gutterBottom>
            Database Error
          </Typography>
          <Typography variant="body1" sx={{ mb: 3 }}>
            {error || 'An unknown error occurred while initializing the database.'}
          </Typography>
          <Button
            variant="contained"
            onClick={() => window.location.reload()}
          >
            Reload Page
          </Button>
        </Paper>
      </Box>
    );
  }

  // Normal app operation - database is initialized
  const contextValue: DatabaseContextType = {
    databaseService,
    isInitialized: initializationState === 'initialized',
    isDatabaseLoaded: initializationState === 'initialized',
    isLoading,
    error,
    workerStatus,
    transactions,
    categories,
    companies,
    accounts,
    budgets,
    projects,
    users,
    trips,
    createOrOpenDatabase,
    loadDatabaseFromFile,
    exportDatabase,
    refreshTransactions,
    refreshCategories,
    refreshCompanies,
    refreshAccounts,
    refreshBudgets,
    refreshProjects,
    refreshUsers,
    refreshTrips,
    refreshAll,
    addTransaction,
    addCategory,
    addCompany,
    findOrCreateCompany,
    addAccount,
    deleteAccount,
    addBudget,
    addProject,
    updateProject,
    deleteProject,
    getProjectById,
    getTransactionsByProject,
    getProjectCosts,
    getUsers,
    getUserById,
    addUser,
    updateUser,
    deleteUser,
    getAccountsByUserId,
    generateTransactionHash,
    checkTransactionHashExists,
    findAccountsByLastFour,
    executeCustomQuery,
    getAllTransactionHashes,
    truncateImportTable,
    insertIntoTempTable,
    deleteFromTempTable,
    checkDuplicateTransactions,
    bulkInsertFromTempTable,
    addTransactionsBatch,
    updateTransactionLabels,
    getTrips,
    getTripById,
    addTrip,
    updateTrip,
    deleteTrip,
    getTransactionsByTrip,
    getTripCosts,
  };
  return (  
    <DatabaseContext.Provider value={contextValue}>
    {children}
    </DatabaseContext.Provider>
  );
};
