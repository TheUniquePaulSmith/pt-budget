// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  createDefaultDatabaseSourceState,
  DATABASE_SOURCE_STATE_STORAGE_KEY,
  loadPersistedDatabaseSourceState,
  persistDatabaseSourceState,
  setDatabaseSourceCookie,
  type CloudLinkedFile,
  type PersistedDatabaseSourceState,
} from './databaseSourceStorage';

describe('loadPersistedDatabaseSourceState', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setDatabaseSourceCookie('local');
  });

  it('returns the default state when nothing is persisted', () => {
    expect(loadPersistedDatabaseSourceState()).toEqual(createDefaultDatabaseSourceState());
  });

  it('normalizes missing conflict-detection fields to null on a pre-etag persisted linked file', () => {
    setDatabaseSourceCookie('gdrive');

    // Simulates JSON persisted by an older build, before etag/cTag/version/
    // md5Checksum existed on CloudLinkedFile.
    const legacyLinkedFile = {
      provider: 'gdrive',
      fileId: 'file-1',
      fileName: 'budget-tracker-2026-01-01.zip',
      modifiedAt: '2026-01-01T00:00:00.000Z',
      size: 1024,
      webUrl: 'https://drive.google.com/file-1',
    };
    const legacyState = {
      source: 'gdrive',
      linkedFiles: { gdrive: legacyLinkedFile },
      lastLocalWriteTimestamp: '2026-01-01T00:00:00.000Z',
      lastCloudSyncTimestamp: '2026-01-01T00:00:00.000Z',
      lastCloudFileTimestamp: '2026-01-01T00:00:00.000Z',
      lastSyncError: null,
    };
    window.localStorage.setItem(
      DATABASE_SOURCE_STATE_STORAGE_KEY,
      JSON.stringify(legacyState)
    );

    const loaded = loadPersistedDatabaseSourceState();

    expect(loaded.linkedFiles.gdrive).toEqual({
      ...legacyLinkedFile,
      etag: null,
      cTag: null,
      version: null,
      md5Checksum: null,
    });
    // syncIntervalMinutes didn't exist on this older persisted shape either.
    expect(loaded.syncIntervalMinutes).toBe(60);
  });

  it('preserves conflict-detection fields already present in persisted JSON', () => {
    setDatabaseSourceCookie('onedrive');

    const linkedFile: CloudLinkedFile = {
      provider: 'onedrive',
      fileId: 'file-2',
      fileName: 'budget-tracker-2026-02-01.zip',
      modifiedAt: '2026-02-01T00:00:00.000Z',
      size: 2048,
      webUrl: 'https://onedrive.example/file-2',
      etag: '"etag-abc"',
      cTag: '"ctag-abc"',
      version: null,
      md5Checksum: null,
    };
    const state: PersistedDatabaseSourceState = {
      source: 'onedrive',
      linkedFiles: { onedrive: linkedFile },
      lastLocalWriteTimestamp: null,
      lastCloudSyncTimestamp: null,
      lastCloudFileTimestamp: null,
      lastSyncError: null,
      autoSyncEnabled: true,
      syncIntervalMinutes: 60,
      pendingChangesSince: null,
      lastSyncAttemptAt: null,
      conflict: null,
    };
    window.localStorage.setItem(
      DATABASE_SOURCE_STATE_STORAGE_KEY,
      JSON.stringify(state)
    );

    const loaded = loadPersistedDatabaseSourceState();

    expect(loaded.linkedFiles.onedrive).toEqual(linkedFile);
  });

  it('round-trips a linked file through persistDatabaseSourceState', () => {
    const linkedFile: CloudLinkedFile = {
      provider: 'gdrive',
      fileId: 'file-3',
      fileName: 'budget-tracker-2026-03-01.zip',
      modifiedAt: '2026-03-01T00:00:00.000Z',
      size: 512,
      webUrl: null,
      etag: null,
      cTag: null,
      version: '42',
      md5Checksum: 'abcdef',
    };

    persistDatabaseSourceState({
      source: 'gdrive',
      linkedFiles: { gdrive: linkedFile },
      lastLocalWriteTimestamp: '2026-03-01T00:00:00.000Z',
      lastCloudSyncTimestamp: '2026-03-01T00:00:00.000Z',
      lastCloudFileTimestamp: '2026-03-01T00:00:00.000Z',
      lastSyncError: null,
      autoSyncEnabled: true,
      syncIntervalMinutes: 60,
      pendingChangesSince: null,
      lastSyncAttemptAt: null,
      conflict: null,
    });

    const loaded = loadPersistedDatabaseSourceState();
    expect(loaded.linkedFiles.gdrive).toEqual(linkedFile);
    expect(loaded.source).toBe('gdrive');
  });

  it('handles an entirely missing linkedFiles object in persisted JSON', () => {
    setDatabaseSourceCookie('local');
    window.localStorage.setItem(
      DATABASE_SOURCE_STATE_STORAGE_KEY,
      JSON.stringify({
        source: 'local',
        lastLocalWriteTimestamp: null,
        lastCloudSyncTimestamp: null,
        lastCloudFileTimestamp: null,
        lastSyncError: null,
      })
    );

    expect(loadPersistedDatabaseSourceState().linkedFiles).toEqual({});
  });
});
