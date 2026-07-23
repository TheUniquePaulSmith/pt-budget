// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseService } from '../lib/databaseService';
import {
  applyDownloadedArchive,
  downloadCloudArchive,
  listCloudFiles,
  persistCloudLink,
  reconcileOnOpen,
  syncToCloud,
} from '@/lib/cloudSyncService';
import { createCloudProviderClient } from '@/lib/cloudProviderClients';
import { SampleDataService } from '@/lib/sampleDataService';
import { useDatabaseInitialization } from './useDatabaseInitialization';

vi.mock('../lib/databaseService', () => ({
  DatabaseService: vi.fn(),
}));

vi.mock('@/lib/sampleDataService', () => ({
  SampleDataService: {
    shouldLoadSampleData: vi.fn(),
    loadAllSampleData: vi.fn(),
  },
}));

vi.mock('@/lib/cloudSyncService', () => ({
  listCloudFiles: vi.fn(),
  downloadCloudArchive: vi.fn(),
  applyDownloadedArchive: vi.fn(),
  persistCloudLink: vi.fn(),
  reconcileOnOpen: vi.fn(),
  syncToCloud: vi.fn(),
  switchDatabaseSource: vi.fn(() => ({
    source: 'local',
    linkedFiles: {},
    lastLocalWriteTimestamp: null,
    lastCloudSyncTimestamp: null,
    lastCloudFileTimestamp: null,
    lastSyncError: null,
    autoSyncEnabled: true,
    pendingChangesSince: null,
    lastSyncAttemptAt: null,
    conflict: null,
  })),
}));

vi.mock('@/lib/cloudProviderClients', () => ({
  createCloudProviderClient: vi.fn(),
}));

type MockService = {
  dbExistsBeforeInit: boolean;
  initialize: ReturnType<typeof vi.fn>;
  createNewDatabase: ReturnType<typeof vi.fn>;
  unlockDatabase: ReturnType<typeof vi.fn>;
  lockDatabase: ReturnType<typeof vi.fn>;
  ensurePrimaryUser: ReturnType<typeof vi.fn>;
  addAccountWithCard: ReturnType<typeof vi.fn>;
  ensureIndexes: ReturnType<typeof vi.fn>;
  clearAndRecreateDatabase: ReturnType<typeof vi.fn>;
  loadDatabaseFromFile: ReturnType<typeof vi.fn>;
  getWorkerService: ReturnType<typeof vi.fn>;
  isEncryptionReady: ReturnType<typeof vi.fn>;
  importDatabaseArchiveData: ReturnType<typeof vi.fn>;
  getEncryptedArchiveTimestamp: ReturnType<typeof vi.fn>;
  canDecryptArchive: ReturnType<typeof vi.fn>;
  getDatabaseStatus: ReturnType<typeof vi.fn>;
};

const mockedDatabaseService = vi.mocked(DatabaseService);
const mockedShouldLoadSampleData = vi.mocked(
  SampleDataService.shouldLoadSampleData
);
const mockedLoadAllSampleData = vi.mocked(SampleDataService.loadAllSampleData);
const mockedListCloudFiles = vi.mocked(listCloudFiles);
const mockedDownloadCloudArchive = vi.mocked(downloadCloudArchive);
const mockedApplyDownloadedArchive = vi.mocked(applyDownloadedArchive);
const mockedPersistCloudLink = vi.mocked(persistCloudLink);
const mockedReconcileOnOpen = vi.mocked(reconcileOnOpen);
const mockedSyncToCloud = vi.mocked(syncToCloud);
const mockedCreateCloudProviderClient = vi.mocked(createCloudProviderClient);

const compatibleBrowserResults = {
  overallCompatible: true,
} as any;

function createDefaultSourceState(overrides: Record<string, unknown> = {}) {
  return {
    source: 'local',
    linkedFiles: {},
    lastLocalWriteTimestamp: null,
    lastCloudSyncTimestamp: null,
    lastCloudFileTimestamp: null,
    lastSyncError: null,
    autoSyncEnabled: true,
    pendingChangesSince: null,
    lastSyncAttemptAt: null,
    conflict: null,
    ...overrides,
  };
}

