// Pure state machine driving automatic cloud sync. No React, no browser
// APIs beyond setTimeout/clearTimeout/Date — everything else (persistence,
// the actual sync call, online/visibility signals) is injected, so this is
// fully testable with fake timers and no DOM.

export type AutoSyncState =
  | 'disabled'
  | 'idle'
  | 'pending'
  | 'syncing'
  | 'paused-auth'
  | 'paused-conflict'
  | 'offline'
  | 'error';

export type AutoSyncPauseReason = 'token-expired' | 'encryption-locked';

export type AutoSyncOutcome =
  | 'saved'
  | 'no-changes'
  | 'conflict'
  | 'auth-required'
  | 'locked'
  | 'error';

export interface AutoSyncSnapshot {
  state: AutoSyncState;
  pauseReason: AutoSyncPauseReason | null;
  pendingSince: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

export interface AutoSyncSchedulerDeps {
  performSync(): Promise<AutoSyncOutcome>;
  loadDirtySince(): string | null;
  persistDirtySince(value: string | null): void;
  /** Trailing debounce after the most recent change. Default 15s. */
  debounceMs?: number;
  /** Hard cap on how long continuous changes can keep pushing the debounce out. Default 60s. */
  maxWaitMs?: number;
  /** Backoff delays for consecutive 'error' outcomes. Default [30s, 2m, 5m], holding at the last value. */
  retryBackoffMs?: number[];
  now?(): number;
}

const DEFAULT_DEBOUNCE_MS = 15_000;
const DEFAULT_MAX_WAIT_MS = 60_000;
const DEFAULT_RETRY_BACKOFF_MS = [30_000, 120_000, 300_000];

const PAUSED_STATES: ReadonlySet<AutoSyncState> = new Set([
  'paused-auth',
  'paused-conflict',
]);

export class AutoSyncScheduler {
  private readonly performSyncFn: () => Promise<AutoSyncOutcome>;
  private readonly loadDirtySince: () => string | null;
  private readonly persistDirtySince: (value: string | null) => void;
  private readonly debounceMs: number;
  private maxWaitMs: number;
  private readonly retryBackoffMs: number[];
  private readonly now: () => number;

  private state: AutoSyncState;
  private pauseReason: AutoSyncPauseReason | null = null;
  private pendingSince: string | null;
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;

  private syncInFlight: Promise<void> | null = null;
  private changedDuringSync = false;
  private isOnline = true;
  private disposed = false;
  private enabled = true;

  private readonly listeners = new Set<(snapshot: AutoSyncSnapshot) => void>();

  constructor(deps: AutoSyncSchedulerDeps) {
    this.performSyncFn = deps.performSync;
    this.loadDirtySince = deps.loadDirtySince;
    this.persistDirtySince = deps.persistDirtySince;
    this.debounceMs = deps.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.maxWaitMs = deps.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
    this.retryBackoffMs = deps.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS;
    this.now = deps.now ?? (() => Date.now());

    this.pendingSince = this.loadDirtySince();
    if (this.pendingSince) {
      this.state = 'pending';
      this.armMaxWaitTimer();
      this.scheduleDebounce();
    } else {
      this.state = 'idle';
    }
  }

  getSnapshot(): AutoSyncSnapshot {
    return {
      state: this.state,
      pauseReason: this.pauseReason,
      pendingSince: this.pendingSince,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
    };
  }

  subscribe(callback: (snapshot: AutoSyncSnapshot) => void): () => void {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }

  private emit() {
    const snapshot = this.getSnapshot();
    this.listeners.forEach((listener) => listener(snapshot));
  }

  /**
   * Called when the database changes. Updates the persisted dirty flag and
   * arms the debounce/max-wait timers — unless auto-sync is disabled,
   * offline, or the scheduler is already paused on a conflict/auth issue
   * that a blind retry can't resolve (those require explicit user action
   * via resume(), not just more local edits).
   */
  notifyChange(changedAt: string): void {
    if (this.disposed) {
      return;
    }

    if (!this.pendingSince) {
      this.pendingSince = changedAt;
      this.persistDirtySince(changedAt);
    }

    if (this.state === 'syncing') {
      this.changedDuringSync = true;
      this.emit();
      return;
    }

    if (!this.enabled) {
      this.state = 'disabled';
      this.emit();
      return;
    }

    if (!this.isOnline) {
      this.state = 'offline';
      this.emit();
      return;
    }

    if (PAUSED_STATES.has(this.state)) {
      // Stay paused: retrying now would just re-hit the same conflict or
      // auth failure. The dirty flag above is still recorded so the UI
      // reflects unsynced work once the pause clears via resume().
      this.emit();
      return;
    }

    if (this.state === 'pending') {
      // Already in an active pending cycle: only push the debounce out.
      // The max-wait timer keeps its original deadline from when this
      // cycle started — re-arming it here would let continuous changes
      // defeat its entire purpose as a fixed upper bound.
      this.scheduleDebounce();
      this.emit();
      return;
    }

    // Starting a fresh pending cycle (from idle or a recovered error).
    this.retryAttempt = 0;
    this.lastError = null;
    this.clearTimers();
    this.state = 'pending';
    this.armMaxWaitTimer();
    this.scheduleDebounce();
    this.emit();
  }

