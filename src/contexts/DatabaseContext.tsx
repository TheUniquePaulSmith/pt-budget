/**
 * Database provider grouped into domain slices.
 *
 * The provider still owns initialization and cached collections, but the
 * public context contract is organized by slice instead of mirroring the
 * entire service API as one flat object.
 */

"use client";

import React, { createContext, useCallback, useContext, useMemo } from 'react';

import { DatabaseInitializationGate } from '../components/setup/DatabaseInitializationGate';
import type { WorkerStatus } from '../lib/databaseWorkerService';
import {
  useDatabaseAccountManagementSlices,
  type DatabaseAccountSlice,
  type DatabaseUserSlice,
} from './useDatabaseAccountManagementSlices';
import {
  useDatabaseCatalogAndPlanningSlices,
  type DatabaseCategorySlice,
  type DatabaseCompanySlice,
  type DatabaseProjectSlice,
  type DatabaseTripSlice,
} from './useDatabaseCatalogAndPlanningSlices';
import {
  useDatabaseCollectionsState,
  type DatabaseCollectionsSlice,
} from './useDatabaseCollectionsState';
import {
  useDatabaseTransactionSlice,
  type DatabaseTransactionSlice,
} from './useDatabaseTransactionSlice';
import { useDatabaseInitialization } from './useDatabaseInitialization';
//import { appLogger } from '../lib/logger';

interface DatabaseStatusSlice {
  isInitialized: boolean;
  isDatabaseLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  workerStatus: WorkerStatus | null;
}

interface DatabaseLifecycleSlice {
  createOrOpenDatabase: (isNew: boolean) => Promise<void>;
  loadDatabaseFromFile: (file: File) => Promise<void>;
  exportDatabase: () => Promise<Uint8Array | null>;
}

interface DatabaseDiagnosticsSlice {
  executeCustomQuery: (sql: string) => Promise<any[]>;
}

interface DatabaseContextType {
  status: DatabaseStatusSlice;
  collections: DatabaseCollectionsSlice;
  lifecycle: DatabaseLifecycleSlice;
  transactions: DatabaseTransactionSlice;
  categories: DatabaseCategorySlice;
  companies: DatabaseCompanySlice;
  accounts: DatabaseAccountSlice;
  projects: DatabaseProjectSlice;
  users: DatabaseUserSlice;
  trips: DatabaseTripSlice;
  diagnostics: DatabaseDiagnosticsSlice;
}

const DatabaseStatusContext = createContext<DatabaseStatusSlice | null>(null);
const DatabaseCollectionsContext =
  createContext<DatabaseCollectionsSlice | null>(null);
const DatabaseLifecycleContext =
  createContext<DatabaseLifecycleSlice | null>(null);
const DatabaseTransactionsContext =
  createContext<DatabaseTransactionSlice | null>(null);
const DatabaseCategoriesContext =
  createContext<DatabaseCategorySlice | null>(null);
const DatabaseCompaniesContext =
  createContext<DatabaseCompanySlice | null>(null);
const DatabaseAccountsContext =
  createContext<DatabaseAccountSlice | null>(null);
const DatabaseProjectsContext =
  createContext<DatabaseProjectSlice | null>(null);
const DatabaseUsersContext = createContext<DatabaseUserSlice | null>(null);
const DatabaseTripsContext = createContext<DatabaseTripSlice | null>(null);
const DatabaseDiagnosticsContext =
  createContext<DatabaseDiagnosticsSlice | null>(null);

function useRequiredContext<T>(
  context: React.Context<T | null>,
  hookName: string
): T {
  const value = useContext(context);
  if (!value) {
    throw new Error(`${hookName} must be used within a DatabaseProvider`);
  }

  return value;
}

export const useDatabaseStatus = () =>
  useRequiredContext(DatabaseStatusContext, 'useDatabaseStatus');

export const useDatabaseCollections = () =>
  useRequiredContext(DatabaseCollectionsContext, 'useDatabaseCollections');

export const useDatabaseLifecycle = () =>
  useRequiredContext(DatabaseLifecycleContext, 'useDatabaseLifecycle');

export const useDatabaseTransactions = () =>
  useRequiredContext(DatabaseTransactionsContext, 'useDatabaseTransactions');

export const useDatabaseCategories = () =>
  useRequiredContext(DatabaseCategoriesContext, 'useDatabaseCategories');

export const useDatabaseCompanies = () =>
  useRequiredContext(DatabaseCompaniesContext, 'useDatabaseCompanies');

export const useDatabaseAccounts = () =>
  useRequiredContext(DatabaseAccountsContext, 'useDatabaseAccounts');

export const useDatabaseProjects = () =>
  useRequiredContext(DatabaseProjectsContext, 'useDatabaseProjects');

export const useDatabaseUsers = () =>
  useRequiredContext(DatabaseUsersContext, 'useDatabaseUsers');

export const useDatabaseTrips = () =>
  useRequiredContext(DatabaseTripsContext, 'useDatabaseTrips');

