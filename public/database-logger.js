// Worker-side structured logger (plain ES module; no src/ imports).
//
// Mirrors src/lib/logging: the same record shape ({ id, ts, level, message,
// context, error }), written straight into the shared, unencrypted
// `ptbudgetapp-logs` IndexedDB database (store `entries`, autoIncrement
// `seq`, indexes `ts` and `context.correlationId`) and announced on
// BroadcastChannel('ptbudget-logs') so open Developer Consoles refresh.
// Keep the names and store shape in sync with src/lib/logging/logDatabase.ts.
//
// Records carry `source: 'worker'`; while a request is being handled
// `correlationId` is the incoming message id (`<tabId>:<n>`), `operation`
// the message type and `tabId` the requesting tab, so app and worker rows
// join in the console. Background work (migration, snapshot export,
// heartbeat) is tagged with `process` instead.

export const LOGS_DB_NAME = 'ptbudgetapp-logs';
export const LOGS_DB_VERSION = 1;
export const LOGS_STORE = 'entries';
export const LOGS_CHANNEL = 'ptbudget-logs';

export const LOG_LEVEL_ORDER = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_DELAY_MS = 250;
const MAX_QUEUE_LENGTH = 5000;

function randomId(length) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = '';
  for (const byte of bytes) id += alphabet[byte % alphabet.length];
  return id;
}

export function normalizeError(value) {
  if (value === undefined || value === null) return undefined;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (typeof value === 'object') {
    if (typeof value.message === 'string') {
      return {
        name: typeof value.name === 'string' ? value.name : 'Error',
        message: value.message,
        stack: typeof value.stack === 'string' ? value.stack : undefined,
      };
    }
    try {
      return { name: 'Error', message: JSON.stringify(value) };
    } catch {
      return { name: 'Error', message: String(value) };
    }
  }
  return { name: 'Error', message: String(value) };
}

// Structured-clone-safe copy of a context value (functions, typed arrays and
// cycles replaced; SQL parameter arrays truncated).
function sanitize(value, seen, depth = 0) {
  if (value === null || value === undefined) return value;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  if (type === 'number') return Number.isFinite(value) ? value : String(value);
  if (type === 'bigint') return `${String(value)}n`;
  if (type === 'function' || type === 'symbol') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return normalizeError(value);
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return `[${value.constructor.name} ${value.byteLength} bytes]`;
  }
  if (type === 'object') {
    if (depth > 6) return '[Object]';
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (Array.isArray(value)) return value.slice(0, 200).map((item) => sanitize(item, seen, depth + 1));
    const out = {};
    for (const [key, entry] of Object.entries(value)) out[key] = sanitize(entry, seen, depth + 1);
    return out;
  }
  return String(value);
}

function openLogsDatabase(onVersionChange) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(LOGS_DB_NAME, LOGS_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOGS_STORE)) {
        const store = db.createObjectStore(LOGS_STORE, { keyPath: 'seq', autoIncrement: true });
        store.createIndex('ts', 'ts', { unique: false });
        store.createIndex('correlationId', 'context.correlationId', { unique: false });
      }
    };
    request.onblocked = () => reject(new Error('Log database open was blocked'));
    request.onerror = () => reject(request.error || new Error('Failed to open the log database'));
    request.onsuccess = () => {
      const db = request.result;
      // Reset App deletes this database from a tab: close our handle at once
      // so the delete is never blocked by the worker; reopen lazily later.
      db.onversionchange = () => {
        db.close();
        if (onVersionChange) onVersionChange();
      };
      resolve(db);
    };
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
  });
}

/**
 * Batched IndexedDB writer shared by every logger instance in the worker.
 * Ring-cap pruning is done by the tabs' sink (the worker only appends).
 */
export class WorkerLogSink {
  constructor(options = {}) {
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.flushDelayMs = options.flushDelayMs ?? DEFAULT_FLUSH_DELAY_MS;
    this.queue = [];
    this.flushTimer = null;
    this.dbPromise = null;
    this.writing = Promise.resolve();
    this.lastErrorAt = 0;
    this.channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(LOGS_CHANNEL);
  }