  private scheduleDebounce() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.attemptSync();
    }, this.debounceMs);
  }

  private armMaxWaitTimer() {
    if (this.maxWaitTimer) {
      return;
    }
    this.maxWaitTimer = setTimeout(() => {
      this.maxWaitTimer = null;
      void this.attemptSync();
    }, this.maxWaitMs);
  }

  private clearTimers() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Bypasses the debounce and syncs immediately — always allowed, including while disabled/paused (a manual "Sync now" should never be blocked by the automatic-sync toggle or a prior pause). */
  syncNow(): Promise<void> {
    this.clearTimers();
    return this.attemptSync();
  }

  /** Forces a queued sync to run immediately, e.g. on tab-hide. No-op if nothing is pending or a sync is already running. */
  flushIfPending(): void {
    if (this.pendingSince && this.state === 'pending') {
      void this.syncNow();
    }
  }

  /** Updates the hard-cap wait time for future pending cycles; a cycle already in flight keeps its existing deadline. */
  setMaxWaitMs(ms: number): void {
    this.maxWaitMs = ms;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;

    if (!enabled) {
      this.clearTimers();
      this.state = 'disabled';
      this.emit();
      return;
    }

    if (this.state === 'disabled') {
      this.state = this.pendingSince ? 'pending' : 'idle';
      this.emit();
      if (this.pendingSince) {
        this.armMaxWaitTimer();
        this.scheduleDebounce();
      }
    }
  }

  setOnline(online: boolean): void {
    const wasOffline = !this.isOnline;
    this.isOnline = online;

    if (!online) {
      this.clearTimers();
      if (this.enabled) {
        this.state = 'offline';
        this.emit();
      }
      return;
    }

    if (wasOffline && this.state === 'offline') {
      this.state = this.pendingSince ? 'pending' : 'idle';
      this.emit();
      if (this.pendingSince) {
        this.armMaxWaitTimer();
        this.scheduleDebounce();
      }
    }
  }

  /**
   * Explicitly resumes from a paused (conflict/auth/error) state — call
   * after the caller has resolved the conflict or re-authenticated.
   * Immediately retries if there's still pending work.
   */
  resume(): Promise<void> {
    if (
      this.state !== 'paused-conflict' &&
      this.state !== 'paused-auth' &&
      this.state !== 'error'
    ) {
      return Promise.resolve();
    }

    this.pauseReason = null;
    this.lastError = null;
    this.retryAttempt = 0;

    if (this.pendingSince) {
      return this.syncNow();
    }

    this.state = 'idle';
    this.emit();
    return Promise.resolve();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimers();
    this.listeners.clear();
  }

  private async attemptSync(): Promise<void> {
    if (this.disposed) {
      return;
    }

    if (this.syncInFlight) {
      return this.syncInFlight;
    }

    this.changedDuringSync = false;
    this.state = 'syncing';
    this.emit();

    const run = (async () => {
      let outcome: AutoSyncOutcome;
      try {
        outcome = await this.performSyncFn();
      } catch (error) {
        outcome = 'error';
        this.lastError = error instanceof Error ? error.message : 'Sync failed';
      }
      this.handleOutcome(outcome);
    })();

    this.syncInFlight = run;
    try {
      await run;
    } finally {
      this.syncInFlight = null;
    }
  }

  private handleOutcome(outcome: AutoSyncOutcome): void {
    switch (outcome) {
      case 'saved':
      case 'no-changes': {
        this.retryAttempt = 0;
        this.lastError = null;
        this.lastSyncAt = new Date(this.now()).toISOString();
        this.clearTimers();

        if (this.changedDuringSync) {
          // A change landed while we were syncing — treat it like any
          // other new change rather than reporting idle.
          this.pendingSince = this.pendingSince ?? new Date(this.now()).toISOString();
          this.persistDirtySince(this.pendingSince);
          this.state = 'pending';
          this.armMaxWaitTimer();
          this.scheduleDebounce();
        } else {
          this.pendingSince = null;
          this.persistDirtySince(null);
          this.state = 'idle';
        }
        break;
      }
      case 'conflict': {
        this.clearTimers();
        this.state = 'paused-conflict';
        break;
      }
      case 'auth-required': {
        this.clearTimers();
        this.state = 'paused-auth';
        this.pauseReason = 'token-expired';
        break;
      }
      case 'locked': {
        this.clearTimers();
        this.state = 'paused-auth';
        this.pauseReason = 'encryption-locked';
        break;
      }
      case 'error': {
        this.state = 'error';
        this.scheduleRetry();
        break;
      }
    }

    this.emit();
  }

  private scheduleRetry(): void {
    if (!this.pendingSince) {
      return;
    }

    const delay =
      this.retryBackoffMs[Math.min(this.retryAttempt, this.retryBackoffMs.length - 1)];
    this.retryAttempt += 1;

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.attemptSync();
    }, delay);
  }
}
