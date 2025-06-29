"use client";

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  ReactNode,
  useCallback,
} from "react";
import {
  DatabaseManager,
  Transaction,
  Category,
  Company,
  Account,
  Budget,
  Project,
} from "../lib/database";
import { sessionManager } from "../lib/sessionManager";

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
  projects: Project[];
  // Database operations
  initializeDatabase: () => Promise<void>;
  createNewDatabase: () => void;
  loadDatabaseFromFile: (file: File) => Promise<void>;
  exportDatabase: () => Uint8Array | null;

  // Session management
  loadDatabaseFromSession: () => Promise<boolean>;
  saveDatabaseToSession: (fileName?: string) => Promise<void>;
  clearSession: () => Promise<void>;
  hasSession: () => Promise<boolean>;

  // Transaction operations
  addTransaction: (
    transaction: Omit<Transaction, "id" | "created_at" | "updated_at">
  ) => Promise<string>;
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
  getProjectById: (id: string) => Project | null;
  getTransactionsByProject: (projectId: string) => Transaction[];
  getProjectCosts: (projectId: string) => {
    estimated: number;
    actual: number;
    transactions_total: number;
  };

  // Analytics
  getTransactionsByDateRange: (
    startDate: string,
    endDate: string,
    type?: "income" | "expense"
  ) => Transaction[];
  getSpendingByCategory: (
    startDate: string,
    endDate: string
  ) => {
    category_id: string;
    category_name: string;
    total: number;
    color: string;
  }[];
  getIncomeByCategory: (
    startDate: string,
    endDate: string
  ) => {
    category_id: string;
    category_name: string;
    total: number;
    color: string;
  }[];  getMonthlyTrends: (
    months?: number
  ) => { month: string; income: number; expense: number }[];  // Auto-save functionality
  autoSaveEnabled: boolean;
  autoSaveFileHandle: FileSystemFileHandle | null;
  lastAutoSave: Date | null;
  setupAutoSave: () => Promise<boolean>;
  setupAutoSaveWithExistingFile: () => Promise<boolean>;
  setupAutoSaveWithFileHandle: (fileHandle: FileSystemFileHandle) => Promise<boolean>;
  enableAutoSave: () => Promise<boolean>;
  disableAutoSave: () => void;
  saveToFile: (fileHandle: FileSystemFileHandle) => Promise<void>;
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
  const [db, setDb] = useState<DatabaseManager | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [isDatabaseLoaded, setIsDatabaseLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);  // Data states
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);  // Auto-save states
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(false);
  const [autoSaveFileHandle, setAutoSaveFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [lastDataHash, setLastDataHash] = useState<string>('');

  const initializeDatabase = async () => {
    try {
      setIsLoading(true);
      setError(null);

      const dbManager = new DatabaseManager();
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

  const createNewDatabase = () => {
    if (!db || !isInitialized) {
      setError("Database not initialized");
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

      const arrayBuffer = await file.arrayBuffer();
      db.loadFromFile(arrayBuffer);
      setIsDatabaseLoaded(true);
      // Load data from the imported database
      refreshAllData();

      // Save to session for persistence
      await saveDatabaseToSession(file.name);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load database file"
      );
    } finally {
      setIsLoading(false);
    }
  };  const exportDatabase = useCallback((): Uint8Array | null => {
    if (!db || !isDatabaseLoaded) {
      setError("No database loaded to export");
      return null;
    }

    try {
      return db.exportToFile();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to export database"
      );
      return null;
    }
  }, [db, isDatabaseLoaded]);

  // Session management methods
  const loadDatabaseFromSession = async (): Promise<boolean> => {
    if (!db || !isInitialized) {
      setError("Database not initialized");
      return false;
    }

    try {
      setIsLoading(true);
      setError(null);
      const sessionData = await sessionManager.loadDatabaseFromSession();
      if (sessionData) {
        // Convert Uint8Array to ArrayBuffer
        const arrayBuffer = new ArrayBuffer(sessionData.byteLength);
        const view = new Uint8Array(arrayBuffer);
        view.set(sessionData);
        db.loadFromFile(arrayBuffer);
        setIsDatabaseLoaded(true);
        refreshAllData();
        return true;
      }

      return false;
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load database from session"
      );
      return false;
    } finally {
      setIsLoading(false);
    }
  };
  const saveDatabaseToSession = useCallback(async (fileName?: string): Promise<void> => {
    if (!db || !isDatabaseLoaded) {
      setError("No database loaded to save");
      return;
    }

    try {
      const dbData = db.exportToFile();
      if (dbData) {
        await sessionManager.saveDatabaseToSession(dbData, fileName);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to save database to session"
      );
    }
  }, [db, isDatabaseLoaded]);

  const clearSession = async (): Promise<void> => {
    try {
      await sessionManager.clearSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear session");
    }
  };
  const hasSession = async (): Promise<boolean> => {
    try {
      return await sessionManager.hasSession();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check session");
      return false;
    }
  };
  // Auto-save functionality
  const setupAutoSave = async (): Promise<boolean> => {
    if (!('showSaveFilePicker' in window)) {
      console.log('File System Access API is not supported in this browser.');
      return false;
    }

    try {
      const fileHandle = await (window as any).showSaveFilePicker({
        suggestedName: `budget-tracker-${new Date().toISOString().split('T')[0]}.db`,
        types: [{
          description: 'Database files',
          accept: { 'application/octet-stream': ['.db'] },
        }],
      });

      setAutoSaveFileHandle(fileHandle);
      setAutoSaveEnabled(true);
      
      // Perform initial save
      await saveToFile(fileHandle);
      
      return true;
    } catch (error) {
      console.log('User cancelled file selection or error occurred:', error);
      return false;
    }
  };
  const setupAutoSaveWithExistingFile = async (): Promise<boolean> => {
    if (!('showOpenFilePicker' in window)) {
      console.log('File System Access API is not supported in this browser.');
      return false;
    }

    try {
      const [fileHandle] = await (window as any).showOpenFilePicker({
        types: [{
          description: 'Database files',
          accept: { 'application/octet-stream': ['.db'] },
        }],
        multiple: false,
      });

      setAutoSaveFileHandle(fileHandle);
      setAutoSaveEnabled(true);
      
      // Perform initial save to update the file
      await saveToFile(fileHandle);
      
      return true;
    } catch (error) {
      console.log('User cancelled file selection or error occurred:', error);
      return false;
    }
  };
  const setupAutoSaveWithFileHandle = async (fileHandle: FileSystemFileHandle): Promise<boolean> => {
    try {
      setAutoSaveFileHandle(fileHandle);
      setAutoSaveEnabled(true);
      
      // Perform initial save to update the file
      await saveToFile(fileHandle);
      
      return true;
    } catch (error) {
      console.error('Error setting up auto-save with file handle:', error);
      return false;
    }
  };

  const enableAutoSave = async (): Promise<boolean> => {
    // This is essentially the same as setupAutoSave, but with a clearer name for manual enabling
    return await setupAutoSave();
  };  const saveToFile = useCallback(async (fileHandle: FileSystemFileHandle): Promise<void> => {
    if (isSaving) return; // Prevent concurrent saves
    
    try {
      setIsSaving(true);
      const dbData = exportDatabase();
      if (dbData) {
        const writable = await fileHandle.createWritable();
        await writable.write(dbData);
        await writable.close();
        setLastAutoSave(new Date());
        console.log('Database auto-saved successfully at', new Date().toLocaleTimeString());
        
        // Also save to session for persistence
        await saveDatabaseToSession(fileHandle.name);
      }
    } catch (error) {
      console.error('Error auto-saving database:', error);
      setAutoSaveEnabled(false);
      setAutoSaveFileHandle(null);
      throw error;
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, exportDatabase, saveDatabaseToSession]);
  const disableAutoSave = (): void => {
    setAutoSaveEnabled(false);
    setAutoSaveFileHandle(null);
    setLastAutoSave(null);
  };  // Auto-save when data changes
  React.useEffect(() => {
    // Create a simple hash of the data to detect actual changes
    const currentDataHash = `${transactions.length}-${categories.length}-${companies.length}-${accounts.length}-${budgets.length}-${projects.length}`;
    
    // Only trigger auto-save if the data has actually changed and we're not in initial loading
    if (currentDataHash !== lastDataHash && lastDataHash !== '' && !isLoading && isDatabaseLoaded) {
      setLastDataHash(currentDataHash);
      
      if (autoSaveEnabled && autoSaveFileHandle) {
        const timeoutId = setTimeout(() => {
          saveToFile(autoSaveFileHandle).catch(console.error);
        }, 2000); // Save 2 seconds after last change

        return () => clearTimeout(timeoutId);
      } else {
        // If auto-save is not enabled, still save to session for persistence
        const timeoutId = setTimeout(() => {
          saveDatabaseToSession().catch(console.error);
        }, 3000); // Save to session 3 seconds after last change

        return () => clearTimeout(timeoutId);
      }
    } else if (lastDataHash === '') {
      // Set initial hash without triggering save
      setLastDataHash(currentDataHash);
    }
  }, [transactions.length, categories.length, companies.length, accounts.length, budgets.length, projects.length, autoSaveEnabled, autoSaveFileHandle, isDatabaseLoaded, isLoading, lastDataHash, saveDatabaseToSession, saveToFile]);

  const refreshAllData = useCallback(() => {
    if (!db || !isDatabaseLoaded) return;

    try {
      setTransactions(db.getTransactions());
      setCategories(db.getCategories());
      setCompanies(db.getCompanies());
      setAccounts(db.getAccounts());
      setBudgets(db.getBudgets());
      setProjects(db.getProjects());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh data");
    }
  }, [db, isDatabaseLoaded]);

  // Transaction operations
  const addTransaction = async (
    transaction: Omit<Transaction, "id" | "created_at" | "updated_at">
  ): Promise<string> => {
    if (!db || !isDatabaseLoaded) {
      throw new Error("Database not loaded");
    }
    try {
      const id = db.addTransaction(transaction);
      refreshTransactions();
      // Auto-save to session after adding transaction
      await saveDatabaseToSession();
      return id;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to add transaction";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const refreshTransactions = useCallback(() => {
    if (!db || !isDatabaseLoaded) return;
    try {
      setTransactions(db.getTransactions());
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
      const id = db.addCategory(category);
      refreshCategories();
      return id;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to add category";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const refreshCategories = useCallback(() => {
    if (!db || !isDatabaseLoaded) return;
    try {
      setCategories(db.getCategories());
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
      const id = db.addCompany(name);
      refreshCompanies();
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
      const existing = db.findCompanyByName(name);
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
  const refreshCompanies = useCallback(() => {
    if (!db || !isDatabaseLoaded) return;
    try {
      setCompanies(db.getCompanies());
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
      const id = db.addAccount(account);
      refreshAccounts();
      return id;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to add account";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const refreshAccounts = useCallback(() => {
    if (!db || !isDatabaseLoaded) return;
    try {
      setAccounts(db.getAccounts());
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
      const id = db.addBudget(budget);
      refreshBudgets();
      return id;
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to add budget";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };
  const refreshBudgets = useCallback(() => {
    if (!db || !isDatabaseLoaded) return;
    try {
      setBudgets(db.getBudgets());
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
      const id = db.addProject(project);
      refreshProjects();
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
      console.log("Updating project with ID:", id);
      console.log("Update data:", updates);
      db.updateProject(id, updates);
      refreshProjects();
    } catch (err) {
      console.error("DatabaseContext updateProject error:", err);
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
      db.deleteProject(id);
      refreshProjects();
      refreshTransactions(); // Refresh transactions as project references may have been cleared
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to delete project";
      setError(errorMessage);
      throw new Error(errorMessage);
    }
  };

  const refreshProjects = useCallback(() => {
    if (!db || !isDatabaseLoaded) return;
    try {
      setProjects(db.getProjects());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to refresh projects"
      );
    }
  }, [db, isDatabaseLoaded]);

  const getProjectById = (id: string): Project | null => {
    if (!db || !isDatabaseLoaded) return null;
    try {
      return db.getProjectById(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to get project");
      return null;
    }
  };

  const getTransactionsByProject = (projectId: string): Transaction[] => {
    if (!db || !isDatabaseLoaded) return [];
    try {
      return db.getTransactionsByProject(projectId);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to get transactions for project"
      );
      return [];
    }
  };

  const getProjectCosts = (
    projectId: string
  ): { estimated: number; actual: number; transactions_total: number } => {
    if (!db || !isDatabaseLoaded)
      return { estimated: 0, actual: 0, transactions_total: 0 };
    try {
      return db.getProjectCosts(projectId);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to get project costs"
      );
      return { estimated: 0, actual: 0, transactions_total: 0 };
    }
  };

  // Analytics operations
  const getTransactionsByDateRange = (
    startDate: string,
    endDate: string,
    type?: "income" | "expense"
  ): Transaction[] => {
    if (!db || !isDatabaseLoaded) return [];
    try {
      return db.getTransactionsByDateRange(startDate, endDate, type);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to get transactions by date range"
      );
      return [];
    }
  };

  const getSpendingByCategory = (startDate: string, endDate: string) => {
    if (!db || !isDatabaseLoaded) return [];
    try {
      return db.getSpendingByCategory(startDate, endDate);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to get spending by category"
      );
      return [];
    }
  };

  const getIncomeByCategory = (startDate: string, endDate: string) => {
    if (!db || !isDatabaseLoaded) return [];
    try {
      return db.getIncomeByCategory(startDate, endDate);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to get income by category"
      );
      return [];
    }
  };

  const getMonthlyTrends = (months: number = 12) => {
    if (!db || !isDatabaseLoaded) return [];
    try {
      return db.getMonthlyTrends(months);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to get monthly trends"
      );
      return [];
    }
  };  const contextValue: DatabaseContextType = {
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
    projects,
    initializeDatabase,
    createNewDatabase,
    loadDatabaseFromFile,
    exportDatabase,
    loadDatabaseFromSession,
    saveDatabaseToSession,
    clearSession,
    hasSession,
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
    getMonthlyTrends,    autoSaveEnabled,
    autoSaveFileHandle,
    lastAutoSave,
    setupAutoSave,
    setupAutoSaveWithExistingFile,
    setupAutoSaveWithFileHandle,
    enableAutoSave,
    disableAutoSave,
    saveToFile,
  };

  return (
    <DatabaseContext.Provider value={contextValue}>
      {children}
    </DatabaseContext.Provider>
  );
};
