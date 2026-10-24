import {
  LOGS_INDEX_TS,
  LOGS_STORE,
  createLogChannel,
  hasIndexedDb,
  openLogsDatabase,
  requestToPromise,
  transactionDone,
  type LogChannelMessage,
} from './logDatabase';
import { getLogRetention, type LogRetention } from './logRetention';
import type { LogRecord, LogSink } from './types';

export interface IdbLogSinkOptions {
  /** Records queued before a flush is forced (default 100). */
  batchSize?: number;
  /** Idle delay before a queued batch is written (default 250 ms). */
  flushDelayMs?: number;
  /** Retention override for tests; defaults to the Settings → Developer values. */
  retention?: () => LogRetention;
  /** Minimum interval between age-based prunes (default 60 s). */
  agePruneIntervalMs?: number;
  /** Injectable clock. */
  now?: () => number;
}

/**
 * Persists records into the `ptbudgetapp-logs` IndexedDB database.
 *
 * Writes are batched: records queue in memory and are written in one
 * transaction after a short idle delay or once the batch is full. After each
 * flush the ring cap is enforced (oldest entries deleted) and open Developer
 * Consoles are told over `BroadcastChannel('ptbudget-logs')` that entries
 * were appended. Tabs never re-persist records they hear about on the
 * channel — the worker writes its own rows directly.
 */
export class IdbLogSink implements LogSink {
  private readonly batchSize: number;
  private readonly flushDelayMs: number;
  private readonly agePruneIntervalMs: number;
  private readonly readRetention: () => LogRetention;
  private readonly now: () => number;
  private readonly channel: BroadcastChannel | null;
  private queue: LogRecord[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dbPromise: Promise<IDBDatabase> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private lastAgePrune = 0;
  private closed = false;
  private lastErrorAt = 0;

  constructor(options: IdbLogSinkOptions = {}) {
    this.batchSize = options.batchSize ?? 100;
    this.flushDelayMs = options.flushDelayMs ?? 250;
    this.agePruneIntervalMs = options.agePruneIntervalMs ?? 60_000;
    this.readRetention = options.retention ?? getLogRetention;
    this.now = options.now ?? (() => Date.now());
    this.channel = createLogChannel();
  }

  get isAvailable(): boolean {
    return hasIndexedDb() && !this.closed;
  }

  write(record: LogRecord): void {
    if (!this.isAvailable) return;
    this.queue.push(record);
    if (this.queue.length >= this.batchSize) {
      void this.flush();
      return;
    }
    if (this.flushTimer === null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, this.flushDelayMs);
    }
  }

