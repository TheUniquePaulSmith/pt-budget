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
import { getErrorCode, type MasterSecret, type MasterSlotType, type UnlockMethod, type UnlockMethods } from '@/lib/encryptionTypes';
import { rememberLastUnlockMethod } from '@/lib/lastUnlockMethod';
import {
  getLinkedCloudFile,
  loadPersistedDatabaseSourceState,
  type CloudLinkedFile,
  type CloudProvider,
  type DatabaseSource,
  type PersistedDatabaseSourceState,
} from '@/lib/databaseSourceStorage';
import { resetApp } from '@/lib/resetApp';
import { SampleDataService } from '@/lib/sampleDataService';
import type { SampleDataImportProgress } from '@/lib/sampleDataService';
import type { Account } from '@/types/database';
import { DEFAULT_CURRENCY, normalizeCurrencyCode } from '@/lib/currencies';
import { logger } from '@/lib/logging';

const log = logger.child({ component: 'DatabaseInitialization' });

export type UnlockOrigin = 'startup' | 'lock';

export type InitializationState =
  | 'checking'
  | 'testing-browser'
  | 'needs-setup'
  /** New database: user must choose a password before creation proceeds. */
  | 'needs-password-setup'
  /** New database, password just set: language and default currency (skippable). */
  | 'needs-preferences'
  /** New database, preferences done: user is prompted to add their first account/card. */
  | 'needs-initial-account'
  /** Loading an encrypted archive: user must enter the password to decrypt. */
  | 'needs-password-entry'
  /** New database, password just set: user chooses local vs. cloud storage. */
  | 'needs-storage-choice'
  | 'needs-cloud-auth'
  /**
   * An encrypted database already exists on this device (a fresh session
   * with no key yet, or after Settings → Lock Database) and must be
   * unlocked — with the SQLite engine itself enforcing the password via the
   * encrypting VFS — before anything else can happen. Not cancelable: there
   * is no "open without a password" for an encrypted database.
   */
  | 'needs-unlock'
  /**
   * An encryption header from a version before key slots (password-derived
   * page key) exists on this device. It cannot be opened; the only way
   * forward is Reset App and a fresh setup or restore.
   */
  | 'needs-legacy-reset'
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
  /** Debug-only: terminates the shared worker and releases what it stores, for Reset App. */
  terminateWorker: (options?: { includeLogs?: boolean }) => Promise<void>;
  /** Live progress while migrating a brand-new database to cloud storage (needs-storage-choice) or manually syncing. */
  storageMigrationStage: SyncStage | null;
  cloudFilePicker: CloudFilePickerState;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  handleBrowserTestComplete: (
    isCompatible: boolean,
    testResults: TestResults
  ) => Promise<void>;
  /**
   * Called by the setup screen once the user has confirmed a master secret
   * (a password, or the entropy behind a freshly generated recovery phrase).
   * Creates the new database protected by it.
   */
  handlePasswordSetupConfirmed: (master: MasterSecret, primaryUserName: string) => Promise<void>;
  /** The key slots on this device, loaded before the unlock screen is shown (null until known). */
  unlockMethods: UnlockMethods | null;
  /** Refreshes `unlockMethods` from the worker (e.g. after a slot was added while unlocked). */
  refreshUnlockMethods: () => Promise<void>;
  /**
   * How the needs-unlock gate was reached: at page load ('startup') or from
   * Settings → Lock Database ('lock'). The lock screen only starts a passkey
   * prompt on its own after a lock, never on first load.
   */
  unlockOrigin: UnlockOrigin;
  /** While an encrypted archive waits for its master secret: which kind of secret it needs. */
  pendingArchiveMasterType: MasterSlotType | null;
  /** Wipes a pre-key-slot (v1) database this version cannot open and starts over. */
  handleLegacyResetRequested: () => Promise<void>;
  /**
   * Called by the preferences screen (right after password setup) with the
   * chosen default currency; the language is already applied by LocaleProvider.
   */
  handlePreferencesConfirmed: (defaultCurrency: string) => Promise<void>;
  /** Keeps the defaults (USD) and continues to the initial-account step. */
  skipPreferences: () => Promise<void>;
  /** The default currency chosen during setup (USD when skipped); the initial account starts with it. */
  setupDefaultCurrency: string;
  /**
   * Called by the initial-account screen once the user confirms their first
   * account and card, right after the preferences step on a brand-new database.
   */
  handleInitialAccountConfirmed: (
    name: string,
    type: Account['type'],
    lastFour: string,
    currency?: string
  ) => Promise<void>;
  /** Skips adding an initial account and continues to the next setup step. */
  skipInitialAccount: () => Promise<void>;
  /**
   * Called by the unlock screen when the user enters the master secret of an
   * encrypted archive they are loading (file or cloud restore).
   */
  handlePasswordEntrySubmitted: (master: MasterSecret) => Promise<void>;
  /** Cancels a pending password-entry flow and returns to the setup screen. */
  cancelPasswordEntry: () => void;
  /** Called from the needs-storage-choice screen right after password setup. */
  handleStorageChoiceSelected: (choice: 'local' | CloudProvider) => Promise<void>;
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
  /** Puts the app into the needs-unlock gate. Call only after the connection has already been closed/locked in the worker. */
  lockDatabaseState: () => void;
  /**
   * Called by the needs-unlock gate — both at first load of a returning
   * device and after Settings → Lock Database. Unlocks the encrypted
   * database (the SQLite engine itself enforces the password via the
   * encrypting VFS) and, once open, reconciles with the cloud source if
   * one is linked.
   */
  handleUnlockSubmitted: (method: UnlockMethod) => Promise<void>;
  /**
   * Debug-only Reset App from the needs-unlock gate. Rejects with
   * "Incorrect password" — leaving everything untouched — unless `master`
   * opens the database's master key slot; otherwise terminates the worker
   * and wipes all local data. The unlocked-app Reset (Settings → Developer)
   * needs no secret: the user has already authenticated.
   */
  handleLockedResetRequested: (master: MasterSecret) => Promise<void>;
}

