'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { TestResults } from '../components/setup/TestBrowser';
import { DatabaseService } from '../lib/databaseService';
import type { WorkerStatus } from '../lib/databaseWorkerService';
import {
  openDatabaseFromCloud,
  saveDatabaseToCloud,
  switchDatabaseSource as persistDatabaseSourceSelection,
} from '@/lib/cloudSyncService';
import { isEncryptedArchive } from '@/lib/databaseEncryption';
import type {
  CloudProvider,
  DatabaseSource,
  PersistedDatabaseSourceState,
} from '@/lib/databaseSourceStorage';
import { loadPersistedDatabaseSourceState } from '@/lib/databaseSourceStorage';
import { SampleDataService } from '@/lib/sampleDataService';
import type { SampleDataImportProgress } from '@/lib/sampleDataService';

export type InitializationState =
  | 'checking'
  | 'testing-browser'
  | 'needs-setup'
  /** New database: user must choose a password before creation proceeds. */
  | 'needs-password-setup'
  /** Loading an encrypted archive: user must enter the password to decrypt. */
  | 'needs-password-entry'
  | 'needs-cloud-auth'
  | 'initialized'
  | 'error';

interface UseDatabaseInitializationOptions {
  loadAllData: (service: DatabaseService) => Promise<void>;
}

interface UseDatabaseInitializationResult {
  databaseService: DatabaseService | null;
  databaseSource: DatabaseSource;
  databaseSourceState: PersistedDatabaseSourceState;
  initializationState: InitializationState;
  isLoading: boolean;
  error: string | null;
  workerStatus: WorkerStatus | null;
  sampleDataImportProgress: SampleDataImportProgress | null;
  /**
   * The cloud provider actually being connected/retried on the
   * needs-cloud-auth screen. Tracked separately from
   * databaseSourceState.source because a failed connectCloudSource() call
   * can throw before that persisted state is ever updated.
   */
  cloudAuthProvider: CloudProvider | null;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  handleBrowserTestComplete: (
    isCompatible: boolean,
    testResults: TestResults
  ) => Promise<void>;
  /**
   * Called by the password setup screen once the user has confirmed a password.
   * Sets the password in the worker and then creates the new database.
   */
  handlePasswordSetupConfirmed: (password: string, primaryUserName: string) => Promise<void>;
  /**
   * Called by the password entry screen when the user enters a password to
   * decrypt a file they are loading.
   */
  handlePasswordEntrySubmitted: (password: string) => Promise<void>;
  /** Cancels a pending password-entry flow and returns to the setup screen. */
  cancelPasswordEntry: () => void;
  createOrOpenDatabase: (isNew: boolean) => Promise<void>;
  loadDatabaseFromFile: (file: File) => Promise<void>;
  connectCloudSource: (provider?: CloudProvider) => Promise<void>;
  migrateDatabaseToCloud: (provider: CloudProvider) => Promise<void>;
  saveDatabaseToCurrentCloud: () => Promise<void>;
  switchToLocalSource: () => void;
  cancelSampleDataImport: () => void;
}

declare global {
  interface Window {
    __budgetTrackerTestApi?: {
      disconnectWorker: () => void;
      cancelSampleDataImport?: () => void;
    };
  }
}

const BROWSER_TEST_STORAGE_KEY = 'budgetApp_browserTestPassed';
const SAMPLE_DATA_IMPORT_FILE_COUNT = 11;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

