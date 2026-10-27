/**
 * Debug-only "Reset App" support. Wipes every trace of locally persisted
 * app data — cookies, localStorage, sessionStorage, and all IndexedDB
 * databases (the encrypted SQLite VFS blocks in `ptbudgetapp-v2-encrypted`,
 * the header keystore in `ptbudgetapp-keys`, and anything else the origin
 * has created) — then reloads to a clean URL so the app comes back up as
 * if freshly installed. The shared database worker is terminated first, so it
 * neither keeps its key and storage handles alive across the reload nor
 * writes into the stores being deleted. Only reachable behind `?debug` (see
 * debugMode.ts).
 *
 * The diagnostic log database (`ptbudgetapp-logs`) is kept by default, so the
 * logs that explain *why* someone had to reset survive the reset; it is only
 * deleted when the user ticks "Also clear diagnostic logs".
 */

import { LOGS_DB_NAME, uninstallPersistentLogging } from './logging';

// Fallback for browsers without `indexedDB.databases()` (see database-worker.js
// for where these names are defined on the worker side).
const KNOWN_INDEXEDDB_NAMES = ['ptbudgetapp-v2-encrypted', 'ptbudgetapp-keys'];

export interface ResetAppOptions {
  /** Also delete the `ptbudgetapp-logs` database (kept by default). */
  includeLogs?: boolean;
}

function deleteIndexedDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/** The database names a reset should delete; the log database only when asked. */
export function selectDatabasesToDelete(existing: readonly string[], includeLogs: boolean): string[] {
  const names = new Set<string>(KNOWN_INDEXEDDB_NAMES);
  for (const name of existing) names.add(name);
  if (!includeLogs) names.delete(LOGS_DB_NAME);
  else names.add(LOGS_DB_NAME);
  return [...names];
}

async function deleteAllIndexedDatabases(includeLogs: boolean): Promise<void> {
  if (typeof indexedDB === 'undefined') return;

  let existing: string[] = [];
  if (typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases().catch(() => []);
    existing = databases.map((db) => db.name).filter((name): name is string => Boolean(name));
  }
  await Promise.all(selectDatabasesToDelete(existing, includeLogs).map(deleteIndexedDatabase));
}

function clearCookies(): void {
  document.cookie.split(';').forEach((cookie) => {
    const name = cookie.split('=')[0]?.trim();
    if (!name) return;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${window.location.hostname}`;
  });
}

/**
 * @param terminateWorker Ends the shared database worker before the storage
 * wipe. It is shared by every tab and outlives a reload, so merely closing
 * this tab's connection would leave it running with its decryption key in
 * memory and its IndexedDB handles open — which blocks the deletes below and
 * makes the "fresh" app reconnect to stale state. The worker closes its
 * handles, deletes the stores it owns and exits. Best-effort.
 */
export async function resetApp(
  terminateWorker?: (options: { includeLogs: boolean }) => void | Promise<void>,
  options: ResetAppOptions = {}
): Promise<void> {
  const includeLogs = options.includeLogs === true;

  try {
    await terminateWorker?.({ includeLogs });
  } catch {
    // Best-effort — the storage wipe below is what actually matters.
  }

  if (includeLogs) {
    // Close this tab's handles on the log database so the delete is not
    // blocked; the worker drops its own handle on `versionchange`.
    await uninstallPersistentLogging().catch(() => undefined);
  }

  clearCookies();

  try {
    window.localStorage.clear();
  } catch {
    // Ignore — proceed with the rest of the wipe regardless.
  }
  try {
    window.sessionStorage.clear();
  } catch {
    // Ignore — proceed with the rest of the wipe regardless.
  }

  await deleteAllIndexedDatabases(includeLogs);

  window.location.href = window.location.origin + window.location.pathname;
}
