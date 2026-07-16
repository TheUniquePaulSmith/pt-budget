// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseService, DatabaseStatusSummary } from './databaseService';
import type { CloudProviderClient } from './cloudProviderClients';
import { CloudAuthRequiredError, CloudConflictError } from './cloudSyncErrors';
import {
  createDefaultDatabaseSourceState,
  loadPersistedDatabaseSourceState,
  persistDatabaseSourceState,
  setDatabaseSourceCookie,
  type CloudLinkedFile,
} from './databaseSourceStorage';
import {
  applyDownloadedArchive,
  decideReconcileOutcome,
  reconcileOnOpen,
  syncToCloud,
} from './cloudSyncService';

function makeLinkedFile(overrides: Partial<CloudLinkedFile> = {}): CloudLinkedFile {
  return {
    provider: 'gdrive',
    fileId: 'file-1',
    fileName: 'budget-tracker-database.zip',
    modifiedAt: '2026-07-01T00:00:00.000Z',
    size: 1024,
    webUrl: null,
    etag: null,
    cTag: null,
    version: '1',
    md5Checksum: null,
    ...overrides,
  };
}

function makeFakeDatabaseService(
  overrides: Partial<Record<keyof DatabaseService, unknown>> = {}
): DatabaseService {
  return {
    isEncryptionReady: vi.fn().mockResolvedValue(true),
    getDatabaseStatus: vi.fn().mockResolvedValue({
      lastWriteTimestamp: '2026-07-14T00:00:00.000Z',
      tableStats: {},
    } as DatabaseStatusSummary),
    exportDatabase: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    importDatabaseArchiveData: vi.fn().mockResolvedValue(undefined),
    getEncryptedArchiveTimestamp: vi.fn().mockReturnValue('2026-07-14T00:00:00.000Z'),
    ...overrides,
  } as unknown as DatabaseService;
}

function makeFakeClient(overrides: Partial<CloudProviderClient> = {}): CloudProviderClient {
  return {
    provider: 'gdrive',
    isConfigured: vi.fn().mockReturnValue(true),
    authenticate: vi.fn().mockResolvedValue(undefined),
    listDatabaseFiles: vi.fn().mockResolvedValue([]),
    downloadFile: vi.fn().mockResolvedValue(new Uint8Array()),
    getFileMetadata: vi.fn().mockResolvedValue(makeLinkedFile()),
    uploadFile: vi.fn().mockResolvedValue(makeLinkedFile({ version: '2' })),
    ...overrides,
  } as unknown as CloudProviderClient;
}

beforeEach(() => {
  window.localStorage.clear();
  setDatabaseSourceCookie('local');
});

describe('syncToCloud', () => {
  it('returns locked when the worker does not hold an encryption key', async () => {
    const databaseService = makeFakeDatabaseService({
      isEncryptionReady: vi.fn().mockResolvedValue(false),
    });
    const client = makeFakeClient();

    const outcome = await syncToCloud({
      databaseService,
      provider: 'gdrive',
      clientFactory: () => client,
    });

    expect(outcome).toBe('locked');
    expect(client.authenticate).not.toHaveBeenCalled();
  });

  it('returns no-changes when a link already exists and nothing is pending', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      linkedFiles: { gdrive: makeLinkedFile() },
    });

    const databaseService = makeFakeDatabaseService();
    const client = makeFakeClient();

    const outcome = await syncToCloud({
      databaseService,
      provider: 'gdrive',
      clientFactory: () => client,
    });

    expect(outcome).toBe('no-changes');
    expect(client.authenticate).not.toHaveBeenCalled();
  });

  it('returns auth-required without ever authenticating interactively', async () => {
    const databaseService = makeFakeDatabaseService();
    const authenticate = vi.fn().mockRejectedValue(new CloudAuthRequiredError());
    const client = makeFakeClient({ authenticate });

    const outcome = await syncToCloud({
      databaseService,
      provider: 'gdrive',
      clientFactory: () => client,
    });

    expect(outcome).toBe('auth-required');
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(authenticate).toHaveBeenCalledWith(false);
  });

  it('detects a conflict when the remote version no longer matches the linked baseline', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      source: 'gdrive',
      linkedFiles: { gdrive: makeLinkedFile({ version: '1' }) },
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
    });

    const databaseService = makeFakeDatabaseService();
    const client = makeFakeClient({
      getFileMetadata: vi.fn().mockResolvedValue(makeLinkedFile({ version: '2' })),
    });

    const outcome = await syncToCloud({
      databaseService,
      provider: 'gdrive',
      clientFactory: () => client,
    });

    expect(outcome).toBe('conflict');
    expect(client.uploadFile).not.toHaveBeenCalled();

    const persisted = loadPersistedDatabaseSourceState();
    expect(persisted.conflict).toMatchObject({ provider: 'gdrive', remoteEtag: '2' });
  });

  it('uploads and clears pending changes on a successful sync', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      source: 'gdrive',
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
    });

    const databaseService = makeFakeDatabaseService();
    const client = makeFakeClient({
      uploadFile: vi.fn().mockResolvedValue(makeLinkedFile({ version: '7' })),
    });

    const outcome = await syncToCloud({
      databaseService,
      provider: 'gdrive',
      clientFactory: () => client,
    });

    expect(outcome).toBe('saved');
    const persisted = loadPersistedDatabaseSourceState();
    expect(persisted.pendingChangesSince).toBeNull();
    expect(persisted.linkedFiles.gdrive?.version).toBe('7');
    expect(persisted.lastSyncError).toBeNull();
  });

  it('surfaces a conflict when uploadFile itself rejects with CloudConflictError', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      source: 'gdrive',
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
    });

    const databaseService = makeFakeDatabaseService();
    const remote = makeLinkedFile({ version: '99' });
    const client = makeFakeClient({
      uploadFile: vi.fn().mockRejectedValue(new CloudConflictError('changed', remote)),
    });

    const outcome = await syncToCloud({
      databaseService,
      provider: 'gdrive',
      clientFactory: () => client,
    });

    expect(outcome).toBe('conflict');
    const persisted = loadPersistedDatabaseSourceState();
    expect(persisted.conflict?.remoteEtag).toBe('99');
  });

  it('force skips the preflight check and passes force through to uploadFile', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      source: 'gdrive',
      linkedFiles: { gdrive: makeLinkedFile({ version: '1' }) },
    });

    const databaseService = makeFakeDatabaseService();
    const getFileMetadata = vi.fn();
    const uploadFile = vi.fn().mockResolvedValue(makeLinkedFile({ version: '2' }));
    const client = makeFakeClient({ getFileMetadata, uploadFile });

    const outcome = await syncToCloud({
      databaseService,
      provider: 'gdrive',
      force: true,
      clientFactory: () => client,
    });

    expect(outcome).toBe('saved');
    expect(getFileMetadata).not.toHaveBeenCalled();
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
  });
});

