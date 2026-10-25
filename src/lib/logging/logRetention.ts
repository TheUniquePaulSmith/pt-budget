/**
 * Log retention settings (Settings → Developer). Stored in localStorage, not
 * the encrypted database, so they apply before unlock and survive a database
 * reset. The IndexedDB sink reads them on every prune.
 */

export interface LogRetention {
  /** Ring cap: the oldest entries beyond this count are deleted. */
  maxEntries: number;
  /** Entries older than this are deleted; 0 = keep until the ring cap evicts them. */
  maxAgeDays: number;
}

export const LOG_RETENTION_STORAGE_KEY = 'ptbudget.logs.retention';
export const DEFAULT_LOG_RETENTION: LogRetention = { maxEntries: 20_000, maxAgeDays: 7 };
export const LOG_RETENTION_ENTRY_OPTIONS = [2_000, 5_000, 20_000, 50_000] as const;
export const LOG_RETENTION_AGE_OPTIONS = [1, 7, 30, 0] as const;

const listeners = new Set<(retention: LogRetention) => void>();

function readStorage(): Partial<LogRetention> | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOG_RETENTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LogRetention>;
    return typeof parsed === 'object' && parsed !== null ? parsed : null;
  } catch {
    return null;
  }
}

export function normalizeLogRetention(value: Partial<LogRetention> | null | undefined): LogRetention {
  const maxEntries = Number(value?.maxEntries);
  const maxAgeDays = Number(value?.maxAgeDays);
  return {
    maxEntries:
      Number.isFinite(maxEntries) && maxEntries >= 100 ? Math.floor(maxEntries) : DEFAULT_LOG_RETENTION.maxEntries,
    maxAgeDays:
      Number.isFinite(maxAgeDays) && maxAgeDays >= 0 ? Math.floor(maxAgeDays) : DEFAULT_LOG_RETENTION.maxAgeDays,
  };
}

export function getLogRetention(): LogRetention {
  return normalizeLogRetention(readStorage());
}

export function setLogRetention(retention: Partial<LogRetention>): LogRetention {
  const next = normalizeLogRetention({ ...getLogRetention(), ...retention });
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(LOG_RETENTION_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage may be unavailable (private mode); the in-memory value still applies this session.
    }
  }
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      // Listeners must never break the caller.
    }
  }
  return next;
}

export function subscribeLogRetention(listener: (retention: LogRetention) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