  /** Writes everything queued so far; resolves once the transaction has committed. */
  flush(): Promise<void> {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.queue.length === 0) return this.writing;
    const batch = this.queue;
    this.queue = [];
    this.writing = this.writing.then(() => this.writeBatch(batch)).catch(() => undefined);
    return this.writing;
  }

  /** Re-runs the ring-cap / age prune now (e.g. after retention settings change). */
  async prune(): Promise<void> {
    const db = await this.getDatabase();
    if (!db) return;
    await this.enforceRetention(db, true);
  }

  /** Closes the connection; further writes are dropped. Call before deleting the database. */
  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
    const dbPromise = this.dbPromise;
    this.dbPromise = null;
    if (dbPromise) {
      try {
        (await dbPromise).close();
      } catch {
        // Already closed by a versionchange.
      }
    }
    this.channel?.close();
  }

  private getDatabase(): Promise<IDBDatabase | null> {
    if (this.closed || !hasIndexedDb()) return Promise.resolve(null);
    if (!this.dbPromise) {
      this.dbPromise = openLogsDatabase(() => {
        // Another context (Reset App) is deleting or upgrading the database:
        // drop our handle so the delete is not blocked; reopen lazily later.
        this.dbPromise = null;
      });
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise.catch(() => null);
  }

  private async writeBatch(batch: LogRecord[]): Promise<void> {
    const db = await this.getDatabase();
    if (!db) return;
    try {
      const transaction = db.transaction(LOGS_STORE, 'readwrite');
      const store = transaction.objectStore(LOGS_STORE);
      for (const record of batch) {
        // Structured clone must succeed: strip anything exotic from the context.
        store.add(toStorable(record));
      }
      await transactionDone(transaction);
      this.post({ type: 'appended', count: batch.length, source: 'app', tabId: batch[0]?.context.tabId });
      await this.enforceRetention(db, false);
    } catch (error) {
      this.reportFailure(error);
    }
  }

  private async enforceRetention(db: IDBDatabase, force: boolean): Promise<void> {
    const retention = this.readRetention();
    try {
      const countTransaction = db.transaction(LOGS_STORE, 'readonly');
      const total = await requestToPromise(countTransaction.objectStore(LOGS_STORE).count());
      const excess = total - retention.maxEntries;
      if (excess > 0) {
        const transaction = db.transaction(LOGS_STORE, 'readwrite');
        const store = transaction.objectStore(LOGS_STORE);
        const oldestKeys = await requestToPromise(store.getAllKeys(null, excess));
        const lastKey = oldestKeys[oldestKeys.length - 1];
        if (lastKey !== undefined) {
          store.delete(IDBKeyRange.upperBound(lastKey));
        }
        await transactionDone(transaction);
      }

      const now = this.now();
      if (retention.maxAgeDays > 0 && (force || now - this.lastAgePrune >= this.agePruneIntervalMs)) {
        this.lastAgePrune = now;
        const cutoff = now - retention.maxAgeDays * 24 * 60 * 60 * 1000;
        const transaction = db.transaction(LOGS_STORE, 'readwrite');
        const store = transaction.objectStore(LOGS_STORE);
        const staleKeys = await requestToPromise(
          store.index(LOGS_INDEX_TS).getAllKeys(IDBKeyRange.upperBound(cutoff, true))
        );
        for (const key of staleKeys) store.delete(key);
        await transactionDone(transaction);
      }
    } catch (error) {
      this.reportFailure(error);
    }
  }

  private post(message: LogChannelMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A closed channel must not break logging.
    }
  }

  private reportFailure(error: unknown): void {
    // Never log through the logger here (it would loop back into this sink);
    // rate-limit a plain console warning instead.
    const now = this.now();
    if (now - this.lastErrorAt < 10_000) return;
    this.lastErrorAt = now;
    if (typeof console !== 'undefined') {
      console.warn('[Logging] Failed to persist log records', error);
    }
  }
}

/** Returns a structured-clone-safe copy of the record (functions, symbols and cycles removed). */
export function toStorable(record: LogRecord): LogRecord {
  const context = sanitize(record.context, new WeakSet()) as LogRecord['context'];
  const storable: LogRecord = { id: record.id, ts: record.ts, level: record.level, message: record.message, context };
  if (record.error) storable.error = { ...record.error };
  return storable;
}

function sanitize(value: unknown, seen: WeakSet<object>, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') return Number.isFinite(value as number) ? value : String(value);
  if (type === 'bigint') return `${String(value)}n`;
  if (type === 'function' || type === 'symbol') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (ArrayBuffer.isView(value)) return `[${value.constructor.name} ${value.byteLength} bytes]`;
  if (type === 'object') {
    if (depth > 6) return '[Object]';
    if (seen.has(value as object)) return '[Circular]';
    seen.add(value as object);
    if (Array.isArray(value)) {
      return value.slice(0, 200).map((item) => sanitize(item, seen, depth + 1));
    }
    if (value instanceof Map) {
      return Object.fromEntries([...value.entries()].slice(0, 200).map(([k, v]) => [String(k), sanitize(v, seen, depth + 1)]));
    }
    if (value instanceof Set) {
      return [...value.values()].slice(0, 200).map((item) => sanitize(item, seen, depth + 1));
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitize(entry, seen, depth + 1);
    }
    return out;
  }
  return String(value);
}