describe('applyDownloadedArchive', () => {
  it('imports the archive and persists the link, clearing dirty/conflict state', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
      conflict: {
        provider: 'gdrive',
        detectedAt: '2026-07-14T00:00:00.000Z',
        remoteModifiedAt: null,
        remoteEtag: '5',
      },
    });

    const databaseService = makeFakeDatabaseService();
    const file = makeLinkedFile({ version: '5' });
    const bytes = new Uint8Array([9, 9, 9]);

    const result = await applyDownloadedArchive({
      databaseService,
      provider: 'gdrive',
      file,
      bytes,
    });

    expect(databaseService.importDatabaseArchiveData).toHaveBeenCalledWith(bytes);
    expect(result.pendingChangesSince).toBeNull();
    expect(result.conflict).toBeNull();
    expect(result.linkedFiles.gdrive).toEqual(file);
    expect(result.source).toBe('gdrive');
  });
});

describe('decideReconcileOutcome', () => {
  it.each([
    [{ hasLink: false, remoteChanged: false, isDirty: false }, 'no-link'],
    [{ hasLink: true, remoteChanged: false, isDirty: false }, 'in-sync'],
    [{ hasLink: true, remoteChanged: false, isDirty: true }, 'local-newer'],
    [{ hasLink: true, remoteChanged: true, isDirty: false }, 'remote-newer'],
    [{ hasLink: true, remoteChanged: true, isDirty: true }, 'both-changed'],
  ] as const)('resolves %j to %s', (input, expected) => {
    expect(decideReconcileOutcome(input)).toBe(expected);
  });
});

describe('reconcileOnOpen', () => {
  it('returns no-link when there is no linked cloud file', async () => {
    const outcome = await reconcileOnOpen({
      provider: 'gdrive',
      clientFactory: () => makeFakeClient(),
    });

    expect(outcome).toBe('no-link');
  });

  it('returns in-sync when the remote version matches and nothing is pending locally', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      linkedFiles: { gdrive: makeLinkedFile({ version: '1' }) },
    });
    const client = makeFakeClient({
      getFileMetadata: vi.fn().mockResolvedValue(makeLinkedFile({ version: '1' })),
    });

    const outcome = await reconcileOnOpen({ provider: 'gdrive', clientFactory: () => client });
    expect(outcome).toBe('in-sync');
  });

  it('returns local-newer when the remote version matches but local changes are pending', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      linkedFiles: { gdrive: makeLinkedFile({ version: '1' }) },
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
    });
    const client = makeFakeClient({
      getFileMetadata: vi.fn().mockResolvedValue(makeLinkedFile({ version: '1' })),
    });

    const outcome = await reconcileOnOpen({ provider: 'gdrive', clientFactory: () => client });
    expect(outcome).toBe('local-newer');
  });

  it('returns remote-newer when the remote version changed and nothing is pending locally', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      linkedFiles: { gdrive: makeLinkedFile({ version: '1' }) },
    });
    const client = makeFakeClient({
      getFileMetadata: vi.fn().mockResolvedValue(makeLinkedFile({ version: '2' })),
    });

    const outcome = await reconcileOnOpen({ provider: 'gdrive', clientFactory: () => client });
    expect(outcome).toBe('remote-newer');
  });

  it('returns both-changed when the remote version changed while local changes are pending', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      linkedFiles: { gdrive: makeLinkedFile({ version: '1' }) },
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
    });
    const client = makeFakeClient({
      getFileMetadata: vi.fn().mockResolvedValue(makeLinkedFile({ version: '2' })),
    });

    const outcome = await reconcileOnOpen({ provider: 'gdrive', clientFactory: () => client });
    expect(outcome).toBe('both-changed');
  });

  it('returns auth-required without opening a popup when silent auth fails', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      linkedFiles: { gdrive: makeLinkedFile() },
    });
    const authenticate = vi.fn().mockRejectedValue(new CloudAuthRequiredError());
    const client = makeFakeClient({ authenticate });

    const outcome = await reconcileOnOpen({ provider: 'gdrive', clientFactory: () => client });
    expect(outcome).toBe('auth-required');
    expect(authenticate).toHaveBeenCalledWith(false);
  });
});
