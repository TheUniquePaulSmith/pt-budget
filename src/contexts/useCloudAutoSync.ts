'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import { databaseWorkerService } from '../lib/databaseWorkerService';
import { createCloudProviderClient } from '../lib/cloudProviderClients';
import {
  AutoSyncScheduler,
  type AutoSyncSnapshot,
} from '../lib/cloudAutoSyncScheduler';
import {
  resolveConflict as resolveConflictSync,
  setAutoSyncEnabled as persistAutoSyncEnabled,
  syncToCloud,
  type ConflictResolutionChoice,
  type SyncStage,
} from '../lib/cloudSyncService';
import {
  clearPendingChanges,
  loadPersistedDatabaseSourceState,
  markPendingChanges,
  type DatabaseSource,
  type PersistedDatabaseSourceState,
} from '../lib/databaseSourceStorage';
import type { InitializationState } from './useDatabaseInitialization';

const LOCK_NAME = 'bt-cloud-sync';

const DISABLED_SNAPSHOT: AutoSyncSnapshot = {
  state: 'disabled',
  pauseReason: null,
  pendingSince: null,
  lastSyncAt: null,
  lastError: null,
};

/** Dev-only debounce override for e2e specs, so they don't wait out the real 15s window. */
function getDebounceOverrideMs(): number | undefined {
  if (typeof window === 'undefined' || process.env.NODE_ENV === 'production') {
    return undefined;
  }
  const value = new URLSearchParams(window.location.search).get('syncDebounceMs');
  const parsed = value ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

interface UseCloudAutoSyncOptions {
  databaseService: DatabaseService | null;
  databaseSourceState: PersistedDatabaseSourceState;
  setDatabaseSourceState: (state: PersistedDatabaseSourceState) => void;
  initializationState: InitializationState;
}

export function useCloudAutoSync({
  databaseService,
  databaseSourceState,
  setDatabaseSourceState,
  initializationState,
}: UseCloudAutoSyncOptions) {
  const schedulerRef = useRef<AutoSyncScheduler | null>(null);
  const [syncStatus, setSyncStatus] = useState<AutoSyncSnapshot>(DISABLED_SNAPSHOT);
  // Fine-grained progress within a single sync attempt (flushing/exporting/
  // encrypting/uploading/done) — separate from syncStatus.state, which only
  // tracks the coarser scheduler state (idle/pending/syncing/paused/error).
  const [syncStage, setSyncStage] = useState<SyncStage | null>(null);

  const source: DatabaseSource = databaseSourceState.source;
  const isActive = initializationState === 'initialized' && source !== 'local';

  // The scheduler's performSync closure is long-lived (created once per
  // isActive transition); this ref lets it always see the latest service
  // instance/source without needing to be recreated on every render, which
  // would otherwise discard in-flight debounce/retry state.
  const latestRef = useRef({ databaseService, source });
  latestRef.current = { databaseService, source };

  const refreshDatabaseSourceState = useCallback(() => {
    setDatabaseSourceState(loadPersistedDatabaseSourceState());
  }, [setDatabaseSourceState]);

  const performSync = useCallback(async () => {
    const { databaseService: service, source: currentSource } = latestRef.current;
    if (!service || currentSource === 'local') {
      return 'no-changes' as const;
    }

    const runSync = () =>
      syncToCloud({ databaseService: service, provider: currentSource, onStage: setSyncStage });

    // De-dupes uploads across tabs sharing the same SharedWorker: every tab
    // receives the same 'database_changed' broadcast, but only one should
    // actually perform the export+upload.
    const outcome =
      typeof navigator !== 'undefined' && 'locks' in navigator
        ? await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, (lock) =>
            lock ? runSync() : Promise.resolve('no-changes' as const)
          )
        : await runSync();

    setSyncStage(null);
    refreshDatabaseSourceState();
    return outcome;
  }, [refreshDatabaseSourceState]);

  useEffect(() => {
    if (!isActive) {
      schedulerRef.current?.dispose();
      schedulerRef.current = null;
      setSyncStatus(DISABLED_SNAPSHOT);
      return;
    }

    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: () => loadPersistedDatabaseSourceState().pendingChangesSince,
      persistDirtySince: (value) => {
        if (value) {
          markPendingChanges(value);
        } else {
          clearPendingChanges();
        }
      },
      debounceMs: getDebounceOverrideMs(),
    });
    schedulerRef.current = scheduler;

    if (!loadPersistedDatabaseSourceState().autoSyncEnabled) {
      scheduler.setEnabled(false);
    }

    const unsubscribe = scheduler.subscribe(setSyncStatus);
    setSyncStatus(scheduler.getSnapshot());

    return () => {
      unsubscribe();
      scheduler.dispose();
      schedulerRef.current = null;
    };
    // performSync is intentionally omitted: it's recreated on every render
    // via refreshDatabaseSourceState's identity, but the scheduler only
    // needs to be (re)built when the app moves in or out of "cloud source,
    // fully initialized" — latestRef above keeps it reading fresh values
    // regardless.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    return databaseWorkerService.onDatabaseChanged((event) => {
      schedulerRef.current?.notifyChange(event.changedAt);
    });
  }, [isActive]);

  useEffect(() => {
    if (!isActive || typeof window === 'undefined') {
      return;
    }

    const handleOnline = () => schedulerRef.current?.setOnline(true);
    const handleOffline = () => schedulerRef.current?.setOnline(false);

    schedulerRef.current?.setOnline(navigator.onLine);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isActive]);

  useEffect(() => {
    if (!isActive || typeof document === 'undefined') {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        schedulerRef.current?.flushIfPending();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isActive]);

  useEffect(() => {
    if (!isActive || typeof window === 'undefined') {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      const state = schedulerRef.current?.getSnapshot().state;
      if (state === 'pending' || state === 'syncing') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isActive]);

  const syncNow = useCallback(async () => {
    await schedulerRef.current?.syncNow();
  }, []);

  const setAutoSyncEnabled = useCallback(
    (enabled: boolean) => {
      persistAutoSyncEnabled(enabled);
      refreshDatabaseSourceState();
      schedulerRef.current?.setEnabled(enabled);
    },
    [refreshDatabaseSourceState]
  );

  /** Re-authenticates interactively (must be called from a user gesture) and resumes a paused sync. */
  const reconnect = useCallback(async () => {
    const { databaseService: service, source: currentSource } = latestRef.current;
    if (!service || currentSource === 'local') {
      return;
    }

    const client = createCloudProviderClient(currentSource);
    await client.authenticate(true);
    refreshDatabaseSourceState();
    await schedulerRef.current?.resume();
  }, [refreshDatabaseSourceState]);

  const resolveConflict = useCallback(
    async (choice: ConflictResolutionChoice) => {
      const { databaseService: service, source: currentSource } = latestRef.current;
      if (!service || currentSource === 'local') {
        return;
      }

      await resolveConflictSync({ databaseService: service, provider: currentSource, choice });
      refreshDatabaseSourceState();
      await schedulerRef.current?.resume();
    },
    [refreshDatabaseSourceState]
  );

  return {
    syncStatus,
    syncStage,
    syncNow,
    setAutoSyncEnabled,
    reconnect,
    resolveConflict,
  };
}
