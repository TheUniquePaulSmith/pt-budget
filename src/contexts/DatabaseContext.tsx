/**
 * Database provider grouped into domain slices.
 *
 * The provider still owns initialization and cached collections, but the
 * public context contract is organized by slice instead of mirroring the
 * entire service API as one flat object.
 */

"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo } from 'react';

import { DatabaseInitializationGate } from '../components/setup/DatabaseInitializationGate';
import type { CloudFilePickerState } from './useDatabaseInitialization';
import type { WorkerStatus } from '../lib/databaseWorkerService';
import {
  loadPersistedDatabaseSourceState,
  type CloudLinkedFile,
  type CloudProvider,
  type DatabaseSource,
  type PersistedDatabaseSourceState,
} from '../lib/databaseSourceStorage';
import type { AutoSyncSnapshot } from '../lib/cloudAutoSyncScheduler';
import {
  disconnectCloudProvider as disconnectCloudProviderAction,
  type ConflictResolutionChoice,
  type SyncStage,
} from '../lib/cloudSyncService';
import { GOOGLE_SCOPE, storeGoogleToken } from '../lib/cloudAuthGoogle';
import { useCloudAutoSync } from './useCloudAutoSync';
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
import {
  useDatabaseSubscriptionsSlice,
  type DatabaseSubscriptionsSlice,
} from './useDatabaseSubscriptionsSlice';
import {
  useDatabaseBudgetSlice,
  type DatabaseBudgetSlice,
} from './useDatabaseBudgetSlice';
import { useDatabaseInitialization } from './useDatabaseInitialization';
//import { appLogger } from '../lib/logger';

declare global {
  interface Window {
    __budgetTrackerTestApi?: {
      disconnectWorker: () => void;
      cancelSampleDataImport?: () => void;
      cloudSync?: {
        getSchedulerState: () => string;
        syncNow: () => Promise<void>;
        injectGoogleToken: (token: string, expiresAtMs: number) => void;
      };
    };
  }
}

interface DatabaseStatusSlice {
  isInitialized: boolean;
  isDatabaseLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  workerStatus: WorkerStatus | null;
  databaseSource: DatabaseSource;
  databaseSourceState: PersistedDatabaseSourceState;
  syncStatus: AutoSyncSnapshot;
  /** Fine-grained progress within a single sync attempt, null when not actively syncing. */
  syncStage: SyncStage | null;
  /** Shared with the pre-init gate — Settings also needs it for "Open from Google Drive/OneDrive" once the app is already running. */
  cloudFilePicker: CloudFilePickerState;
}

interface DatabaseLifecycleSlice {
  createOrOpenDatabase: (isNew: boolean) => Promise<void>;
  loadDatabaseFromFile: (file: File) => Promise<void>;
  exportDatabase: () => Promise<Uint8Array | null>;
  connectCloudSource: (provider?: CloudProvider) => Promise<void>;
  migrateDatabaseToCloud: (provider: CloudProvider) => Promise<void>;
  saveDatabaseToCurrentCloud: () => Promise<void>;
  switchToLocalSource: () => void;
  setEncryptionPassword: (password: string) => Promise<void>;
  clearEncryptionPassword: () => Promise<void>;
  /** Verifies `currentPassword`, then re-encrypts future exports/cloud uploads with `newPassword` and (if cloud-linked) immediately re-syncs. */
  changePassword: (currentPassword: string, newPassword: string) => Promise<{ syncError: string | null }>;
  /** Syncs to cloud (if linked), forgets the password, and gates the app until it's re-entered. Pass `{ skipSync: true }` to lock anyway after a failed sync attempt. */
  lockDatabase: (options?: { skipSync?: boolean }) => Promise<{ locked: boolean; syncError: string | null }>;
  /** Re-enters the password after a manual lock and resumes the app. */
  unlockDatabase: (password: string) => Promise<void>;
  syncNow: () => Promise<void>;
  setAutoSyncEnabled: (enabled: boolean) => void;
  setSyncIntervalMinutes: (minutes: number) => void;
  reconnectCloudSource: () => Promise<void>;
  resolveCloudConflict: (choice: ConflictResolutionChoice) => Promise<void>;
  disconnectCloudProvider: (provider: CloudProvider) => void;
  closeCloudFilePicker: () => void;
  handleCloudFileSelected: (file: CloudLinkedFile) => Promise<void>;
}

