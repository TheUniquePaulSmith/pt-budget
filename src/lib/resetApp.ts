/**
 * Debug-only "Reset App" support. Wipes every trace of locally persisted
 * app data — cookies, localStorage, sessionStorage, and all IndexedDB
 * databases (the encrypted SQLite VFS blocks in `ptbudgetapp-v2-encrypted`,
 * the header keystore in `ptbudgetapp-keys`, and anything else the origin
 * has created) — then reloads to a clean URL so the app comes back up as
 * if freshly installed. Only reachable behind `?debug` (see debugMode.ts).
 */

// Fallback for browsers without `indexedDB.databases()` (see database-worker.js
// for where these names are defined on the worker side).
const KNOWN_INDEXEDDB_NAMES = ['ptbudgetapp-v2-encrypted', 'ptbudgetapp-keys'];

function deleteIndexedDatabase(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

async function deleteAllIndexedDatabases(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;

  if (typeof indexedDB.databases === 'function') {
    const databases = await indexedDB.databases().catch(() => []);
    const names = new Set(KNOWN_INDEXEDDB_NAMES);
    databases.forEach((db) => {
      if (db.name) names.add(db.name);
    });
    await Promise.all([...names].map(deleteIndexedDatabase));
    return;
  }

  await Promise.all(KNOWN_INDEXEDDB_NAMES.map(deleteIndexedDatabase));
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
 * @param disconnectWorker Best-effort teardown of the current tab's
 * SharedWorker connection before the storage wipe. The reload that follows
 * severs it anyway, but calling this first avoids the worker touching
 * storage mid-delete.
 */
export async function resetApp(disconnectWorker?: () => void): Promise<void> {
  try {
    disconnectWorker?.();
  } catch {
    // Best-effort — the storage wipe below is what actually matters.
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

  await deleteAllIndexedDatabases();

  window.location.href = window.location.origin + window.location.pathname;
}