function createCloudFile(overrides: Record<string, unknown> = {}) {
  return {
    provider: 'gdrive',
    fileId: 'f1',
    fileName: 'budget-tracker-2026.zip',
    modifiedAt: null,
    size: 100,
    webUrl: null,
    etag: null,
    cTag: null,
    version: '1',
    md5Checksum: null,
    ...overrides,
  };
}

function createServiceMock(overrides: Partial<MockService> = {}): MockService {
  const workerService = {
    onStatusChange: vi.fn(() => vi.fn()),
    destroy: vi.fn(),
  };

  return {
    dbExistsBeforeInit: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    createNewDatabase: vi.fn().mockResolvedValue(undefined),
    unlockDatabase: vi.fn().mockResolvedValue(undefined),
    lockDatabase: vi.fn().mockResolvedValue(undefined),
    ensurePrimaryUser: vi.fn().mockResolvedValue(1),
    addAccountWithCard: vi.fn().mockResolvedValue({ accountId: 1, cardId: 1 }),
    ensureIndexes: vi.fn().mockResolvedValue(undefined),
    clearAndRecreateDatabase: vi.fn().mockResolvedValue(undefined),
    loadDatabaseFromFile: vi.fn().mockResolvedValue(undefined),
    getWorkerService: vi.fn(() => workerService),
    isEncryptionReady: vi.fn().mockResolvedValue(true),
    importDatabaseArchiveData: vi.fn().mockResolvedValue(undefined),
    getEncryptedArchiveTimestamp: vi.fn().mockReturnValue(null),
    canDecryptArchive: vi.fn().mockResolvedValue(true),
    getDatabaseStatus: vi
      .fn()
      .mockResolvedValue({ lastWriteTimestamp: null, tableStats: {} }),
    ...overrides,
  };
}

function createAbortError(message = 'cancelled') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

/** Drives the hook from 'testing-browser' through handleBrowserTestComplete, as a real TestBrowser mount would. */
async function completeBrowserTest(result: { current: ReturnType<typeof useDatabaseInitialization> }) {
  await waitFor(() => {
    expect(result.current.initializationState).toBe('testing-browser');
  });
  await act(async () => {
    await result.current.handleBrowserTestComplete(true, compatibleBrowserResults);
  });
}

