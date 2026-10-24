/**
 * Read side of the diagnostic log database, used by the Developer Console
 * and the export. Reads are paged newest-first by `seq` and filtered in
 * JavaScript while walking the cursor (the store is a 20k-entry ring, so a
 * full walk stays cheap); a correlation-id filter uses its index instead.
 */

import {
  LOGS_INDEX_CORRELATION,
  LOGS_STORE,
  createLogChannel,
  hasIndexedDb,
  openLogsDatabase,
  requestToPromise,
  transactionDone,
  type LogChannelMessage,
  type StoredLogRecord,
} from './logDatabase';
import type { LogLevel, LogSource } from './types';

export interface LogFilters {
  /** Levels to include; empty = all. */
  levels?: readonly LogLevel[];
  /** Sources to include; empty = all. */
  sources?: readonly LogSource[];
  page?: string;
  correlationId?: string;
  /** Case-insensitive substring over message, component, operation, element, error and context JSON. */
  text?: string;
}

export interface LogPageRequest {
  filters?: LogFilters;
  /** Only records with `seq` strictly below this are returned (for "load older"). */
  beforeSeq?: number;
  limit?: number;
}

export interface LogPage {
  records: StoredLogRecord[];
  /** True when the walk stopped because `limit` was reached, i.e. older matches may exist. */
  hasMore: boolean;
}

let sharedDb: Promise<IDBDatabase> | null = null;

async function getReadDatabase(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return null;
  if (!sharedDb) {
    sharedDb = openLogsDatabase(() => {
      sharedDb = null;
    });
    sharedDb.catch(() => {
      sharedDb = null;
    });
  }
  return sharedDb.catch(() => null);
}

/** Drops the shared read connection (before deleting the database). */
export async function closeLogStore(): Promise<void> {
  const pending = sharedDb;
  sharedDb = null;
  if (!pending) return;
  try {
    (await pending).close();
  } catch {
    // Already closed.
  }
}

export function matchesLogFilters(record: StoredLogRecord, filters: LogFilters | undefined): boolean {
  if (!filters) return true;
  if (filters.levels && filters.levels.length > 0 && !filters.levels.includes(record.level)) return false;
  const source = (record.context.source ?? 'app') as LogSource;
  if (filters.sources && filters.sources.length > 0 && !filters.sources.includes(source)) return false;
  if (filters.page && record.context.page !== filters.page) return false;
  if (filters.correlationId && record.context.correlationId !== filters.correlationId) return false;
  if (filters.text) {
    const needle = filters.text.trim().toLowerCase();
    if (needle !== '' && !searchText(record).includes(needle)) return false;
  }
  return true;
}

export function searchText(record: StoredLogRecord): string {
  const { component, operation, element, page, correlationId, process, ...rest } = record.context;
  let contextJson = '';
  try {
    contextJson = JSON.stringify(rest);
  } catch {
    contextJson = '';
  }
  return [
    record.message,
    record.level,
    component,
    operation,
    element,
    page,
    correlationId,
    process,
    record.error?.name,
    record.error?.message,
    record.error?.stack,
    contextJson,
  ]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join('\n')
    .toLowerCase();
}

function openCursorNewestFirst(
  source: IDBObjectStore | IDBIndex,
  range: IDBKeyRange | null,
  onRecord: (record: StoredLogRecord) => boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = source.openCursor(range, 'prev');
    request.onerror = () => reject(request.error ?? new Error('Failed to read logs'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const keepGoing = onRecord(cursor.value as StoredLogRecord);
      if (keepGoing) cursor.continue();
      else resolve();
    };
  });
}

/** One page of records, newest first. */
export async function readLogPage(request: LogPageRequest = {}): Promise<LogPage> {
  const db = await getReadDatabase();
  const limit = request.limit ?? 200;
  if (!db) return { records: [], hasMore: false };

  const records: StoredLogRecord[] = [];
  let hasMore = false;
  const transaction = db.transaction(LOGS_STORE, 'readonly');
  const store = transaction.objectStore(LOGS_STORE);
  const filters = request.filters;
  const beforeSeq = request.beforeSeq;

  const collect = (record: StoredLogRecord): boolean => {
    if (beforeSeq !== undefined && record.seq >= beforeSeq) return true;
    if (!matchesLogFilters(record, filters)) return true;
    if (records.length >= limit) {
      hasMore = true;
      return false;
    }
    records.push(record);
    return true;
  };

  if (filters?.correlationId) {
    await openCursorNewestFirst(
      store.index(LOGS_INDEX_CORRELATION),
      IDBKeyRange.only(filters.correlationId),
      collect
    );
    // Index order is by key then primary key, so re-sort newest-first by seq.
    records.sort((a, b) => b.seq - a.seq);
  } else {
    const range = beforeSeq !== undefined ? IDBKeyRange.upperBound(beforeSeq, true) : null;
    await openCursorNewestFirst(store, range, collect);
  }
  await transactionDone(transaction).catch(() => undefined);
  return { records, hasMore };
}

/** Every app and worker record sharing `correlationId`, oldest first (a request/response timeline). */
export async function readCorrelation(correlationId: string): Promise<StoredLogRecord[]> {
  const page = await readLogPage({ filters: { correlationId }, limit: 1000 });
  return page.records.sort((a, b) => a.seq - b.seq);
}

export async function countLogs(): Promise<number> {
  const db = await getReadDatabase();
  if (!db) return 0;
  const transaction = db.transaction(LOGS_STORE, 'readonly');
  return requestToPromise(transaction.objectStore(LOGS_STORE).count());
}

/** All records, oldest first (for export). */
export async function readAllLogs(): Promise<StoredLogRecord[]> {
  const db = await getReadDatabase();
  if (!db) return [];
  const transaction = db.transaction(LOGS_STORE, 'readonly');
  const all = await requestToPromise(transaction.objectStore(LOGS_STORE).getAll());
  return all as StoredLogRecord[];
}

export async function clearLogs(): Promise<void> {
  const db = await getReadDatabase();
  if (!db) return;
  const transaction = db.transaction(LOGS_STORE, 'readwrite');
  transaction.objectStore(LOGS_STORE).clear();
  await transactionDone(transaction);
  const channel = createLogChannel();
  try {
    channel?.postMessage({ type: 'cleared' } satisfies LogChannelMessage);
  } finally {
    channel?.close();
  }
}

/** Subscribes to append / clear notifications from every writer (this tab, other tabs, the worker). */
export function subscribeToLogUpdates(listener: (message: LogChannelMessage) => void): () => void {
  const channel = createLogChannel();
  if (!channel) return () => undefined;
  const handler = (event: MessageEvent<LogChannelMessage>) => {
    if (event.data && typeof event.data === 'object' && 'type' in event.data) listener(event.data);
  };
  channel.addEventListener('message', handler);
  return () => {
    channel.removeEventListener('message', handler);
    channel.close();
  };
}