  write(record) {
    if (typeof indexedDB === 'undefined') return;
    if (this.queue.length >= MAX_QUEUE_LENGTH) this.queue.shift();
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

  flush() {
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

  getDatabase() {
    if (!this.dbPromise) {
      this.dbPromise = openLogsDatabase(() => {
        this.dbPromise = null;
      });
      this.dbPromise.catch(() => {
        this.dbPromise = null;
      });
    }
    return this.dbPromise.catch(() => null);
  }

  async writeBatch(batch) {
    const db = await this.getDatabase();
    if (!db) return;
    try {
      const transaction = db.transaction(LOGS_STORE, 'readwrite');
      const store = transaction.objectStore(LOGS_STORE);
      for (const record of batch) store.add(record);
      await transactionDone(transaction);
      if (this.channel) {
        this.channel.postMessage({ type: 'appended', count: batch.length, source: 'worker' });
      }
    } catch (error) {
      const now = Date.now();
      if (now - this.lastErrorAt > 10_000) {
        this.lastErrorAt = now;
        // Plain console on purpose: logging the failure through the sink would loop.
        console.warn('[DB Worker] Failed to persist log records', error);
      }
    }
  }
}

/**
 * Logger with the app's API subset: level methods, `child(context)`, and a
 * mutable minimum level (`setLevel`). All instances share one sink.
 */
export class WorkerLogger {
  constructor(sink, context = {}, state = { level: 'info', counter: 0, instanceId: randomId(6) }) {
    this.sink = sink;
    this.context = context;
    this.state = state;
  }

  setLevel(level) {
    if (level in LOG_LEVEL_ORDER) this.state.level = level;
  }

  getLevel() {
    return this.state.level;
  }

  isLevelEnabled(level) {
    return LOG_LEVEL_ORDER[level] >= LOG_LEVEL_ORDER[this.state.level];
  }

  child(context) {
    return new WorkerLogger(this.sink, { ...this.context, ...context }, this.state);
  }

  emit(level, message, context) {
    if (!this.isLevelEnabled(level)) return;
    try {
      const merged = { ...this.context, ...(context || {}) };
      const { error, ...rest } = merged;
      this.state.counter += 1;
      const record = {
        id: `w${this.state.instanceId}-${this.state.counter}`,
        ts: Date.now(),
        level,
        message: String(message),
        context: { source: 'worker', ...sanitize(rest, new WeakSet()) },
      };
      const normalized = normalizeError(error);
      if (normalized) record.error = normalized;
      this.sink.write(record);
      if (level === 'warn' || level === 'error') {
        // Warnings and errors still reach the worker's own console (DevTools).
        const printer = level === 'error' ? console.error : console.warn;
        printer(`[DB Worker] ${message}`, normalized ? normalized.stack || normalized.message : '');
      }
    } catch {
      // Logging must never throw into worker code.
    }
  }

  trace(message, context) {
    this.emit('trace', message, context);
  }
  debug(message, context) {
    this.emit('debug', message, context);
  }
  info(message, context) {
    this.emit('info', message, context);
  }
  warn(message, context) {
    this.emit('warn', message, context);
  }
  error(message, context) {
    this.emit('error', message, context);
  }

  flush() {
    return this.sink.flush();
  }
}

/** The tab a correlation id was minted in (`<tabId>:<n>` → `<tabId>`). */
export function tabIdFromCorrelationId(correlationId) {
  if (typeof correlationId !== 'string') return undefined;
  const separator = correlationId.indexOf(':');
  return separator > 0 ? correlationId.slice(0, separator) : undefined;
}

/**
 * The context for records written while handling one message: correlation
 * id = message id, operation = message type, plus whatever the tab sent in
 * `payload.meta` (page, component, operation it was performing).
 */
export function requestLogContext(id, type, meta) {
  const context = { component: 'DatabaseWorker' };
  if (typeof id === 'string' && id !== '') {
    context.correlationId = id;
    const tabId = tabIdFromCorrelationId(id);
    if (tabId) context.tabId = tabId;
  }
  if (typeof type === 'string') context.operation = type;
  if (meta && typeof meta === 'object') {
    if (typeof meta.correlationId === 'string' && meta.correlationId !== '') context.correlationId = meta.correlationId;
    if (typeof meta.page === 'string') context.page = meta.page;
    if (typeof meta.component === 'string') context.appComponent = meta.component;
    if (typeof meta.operation === 'string' && meta.operation !== type) context.appOperation = meta.operation;
    if (typeof meta.tabId === 'string') context.tabId = meta.tabId;
  }
  return context;
}

export function createWorkerLogger(options = {}) {
  const sink = options.sink || new WorkerLogSink(options);
  const root = new WorkerLogger(sink, { component: 'DatabaseWorker' });
  if (options.level) root.setLevel(options.level);
  return root;
}
