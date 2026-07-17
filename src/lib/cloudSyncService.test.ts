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
  hasFileChangedRemotely,
  reconcileOnOpen,
  resolveConflict,
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
    // Upload responses carry an md5Checksum so the post-upload
    // ensureContentToken re-fetch stays out of tests not about it.
    uploadFile: vi.fn().mockResolvedValue(makeLinkedFile({ version: '2', md5Checksum: 'md5-upload' })),
    ...overrides,
  } as unknown as CloudProviderClient;
}

beforeEach(() => {
  window.localStorage.clear();
  setDatabaseSourceCookie('local');
});

describe('hasFileChangedRemotely', () => {
  it.each([
    [
      'gdrive: version drifted server-side but md5 matches → unchanged',
      'gdrive',
      { version: '1', md5Checksum: 'aaa' },
      { version: '9', md5Checksum: 'aaa' },
      false,
    ],
    [
      'gdrive: md5 differs → changed, regardless of version',
      'gdrive',
      { version: '1', md5Checksum: 'aaa' },
      { version: '1', md5Checksum: 'bbb' },
      true,
    ],
    [
      'gdrive: legacy baseline without md5 falls back to version compare (mismatch)',
      'gdrive',
      { version: '1', md5Checksum: null },
      { version: '2', md5Checksum: 'aaa' },
      true,
    ],
    [
      'gdrive: legacy baseline without md5 falls back to version compare (match)',
      'gdrive',
      { version: '1', md5Checksum: null },
      { version: '1', md5Checksum: 'aaa' },
      false,
    ],
    [
      'onedrive: eTag churned post-upload but cTag matches → unchanged',
      'onedrive',
      { version: null, etag: '"e1"', cTag: '"c1"' },
      { version: null, etag: '"e9"', cTag: '"c1"' },
      false,
    ],
    [
      'onedrive: cTag differs → changed, regardless of eTag',
      'onedrive',
      { version: null, etag: '"e1"', cTag: '"c1"' },
      { version: null, etag: '"e1"', cTag: '"c9"' },
      true,
    ],
    [
      'onedrive: legacy link without cTags falls back to eTag compare',
      'onedrive',
      { version: null, etag: '"e1"', cTag: null },
      { version: null, etag: '"e2"', cTag: null },
      true,
    ],
    [
      'no tokens at all: equal modified-times → unchanged',
      'gdrive',
      { version: null, modifiedAt: '2026-07-01T00:00:00.000Z' },
      { version: null, modifiedAt: '2026-07-01T00:00:00.000Z' },
      false,
    ],
    [
      'no tokens at all: differing modified-times → changed',
      'gdrive',
      { version: null, modifiedAt: '2026-07-01T00:00:00.000Z' },
      { version: null, modifiedAt: '2026-07-02T00:00:00.000Z' },
      true,
    ],
    [
      'nothing comparable → conservatively changed',
      'gdrive',
      { version: null, modifiedAt: null },
      { version: null, modifiedAt: null },
      true,
    ],
  ] as const)('%s', (_description, provider, linkedOverrides, currentOverrides, expected) => {
    expect(
      hasFileChangedRemotely(
        provider,
        makeLinkedFile({ provider, ...linkedOverrides }),
        makeLinkedFile({ provider, ...currentOverrides })
      )
    ).toBe(expected);
  });
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

  it('falls back to the version compare for a legacy link without checksums and detects a conflict', async () => {
    // md5Checksum null on both sides — a link persisted before content
    // fingerprints were captured — so the version fallback decides.
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

  it('does not conflict when the version drifted server-side but the checksum matches, and uploads with the fresh token', async () => {
    // The regression behind "every local edit shows Resolve conflict":
    // Drive advances `version` on its own after an upload, so the stored
    // baseline never matches a later metadata read even though the bytes
    // are untouched. The md5 compare must win, and the upload's ifMatch
    // must be the freshly-read version, not the stale stored one.
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      source: 'gdrive',
      linkedFiles: { gdrive: makeLinkedFile({ version: '1', md5Checksum: 'aaa' }) },
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
    });

    const databaseService = makeFakeDatabaseService();
    const uploadFile = vi
      .fn()
      .mockResolvedValue(makeLinkedFile({ version: '6', md5Checksum: 'bbb' }));
    const client = makeFakeClient({
      getFileMetadata: vi
        .fn()
        .mockResolvedValue(makeLinkedFile({ version: '5', md5Checksum: 'aaa' })),
      uploadFile,
    });

    const outcome = await syncToCloud({
      databaseService,
      provider: 'gdrive',
      clientFactory: () => client,
    });

    expect(outcome).toBe('saved');
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ ifMatch: '5' }));

    const persisted = loadPersistedDatabaseSourceState();
    expect(persisted.linkedFiles.gdrive?.md5Checksum).toBe('bbb');
    expect(persisted.conflict).toBeNull();
    expect(persisted.pendingChangesSince).toBeNull();
  });

  it('detects a conflict when the remote checksum changed even though the version matches', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      source: 'gdrive',
      linkedFiles: { gdrive: makeLinkedFile({ version: '1', md5Checksum: 'aaa' }) },
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
    });

    const databaseService = makeFakeDatabaseService();
    const client = makeFakeClient({
      getFileMetadata: vi
        .fn()
        .mockResolvedValue(makeLinkedFile({ version: '1', md5Checksum: 'zzz' })),
    });

    const outcome = await syncToCloud({
      databaseService,
      provider: 'gdrive',
      clientFactory: () => client,
    });

    expect(outcome).toBe('conflict');
    expect(client.uploadFile).not.toHaveBeenCalled();
    expect(loadPersistedDatabaseSourceState().conflict).toMatchObject({
      provider: 'gdrive',
      remoteEtag: '1',
    });
  });

  it('tolerates OneDrive eTag churn when the cTag matches, sending the fresh eTag as If-Match', async () => {
    const linked = makeLinkedFile({
      provider: 'onedrive',
      etag: '"e1"',
      cTag: '"c1"',
      version: null,
      md5Checksum: null,
    });
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      source: 'onedrive',
      linkedFiles: { onedrive: linked },
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
    });

    const databaseService = makeFakeDatabaseService();
    const uploadFile = vi.fn().mockResolvedValue(
      makeLinkedFile({
        provider: 'onedrive',
        etag: '"e10"',
        cTag: '"c2"',
        version: null,
        md5Checksum: null,
      })
    );
    const client = makeFakeClient({
      getFileMetadata: vi.fn().mockResolvedValue(
        makeLinkedFile({
          provider: 'onedrive',
          etag: '"e9"',
          cTag: '"c1"',
          version: null,
          md5Checksum: null,
        })
      ),
      uploadFile,
    });

    const outcome = await syncToCloud({
      databaseService,
      provider: 'onedrive',
      clientFactory: () => client,
    });

    expect(outcome).toBe('saved');
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ ifMatch: '"e9"' }));
    expect(loadPersistedDatabaseSourceState().linkedFiles.onedrive?.cTag).toBe('"c2"');
  });

  it('detects a OneDrive conflict when the cTag changed', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      source: 'onedrive',
      linkedFiles: {
        onedrive: makeLinkedFile({
          provider: 'onedrive',
          etag: '"e1"',
          cTag: '"c1"',
          version: null,
          md5Checksum: null,
        }),
      },
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
    });

    const databaseService = makeFakeDatabaseService();
    const client = makeFakeClient({
      getFileMetadata: vi.fn().mockResolvedValue(
        makeLinkedFile({
          provider: 'onedrive',
          etag: '"e1"',
          cTag: '"c9"',
          version: null,
          md5Checksum: null,
        })
      ),
    });

    const outcome = await syncToCloud({
      databaseService,
      provider: 'onedrive',
      clientFactory: () => client,
    });

    expect(outcome).toBe('conflict');
    expect(client.uploadFile).not.toHaveBeenCalled();
  });

  it('re-fetches metadata when the upload response lacks a content checksum', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      source: 'gdrive',
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
    });

    const databaseService = makeFakeDatabaseService();
    const getFileMetadata = vi
      .fn()
      .mockResolvedValue(makeLinkedFile({ version: '8', md5Checksum: 'md5-fresh' }));
    const client = makeFakeClient({
      getFileMetadata,
      uploadFile: vi.fn().mockResolvedValue(makeLinkedFile({ version: '7', md5Checksum: null })),
    });

    const outcome = await syncToCloud({
      databaseService,
      provider: 'gdrive',
      clientFactory: () => client,
    });

    expect(outcome).toBe('saved');
    expect(getFileMetadata).toHaveBeenCalledWith('file-1');
    const persisted = loadPersistedDatabaseSourceState();
    expect(persisted.linkedFiles.gdrive?.md5Checksum).toBe('md5-fresh');
    expect(persisted.linkedFiles.gdrive?.version).toBe('8');
  });

  it('still saves with the upload response when the compensating metadata read fails', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      source: 'gdrive',
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
    });

    const databaseService = makeFakeDatabaseService();
    const client = makeFakeClient({
      getFileMetadata: vi.fn().mockRejectedValue(new Error('metadata read failed')),
      uploadFile: vi.fn().mockResolvedValue(makeLinkedFile({ version: '7', md5Checksum: null })),
    });

    const outcome = await syncToCloud({
      databaseService,
      provider: 'gdrive',
      clientFactory: () => client,
    });

    expect(outcome).toBe('saved');
    const persisted = loadPersistedDatabaseSourceState();
    expect(persisted.linkedFiles.gdrive?.version).toBe('7');
    expect(persisted.linkedFiles.gdrive?.md5Checksum).toBeNull();
    expect(persisted.pendingChangesSince).toBeNull();
  });

  it('uploads and clears pending changes on a successful sync', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      source: 'gdrive',
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
    });

    const databaseService = makeFakeDatabaseService();
    const client = makeFakeClient({
      uploadFile: vi.fn().mockResolvedValue(makeLinkedFile({ version: '7', md5Checksum: 'md5-7' })),
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
    const uploadFile = vi
      .fn()
      .mockResolvedValue(makeLinkedFile({ version: '2', md5Checksum: 'md5-force' }));
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

  // The four version-compare cases below exercise the legacy fallback:
  // makeLinkedFile defaults md5Checksum to null, as persisted by app
  // versions that predate content fingerprints.
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

  it('returns in-sync at boot when only the version drifted but the checksum matches', async () => {
    // Without the checksum compare, this exact state used to trigger a
    // silent cloud re-download on every app open.
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      linkedFiles: { gdrive: makeLinkedFile({ version: '1', md5Checksum: 'aaa' }) },
    });
    const client = makeFakeClient({
      getFileMetadata: vi
        .fn()
        .mockResolvedValue(makeLinkedFile({ version: '9', md5Checksum: 'aaa' })),
    });

    const outcome = await reconcileOnOpen({ provider: 'gdrive', clientFactory: () => client });
    expect(outcome).toBe('in-sync');
  });

  it('returns local-newer at boot when changes are pending and only the version drifted', async () => {
    // Without the checksum compare, this exact state used to record a
    // conflict at boot ("both-changed") from a purely-local edit.
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      linkedFiles: { gdrive: makeLinkedFile({ version: '1', md5Checksum: 'aaa' }) },
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
    });
    const client = makeFakeClient({
      getFileMetadata: vi
        .fn()
        .mockResolvedValue(makeLinkedFile({ version: '9', md5Checksum: 'aaa' })),
    });

    const outcome = await reconcileOnOpen({ provider: 'gdrive', clientFactory: () => client });
    expect(outcome).toBe('local-newer');
    expect(loadPersistedDatabaseSourceState().conflict).toBeNull();
  });

  it('returns both-changed and records the conflict when the checksum differs while changes are pending', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      linkedFiles: { gdrive: makeLinkedFile({ version: '1', md5Checksum: 'aaa' }) },
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
    });
    const client = makeFakeClient({
      getFileMetadata: vi
        .fn()
        .mockResolvedValue(makeLinkedFile({ version: '9', md5Checksum: 'zzz' })),
    });

    const outcome = await reconcileOnOpen({ provider: 'gdrive', clientFactory: () => client });
    expect(outcome).toBe('both-changed');
    expect(loadPersistedDatabaseSourceState().conflict).toMatchObject({
      provider: 'gdrive',
      remoteEtag: '9',
    });
  });
});

