// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseService } from '../lib/databaseService';
import {
  createDefaultDatabaseSourceState,
  persistDatabaseSourceState,
  setDatabaseSourceCookie,
  type PersistedDatabaseSourceState,
} from '../lib/databaseSourceStorage';
import { useCloudAutoSync } from './useCloudAutoSync';

const mockOnDatabaseChanged = vi.fn();

vi.mock('../lib/databaseWorkerService', () => ({
  databaseWorkerService: {
    onDatabaseChanged: (...args: unknown[]) => mockOnDatabaseChanged(...args),
  },
}));

const mockSyncToCloud = vi.fn();
const mockResolveConflict = vi.fn();
const mockSetAutoSyncEnabled = vi.fn();

vi.mock('../lib/cloudSyncService', () => ({
  syncToCloud: (...args: unknown[]) => mockSyncToCloud(...args),
  resolveConflict: (...args: unknown[]) => mockResolveConflict(...args),
  setAutoSyncEnabled: (...args: unknown[]) => mockSetAutoSyncEnabled(...args),
}));

const mockAuthenticate = vi.fn().mockResolvedValue(undefined);

vi.mock('../lib/cloudProviderClients', () => ({
  createCloudProviderClient: () => ({ authenticate: mockAuthenticate }),
}));

// jsdom does not implement the Web Locks API.
function stubNavigatorLocks() {
  Object.defineProperty(globalThis.navigator, 'locks', {
    configurable: true,
    value: {
      request: (_name: string, _options: unknown, fn: (lock: unknown) => unknown) => fn({}),
    },
  });
}

function makeCloudState(
  overrides: Partial<PersistedDatabaseSourceState> = {}
): PersistedDatabaseSourceState {
  return {
    ...createDefaultDatabaseSourceState(),
    source: 'gdrive',
    ...overrides,
  };
}

describe('useCloudAutoSync', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setDatabaseSourceCookie('local');
    mockOnDatabaseChanged.mockReset().mockReturnValue(vi.fn());
    mockSyncToCloud.mockReset().mockResolvedValue('saved');
    mockResolveConflict.mockReset().mockResolvedValue(undefined);
    mockSetAutoSyncEnabled.mockReset();
    mockAuthenticate.mockClear();
    stubNavigatorLocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not subscribe to database changes or activate a scheduler for a local source', async () => {
    const { result } = renderHook(() =>
      useCloudAutoSync({
        databaseService: {} as unknown as DatabaseService,
        databaseSourceState: createDefaultDatabaseSourceState(),
        setDatabaseSourceState: vi.fn(),
        initializationState: 'initialized',
      })
    );

    expect(mockOnDatabaseChanged).not.toHaveBeenCalled();
    expect(result.current.syncStatus.state).toBe('disabled');
  });

  it('wires database_changed events into the scheduler as pending', async () => {
    persistDatabaseSourceState(makeCloudState());

    const { result } = renderHook(() =>
      useCloudAutoSync({
        databaseService: {} as unknown as DatabaseService,
        databaseSourceState: makeCloudState(),
        setDatabaseSourceState: vi.fn(),
        initializationState: 'initialized',
      })
    );

    expect(mockOnDatabaseChanged).toHaveBeenCalledTimes(1);
    const changeCallback = mockOnDatabaseChanged.mock.calls[0][0] as (event: {
      changedAt: string;
      writeCount: number;
    }) => void;

    act(() => {
      changeCallback({ changedAt: '2026-07-14T00:00:00.000Z', writeCount: 1 });
    });

    expect(result.current.syncStatus.state).toBe('pending');
    expect(result.current.syncStatus.pendingSince).toBe('2026-07-14T00:00:00.000Z');
  });

  it('prevents the tab from closing while a sync is pending', async () => {
    persistDatabaseSourceState(makeCloudState());

    renderHook(() =>
      useCloudAutoSync({
        databaseService: {} as unknown as DatabaseService,
        databaseSourceState: makeCloudState(),
        setDatabaseSourceState: vi.fn(),
        initializationState: 'initialized',
      })
    );

    const changeCallback = mockOnDatabaseChanged.mock.calls[0][0] as (event: {
      changedAt: string;
      writeCount: number;
    }) => void;
    act(() => {
      changeCallback({ changedAt: '2026-07-14T00:00:00.000Z', writeCount: 1 });
    });

    const event = new Event('beforeunload', { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('does not prevent the tab from closing while idle', async () => {
    persistDatabaseSourceState(makeCloudState());

    renderHook(() =>
      useCloudAutoSync({
        databaseService: {} as unknown as DatabaseService,
        databaseSourceState: makeCloudState(),
        setDatabaseSourceState: vi.fn(),
        initializationState: 'initialized',
      })
    );

    const event = new Event('beforeunload', { cancelable: true });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    window.dispatchEvent(event);

    expect(preventDefaultSpy).not.toHaveBeenCalled();
  });

  it('syncNow drives cloudSyncService.syncToCloud through the Web Locks stub', async () => {
    persistDatabaseSourceState(makeCloudState());

    const { result } = renderHook(() =>
      useCloudAutoSync({
        databaseService: {} as unknown as DatabaseService,
        databaseSourceState: makeCloudState(),
        setDatabaseSourceState: vi.fn(),
        initializationState: 'initialized',
      })
    );

    await act(async () => {
      await result.current.syncNow();
    });

    expect(mockSyncToCloud).toHaveBeenCalledTimes(1);
    expect(result.current.syncStatus.state).toBe('idle');
  });

  it('reconnect authenticates interactively and resumes a paused sync', async () => {
    persistDatabaseSourceState(makeCloudState());
    mockSyncToCloud.mockResolvedValueOnce('auth-required').mockResolvedValueOnce('saved');

    const { result } = renderHook(() =>
      useCloudAutoSync({
        databaseService: {} as unknown as DatabaseService,
        databaseSourceState: makeCloudState(),
        setDatabaseSourceState: vi.fn(),
        initializationState: 'initialized',
      })
    );

    // A real auth-required pause only leaves something to resume() when
    // there's actually pending work — mark the database dirty first, same
    // as a real 'database_changed' broadcast would.
    const changeCallback = mockOnDatabaseChanged.mock.calls[0][0] as (event: {
      changedAt: string;
      writeCount: number;
    }) => void;
    act(() => {
      changeCallback({ changedAt: '2026-07-14T00:00:00.000Z', writeCount: 1 });
    });

    await act(async () => {
      await result.current.syncNow();
    });
    expect(result.current.syncStatus.state).toBe('paused-auth');

    await act(async () => {
      await result.current.reconnect();
    });

    expect(mockAuthenticate).toHaveBeenCalledWith(true);
    expect(mockSyncToCloud).toHaveBeenCalledTimes(2);
    expect(result.current.syncStatus.state).toBe('idle');
  });
});