export function useDatabaseInitialization({
  loadAllData,
}: UseDatabaseInitializationOptions): UseDatabaseInitializationResult {
  const [databaseService, setDatabaseService] =
    useState<DatabaseService | null>(null);
  const [databaseSourceState, setDatabaseSourceState] = useState<PersistedDatabaseSourceState>(() =>
    loadPersistedDatabaseSourceState()
  );
  // The provider actually being attempted for the needs-cloud-auth screen.
  // Set before any call that might throw without updating databaseSourceState,
  // so the screen's label and retry always target the right provider.
  const [cloudAuthProvider, setCloudAuthProvider] = useState<CloudProvider | null>(null);
  const [initializationState, setInitializationState] =
    useState<InitializationState>('checking');
  const [isLoading, setIsLoading] = useState(false);

  // Bytes of an encrypted archive that is waiting to be decrypted (e.g. after
  // the user selects a file we detect is encrypted and need the password).
  const pendingEncryptedBytesRef = useRef<Uint8Array | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const [sampleDataImportProgress, setSampleDataImportProgress] =
    useState<SampleDataImportProgress | null>(null);
  const hasCheckedDatabase = useRef(false);
  const sampleDataImportAbortControllerRef = useRef<AbortController | null>(null);

  const cancelSampleDataImport = useCallback(() => {
    sampleDataImportAbortControllerRef.current?.abort();
  }, []);

  const handleBrowserTestComplete = useCallback(
    async (isCompatible: boolean, _testResults: TestResults) => {
      if (!isCompatible) {
        return;
      }

      try {
        const persistedSourceState = loadPersistedDatabaseSourceState();
        const service = new DatabaseService();

        console.debug('[DB Context] Calling initialize to worker service...');
        await service.initialize();

        console.info('[DB Context] Monitoring database worker service...');
        const workerService = service.getWorkerService();
        workerService.onStatusChange(setWorkerStatus);

        setDatabaseService(service);
        setDatabaseSourceState(persistedSourceState);

        if (persistedSourceState.source !== 'local') {
          setCloudAuthProvider(persistedSourceState.source);

          if (service.dbExistsBeforeInit) {
            console.info('[DB Context] Found existing local working copy, opening...');
            await service.openExistingDatabase();
          }

          const cloudResult = await openDatabaseFromCloud({
            databaseService: service,
            provider: persistedSourceState.source,
            interactive: false,
            allowFilePrompt: false,
          });

          setDatabaseSourceState(cloudResult.state);

          if (cloudResult.action === 'needs-user-action') {
            if (service.dbExistsBeforeInit) {
              await loadAllData(service);
              setInitializationState('initialized');
            } else {
              setInitializationState('needs-cloud-auth');
            }

            if (cloudResult.state.lastSyncError) {
              setError(cloudResult.state.lastSyncError);
            }

            hasCheckedDatabase.current = true;
            return;
          }

          await loadAllData(service);
          setInitializationState('initialized');
        } else if (service.dbExistsBeforeInit) {
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
      cancelSampleDataImport,
    };

    return () => {
      delete window.__budgetTrackerTestApi;
    };
  }, [cancelSampleDataImport, databaseService]);

  const createOrOpenDatabase = useCallback(
    async (isNew: boolean) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      // For a new database we must collect a password first.  Check whether
      // the worker already holds a key (from another tab in this session).
      if (isNew) {
        const encryptionAlreadyReady = await databaseService
          .isEncryptionReady()
          .catch(() => false);

        if (!encryptionAlreadyReady) {
          // Transition to the password setup screen.  The actual database
          // creation happens in handlePasswordSetupConfirmed.
          setInitializationState('needs-password-setup');
          return;
        }
      }

      setIsLoading(true);
      setError(null);

      try {
        if (isNew) {
          const shouldLoadSampleData = SampleDataService.shouldLoadSampleData();
          await databaseService.createNewDatabase({
            deferIndexes: shouldLoadSampleData,
          });

          if (shouldLoadSampleData) {
            console.info('[DB Context] Loading sample data...');
            const abortController = new AbortController();
            sampleDataImportAbortControllerRef.current = abortController;
            setSampleDataImportProgress({
              stage: 'starting',
              currentFile: null,
              currentTable: null,
              completedFiles: 0,
              totalFiles: SAMPLE_DATA_IMPORT_FILE_COUNT,
              importedRows: 0,
              expectedRows: null,
              isCancelable: true,
              message: 'Preparing sample data import...',
            });

            try {
              await SampleDataService.loadAllSampleData({
                signal: abortController.signal,
                onProgress: setSampleDataImportProgress,
              });
              console.info('[DB Context] Sample data loaded successfully');
            } catch (sampleError) {
              if (isAbortError(sampleError)) {
                console.info(
                  '[DB Context] Sample data import cancelled, recreating an empty database...'
                );
                setSampleDataImportProgress((currentProgress: SampleDataImportProgress | null) => ({
                  stage: 'cancelled',
                  currentFile: currentProgress?.currentFile ?? null,
                  currentTable: currentProgress?.currentTable ?? null,
                  completedFiles: currentProgress?.completedFiles ?? 0,
                  totalFiles:
                    currentProgress?.totalFiles ?? SAMPLE_DATA_IMPORT_FILE_COUNT,
                  importedRows: currentProgress?.importedRows ?? 0,
                  expectedRows: currentProgress?.expectedRows ?? null,
                  isCancelable: false,
                  message:
                    'Cancelling sample data import and resetting the database...',
                }));
                await databaseService.clearAndRecreateDatabase();
                console.info(
                  '[DB Context] Sample data import cancelled; continuing with an empty database'
                );
              } else {
                console.error(
                  '[DB Context] Failed to load sample data:',
                  sampleError
                );
                setError('Database created but sample data failed to load');
              }
            } finally {
              sampleDataImportAbortControllerRef.current = null;
            }

            console.info('[DB Context] Ensuring indexes after sample data import...');
            await databaseService.ensureIndexes();
          }
          await databaseService.ensurePrimaryUser('Primary User');
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
        sampleDataImportAbortControllerRef.current = null;
        setSampleDataImportProgress(null);
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

      // Read the file bytes first so we can detect whether it is encrypted.
      const arrayBuffer = await file.arrayBuffer();
      const fileBytes = new Uint8Array(arrayBuffer);

      if (isEncryptedArchive(fileBytes)) {
        // Check if the worker already holds a key (e.g. another tab already
        // authenticated in this session).
        const encryptionAlreadyReady = await databaseService
          .isEncryptionReady()
          .catch(() => false);

        if (!encryptionAlreadyReady) {
          // Park the file bytes and ask the user for the password.
          pendingEncryptedBytesRef.current = fileBytes;
          setInitializationState('needs-password-entry');
          return;
        }
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

  const connectCloudSource = useCallback(
    async (provider?: CloudProvider) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      const targetProvider =
        provider ??
        (databaseSourceState.source === 'local'
          ? null
          : databaseSourceState.source) ??
        cloudAuthProvider;

      if (!targetProvider) {
        throw new Error('Select a cloud provider to continue');
      }

      // Record the attempt before the call below, which can throw before
      // ever returning a state that would otherwise update databaseSourceState.
      setCloudAuthProvider(targetProvider);

      setIsLoading(true);
      setError(null);

      try {
        const cloudResult = await openDatabaseFromCloud({
          databaseService,
          provider: targetProvider,
          interactive: true,
          allowFilePrompt: true,
          preferStoredFile: false,
        });

        setDatabaseSourceState(cloudResult.state);

        if (cloudResult.action === 'needs-user-action') {
          throw new Error(
            cloudResult.state.lastSyncError ||
              'Cloud authentication is required to continue'
          );
        }

        await loadAllData(databaseService);
        setInitializationState('initialized');
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to connect cloud database';
        setError(message);
        if (initializationState !== 'initialized') {
          setInitializationState('needs-cloud-auth');
        }
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [databaseService, databaseSourceState.source, cloudAuthProvider, initializationState, loadAllData]
  );

  const migrateDatabaseToCloud = useCallback(
    async (provider: CloudProvider) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      setIsLoading(true);
      setError(null);

      try {
        const cloudResult = await saveDatabaseToCloud({
          databaseService,
          provider,
          interactive: true,
          createNewFile: true,
        });
        setDatabaseSourceState(cloudResult.state);
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : 'Failed to migrate database to cloud storage';
        setError(message);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [databaseService]
  );

  const saveDatabaseToCurrentCloud = useCallback(async () => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    if (databaseSourceState.source === 'local') {
      throw new Error('The current database source is local');
    }

    setIsLoading(true);
    setError(null);

    try {
      const cloudResult = await saveDatabaseToCloud({
        databaseService,
        provider: databaseSourceState.source,
        interactive: true,
      });
      setDatabaseSourceState(cloudResult.state);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : 'Failed to save database to cloud storage';
      setError(message);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [databaseService, databaseSourceState.source]);

  const switchToLocalSource = useCallback(() => {
    const nextState = persistDatabaseSourceSelection('local');
    setDatabaseSourceState(nextState);
    setCloudAuthProvider(null);
    setError(null);

    if (initializationState !== 'initialized') {
      setInitializationState('needs-setup');
    }
  }, [initializationState]);

  // ---------------------------------------------------------------------------
  // Password setup (new database)
  // ---------------------------------------------------------------------------

  const handlePasswordSetupConfirmed = useCallback(
    async (password: string, primaryUserName: string) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      setIsLoading(true);
      setError(null);

      try {
        // Store the password in the worker first.
        await databaseService.setEncryptionPassword(password);

        // Now create the database (mirrors createOrOpenDatabase isNew=true path
        // but skips the password gate since we just set it).
        const shouldLoadSampleData = SampleDataService.shouldLoadSampleData();
        await databaseService.createNewDatabase({
          deferIndexes: shouldLoadSampleData,
        });

        if (shouldLoadSampleData) {
          console.info('[DB Context] Loading sample data...');
          const abortController = new AbortController();
          sampleDataImportAbortControllerRef.current = abortController;
          setSampleDataImportProgress({
            stage: 'starting',
            currentFile: null,
            currentTable: null,
            completedFiles: 0,
            totalFiles: SAMPLE_DATA_IMPORT_FILE_COUNT,
            importedRows: 0,
            expectedRows: null,
            isCancelable: true,
            message: 'Preparing sample data import...',
          });

          try {
            await SampleDataService.loadAllSampleData({
              signal: abortController.signal,
              onProgress: setSampleDataImportProgress,
            });
          } catch (sampleError) {
            if (isAbortError(sampleError)) {
              await databaseService.clearAndRecreateDatabase();
            } else {
              console.error('[DB Context] Failed to load sample data:', sampleError);
              setError('Database created but sample data failed to load');
            }
          } finally {
            sampleDataImportAbortControllerRef.current = null;
          }

          await databaseService.ensureIndexes();
        }

        await databaseService.ensurePrimaryUser(primaryUserName.trim());

        await loadAllData(databaseService);
        setInitializationState('initialized');
      } catch (err) {
        console.error('Failed to create database with password:', err);
        setError(err instanceof Error ? err.message : 'Failed to create database');
        // Return the user to the password setup screen so they can retry.
      } finally {
        setSampleDataImportProgress(null);
        setIsLoading(false);
      }
    },
    [databaseService, loadAllData]
  );

  // ---------------------------------------------------------------------------
  // Password entry (loading an encrypted archive)
  // ---------------------------------------------------------------------------

  const handlePasswordEntrySubmitted = useCallback(
    async (password: string) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      const pendingBytes = pendingEncryptedBytesRef.current;
      if (!pendingBytes) {
        throw new Error('No pending archive to decrypt');
      }

      setIsLoading(true);
      setError(null);

      try {
        // Set the password in the worker (derives the key).
        await databaseService.setEncryptionPassword(password);

        // Delegate to importDatabaseArchiveData which will decrypt and import.
        await databaseService.importDatabaseArchiveData(pendingBytes);
        pendingEncryptedBytesRef.current = null;

        await loadAllData(databaseService);
        setInitializationState('initialized');
      } catch (err) {
        console.error('Failed to decrypt/import database:', err);
        const message = err instanceof Error ? err.message : 'Failed to open database';
        setError(message);
        // Clear a bad password from the worker so the user can retry.
        await databaseService.clearEncryptionPassword().catch(() => undefined);
      } finally {
        setIsLoading(false);
      }
    },
    [databaseService, loadAllData]
  );

  const cancelPasswordEntry = useCallback(() => {
    pendingEncryptedBytesRef.current = null;
    setError(null);
    setInitializationState('needs-setup');
  }, []);

  return {
    databaseService,
    databaseSource: databaseSourceState.source,
    databaseSourceState,
    initializationState,
    isLoading,
    error,
    workerStatus,
    sampleDataImportProgress,
    cloudAuthProvider,
    setError,
    handleBrowserTestComplete,
    handlePasswordSetupConfirmed,
    handlePasswordEntrySubmitted,
    cancelPasswordEntry,
    createOrOpenDatabase,
    loadDatabaseFromFile,
    connectCloudSource,
    migrateDatabaseToCloud,
    saveDatabaseToCurrentCloud,
    switchToLocalSource,
    cancelSampleDataImport,
  };
}