export const useDatabaseDiagnostics = () =>
  useRequiredContext(DatabaseDiagnosticsContext, 'useDatabaseDiagnostics');

export const useDatabaseContext = (): DatabaseContextType => ({
  status: useDatabaseStatus(),
  collections: useDatabaseCollections(),
  lifecycle: useDatabaseLifecycle(),
  transactions: useDatabaseTransactions(),
  categories: useDatabaseCategories(),
  companies: useDatabaseCompanies(),
  accounts: useDatabaseAccounts(),
  projects: useDatabaseProjects(),
  users: useDatabaseUsers(),
  trips: useDatabaseTrips(),
  diagnostics: useDatabaseDiagnostics(),
});

interface DatabaseProviderProps {
  children: React.ReactNode;
}

export const DatabaseProvider: React.FC<DatabaseProviderProps> = ({
  children,
}) => {
  const {
    collections,
    loadAllData,
    refreshTransactions,
    refreshCategories,
    refreshCompanies,
    refreshAccounts,
    refreshProjects,
    refreshUsers,
    refreshTrips,
  } = useDatabaseCollectionsState({
    getDatabaseService: () => databaseService,
  });

  const {
    databaseService,
    initializationState,
    isLoading,
    error,
    workerStatus,
    sampleDataImportProgress,
    setError,
    handleBrowserTestComplete,
    createOrOpenDatabase,
    loadDatabaseFromFile,
    cancelSampleDataImport,
  } = useDatabaseInitialization({ loadAllData });

  const exportDatabase = useCallback(async (): Promise<Uint8Array | null> => {
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
  }, [databaseService, setError]);

  const transactionsSlice = useDatabaseTransactionSlice({
    databaseService,
    refreshTransactions,
  });
  const { accountsSlice, usersSlice } = useDatabaseAccountManagementSlices({
    databaseService,
    refreshAccounts,
    refreshUsers,
  });
  const {
    categoriesSlice,
    companiesSlice,
    projectsSlice,
    tripsSlice,
  } = useDatabaseCatalogAndPlanningSlices({
    databaseService,
    refreshCategories,
    refreshCompanies,
    refreshProjects,
    refreshTrips,
  });

  // Custom SQL query execution
  const executeCustomQuery = useCallback(async (sql: string): Promise<any[]> => {
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

      return await databaseService.executeCustomQuery(sql);
    } catch (err) {
      console.error('Failed to execute custom query:', err);
      throw err;
    }
  }, [databaseService]);

  const statusValue = useMemo(
    () => ({
      isInitialized: initializationState === 'initialized',
      isDatabaseLoaded: initializationState === 'initialized',
      isLoading,
      error,
      workerStatus,
    }),
    [initializationState, isLoading, error, workerStatus]
  );

  const lifecycleValue = useMemo(
    () => ({
      createOrOpenDatabase,
      loadDatabaseFromFile,
      exportDatabase,
    }),
    [createOrOpenDatabase, loadDatabaseFromFile, exportDatabase]
  );

  const diagnosticsValue = useMemo(
    () => ({
      executeCustomQuery,
    }),
    [executeCustomQuery]
  );

  if (initializationState !== 'initialized') {
    return (
      <DatabaseInitializationGate
        initializationState={initializationState}
        isLoading={isLoading}
        error={error}
        sampleDataImportProgress={sampleDataImportProgress}
        onBrowserTestComplete={handleBrowserTestComplete}
        onCreateOrOpenDatabase={createOrOpenDatabase}
        onLoadDatabaseFromFile={loadDatabaseFromFile}
        onCancelSampleDataImport={cancelSampleDataImport}
      />
    );
  }

  return (
    <DatabaseStatusContext.Provider value={statusValue}>
      <DatabaseCollectionsContext.Provider value={collections}>
        <DatabaseLifecycleContext.Provider value={lifecycleValue}>
          <DatabaseTransactionsContext.Provider value={transactionsSlice}>
            <DatabaseCategoriesContext.Provider value={categoriesSlice}>
              <DatabaseCompaniesContext.Provider value={companiesSlice}>
                <DatabaseAccountsContext.Provider value={accountsSlice}>
                  <DatabaseProjectsContext.Provider value={projectsSlice}>
                    <DatabaseUsersContext.Provider value={usersSlice}>
                      <DatabaseTripsContext.Provider value={tripsSlice}>
                        <DatabaseDiagnosticsContext.Provider value={diagnosticsValue}>
                          {children}
                        </DatabaseDiagnosticsContext.Provider>
                      </DatabaseTripsContext.Provider>
                    </DatabaseUsersContext.Provider>
                  </DatabaseProjectsContext.Provider>
                </DatabaseAccountsContext.Provider>
              </DatabaseCompaniesContext.Provider>
            </DatabaseCategoriesContext.Provider>
          </DatabaseTransactionsContext.Provider>
        </DatabaseLifecycleContext.Provider>
      </DatabaseCollectionsContext.Provider>
    </DatabaseStatusContext.Provider>
  );
};
