'use client';

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import type { TestResults } from '../components/setup/TestBrowser';
import { DatabaseService } from '../lib/databaseService';
import type { WorkerStatus } from '../lib/databaseWorkerService';
import {
  applyDownloadedArchive,
  downloadCloudArchive,
  listCloudFiles,
  persistCloudLink,
  reconcileOnOpen,
  switchDatabaseSource as persistDatabaseSourceSelection,
  syncToCloud,
  type ReconcileOutcome,
  type SyncStage,
} from '@/lib/cloudSyncService';
import { createCloudProviderClient } from '@/lib/cloudProviderClients';
import { isEncryptedArchive } from '@/lib/databaseEncryption';
import {
  getLinkedCloudFile,
  loadPersistedDatabaseSourceState,
  type CloudLinkedFile,
  type CloudProvider,
  type DatabaseSource,
  type PersistedDatabaseSourceState,
} from '@/lib/databaseSourceStorage';
import { SampleDataService } from '@/lib/sampleDataService';
import type { SampleDataImportProgress } from '@/lib/sampleDataService';
import type { Account } from '@/types/database';

export type InitializationState =
  | 'checking'
  | 'testing-browser'
  | 'needs-setup'
  /** New database: user must choose a password before creation proceeds. */
  | 'needs-password-setup'
  /** New database, password just set: user is prompted to add their first account/card. */
  | 'needs-initial-account'
  /** Loading an encrypted archive: user must enter the password to decrypt. */
  | 'needs-password-entry'
  /** New database, password just set: user chooses local vs. cloud storage. */
  | 'needs-storage-choice'
  | 'needs-cloud-auth'
  /** Cloud source with a local working copy, but no key yet this session: gate cloud sync on the password. */
  | 'needs-cloud-password'
  /** User manually locked the database (Settings): the working copy is untouched, but the password has been forgotten and the app is gated until it's re-entered. */
  | 'locked'
  | 'initialized'
  | 'error';

export interface CloudFilePickerState {
  isOpen: boolean;
  provider: CloudProvider | null;
  files: CloudLinkedFile[];
  isLoading: boolean;
  error: string | null;
}

const CLOSED_CLOUD_FILE_PICKER: CloudFilePickerState = {
  isOpen: false,
  provider: null,
  files: [],
  isLoading: false,
  error: null,
};

interface UseDatabaseInitializationOptions {
  loadAllData: (service: DatabaseService) => Promise<void>;
}

