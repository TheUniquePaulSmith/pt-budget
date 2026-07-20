import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AutoSyncScheduler, type AutoSyncOutcome } from './cloudAutoSyncScheduler';

function createDirtyStore(initial: string | null = null) {
  let value = initial;
  return {
    load: () => value,
    persist: (v: string | null) => {
      value = v;
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('AutoSyncScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires a sync 15s after a change, not before', async () => {
    const store = createDirtyStore();
    const performSync = vi.fn().mockResolvedValue('saved');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    scheduler.notifyChange('2026-07-14T00:00:00.000Z');

    await vi.advanceTimersByTimeAsync(14_999);
    expect(performSync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(performSync).toHaveBeenCalledTimes(1);
  });

  it('fires at the 60s max-wait cap under continuous changes that keep resetting the debounce', async () => {
    const store = createDirtyStore();
    const performSync = vi.fn().mockResolvedValue('saved');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    scheduler.notifyChange('t0');
    for (let elapsed = 5_000; elapsed <= 55_000; elapsed += 5_000) {
      await vi.advanceTimersByTimeAsync(5_000);
      scheduler.notifyChange(`t${elapsed}`);
    }
    expect(performSync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000); // total 60s since the first change
    expect(performSync).toHaveBeenCalledTimes(1);
  });

  it('setMaxWaitMs changes the hard-cap wait time for the next pending cycle', async () => {
    const store = createDirtyStore();
    const performSync = vi.fn().mockResolvedValue('saved');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    scheduler.setMaxWaitMs(5_000);
    scheduler.notifyChange('t0');

    await vi.advanceTimersByTimeAsync(4_999);
    expect(performSync).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(performSync).toHaveBeenCalledTimes(1);
  });

  it('syncNow bypasses the debounce and runs immediately', async () => {
    const store = createDirtyStore();
    const performSync = vi.fn().mockResolvedValue('saved');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    scheduler.notifyChange('t0');
    await scheduler.syncNow();

    expect(performSync).toHaveBeenCalledTimes(1);
    expect(scheduler.getSnapshot().state).toBe('idle');
  });

  it('collapses a change that arrives mid-sync into a fresh pending cycle afterward', async () => {
    const store = createDirtyStore();
    const deferred = createDeferred<AutoSyncOutcome>();
    const performSync = vi.fn().mockReturnValue(deferred.promise);
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    scheduler.notifyChange('t0');
    const syncPromise = scheduler.syncNow();
    expect(scheduler.getSnapshot().state).toBe('syncing');

    scheduler.notifyChange('t1');
    expect(performSync).toHaveBeenCalledTimes(1);

    deferred.resolve('saved');
    await syncPromise;

    expect(scheduler.getSnapshot().state).toBe('pending');
    expect(scheduler.getSnapshot().pendingSince).not.toBeNull();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(performSync).toHaveBeenCalledTimes(2);
  });

  it('does not start a duplicate sync when one is already in flight', async () => {
    const store = createDirtyStore();
    const deferred = createDeferred<AutoSyncOutcome>();
    const performSync = vi.fn().mockReturnValue(deferred.promise);
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    scheduler.notifyChange('t0');
    const first = scheduler.syncNow();
    const second = scheduler.syncNow();

    expect(performSync).toHaveBeenCalledTimes(1);

    deferred.resolve('saved');
    await Promise.all([first, second]);
  });

  it('queues while offline and flushes once back online', async () => {
    const store = createDirtyStore();
    const performSync = vi.fn().mockResolvedValue('saved');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    scheduler.setOnline(false);
    scheduler.notifyChange('t0');
    expect(scheduler.getSnapshot().state).toBe('offline');

    await vi.advanceTimersByTimeAsync(60_000);
    expect(performSync).not.toHaveBeenCalled();

    scheduler.setOnline(true);
    expect(scheduler.getSnapshot().state).toBe('pending');

    await vi.advanceTimersByTimeAsync(15_000);
    expect(performSync).toHaveBeenCalledTimes(1);
  });

  it('a conflict outcome pauses without arming a retry timer', async () => {
    const store = createDirtyStore();
    const performSync = vi.fn().mockResolvedValue('conflict');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    scheduler.notifyChange('t0');
    await scheduler.syncNow();

    expect(scheduler.getSnapshot().state).toBe('paused-conflict');

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(performSync).toHaveBeenCalledTimes(1);
  });

  it('an auth-required outcome pauses with a token-expired reason', async () => {
    const store = createDirtyStore();
    const performSync = vi.fn().mockResolvedValue('auth-required');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    scheduler.notifyChange('t0');
    await scheduler.syncNow();

    const snapshot = scheduler.getSnapshot();
    expect(snapshot.state).toBe('paused-auth');
    expect(snapshot.pauseReason).toBe('token-expired');
  });

  it('a locked outcome pauses with an encryption-locked reason', async () => {
    const store = createDirtyStore();
    const performSync = vi.fn().mockResolvedValue('locked');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    scheduler.notifyChange('t0');
    await scheduler.syncNow();

    const snapshot = scheduler.getSnapshot();
    expect(snapshot.state).toBe('paused-auth');
    expect(snapshot.pauseReason).toBe('encryption-locked');
  });

  it('retries an error outcome on an increasing backoff schedule that holds at the last value', async () => {
    const store = createDirtyStore();
    const performSync = vi.fn().mockResolvedValue('error');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
      retryBackoffMs: [1_000, 2_000, 4_000],
    });

    scheduler.notifyChange('t0');
    await scheduler.syncNow();
    expect(performSync).toHaveBeenCalledTimes(1);
    expect(scheduler.getSnapshot().state).toBe('error');

    await vi.advanceTimersByTimeAsync(1_000);
    expect(performSync).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(performSync).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(4_000);
    expect(performSync).toHaveBeenCalledTimes(4);

    // Backoff holds at the last configured value rather than growing further.
    await vi.advanceTimersByTimeAsync(4_000);
    expect(performSync).toHaveBeenCalledTimes(5);
  });

  it('starts pending immediately when constructed with a persisted dirty flag', async () => {
    const store = createDirtyStore('2026-07-14T00:00:00.000Z');
    const performSync = vi.fn().mockResolvedValue('saved');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    expect(scheduler.getSnapshot().state).toBe('pending');
    expect(scheduler.getSnapshot().pendingSince).toBe('2026-07-14T00:00:00.000Z');

    await vi.advanceTimersByTimeAsync(15_000);
    expect(performSync).toHaveBeenCalledTimes(1);
  });

  it('starts idle when constructed with no persisted dirty flag', () => {
    const store = createDirtyStore(null);
    const performSync = vi.fn().mockResolvedValue('saved');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    expect(scheduler.getSnapshot().state).toBe('idle');
  });

  it('disabled ignores change notifications but syncNow is still allowed', async () => {
    const store = createDirtyStore();
    const performSync = vi.fn().mockResolvedValue('saved');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    scheduler.setEnabled(false);
    scheduler.notifyChange('t0');
    expect(scheduler.getSnapshot().state).toBe('disabled');

    await vi.advanceTimersByTimeAsync(120_000);
    expect(performSync).not.toHaveBeenCalled();

    await scheduler.syncNow();
    expect(performSync).toHaveBeenCalledTimes(1);
  });

  it('resume() clears a paused state and retries when there is pending work', async () => {
    const store = createDirtyStore();
    const performSync = vi
      .fn()
      .mockResolvedValueOnce('conflict')
      .mockResolvedValueOnce('saved');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    scheduler.notifyChange('t0');
    await scheduler.syncNow();
    expect(scheduler.getSnapshot().state).toBe('paused-conflict');

    await scheduler.resume();

    expect(performSync).toHaveBeenCalledTimes(2);
    expect(scheduler.getSnapshot().state).toBe('idle');
  });

  it('notifyChange while paused on a conflict keeps the pause instead of retrying', async () => {
    const store = createDirtyStore();
    const performSync = vi.fn().mockResolvedValue('conflict');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    scheduler.notifyChange('t0');
    await scheduler.syncNow();
    expect(scheduler.getSnapshot().state).toBe('paused-conflict');

    scheduler.notifyChange('t1');
    expect(scheduler.getSnapshot().state).toBe('paused-conflict');

    await vi.advanceTimersByTimeAsync(120_000);
    expect(performSync).toHaveBeenCalledTimes(1);
  });

  it('dispose stops any further timers from firing', async () => {
    const store = createDirtyStore();
    const performSync = vi.fn().mockResolvedValue('saved');
    const scheduler = new AutoSyncScheduler({
      performSync,
      loadDirtySince: store.load,
      persistDirtySince: store.persist,
    });

    scheduler.notifyChange('t0');
    scheduler.dispose();

    await vi.advanceTimersByTimeAsync(120_000);
    expect(performSync).not.toHaveBeenCalled();
  });
});