const BROWSER_TEST_STORAGE_KEY = 'budgetApp_browserTestPassed';
const SAMPLE_DATA_IMPORT_FILE_COUNT = SampleDataService.sampleDataFileCount;

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
  const [unlockMethods, setUnlockMethods] = useState<UnlockMethods | null>(null);
  const [unlockOrigin, setUnlockOrigin] = useState<UnlockOrigin>('startup');
  const [pendingArchiveMasterType, setPendingArchiveMasterType] = useState<MasterSlotType | null>(null);

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
  // Default currency chosen on the preferences step (USD when skipped), so the
  // initial-account step can start its currency select from it.
  const [setupDefaultCurrency, setSetupDefaultCurrency] = useState<string>(DEFAULT_CURRENCY);
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

        log.debug('Calling initialize on the worker service', { operation: 'initialize' });
        await service.initialize();

        log.debug('Monitoring database worker service', { operation: 'initialize' });
        const workerService = service.getWorkerService();
        workerService.onStatusChange(setWorkerStatus);

        setDatabaseService(service);
        setDatabaseSourceState(persistedSourceState);

        if (service.dbExistsBeforeInit) {
          // Another tab in this SharedWorker session may have already
          // unlocked the database (e.g. a second page opened in the same
          // browser context) — in that case there's nothing to unlock here,
          // just load what's already open.
          const alreadyUnlocked = await service.isEncryptionReady().catch(() => false);
          if (alreadyUnlocked) {
            log.info('Database already unlocked by another tab this session', { operation: 'initialize' });
            await loadAllData(service);
            setInitializationState('initialized');
          } else {
            // An encrypted database exists on this device (regardless of
            // whether the persisted source is local or cloud-linked) — the
            // engine can't open it without a key slot's secret. Which slots
            // exist is readable before unlock and decides what the lock
            // screen offers. Reconciling with the cloud source (if linked)
            // happens after a successful unlock, in handleUnlockSubmitted.
            const methods = await service.getUnlockMethods().catch((err: unknown) => {
              log.warn('Could not read the unlock methods', { operation: 'initialize', error: err });
              return null;
            });
            setUnlockMethods(methods);
            if (methods?.legacyHeader) {
              log.warn('Found a pre-key-slot (v1) encryption header; it cannot be opened', { operation: 'initialize' });
              setInitializationState('needs-legacy-reset');
            } else {
              log.info('Found an existing encrypted database, needs unlock', { operation: 'initialize' });
              setInitializationState('needs-unlock');
            }
          }
        } else if (persistedSourceState.source !== 'local') {
          setInitializationState('needs-cloud-auth');
        } else {
          log.info('No existing database found', { operation: 'initialize' });
          setInitializationState('needs-setup');
        }

        hasCheckedDatabase.current = true;
      } catch (err) {
        log.error('Failed to initialize database', { operation: 'initialize', error: err });
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
            log.debug('Using cached browser compatibility results, skipping test', {
              operation: 'browserTest',
            });
            await handleBrowserTestComplete(true, savedResults);
            return;
          }
        } catch (err) {
          log.warn('Failed to parse cached test results, running test again', {
            operation: 'browserTest',
            error: err,
          });
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
  const markWorkerDisconnected = useCallback(() => {
    setWorkerStatus((currentStatus) => ({
      isWorkerAlive: false,
      isConnected: false,
      dbStatus: 'disconnected',
      version: currentStatus?.version || '1.0.0',
      lastHeartbeat: currentStatus?.lastHeartbeat || 0,
    }));
  }, []);

  const disconnectWorker = useCallback(() => {
    databaseService?.getWorkerService().destroy?.();
    markWorkerDisconnected();
  }, [databaseService, markWorkerDisconnected]);

  // Debug-only Reset App: ends the shared worker itself (see
  // DatabaseWorkerService.terminate), not just this tab's connection to it.
  const terminateWorker = useCallback(
    async (options?: { includeLogs?: boolean }) => {
      await databaseService?.getWorkerService().terminate?.(options);
      markWorkerDisconnected();
    },
    [databaseService, markWorkerDisconnected]
  );

  // Creating a database always requires a password first (see
  // handlePasswordSetupConfirmed, which does the actual creation), so this
  // just gates entry into that screen — except for the rare multi-tab race
  // where another tab in this SharedWorker session already created+unlocked
  // a database, in which case there's nothing left to create; just load
  // what's already open.
  const createOrOpenDatabase = useCallback(
    async (isNew: boolean) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }
      if (!isNew) {
        throw new Error('Opening an existing database requires unlocking it with a password');
      }

      const encryptionAlreadyReady = await databaseService
        .isEncryptionReady()
        .catch(() => false);

      if (!encryptionAlreadyReady) {
        setInitializationState('needs-password-setup');
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        await loadAllData(databaseService);
        setInitializationState('initialized');
      } catch (err) {
        log.error('Failed to load already-open database', { operation: 'loadOpenDatabase', error: err });
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
          // Park the file bytes and ask the user for the archive's master
          // secret (its header says whether that is a password or a phrase).
          pendingEncryptedBytesRef.current = fileBytes;
          setPendingArchiveMasterType(databaseService.getEncryptedArchiveMeta(fileBytes)?.masterSlot.type ?? 'password');
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
        log.error('Failed to load database from file', { operation: 'loadDatabaseFile', error: err });
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
          setPendingArchiveMasterType(databaseService.getEncryptedArchiveMeta(bytes)?.masterSlot.type ?? 'password');
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
    async (master: MasterSecret, primaryUserName: string) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      setIsLoading(true);
      setError(null);

      try {
        const shouldLoadSampleData = SampleDataService.shouldLoadSampleData();
        await databaseService.createNewDatabase(master, {
          deferIndexes: shouldLoadSampleData,
        });

        if (shouldLoadSampleData) {
          log.info('Loading sample data', { operation: 'createDatabase', process: 'sample-data' });
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
              log.error('Failed to load sample data', { operation: 'createDatabase', process: 'sample-data', error: sampleError });
              setError('Database created but sample data failed to load');
            }
          } finally {
            sampleDataImportAbortControllerRef.current = null;
          }

          await databaseService.ensureIndexes();
        }

        const primaryUserId = await databaseService.ensurePrimaryUser(primaryUserName.trim());
        primaryUserIdRef.current = primaryUserId;

        // The next steps are the preferences (language, default currency) and
        // a first account/card, not diving straight into the app. loadAllData
        // runs once the account step completes (or is skipped) so the
        // freshly-created account is picked up too.
        setSetupDefaultCurrency(DEFAULT_CURRENCY);
        setInitializationState('needs-preferences');
      } catch (err) {
        log.error('Failed to create database with password', { operation: 'createDatabase', error: err });
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
  // Preferences (right after password setup on a brand-new database)
  // ---------------------------------------------------------------------------

  const handlePreferencesConfirmed = useCallback(
    async (defaultCurrency: string) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      setIsLoading(true);
      setError(null);

      try {
        const code = normalizeCurrencyCode(defaultCurrency);
        await databaseService.preferences.setDefaultCurrency(code);
        setSetupDefaultCurrency(code);
        setInitializationState('needs-initial-account');
      } catch (err) {
        log.error('Failed to save setup preferences', { operation: 'setupPreferences', error: err });
        setError(err instanceof Error ? err.message : 'Failed to save preferences');
        // Stay on the preferences screen so the user can retry or skip.
      } finally {
        setIsLoading(false);
      }
    },
    [databaseService]
  );

  const skipPreferences = useCallback(async () => {
    setError(null);
    setInitializationState('needs-initial-account');
  }, []);

  // ---------------------------------------------------------------------------
  // Initial account (right after the preferences step on a brand-new database)
  // ---------------------------------------------------------------------------

  const handleInitialAccountConfirmed = useCallback(
    async (name: string, type: Account['type'], lastFour: string, currency?: string) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      setIsLoading(true);
      setError(null);

      try {
        const ownerUserId = primaryUserIdRef.current;
        if (ownerUserId != null) {
          await databaseService.addAccountWithCard(
            { name, type, currency: normalizeCurrencyCode(currency, setupDefaultCurrency) },
            ownerUserId,
            { last_four: lastFour, nickname: null, user_id: ownerUserId }
          );
        }

        await loadAllData(databaseService);
        setInitializationState('needs-storage-choice');
      } catch (err) {
        log.error('Failed to create initial account', { operation: 'createInitialAccount', error: err });
        setError(err instanceof Error ? err.message : 'Failed to create account');
        // Stay on the initial-account screen so the user can retry.
      } finally {
        setIsLoading(false);
      }
    },
    [databaseService, loadAllData, setupDefaultCurrency]
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
      log.error('Failed to load data after skipping initial account', { operation: 'skipInitialAccount', error: err });
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
  // Password entry (loading an encrypted archive)
  // ---------------------------------------------------------------------------

  const handlePasswordEntrySubmitted = useCallback(
    async (master: MasterSecret) => {
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
        const meta = databaseService.getEncryptedArchiveMeta(pendingBytes);
        if (!meta) {
          throw new Error('This file is not a readable encrypted backup');
        }

        // Verify the secret can actually decrypt THIS archive before
        // establishing a local encryption header under it — a wrong secret
        // must never leave behind a header that blocks a clean retry (this
        // state is only reachable before any local database exists, so
        // there's nothing else to protect yet).
        const canDecrypt = await databaseService.canDecryptArchive(pendingBytes, master);
        if (!canDecrypt) {
          throw new Error(master.type === 'password' ? 'Incorrect password for this database' : 'Incorrect recovery phrase for this database');
        }

        // Secret confirmed: this device adopts the archive's root key and
        // master slot (so backup and local copy share one secret), then
        // decrypts and imports the archive.
        await databaseService.createNewDatabase(master, { deferIndexes: true }, { keyId: meta.keyId, masterSlot: meta.masterSlot });
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
        setPendingArchiveMasterType(null);

        await loadAllData(databaseService);
        setInitializationState('initialized');
      } catch (err) {
        log.error('Failed to decrypt/import database', { operation: 'importDatabase', error: err });
        const message = err instanceof Error ? err.message : 'Failed to open database';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    },
    [databaseService, loadAllData]
  );

  const cancelPasswordEntry = useCallback(() => {
    pendingEncryptedBytesRef.current = null;
    pendingCloudContextRef.current = null;
    setPendingArchiveMasterType(null);
    setError(null);
    setInitializationState('needs-setup');
  }, []);

  // ---------------------------------------------------------------------------
  // Unlock (first load of a returning device, and Settings → Lock Database)
  // ---------------------------------------------------------------------------

  /** Puts the app into the needs-unlock gate. Call only after the connection has already been closed/locked in the worker. */
  const refreshUnlockMethods = useCallback(async () => {
    if (!databaseService) return;
    try {
      setUnlockMethods(await databaseService.getUnlockMethods());
    } catch (err) {
      log.warn('Could not refresh the unlock methods', { operation: 'getUnlockMethods', error: err });
    }
  }, [databaseService]);

  const lockDatabaseState = useCallback(() => {
    setError(null);
    // A slot added during this session (a new passkey, say) must show on the
    // lock screen, so re-read the header rather than trusting the copy taken
    // at startup.
    void refreshUnlockMethods();
    setUnlockOrigin('lock');
    setInitializationState('needs-unlock');
  }, [refreshUnlockMethods]);

  const handleUnlockSubmitted = useCallback(
    async (method: UnlockMethod) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      setIsLoading(true);
      setError(null);

      try {
        // The worker refuses a wrong secret (the key slot's AES-GCM unwrap
        // fails), so once this succeeds there's nothing left to separately
        // verify against the cloud copy.
        await databaseService.unlockDatabase(method);
        rememberLastUnlockMethod(method.type);

        if (databaseSourceState.source !== 'local') {
          const provider = databaseSourceState.source;

          let outcome: ReconcileOutcome;
          try {
            outcome = await reconcileOnOpen({ provider });
          } catch (err) {
            log.error('Failed to reconcile cloud state', { operation: 'unlockDatabase', process: 'cloud-sync', error: err });
            outcome = 'auth-required';
          }

          if (outcome === 'remote-newer') {
            const linkedFile = getLinkedCloudFile(databaseSourceState, provider);
            if (linkedFile) {
              try {
                const { bytes, freshMeta } = await downloadCloudArchive({ provider, file: linkedFile });
                await applyDownloadedArchive({ databaseService, provider, file: freshMeta, bytes });
                // The pull may have adopted a master slot changed on another device.
                void refreshUnlockMethods();
              } catch (err) {
                log.error('Failed to pull the newer cloud copy', { operation: 'unlockDatabase', process: 'cloud-sync', error: err });
                setError(err instanceof Error ? err.message : 'Failed to sync from the cloud');
              }
            }
          }

          setDatabaseSourceState(loadPersistedDatabaseSourceState());
        }

        await loadAllData(databaseService);
        setInitializationState('initialized');
      } catch (err) {
        log.error('Failed to unlock database', { operation: 'unlockDatabase', error: err, code: getErrorCode(err) });
        setError(err instanceof Error ? err.message : 'Incorrect password');
      } finally {
        setIsLoading(false);
      }
    },
    [databaseService, databaseSourceState, loadAllData, refreshUnlockMethods]
  );

  // ---------------------------------------------------------------------------
  // Reset App from the lock screen (debug-only; the caller gates on isDebugMode)
  // ---------------------------------------------------------------------------

  const handleLockedResetRequested = useCallback(
    async (master: MasterSecret) => {
      if (!databaseService) {
        throw new Error('Database service not initialized');
      }

      // A locked app has not proven who is at the keyboard, so resetting it
      // (which destroys the database) takes the same secret as unlocking it.
      // Checked against the master key slot without unlocking anything, and
      // before any teardown starts.
      const isCorrect = await databaseService.verifyMaster(master);
      if (!isCorrect) {
        log.warn('Reset App rejected: incorrect secret', { operation: 'resetApp' });
        throw new Error(master.type === 'password' ? 'Incorrect password' : 'Incorrect recovery phrase');
      }

      await resetApp(terminateWorker);
    },
    [databaseService, terminateWorker]
  );

  /**
   * A v1 (pre-key-slot) header cannot be opened by this version and its
   * verifier format is gone, so there is no secret to check: wiping it is
   * the same as the user clearing site data.
   */
  const handleLegacyResetRequested = useCallback(async () => {
    log.warn('Resetting a legacy (v1) encrypted database', { operation: 'resetApp' });
    await resetApp(terminateWorker);
  }, [terminateWorker]);

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
    terminateWorker,
    storageMigrationStage,
    cloudFilePicker,
    setError,
    handleBrowserTestComplete,
    handlePasswordSetupConfirmed,
    handlePreferencesConfirmed,
    skipPreferences,
    setupDefaultCurrency,
    handleInitialAccountConfirmed,
    skipInitialAccount,
    handlePasswordEntrySubmitted,
    cancelPasswordEntry,
    handleStorageChoiceSelected,
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
    handleUnlockSubmitted,
    handleLockedResetRequested,
    unlockMethods,
    refreshUnlockMethods,
    unlockOrigin,
    pendingArchiveMasterType,
    handleLegacyResetRequested,
  };
}