interface UseDatabaseInitializationResult {
  databaseService: DatabaseService | null;
  databaseSource: DatabaseSource;
  databaseSourceState: PersistedDatabaseSourceState;
  /** Pushes an externally-persisted source-state change (e.g. from the auto-sync scheduler) into this hook's cached copy. */
  setDatabaseSourceState: Dispatch<SetStateAction<PersistedDatabaseSourceState>>;
  initializationState: InitializationState;
  isLoading: boolean;
  error: string | null;
  workerStatus: WorkerStatus | null;
  sampleDataImportProgress: SampleDataImportProgress | null;
  /** Dev-only: forcibly disconnects the worker, for the __budgetTrackerTestApi hook. */
  disconnectWorker: () => void;
  /** Live progress while migrating a brand-new database to cloud storage (needs-storage-choice) or manually syncing. */
  storageMigrationStage: SyncStage | null;
  cloudFilePicker: CloudFilePickerState;
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
   * Called by the initial-account screen once the user confirms their first
   * account and card, right after password setup on a brand-new database.
   */
  handleInitialAccountConfirmed: (
    name: string,
    type: Account['type'],
    lastFour: string
  ) => Promise<void>;
  /** Skips adding an initial account and continues to the next setup step. */
  skipInitialAccount: () => Promise<void>;
  /**
   * Called by the password entry screen when the user enters a password to
   * decrypt a file they are loading.
   */
  handlePasswordEntrySubmitted: (password: string) => Promise<void>;
  /** Cancels a pending password-entry flow and returns to the setup screen. */
  cancelPasswordEntry: () => void;
  /** Called from the needs-storage-choice screen right after password setup. */
  handleStorageChoiceSelected: (choice: 'local' | CloudProvider) => Promise<void>;
  /** Called from the needs-cloud-password screen. */
  handleCloudPasswordSubmitted: (password: string) => Promise<void>;
  /** Continues into the app without unlocking cloud sync this session. */
  skipCloudUnlock: () => Promise<void>;
  createOrOpenDatabase: (isNew: boolean) => Promise<void>;
  loadDatabaseFromFile: (file: File) => Promise<void>;
  /** Opens the cloud file picker for `provider` (or the persisted source if omitted). */
  connectCloudSource: (provider?: CloudProvider) => Promise<void>;
  closeCloudFilePicker: () => void;
  /** Called once the user picks a file from the cloud file picker dialog. */
  handleCloudFileSelected: (file: CloudLinkedFile) => Promise<void>;
  migrateDatabaseToCloud: (provider: CloudProvider) => Promise<void>;
  saveDatabaseToCurrentCloud: () => Promise<void>;
  switchToLocalSource: () => void;
  cancelSampleDataImport: () => void;
  /** Puts the app into the locked gate. Call only after the password has already been cleared from the worker. */
  lockDatabaseState: () => void;
  /** Called by the locked-database gate: re-sets the password and resumes the app. The working copy was never touched, so no reimport is needed. */
  unlockDatabase: (password: string) => Promise<void>;
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
  const [initializationState, setInitializationState] =
    useState<InitializationState>('checking');
  const [isLoading, setIsLoading] = useState(false);
  const [storageMigrationStage, setStorageMigrationStage] = useState<SyncStage | null>(null);
  const [cloudFilePicker, setCloudFilePicker] = useState<CloudFilePickerState>(
    CLOSED_CLOUD_FILE_PICKER
  );

  // Bytes of an encrypted archive that is waiting to be decrypted (e.g. after
  // the user selects a file we detect is encrypted and need the password).
  const pendingEncryptedBytesRef = useRef<Uint8Array | null>(null);
  // Set alongside pendingEncryptedBytesRef when the pending bytes came from
  // the cloud file picker (rather than a local file), so
  // handlePasswordEntrySubmitted knows to also persist the cloud link.
  const pendingCloudContextRef = useRef<{ provider: CloudProvider; file: CloudLinkedFile } | null>(
    null
  );
  // Primary user id created during password setup, held here so the
  // initial-account step (a separate screen/handler) knows who owns the
  // account it creates.
  const primaryUserIdRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const [sampleDataImportProgress, setSampleDataImportProgress] =
    useState<SampleDataImportProgress | null>(null);
  const hasCheckedDatabase = useRef(false);
  const sampleDataImportAbortControllerRef = useRef<AbortController | null>(null);

  const cancelSampleDataImport = useCallback(() => {
    sampleDataImportAbortControllerRef.current?.abort();
  }, []);