describe('resolveConflict', () => {
  it('keep-both uploads under a new name and re-fetches metadata when the response lacks a checksum', async () => {
    persistDatabaseSourceState({
      ...createDefaultDatabaseSourceState(),
      source: 'gdrive',
      linkedFiles: { gdrive: makeLinkedFile() },
      pendingChangesSince: '2026-07-14T00:00:00.000Z',
      conflict: {
        provider: 'gdrive',
        detectedAt: '2026-07-14T00:00:00.000Z',
        remoteModifiedAt: null,
        remoteEtag: '5',
      },
    });

    const databaseService = makeFakeDatabaseService();
    const getFileMetadata = vi
      .fn()
      .mockResolvedValue(makeLinkedFile({ fileId: 'file-2', version: '3', md5Checksum: 'md5-2' }));
    const uploadFile = vi
      .fn()
      .mockResolvedValue(makeLinkedFile({ fileId: 'file-2', version: '2', md5Checksum: null }));
    const client = makeFakeClient({ getFileMetadata, uploadFile });

    const outcome = await resolveConflict({
      databaseService,
      provider: 'gdrive',
      choice: 'keep-both',
      clientFactory: () => client,
    });

    expect(outcome).toBe('saved');
    expect(uploadFile).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    expect(getFileMetadata).toHaveBeenCalledWith('file-2');

    const persisted = loadPersistedDatabaseSourceState();
    expect(persisted.linkedFiles.gdrive?.md5Checksum).toBe('md5-2');
    expect(persisted.conflict).toBeNull();
    expect(persisted.pendingChangesSince).toBeNull();
  });
});