describe('useDatabaseInitialization', () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = 'budgetTrackerDatabaseSource=local; path=/';
    mockedDatabaseService.mockReset();
    mockedShouldLoadSampleData.mockReset();
    mockedLoadAllSampleData.mockReset();
    mockedListCloudFiles.mockReset();
    mockedDownloadCloudArchive.mockReset();
    mockedApplyDownloadedArchive.mockReset();
    mockedPersistCloudLink.mockReset();
    mockedReconcileOnOpen.mockReset();
    mockedSyncToCloud.mockReset();
    mockedCreateCloudProviderClient.mockReset();
  });

  afterEach(() => {
    delete window.__budgetTrackerTestApi;
  });

  it('moves to browser testing when no cached compatibility result exists', async () => {
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );

    await waitFor(() => {
      expect(result.current.initializationState).toBe('testing-browser');
    });

    expect(mockedDatabaseService).not.toHaveBeenCalled();
  });

  it('uses cached compatible browser results to detect an existing encrypted database and gate on unlock', async () => {
    localStorage.setItem(
      'budgetApp_browserTestPassed',
      JSON.stringify(compatibleBrowserResults)
    );

    const service = createServiceMock({
      dbExistsBeforeInit: true,
      isEncryptionReady: vi.fn().mockResolvedValue(false),
    });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );

    await waitFor(() => {
      expect(result.current.initializationState).toBe('needs-unlock');
    });

    expect(service.initialize).toHaveBeenCalledTimes(1);
    expect(service.getWorkerService).toHaveBeenCalledTimes(1);
    expect(loadAllData).not.toHaveBeenCalled();
    expect(result.current.databaseService).toBe(service);

    // The SQLite engine itself enforces the password via the encrypting VFS.
    await act(async () => {
      await result.current.handleUnlockSubmitted('correcthorsebatterystaple');
    });

    expect(service.unlockDatabase).toHaveBeenCalledWith('correcthorsebatterystaple');
    expect(loadAllData).toHaveBeenCalledWith(service);
    expect(result.current.initializationState).toBe('initialized');
  });

  it('skips needs-unlock and loads straight through when another tab in this SharedWorker session already unlocked the database', async () => {
    localStorage.setItem(
      'budgetApp_browserTestPassed',
      JSON.stringify(compatibleBrowserResults)
    );

    const service = createServiceMock({
      dbExistsBeforeInit: true,
      isEncryptionReady: vi.fn().mockResolvedValue(true),
    });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );

    await waitFor(() => {
      expect(result.current.initializationState).toBe('initialized');
    });

    expect(service.unlockDatabase).not.toHaveBeenCalled();
    expect(loadAllData).toHaveBeenCalledWith(service);
  });

  it('rejects an incorrect password at needs-unlock without loading any data', async () => {
    localStorage.setItem(
      'budgetApp_browserTestPassed',
      JSON.stringify(compatibleBrowserResults)
    );

    const service = createServiceMock({
      dbExistsBeforeInit: true,
      isEncryptionReady: vi.fn().mockResolvedValue(false),
      unlockDatabase: vi.fn().mockRejectedValue(new Error('Incorrect password')),
    });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );

    await waitFor(() => {
      expect(result.current.initializationState).toBe('needs-unlock');
    });

    await act(async () => {
      await result.current.handleUnlockSubmitted('wrong-password');
    });

    expect(loadAllData).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Incorrect password');
    expect(result.current.initializationState).toBe('needs-unlock');
  });

  it('createOrOpenDatabase(true) redirects to needs-password-setup without creating anything (a password is required first)', async () => {
    const service = createServiceMock({
      dbExistsBeforeInit: false,
      isEncryptionReady: vi.fn().mockResolvedValue(false),
    });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );

    await completeBrowserTest(result);
    await waitFor(() => {
      expect(result.current.initializationState).toBe('needs-setup');
    });

    await act(async () => {
      await result.current.createOrOpenDatabase(true);
    });

    expect(service.createNewDatabase).not.toHaveBeenCalled();
    expect(result.current.initializationState).toBe('needs-password-setup');
  });

  it('handlePasswordSetupConfirmed creates the database with the password and loads sample data when requested', async () => {
    const service = createServiceMock({ dbExistsBeforeInit: false });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    mockedShouldLoadSampleData.mockReturnValue(true);
    mockedLoadAllSampleData.mockResolvedValue(undefined);
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );

    await completeBrowserTest(result);

    await waitFor(() => {
      expect(result.current.initializationState).toBe('needs-setup');
    });

    await act(async () => {
      await result.current.handlePasswordSetupConfirmed('correcthorsebatterystaple', 'Pat');
    });

    expect(service.createNewDatabase).toHaveBeenCalledWith('correcthorsebatterystaple', {
      deferIndexes: true,
    });
    expect(service.ensureIndexes).toHaveBeenCalledTimes(1);
    expect(mockedShouldLoadSampleData).toHaveBeenCalledTimes(1);
    expect(mockedLoadAllSampleData).toHaveBeenCalledWith(
      expect.objectContaining({
        signal: expect.any(AbortSignal),
        onProgress: expect.any(Function),
      })
    );
    expect(result.current.initializationState).toBe('needs-initial-account');
    expect(result.current.isLoading).toBe(false);
  });

  it('cancels sample data import and recreates the database, then proceeds to needs-initial-account', async () => {
    const service = createServiceMock({ dbExistsBeforeInit: false });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    mockedShouldLoadSampleData.mockReturnValue(true);
    mockedLoadAllSampleData.mockImplementation(
      ({ signal, onProgress } = {}) =>
        new Promise<void>((_resolve, reject) => {
          onProgress?.({
            stage: 'importing-table',
            currentFile: 'transactions.json',
            currentTable: 'transactions',
            completedFiles: 7,
            totalFiles: 8,
            importedRows: 1000,
            expectedRows: 5000,
            isCancelable: true,
            message: 'Importing transaction sample data...',
          });

          signal?.addEventListener(
            'abort',
            () => {
              reject(createAbortError());
            },
            { once: true }
          );
        })
    );
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );

    await completeBrowserTest(result);

    await waitFor(() => {
      expect(result.current.initializationState).toBe('needs-setup');
    });

    let confirmPromise!: Promise<void>;
    await act(async () => {
      confirmPromise = result.current.handlePasswordSetupConfirmed('correcthorsebatterystaple', 'Pat');
    });

    await waitFor(() => {
      expect(result.current.sampleDataImportProgress?.currentTable).toBe(
        'transactions'
      );
    });

    await act(async () => {
      result.current.cancelSampleDataImport();
      await confirmPromise;
    });

    expect(service.createNewDatabase).toHaveBeenCalledWith('correcthorsebatterystaple', {
      deferIndexes: true,
    });
    expect(service.clearAndRecreateDatabase).toHaveBeenCalledTimes(1);
    expect(service.ensureIndexes).toHaveBeenCalledTimes(1);
    expect(result.current.initializationState).toBe('needs-initial-account');
    expect(result.current.sampleDataImportProgress).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('loads a database file through the initialized service', async () => {
    const service = createServiceMock({ dbExistsBeforeInit: false });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    const loadAllData = vi.fn().mockResolvedValue(undefined);
    // Use a mock file whose arrayBuffer returns non-encrypted bytes so the
    // hook falls through to the service without showing the password screen.
    const plainBytes = new Uint8Array(8).fill(1);
    const file = {
      arrayBuffer: vi.fn().mockResolvedValue(plainBytes.buffer),
      name: 'budget.db',
      type: 'application/octet-stream',
    } as unknown as File;

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );

    await completeBrowserTest(result);

    await waitFor(() => {
      expect(result.current.initializationState).toBe('needs-setup');
    });

    await act(async () => {
      await result.current.loadDatabaseFromFile(file);
    });

    expect(service.loadDatabaseFromFile).toHaveBeenCalledWith(file);
    expect(loadAllData).toHaveBeenLastCalledWith(service);
    expect(result.current.initializationState).toBe('initialized');
  });

  it('goes to needs-initial-account after password setup completes, right after password entry', async () => {
    const service = createServiceMock({ dbExistsBeforeInit: false });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    mockedShouldLoadSampleData.mockReturnValue(false);
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );

    await completeBrowserTest(result);
    await waitFor(() => expect(result.current.initializationState).toBe('needs-setup'));

    await act(async () => {
      await result.current.handlePasswordSetupConfirmed('correcthorsebatterystaple', 'Pat');
    });

    expect(service.createNewDatabase).toHaveBeenCalledWith('correcthorsebatterystaple', {
      deferIndexes: false,
    });
    expect(result.current.initializationState).toBe('needs-initial-account');
  });

  it('handleInitialAccountConfirmed creates the account for the newly-created primary user, then goes to needs-storage-choice', async () => {
    const service = createServiceMock({ dbExistsBeforeInit: false });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    mockedShouldLoadSampleData.mockReturnValue(false);
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );
    await completeBrowserTest(result);
    await waitFor(() => expect(result.current.initializationState).toBe('needs-setup'));
    await act(async () => {
      await result.current.handlePasswordSetupConfirmed('correcthorsebatterystaple', 'Pat');
    });
    await waitFor(() => expect(result.current.initializationState).toBe('needs-initial-account'));

    await act(async () => {
      await result.current.handleInitialAccountConfirmed('Checking', 'checking', '1234');
    });

    expect(service.addAccountWithCard).toHaveBeenCalledWith(
      { name: 'Checking', type: 'checking' },
      1,
      { last_four: '1234', nickname: null, user_id: 1 }
    );
    expect(result.current.initializationState).toBe('needs-storage-choice');
  });

  it('skipInitialAccount goes to needs-storage-choice without creating an account', async () => {
    const service = createServiceMock({ dbExistsBeforeInit: false });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    mockedShouldLoadSampleData.mockReturnValue(false);
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );
    await completeBrowserTest(result);
    await waitFor(() => expect(result.current.initializationState).toBe('needs-setup'));
    await act(async () => {
      await result.current.handlePasswordSetupConfirmed('correcthorsebatterystaple', 'Pat');
    });
    await waitFor(() => expect(result.current.initializationState).toBe('needs-initial-account'));

    await act(async () => {
      await result.current.skipInitialAccount();
    });

    expect(service.addAccountWithCard).not.toHaveBeenCalled();
    expect(result.current.initializationState).toBe('needs-storage-choice');
  });

  it('handleStorageChoiceSelected(local) goes straight to initialized without touching cloud sync', async () => {
    const service = createServiceMock({ dbExistsBeforeInit: false });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    mockedShouldLoadSampleData.mockReturnValue(false);
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );
    await completeBrowserTest(result);
    await waitFor(() => expect(result.current.initializationState).toBe('needs-setup'));
    await act(async () => {
      await result.current.handlePasswordSetupConfirmed('correcthorsebatterystaple', 'Pat');
    });
    await waitFor(() => expect(result.current.initializationState).toBe('needs-initial-account'));
    await act(async () => {
      await result.current.skipInitialAccount();
    });
    await waitFor(() => expect(result.current.initializationState).toBe('needs-storage-choice'));

    await act(async () => {
      await result.current.handleStorageChoiceSelected('local');
    });

    expect(result.current.initializationState).toBe('initialized');
    expect(mockedSyncToCloud).not.toHaveBeenCalled();
    expect(mockedCreateCloudProviderClient).not.toHaveBeenCalled();
  });

  it('handleStorageChoiceSelected(gdrive) authenticates interactively then syncs, landing on initialized', async () => {
    const service = createServiceMock({ dbExistsBeforeInit: false });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    mockedShouldLoadSampleData.mockReturnValue(false);
    const authenticate = vi.fn().mockResolvedValue(undefined);
    mockedCreateCloudProviderClient.mockReturnValue({ authenticate } as any);
    mockedSyncToCloud.mockResolvedValue('saved');
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );
    await completeBrowserTest(result);
    await waitFor(() => expect(result.current.initializationState).toBe('needs-setup'));
    await act(async () => {
      await result.current.handlePasswordSetupConfirmed('correcthorsebatterystaple', 'Pat');
    });
    await waitFor(() => expect(result.current.initializationState).toBe('needs-initial-account'));
    await act(async () => {
      await result.current.skipInitialAccount();
    });
    await waitFor(() => expect(result.current.initializationState).toBe('needs-storage-choice'));

    await act(async () => {
      await result.current.handleStorageChoiceSelected('gdrive');
    });

    expect(authenticate).toHaveBeenCalledWith(true);
    expect(mockedSyncToCloud).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gdrive', force: true })
    );
    expect(result.current.initializationState).toBe('initialized');
  });

  it('a storage-choice sync failure stays on needs-storage-choice with an error, not initialized', async () => {
    const service = createServiceMock({ dbExistsBeforeInit: false });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    mockedShouldLoadSampleData.mockReturnValue(false);
    mockedCreateCloudProviderClient.mockReturnValue({
      authenticate: vi.fn().mockRejectedValue(new Error('popup blocked')),
    } as any);
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );
    await completeBrowserTest(result);
    await waitFor(() => expect(result.current.initializationState).toBe('needs-setup'));
    await act(async () => {
      await result.current.handlePasswordSetupConfirmed('correcthorsebatterystaple', 'Pat');
    });
    await waitFor(() => expect(result.current.initializationState).toBe('needs-initial-account'));
    await act(async () => {
      await result.current.skipInitialAccount();
    });
    await waitFor(() => expect(result.current.initializationState).toBe('needs-storage-choice'));

    await act(async () => {
      await result.current.handleStorageChoiceSelected('gdrive');
    });

    expect(result.current.initializationState).toBe('needs-storage-choice');
    expect(result.current.error).toBe('popup blocked');
  });

  it('needs-cloud-auth: connectCloudSource lists files into the cloud file picker', async () => {
    document.cookie = 'budgetTrackerDatabaseSource=gdrive; path=/';
    const service = createServiceMock({ dbExistsBeforeInit: false });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    mockedReconcileOnOpen.mockResolvedValue('no-link');
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );
    await completeBrowserTest(result);
    await waitFor(() => {
      expect(result.current.initializationState).toBe('needs-cloud-auth');
    });

    const file = createCloudFile();
    mockedListCloudFiles.mockResolvedValue([file] as any);

    await act(async () => {
      await result.current.connectCloudSource('gdrive');
    });

    expect(mockedListCloudFiles).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gdrive', interactive: true })
    );
    expect(result.current.cloudFilePicker).toEqual({
      isOpen: true,
      provider: 'gdrive',
      files: [file],
      isLoading: false,
      error: null,
    });
  });

  it('tracks the attempted provider through a failed connect so the label and retry target the same provider', async () => {
    // Fresh local session (the default beforeEach cookie): databaseSourceState.source
    // stays 'local' for both this failed attempt and the retry below, since neither
    // ever persists a source change.
    const service = createServiceMock({ dbExistsBeforeInit: false });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );
    await completeBrowserTest(result);
    await waitFor(() => {
      expect(result.current.initializationState).toBe('needs-setup');
    });

    // Mirrors the needs-setup screen's "Open from Google Drive" button, which
    // always passes an explicit provider. The list call fails before anything
    // is persisted (e.g. popup blocked, or the request itself errors).
    mockedListCloudFiles.mockRejectedValueOnce(new Error('Failed to list Google Drive files'));

    await act(async () => {
      await result.current.connectCloudSource('gdrive');
    });

    await waitFor(() => {
      expect(result.current.initializationState).toBe('needs-cloud-auth');
    });
    expect(result.current.databaseSourceState.source).toBe('local');
    // The failed attempt must still be remembered so the needs-cloud-auth
    // screen's label reads "Connect Google Drive", not "Connect OneDrive".
    expect(result.current.cloudFilePicker.provider).toBe('gdrive');
    expect(result.current.error).toBe('Failed to list Google Drive files');

    // Retry, exactly as the needs-cloud-auth screen's "Connect" button does:
    // no explicit provider argument. It must re-target Google Drive, not
    // throw "Select a cloud provider to continue".
    const file = createCloudFile();
    mockedListCloudFiles.mockResolvedValueOnce([file] as any);

    await act(async () => {
      await result.current.connectCloudSource();
    });

    expect(mockedListCloudFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'gdrive', interactive: true })
    );
    expect(result.current.cloudFilePicker).toEqual({
      isOpen: true,
      provider: 'gdrive',
      files: [file],
      isLoading: false,
      error: null,
    });
  });

  it('selecting a cloud file that needs a password parks the bytes, then persists the link once the password is confirmed', async () => {
    document.cookie = 'budgetTrackerDatabaseSource=gdrive; path=/';
    const service = createServiceMock({
      dbExistsBeforeInit: false,
      isEncryptionReady: vi.fn().mockResolvedValue(false),
    });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    mockedReconcileOnOpen.mockResolvedValue('no-link');
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );
    await completeBrowserTest(result);
    await waitFor(() => expect(result.current.initializationState).toBe('needs-cloud-auth'));

    const file = createCloudFile();
    mockedListCloudFiles.mockResolvedValue([file] as any);
    await act(async () => {
      await result.current.connectCloudSource('gdrive');
    });

    const archiveBytes = new Uint8Array([1, 2, 3]);
    const freshMeta = createCloudFile({ version: '2' });
    mockedDownloadCloudArchive.mockResolvedValue({
      bytes: archiveBytes,
      cloudTimestamp: '2026-07-14T00:00:00.000Z',
      freshMeta,
    } as any);

    await act(async () => {
      await result.current.handleCloudFileSelected(file as any);
    });

    // This is the fix for the original bug: a fresh cloud-sourced device
    // now actually reaches the password screen instead of silently failing
    // to decrypt.
    expect(result.current.initializationState).toBe('needs-password-entry');
    expect(result.current.cloudFilePicker.isOpen).toBe(false);
    expect(mockedApplyDownloadedArchive).not.toHaveBeenCalled();

    const persistedState = createDefaultSourceState({
      source: 'gdrive',
      linkedFiles: { gdrive: freshMeta },
    });
    mockedPersistCloudLink.mockReturnValue(persistedState as any);
    service.getEncryptedArchiveTimestamp = vi.fn().mockReturnValue('2026-07-14T00:00:00.000Z');

    await act(async () => {
      await result.current.handlePasswordEntrySubmitted('correcthorsebatterystaple');
    });

    expect(service.canDecryptArchive).toHaveBeenCalledWith(archiveBytes, 'correcthorsebatterystaple');
    expect(service.createNewDatabase).toHaveBeenCalledWith('correcthorsebatterystaple', {
      deferIndexes: true,
    });
    expect(service.importDatabaseArchiveData).toHaveBeenCalledWith(archiveBytes);
    expect(mockedPersistCloudLink).toHaveBeenCalledWith({
      provider: 'gdrive',
      file: freshMeta,
      cloudTimestamp: '2026-07-14T00:00:00.000Z',
    });
    expect(result.current.databaseSourceState).toEqual(persistedState);
    expect(result.current.initializationState).toBe('initialized');
  });

  it('needs-unlock (cloud-linked): an incorrect password is rejected and cloud reconciliation never runs', async () => {
    document.cookie = 'budgetTrackerDatabaseSource=gdrive; path=/';
    localStorage.setItem(
      'budgetTrackerDatabaseSourceState',
      JSON.stringify(
        createDefaultSourceState({
          source: 'gdrive',
          linkedFiles: { gdrive: createCloudFile() },
        })
      )
    );

    const service = createServiceMock({
      dbExistsBeforeInit: true,
      isEncryptionReady: vi.fn().mockResolvedValue(false),
      unlockDatabase: vi.fn().mockRejectedValue(new Error('Incorrect password')),
    });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );
    await completeBrowserTest(result);
    await waitFor(() => {
      expect(result.current.initializationState).toBe('needs-unlock');
    });

    await act(async () => {
      await result.current.handleUnlockSubmitted('wrong-password');
    });

    expect(service.unlockDatabase).toHaveBeenCalledWith('wrong-password');
    expect(mockedReconcileOnOpen).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Incorrect password');
    expect(result.current.initializationState).toBe('needs-unlock');
    expect(loadAllData).not.toHaveBeenCalled();
  });

  it('needs-unlock (cloud-linked): the correct password unlocks, reconciles with the cloud source, and proceeds to initialized', async () => {
    document.cookie = 'budgetTrackerDatabaseSource=gdrive; path=/';
    localStorage.setItem(
      'budgetTrackerDatabaseSourceState',
      JSON.stringify(
        createDefaultSourceState({
          source: 'gdrive',
          linkedFiles: { gdrive: createCloudFile() },
        })
      )
    );

    const service = createServiceMock({
      dbExistsBeforeInit: true,
      isEncryptionReady: vi.fn().mockResolvedValue(false),
    });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    mockedReconcileOnOpen.mockResolvedValue('in-sync');
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );
    await completeBrowserTest(result);
    await waitFor(() => {
      expect(result.current.initializationState).toBe('needs-unlock');
    });

    await act(async () => {
      await result.current.handleUnlockSubmitted('correcthorsebatterystaple');
    });

    expect(service.unlockDatabase).toHaveBeenCalledWith('correcthorsebatterystaple');
    expect(mockedReconcileOnOpen).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'gdrive' })
    );
    expect(loadAllData).toHaveBeenCalledWith(service);
    expect(result.current.initializationState).toBe('initialized');
  });
});