  const closeCloudFilePicker = useCallback(() => {
    setCloudFilePicker(CLOSED_CLOUD_FILE_PICKER);
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
          const provider = persistedSourceState.source;

          if (service.dbExistsBeforeInit) {
            console.info('[DB Context] Found existing local working copy, opening...');
            await service.openExistingDatabase();
          }

          const encryptionReady = await service.isEncryptionReady().catch(() => false);

          if (!encryptionReady) {
            // The live database is plaintext and needs no password to open,
            // but cloud sync needs the password to encrypt/decrypt archives.
            // With a local copy already open we can gate just cloud sync on
            // it (needs-cloud-password); without one, reconcileOnOpen can't
            // safely decide anything without a key, so fall through to the
            // normal connect flow.
            setInitializationState(
              service.dbExistsBeforeInit ? 'needs-cloud-password' : 'needs-cloud-auth'
            );
            hasCheckedDatabase.current = true;
            return;
          }

          let outcome: ReconcileOutcome;
          try {
            outcome = await reconcileOnOpen({ provider });
          } catch (err) {
            console.error('[DB Context] Failed to reconcile cloud state:', err);
            outcome = 'auth-required';
          }

          if (outcome === 'remote-newer') {
            const linkedFile = getLinkedCloudFile(persistedSourceState, provider);
            if (linkedFile) {
              try {
                const { bytes, freshMeta } = await downloadCloudArchive({ provider, file: linkedFile });
                await applyDownloadedArchive({ databaseService: service, provider, file: freshMeta, bytes });
              } catch (err) {
                console.error('[DB Context] Failed to pull the newer cloud copy:', err);
                setError(err instanceof Error ? err.message : 'Failed to sync from the cloud');
              }
            }
          }

          setDatabaseSourceState(loadPersistedDatabaseSourceState());

          const needsUserAction =
            (outcome === 'auth-required' || outcome === 'no-link') && !service.dbExistsBeforeInit;

          if (needsUserAction) {
            setInitializationState('needs-cloud-auth');
          } else {
            // remote-newer (pulled above), in-sync, local-newer, both-changed
            // (the conflict is now persisted and surfaced via the status
            // chip), or auth-required-but-we-still-have-a-local-copy: in
            // every case there's something to show. The auto-sync scheduler
            // takes it from here.
            await loadAllData(service);
            setInitializationState('initialized');
          }

          hasCheckedDatabase.current = true;
          return;
        }

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

  // Exposed for the dev-only window.__budgetTrackerTestApi, which
  // DatabaseContext.tsx registers — consolidated there (rather than in an
  // effect here) so it can be combined with the auto-sync test hooks
  // without two independent effects racing to set the same global.
  const disconnectWorker = useCallback(() => {
    databaseService?.getWorkerService().destroy?.();
    setWorkerStatus((currentStatus) => ({
      isWorkerAlive: false,
      isConnected: false,
      dbStatus: 'disconnected',
      version: currentStatus?.version || '1.0.0',
      lastHeartbeat: currentStatus?.lastHeartbeat || 0,
    }));
  }, [databaseService]);

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
      const targetProvider =
        provider ??
        (databaseSourceState.source === 'local'
          ? null
          : databaseSourceState.source) ??
        cloudFilePicker.provider;

      if (!targetProvider) {
        throw new Error('Select a cloud provider to continue');
      }

      setCloudFilePicker({
        isOpen: true,
        provider: targetProvider,
        files: [],
        isLoading: true,
        error: null,
      });
      setError(null);

      try {
        const files = await listCloudFiles({ provider: targetProvider, interactive: true });
        setCloudFilePicker({
          isOpen: true,
          provider: targetProvider,
          files,
          isLoading: false,
          error: null,
        });
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to connect cloud database';
        setCloudFilePicker({
          isOpen: true,
          provider: targetProvider,
          files: [],
          isLoading: false,
          error: message,
        });
        setError(message);
        if (initializationState !== 'initialized') {
          setInitializationState('needs-cloud-auth');
        }
      }
    },
    [databaseSourceState.source, initializationState, cloudFilePicker.provider]
  );

  const handleCloudFileSelected = useCallback(
    async (file: CloudLinkedFile) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      const provider = file.provider;
      setCloudFilePicker((current) => ({ ...current, isLoading: true, error: null }));
      setIsLoading(true);
      setError(null);

      try {
        const { bytes, freshMeta } = await downloadCloudArchive({ provider, file });

        const encryptionAlreadyReady = await databaseService
          .isEncryptionReady()
          .catch(() => false);

        if (!encryptionAlreadyReady) {
          // Park the bytes and ask for the password — handlePasswordEntrySubmitted
          // persists the cloud link once the password is confirmed to work.
          pendingEncryptedBytesRef.current = bytes;
          pendingCloudContextRef.current = { provider, file: freshMeta };
          closeCloudFilePicker();
          setInitializationState('needs-password-entry');
          return;
        }

        await applyDownloadedArchive({ databaseService, provider, file: freshMeta, bytes });
        setDatabaseSourceState(loadPersistedDatabaseSourceState());
        await loadAllData(databaseService);
        closeCloudFilePicker();
        setInitializationState('initialized');
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to open the selected database';
        setError(message);
        setCloudFilePicker((current) => ({ ...current, isLoading: false, error: message }));
      } finally {
        setIsLoading(false);
      }
    },
    [databaseService, loadAllData, closeCloudFilePicker]
  );

  const migrateDatabaseToCloud = useCallback(
    async (provider: CloudProvider) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      setIsLoading(true);
      setError(null);

      try {
        const client = createCloudProviderClient(provider);
        await client.authenticate(true);

        const outcome = await syncToCloud({ databaseService, provider, force: true });
        if (outcome !== 'saved') {
          throw new Error('Failed to migrate database to cloud storage');
        }

        setDatabaseSourceState(loadPersistedDatabaseSourceState());
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

    const provider = databaseSourceState.source;
    if (provider === 'local') {
      throw new Error('The current database source is local');
    }

    setIsLoading(true);
    setError(null);

    try {
      const client = createCloudProviderClient(provider);
      await client.authenticate(true);

      const outcome = await syncToCloud({ databaseService, provider });
      if (outcome === 'conflict') {
        throw new Error(
          'The cloud copy has changed since it was last synced. Resolve the conflict before saving again.'
        );
      }
      if (outcome !== 'saved' && outcome !== 'no-changes') {
        throw new Error('Failed to save database to cloud storage');
      }

      setDatabaseSourceState(loadPersistedDatabaseSourceState());
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

        const primaryUserId = await databaseService.ensurePrimaryUser(primaryUserName.trim());
        primaryUserIdRef.current = primaryUserId;

        // The next step is adding a first account/card, not diving straight
        // into the app. loadAllData runs once that step completes (or is
        // skipped) so the freshly-created account is picked up too.
        setInitializationState('needs-initial-account');
      } catch (err) {
        console.error('Failed to create database with password:', err);
        setError(err instanceof Error ? err.message : 'Failed to create database');
        // Return the user to the password setup screen so they can retry.
      } finally {
        setSampleDataImportProgress(null);
        setIsLoading(false);
      }
    },
    [databaseService]
  );

  // ---------------------------------------------------------------------------
  // Initial account (right after password setup on a brand-new database)
  // ---------------------------------------------------------------------------

  const handleInitialAccountConfirmed = useCallback(
    async (name: string, type: Account['type'], lastFour: string) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      setIsLoading(true);
      setError(null);

      try {
        const ownerUserId = primaryUserIdRef.current;
        if (ownerUserId != null) {
          await databaseService.addAccountWithCard(
            { name, type },
            ownerUserId,
            { last_four: lastFour, nickname: null, user_id: ownerUserId }
          );
        }

        await loadAllData(databaseService);
        setInitializationState('needs-storage-choice');
      } catch (err) {
        console.error('Failed to create initial account:', err);
        setError(err instanceof Error ? err.message : 'Failed to create account');
        // Stay on the initial-account screen so the user can retry.
      } finally {
        setIsLoading(false);
      }
    },
    [databaseService, loadAllData]
  );

  const skipInitialAccount = useCallback(async () => {
    if (!databaseService) {
      setInitializationState('needs-storage-choice');
      return;
    }

    setError(null);
    try {
      await loadAllData(databaseService);
    } catch (err) {
      console.error('[DB Context] Failed to load data after skipping initial account:', err);
    }
    setInitializationState('needs-storage-choice');
  }, [databaseService, loadAllData]);

  // ---------------------------------------------------------------------------
  // Storage choice (right after password setup on a brand-new database)
  // ---------------------------------------------------------------------------

  const handleStorageChoiceSelected = useCallback(
    async (choice: 'local' | CloudProvider) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      if (choice === 'local') {
        setInitializationState('initialized');
        return;
      }

      setIsLoading(true);
      setError(null);
      setStorageMigrationStage('flushing');

      try {
        const client = createCloudProviderClient(choice);
        await client.authenticate(true);

        const outcome = await syncToCloud({
          databaseService,
          provider: choice,
          force: true,
          onStage: setStorageMigrationStage,
        });

        if (outcome !== 'saved') {
          throw new Error('Failed to save the database to cloud storage');
        }

        setDatabaseSourceState(loadPersistedDatabaseSourceState());
        setInitializationState('initialized');
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to set up cloud storage';
        setError(message);
        // Stay on the storage-choice screen so the user can retry or pick local instead.
      } finally {
        setStorageMigrationStage(null);
        setIsLoading(false);
      }
    },
    [databaseService]
  );

  // ---------------------------------------------------------------------------
  // Cloud password gate (returning to a cloud-linked database this session)
  // ---------------------------------------------------------------------------

  const handleCloudPasswordSubmitted = useCallback(
    async (password: string) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      const provider = databaseSourceState.source;
      if (provider === 'local') {
        throw new Error('The current database source is local');
      }

      setIsLoading(true);
      setError(null);

      try {
        await databaseService.setEncryptionPassword(password);

        const currentState = loadPersistedDatabaseSourceState();
        const linkedFile = getLinkedCloudFile(currentState, provider);

        if (linkedFile) {
          // Verify against the cloud copy WITHOUT importing it — the local
          // database (already open, always plaintext) must not be silently
          // overwritten just to check a password.
          const { bytes } = await downloadCloudArchive({ provider, file: linkedFile });
          const passwordIsValid = await databaseService.verifyEncryptionPassword(bytes);

          if (!passwordIsValid) {
            await databaseService.clearEncryptionPassword().catch(() => undefined);
            throw new Error('Incorrect password for this database');
          }
        }

        await loadAllData(databaseService);
        setInitializationState('initialized');
      } catch (err) {
        console.error('[DB Context] Failed to unlock cloud sync:', err);
        setError(err instanceof Error ? err.message : 'Failed to unlock cloud sync');
      } finally {
        setIsLoading(false);
      }
    },
    [databaseService, databaseSourceState.source, loadAllData]
  );

  const skipCloudUnlock = useCallback(async () => {
    if (!databaseService) {
      setInitializationState('needs-setup');
      return;
    }

    setError(null);
    try {
      await loadAllData(databaseService);
    } catch (err) {
      console.error('[DB Context] Failed to load data after skipping cloud unlock:', err);
    }
    setInitializationState('initialized');
  }, [databaseService, loadAllData]);

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

        const cloudContext = pendingCloudContextRef.current;
        if (cloudContext) {
          pendingCloudContextRef.current = null;
          const cloudTimestamp = databaseService.getEncryptedArchiveTimestamp(pendingBytes);
          setDatabaseSourceState(
            persistCloudLink({ provider: cloudContext.provider, file: cloudContext.file, cloudTimestamp })
          );
        }

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
    pendingCloudContextRef.current = null;
    setError(null);
    setInitializationState('needs-setup');
  }, []);

  // ---------------------------------------------------------------------------
  // Manual lock (Settings → Security → Lock Database)
  // ---------------------------------------------------------------------------

  const lockDatabaseState = useCallback(() => {
    setError(null);
    setInitializationState('locked');
  }, []);

  const unlockDatabase = useCallback(
    async (password: string) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      setIsLoading(true);
      setError(null);

      try {
        await databaseService.setEncryptionPassword(password);
        setInitializationState('initialized');
      } catch (err) {
        console.error('[DB Context] Failed to unlock database:', err);
        setError(err instanceof Error ? err.message : 'Failed to unlock database');
      } finally {
        setIsLoading(false);
      }
    },
    [databaseService]
  );

  return {
    databaseService,
    databaseSource: databaseSourceState.source,
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
  };
}
