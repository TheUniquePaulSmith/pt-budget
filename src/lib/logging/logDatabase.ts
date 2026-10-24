/**
 * Low-level access to the diagnostic log database.
 *
 * `ptbudgetapp-logs` is a separate, unencrypted IndexedDB database shared by
 * every tab and by the SharedWorker (`public/database-logger.js` mirrors this
 * file in plain JS — keep the names, version and store shape in sync). It is
 * deliberately not part of the encrypted SQLite store: logs must survive a
 * crash before unlock and must be readable without the password.
 */

import type { LogRecord } from './types';

export const LOGS_DB_NAME = 'ptbudgetapp-logs';
export const LOGS_DB_VERSION = 1;
export const LOGS_STORE = 'entries';
export const LOGS_CHANNEL = 'ptbudget-logs';
export const LOGS_INDEX_TS = 'ts';
export const LOGS_INDEX_CORRELATION = 'correlationId';

/** A record as stored: the auto-incremented `seq` is the primary key and the newest-first sort key. */
export interface StoredLogRecord extends LogRecord {
  seq: number;
}

/** Messages posted on `BroadcastChannel(LOGS_CHANNEL)` by every writer. */
export type LogChannelMessage =
  | { type: 'appended'; count: number; source: 'app' | 'worker' | 'console'; tabId?: string }
  | { type: 'cleared' };

export function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export function upgradeLogsDatabase(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(LOGS_STORE)) {
    const store = db.createObjectStore(LOGS_STORE, { keyPath: 'seq', autoIncrement: true });
    store.createIndex(LOGS_INDEX_TS, 'ts', { unique: false });
    store.createIndex(LOGS_INDEX_CORRELATION, 'context.correlationId', { unique: false });
  }
}

/**
 * Opens the log database, creating the store on first use. `onVersionChange`
 * is invoked (after the connection has been closed) when another context
 * deletes or upgrades the database, so callers drop their handle and a
 * `deleteDatabase` from Reset App is never silently blocked.
 */
export function openLogsDatabase(onVersionChange?: () => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!hasIndexedDb()) {
      reject(new Error('IndexedDB is not available'));
      return;
    }
    const request = indexedDB.open(LOGS_DB_NAME, LOGS_DB_VERSION);
    request.onupgradeneeded = () => upgradeLogsDatabase(request.result);
    request.onblocked = () => reject(new Error('Log database open was blocked'));
    request.onerror = () => reject(request.error ?? new Error('Failed to open the log database'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        onVersionChange?.();
      };
      resolve(db);
    };
  });
}

/** Deletes the whole log database. Resolves even when blocked, like resetApp's other deletes. */
export function deleteLogsDatabase(): Promise<void> {
  return new Promise((resolve) => {
    if (!hasIndexedDb()) {
      resolve();
      return;
    }
    const request = indexedDB.deleteDatabase(LOGS_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

export function createLogChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  try {
    return new BroadcastChannel(LOGS_CHANNEL);
  } catch {
    return null;
  }
}
