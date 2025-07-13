/**
 * Simplified Database Context
 * 
 * Combines database initialization and data management in a single context.
 * Eliminates the need for separate DatabaseInitializer component.
 */

"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
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
  AccountAlias,
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
  accountAliases: AccountAlias[];
  
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
  refreshAccountAliases: () => Promise<void>;
  refreshAll: () => Promise<void>;

  // Transaction operations
  addTransaction: (
    transaction: Omit<Transaction, "id" | "created_at" | "updated_at">
  ) => Promise<void>;

  // Category operations
  addCategory: (
    category: Omit<Category, "id" | "created_at" | "updated_at">
  ) => Promise<string>;

  // Company operations
  addCompany: (name: string) => Promise<string>;
  findOrCreateCompany: (name: string) => Promise<string>;

  // Account operations
  addAccount: (
    account: Omit<Account, "id" | "created_at" | "updated_at">
  ) => Promise<string>;
  deleteAccount: (id: string) => Promise<void>;

  // Budget operations
  addBudget: (
    budget: Omit<Budget, "id" | "created_at" | "updated_at">
  ) => Promise<string>;

  // Project operations
  addProject: (
    project: Omit<Project, "id" | "created_at" | "updated_at">
  ) => Promise<string>;
  updateProject: (
    id: string,
    updates: Partial<Omit<Project, "id" | "created_at" | "updated_at">>
  ) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  getProjectById: (id: string) => Promise<Project | null>;
  getTransactionsByProject: (projectId: string) => Promise<Transaction[]>;
  getProjectCosts: (
    projectId: string
  ) => Promise<{
    estimated: number;
    actual: number;
    transactions_total: number;
  }>;

  // Account Alias operations
  getAccountAliases: () => Promise<AccountAlias[]>;
  getAccountAliasesByAccountId: (accountId: string) => Promise<AccountAlias[]>;
  findAccountAliasesByLastFour: (lastFour: string) => Promise<AccountAlias[]>;
  addAccountAlias: (
    alias: Omit<AccountAlias, "id" | "created_at" | "updated_at">
  ) => Promise<string>;
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
  const [accountAliases, setAccountAliases] = useState<AccountAlias[]>([]);
  
  const hasCheckedDatabase = useRef(false);

   const initializeAndCheck = async () => {
      // First test browser compatibility
      setInitializationState('testing-browser');
      // Browser testing will trigger the next phase via handleBrowserTestComplete
    };

   const handleBrowserTestComplete = async (isCompatible: boolean, testResults: any) => {
      setIsBrowserCompatible(isCompatible);
      
      if (!isCompatible) {
        setError('Your browser is not compatible with this application. Please use a modern browser with WebAssembly and SharedWorker support.');
        setInitializationState('error');
        return;
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

    // Initialize the database service
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
        accountAliasesData
      ] = await Promise.all([
        service.getTransactions(),
        service.getCategories(),
        service.getCompanies(),
        service.getAccounts(),
        service.getBudgets(),
        service.getProjects(),
        service.getAccountAliases()
      ]);

      setTransactions(transactionsData);
      setCategories(categoriesData);
      setCompanies(companiesData);
      setAccounts(accountsData);
      setBudgets(budgetsData);
      setProjects(projectsData);
      setAccountAliases(accountAliasesData);
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
  const refreshTransactions = async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getTransactions();
      setTransactions(data);
    } catch (err) {
      console.error('Failed to refresh transactions:', err);
    }
  };

  const refreshCategories = async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getCategories();
      setCategories(data);
    } catch (err) {
      console.error('Failed to refresh categories:', err);
    }
  };

  const refreshCompanies = async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getCompanies();
      setCompanies(data);
    } catch (err) {
      console.error('Failed to refresh companies:', err);
    }
  };

  const refreshAccounts = async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getAccounts();
      setAccounts(data);
    } catch (err) {
      console.error('Failed to refresh accounts:', err);
    }
  };

  const refreshBudgets = async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getBudgets();
      setBudgets(data);
    } catch (err) {
      console.error('Failed to refresh budgets:', err);
    }
  };

  const refreshProjects = async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getProjects();
      setProjects(data);
    } catch (err) {
      console.error('Failed to refresh projects:', err);
    }
  };

  const refreshAccountAliases = async () => {
    if (!databaseService) return;
    try {
      const data = await databaseService.getAccountAliases();
      setAccountAliases(data);
    } catch (err) {
      console.error('Failed to refresh account aliases:', err);
    }
  };

  const refreshAll = async () => {
    if (!databaseService) return;
    try {
      await loadAllData(databaseService);
    } catch (err) {
      console.error('Failed to refresh all data:', err);
    }
  };

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
  const addCompany = async (name: string): Promise<string> => {
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

  const findOrCreateCompany = async (name: string): Promise<string> => {
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
  const addAccount = async (account: Omit<Account, "id" | "created_at" | "updated_at">): Promise<string> => {
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

  const deleteAccount = async (id: string) => {
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
  const addBudget = async (budget: Omit<Budget, "id" | "created_at" | "updated_at">): Promise<string> => {
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
  const addProject = async (project: Omit<Project, "id" | "created_at" | "updated_at">): Promise<string> => {
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

  const updateProject = async (id: string, updates: Partial<Omit<Project, "id" | "created_at" | "updated_at">>) => {
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

  const deleteProject = async (id: string) => {
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

  const getProjectById = async (id: string): Promise<Project | null> => {
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

  const getTransactionsByProject = async (projectId: string): Promise<Transaction[]> => {
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

  const getProjectCosts = async (projectId: string): Promise<{ estimated: number; actual: number; transactions_total: number }> => {
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

  // Account Alias operations
  const getAccountAliases = async (): Promise<AccountAlias[]> => {
    if (!databaseService) {
      return [];
    }

    try {
      return await databaseService.getAccountAliases();
    } catch (err) {
      console.error('Failed to get account aliases:', err);
      return [];
    }
  };

  const getAccountAliasesByAccountId = async (accountId: string): Promise<AccountAlias[]> => {
    if (!databaseService) {
      return [];
    }

    try {
      return await databaseService.getAccountAliasesByAccountId(accountId);
    } catch (err) {
      console.error('Failed to get account aliases by account id:', err);
      return [];
    }
  };

  const findAccountAliasesByLastFour = async (lastFour: string): Promise<AccountAlias[]> => {
    if (!databaseService) {
      return [];
    }

    try {
      return await databaseService.findAccountAliasesByLastFour(lastFour);
    } catch (err) {
      console.error('Failed to find account aliases by last four:', err);
      return [];
    }
  };

  const addAccountAlias = async (alias: Omit<AccountAlias, "id" | "created_at" | "updated_at">): Promise<string> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      const id = await databaseService.addAccountAlias(alias);
      await refreshAccountAliases();
      return id;
    } catch (err) {
      console.error('Failed to add account alias:', err);
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
    accountAliases,
    createOrOpenDatabase,
    loadDatabaseFromFile,
    exportDatabase,
    refreshTransactions,
    refreshCategories,
    refreshCompanies,
    refreshAccounts,
    refreshBudgets,
    refreshProjects,
    refreshAccountAliases,
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
    getAccountAliases,
    getAccountAliasesByAccountId,
    findAccountAliasesByLastFour,
    addAccountAlias,
  };

  return (
    <DatabaseContext.Provider value={contextValue}>
      {children}
    </DatabaseContext.Provider>
  );
};