interface DatabaseDiagnosticsSlice {
  executeCustomQuery: (sql: string, timeoutMs?: number) => Promise<any[]>;
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
  subscriptions: DatabaseSubscriptionsSlice;
  budgets: DatabaseBudgetSlice;
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
const DatabaseSubscriptionsContext =
  createContext<DatabaseSubscriptionsSlice | null>(null);
const DatabaseBudgetContext = createContext<DatabaseBudgetSlice | null>(null);
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

export const useDatabaseSubscriptions = () =>
  useRequiredContext(DatabaseSubscriptionsContext, 'useDatabaseSubscriptions');

export const useDatabaseBudget = () =>
  useRequiredContext(DatabaseBudgetContext, 'useDatabaseBudget');

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
  subscriptions: useDatabaseSubscriptions(),
  budgets: useDatabaseBudget(),
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
    refreshBudgets,
    refreshCategories,
    refreshCompanies,
    refreshAccounts,
    refreshProjects,
    refreshUsers,
    refreshTrips,
    refreshMerchantRules,
    refreshRecurringSeries,
  } = useDatabaseCollectionsState({
    getDatabaseService: () => databaseService,
  });

  const {
    databaseService,
    databaseSource,
    databaseSourceState,
    setDatabaseSourceState,
    initializationState,
    isLoading,
    error,
    workerStatus,
    sampleDataImportProgress,
    disconnectWorker,
    storageMigrationStage,
    cloudFilePicker,
    setError,
    handleBrowserTestComplete,
    handlePasswordSetupConfirmed,
    handleInitialAccountConfirmed,
    skipInitialAccount,
    handlePasswordEntrySubmitted,
    cancelPasswordEntry,
    handleStorageChoiceSelected,
    handleCloudPasswordSubmitted,
    skipCloudUnlock,
    createOrOpenDatabase,
    loadDatabaseFromFile,
    connectCloudSource,
    closeCloudFilePicker,
    handleCloudFileSelected,
    migrateDatabaseToCloud,
    saveDatabaseToCurrentCloud,
    switchToLocalSource,
    cancelSampleDataImport,
    lockDatabaseState,
    unlockDatabase,
  } = useDatabaseInitialization({ loadAllData });

  const {
    syncStatus,
    syncStage,
    syncNow,
    setAutoSyncEnabled,
    setSyncIntervalMinutes,
    reconnect: reconnectCloudSource,
    resolveConflict: resolveCloudConflict,
  } = useCloudAutoSync({
    databaseService,
    databaseSourceState,
    setDatabaseSourceState,
    initializationState,
  });

  // Dev-only test hooks, consolidated here (rather than split across the
  // hooks that own each piece) so there's a single owner of this global —
  // two independent effects racing to set/merge the same window property
  // would be fragile.
  useEffect(() => {
    if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') {
      return;
    }

    window.__budgetTrackerTestApi = {
      disconnectWorker,
      cancelSampleDataImport,
      cloudSync: {
        getSchedulerState: () => syncStatus.state,
        syncNow,
        injectGoogleToken: (token: string, expiresAtMs: number) => {
          storeGoogleToken({ accessToken: token, expiresAtMs, scope: GOOGLE_SCOPE });
        },
      },
    };

    return () => {
      delete window.__budgetTrackerTestApi;
    };
  }, [disconnectWorker, cancelSampleDataImport, syncStatus.state, syncNow]);

  const disconnectCloudProvider = useCallback(
    (provider: CloudProvider) => {
      setDatabaseSourceState(disconnectCloudProviderAction(provider));
    },
    [setDatabaseSourceState]
  );

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

  const setEncryptionPassword = useCallback(async (password: string) => {
    if (!databaseService) throw new Error('Database service not initialized');
    await databaseService.setEncryptionPassword(password);
  }, [databaseService]);

  const clearEncryptionPassword = useCallback(async () => {
    if (!databaseService) throw new Error('Database service not initialized');
    await databaseService.clearEncryptionPassword();
  }, [databaseService]);

  /**
   * Verifies the current password, switches the worker over to the new one,
   * and (when cloud-linked) immediately re-syncs so the cloud copy is
   * re-encrypted under the new key rather than left stale under the old one.
   */
  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string): Promise<{ syncError: string | null }> => {
      if (!databaseService) throw new Error('Database service not initialized');

      const isCurrentPasswordValid = await databaseService.verifyCurrentPassword(currentPassword);
      if (!isCurrentPasswordValid) {
        throw new Error('Current password is incorrect.');
      }

      await databaseService.setEncryptionPassword(newPassword);

      if (databaseSource === 'local') {
        return { syncError: null };
      }

      await syncNow();
      return { syncError: loadPersistedDatabaseSourceState().lastSyncError };
    },
    [databaseService, databaseSource, syncNow]
  );

  /**
   * Syncs to cloud (if linked) then forgets the password and gates the app.
   * If a cloud sync is needed and fails, the password is left in place and
   * the caller (Settings UI) gets the failure back to decide whether to
   * confirm locking anyway via `{ skipSync: true }`.
   */
  const lockDatabase = useCallback(
    async (options?: { skipSync?: boolean }): Promise<{ locked: boolean; syncError: string | null }> => {
      if (databaseSource !== 'local' && !options?.skipSync) {
        await syncNow();
        const syncError = loadPersistedDatabaseSourceState().lastSyncError;
        if (syncError) {
          return { locked: false, syncError };
        }
      }

      await clearEncryptionPassword();
      lockDatabaseState();
      return { locked: true, syncError: null };
    },
    [databaseSource, syncNow, clearEncryptionPassword, lockDatabaseState]
  );

  const transactionsSlice = useDatabaseTransactionSlice({
    databaseService,
    refreshTransactions,
    refreshCategories,
    refreshCompanies,
    refreshRecurringSeries,
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
  const subscriptionsSlice = useDatabaseSubscriptionsSlice({
    databaseService,
    refreshTransactions,
    refreshCompanies,
    refreshMerchantRules,
    refreshRecurringSeries,
  });
  const budgetSlice = useDatabaseBudgetSlice({
    databaseService,
    refreshBudgets,
  });

  // Custom SQL query execution
  const executeCustomQuery = useCallback(async (sql: string, timeoutMs?: number): Promise<any[]> => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    try {
      // Sanitize the query to prevent dangerous operations
      const trimmedSql = sql.trim().toLowerCase();

      // Block potentially dangerous operations
      const dangerousKeywords = ['drop', 'delete', 'update', 'insert', 'alter', 'truncate'];
      const isDangerous = dangerousKeywords.some(keyword =>
        trimmedSql.includes(keyword + ' ') || trimmedSql.startsWith(keyword)
      );

      if (isDangerous) {
        throw new Error('Only SELECT queries are allowed for security reasons');
      }

      if (timeoutMs !== undefined) {
        return await databaseService.executeCustomQueryWithTimeout(sql, timeoutMs);
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
      databaseSource,
      databaseSourceState,
      syncStatus,
      syncStage,
      cloudFilePicker,
    }),
    [
      initializationState,
      isLoading,
      error,
      workerStatus,
      databaseSource,
      databaseSourceState,
      syncStatus,
      syncStage,
      cloudFilePicker,
    ]
  );

  const lifecycleValue = useMemo(
    () => ({
      createOrOpenDatabase,
      loadDatabaseFromFile,
      exportDatabase,
      connectCloudSource,
      migrateDatabaseToCloud,
      saveDatabaseToCurrentCloud,
      switchToLocalSource,
      setEncryptionPassword,
      clearEncryptionPassword,
      changePassword,
      lockDatabase,
      unlockDatabase,
      syncNow,
      setAutoSyncEnabled,
      setSyncIntervalMinutes,
      reconnectCloudSource,
      resolveCloudConflict,
      disconnectCloudProvider,
      closeCloudFilePicker,
      handleCloudFileSelected,
    }),
    [
      createOrOpenDatabase,
      loadDatabaseFromFile,
      exportDatabase,
      connectCloudSource,
      migrateDatabaseToCloud,
      saveDatabaseToCurrentCloud,
      switchToLocalSource,
      setEncryptionPassword,
      clearEncryptionPassword,
      changePassword,
      lockDatabase,
      unlockDatabase,
      syncNow,
      setAutoSyncEnabled,
      setSyncIntervalMinutes,
      reconnectCloudSource,
      resolveCloudConflict,
      disconnectCloudProvider,
      closeCloudFilePicker,
      handleCloudFileSelected,
    ]
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
        databaseSource={databaseSource}
        initializationState={initializationState}
        isLoading={isLoading}
        error={error}
        sampleDataImportProgress={sampleDataImportProgress}
        storageMigrationStage={storageMigrationStage}
        cloudFilePicker={cloudFilePicker}
        onBrowserTestComplete={handleBrowserTestComplete}
        onCreateOrOpenDatabase={createOrOpenDatabase}
        onLoadDatabaseFromFile={loadDatabaseFromFile}
        onConnectCloudSource={connectCloudSource}
        onCloseCloudFilePicker={closeCloudFilePicker}
        onCloudFileSelected={handleCloudFileSelected}
        onSwitchToLocalSource={switchToLocalSource}
        onCancelSampleDataImport={cancelSampleDataImport}
        onPasswordSetupConfirmed={handlePasswordSetupConfirmed}
        onInitialAccountConfirmed={handleInitialAccountConfirmed}
        onSkipInitialAccount={skipInitialAccount}
        onPasswordEntrySubmitted={handlePasswordEntrySubmitted}
        onCancelPasswordEntry={cancelPasswordEntry}
        onStorageChoiceSelected={handleStorageChoiceSelected}
        onCloudPasswordSubmitted={handleCloudPasswordSubmitted}
        onSkipCloudUnlock={skipCloudUnlock}
        onUnlockDatabase={unlockDatabase}
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
                        <DatabaseSubscriptionsContext.Provider value={subscriptionsSlice}>
                          <DatabaseBudgetContext.Provider value={budgetSlice}>
                            <DatabaseDiagnosticsContext.Provider value={diagnosticsValue}>
                              {children}
                            </DatabaseDiagnosticsContext.Provider>
                          </DatabaseBudgetContext.Provider>
                        </DatabaseSubscriptionsContext.Provider>
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
