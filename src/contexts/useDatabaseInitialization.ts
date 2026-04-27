'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { TestResults } from '../components/setup/TestBrowser';
import { DatabaseService } from '../lib/databaseService';
import type { WorkerStatus } from '../lib/databaseWorkerService';
import { SampleDataService } from '../lib/sampleDataService';

export type InitializationState =
  | 'checking'
  | 'testing-browser'
  | 'needs-setup'
  | 'initialized'
  | 'error';

interface UseDatabaseInitializationOptions {
  loadAllData: (service: DatabaseService) => Promise<void>;
}

interface UseDatabaseInitializationResult {
  databaseService: DatabaseService | null;
  initializationState: InitializationState;
  isLoading: boolean;
  error: string | null;
  workerStatus: WorkerStatus | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  handleBrowserTestComplete: (
    isCompatible: boolean,
    testResults: TestResults
  ) => Promise<void>;
  createOrOpenDatabase: (isNew: boolean) => Promise<void>;
  loadDatabaseFromFile: (file: File) => Promise<void>;
}

declare global {
  interface Window {
    __budgetTrackerTestApi?: {
      disconnectWorker: () => void;
    };
  }
}

const BROWSER_TEST_STORAGE_KEY = 'budgetApp_browserTestPassed';

export function useDatabaseInitialization({
  loadAllData,
}: UseDatabaseInitializationOptions): UseDatabaseInitializationResult {
  const [databaseService, setDatabaseService] =
    useState<DatabaseService | null>(null);
  const [initializationState, setInitializationState] =
    useState<InitializationState>('checking');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const hasCheckedDatabase = useRef(false);

  const handleBrowserTestComplete = useCallback(
    async (isCompatible: boolean, _testResults: TestResults) => {
      if (!isCompatible) {
        return;
      }

      try {
        const service = new DatabaseService();

        console.debug('[DB Context] Calling initialize to worker service...');
        await service.initialize();

        console.info('[DB Context] Monitoring database worker service...');
        const workerService = service.getWorkerService();
        workerService.onStatusChange(setWorkerStatus);

        setDatabaseService(service);

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
        setError(
          err instanceof Error ? err.message : 'Failed to initialize database'
        );
        setInitializationState('error');
      }
    },
    [loadAllData]
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (hasCheckedDatabase.current) {
      return;
    }

    const initializeAndCheck = async () => {
      const previousTestResults = localStorage.getItem(
        BROWSER_TEST_STORAGE_KEY
      );

      if (previousTestResults) {
        try {
          const savedResults = JSON.parse(previousTestResults) as TestResults;
          if (savedResults.overallCompatible) {
            console.log(
              '[DB Context] Using cached browser compatibility results, skipping test'
            );
            await handleBrowserTestComplete(true, savedResults);
            return;
          }
        } catch (err) {
          console.warn(
            '[DB Context] Failed to parse cached test results, running test again',
            err
          );
          localStorage.removeItem(BROWSER_TEST_STORAGE_KEY);
        }
      }

      setInitializationState('testing-browser');
    };

    void initializeAndCheck();
  }, [handleBrowserTestComplete]);

  useEffect(() => {
    if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') {
      return;
    }

    window.__budgetTrackerTestApi = {
      disconnectWorker: () => {
        databaseService?.getWorkerService().destroy?.();
        setWorkerStatus((currentStatus) => ({
          isWorkerAlive: false,
          isConnected: false,
          dbStatus: 'disconnected',
          version: currentStatus?.version || '1.0.0',
          lastHeartbeat: currentStatus?.lastHeartbeat || 0,
        }));
      },
    };

    return () => {
      delete window.__budgetTrackerTestApi;
    };
  }, [databaseService]);

  const createOrOpenDatabase = useCallback(
    async (isNew: boolean) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      setIsLoading(true);
      setError(null);

      try {
        if (isNew) {
          await databaseService.createNewDatabase();

          if (SampleDataService.shouldLoadSampleData()) {
            console.info('[DB Context] Loading sample data...');
            try {
              await SampleDataService.loadAllSampleData();
              console.info('[DB Context] Sample data loaded successfully');
            } catch (sampleError) {
              console.error(
                '[DB Context] Failed to load sample data:',
                sampleError
              );
              setError('Database created but sample data failed to load');
            }
          }
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
    },
    [databaseService, loadAllData]
  );

  const loadDatabaseFromFile = useCallback(
    async (file: File) => {
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
        setError(
          err instanceof Error ? err.message : 'Failed to load database file'
        );
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [databaseService, loadAllData]
  );

  return {
    databaseService,
    initializationState,
    isLoading,
    error,
    workerStatus,
    setError,
    handleBrowserTestComplete,
    createOrOpenDatabase,
    loadDatabaseFromFile,
  };
}

