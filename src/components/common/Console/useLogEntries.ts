'use client';

/**
 * Paged, live view over the diagnostic log database for the Developer
 * Console: newest first, filtered in the store, refreshed from
 * `BroadcastChannel('ptbudget-logs')` while "Follow" is on (otherwise new
 * entries are counted and shown on demand).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  countLogs,
  readLogPage,
  subscribeToLogUpdates,
  type LogFilters,
  type LogLevel,
  type LogSource,
  type StoredLogRecord,
} from '@/lib/logging';

export interface LogViewFilters {
  levels: LogLevel[];
  sources: LogSource[];
  page: string;
  correlationId: string;
  text: string;
}

export const ALL_LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];
export const ALL_SOURCES: LogSource[] = ['app', 'worker', 'console'];

export const DEFAULT_LOG_VIEW_FILTERS: LogViewFilters = {
  levels: [...ALL_LEVELS],
  sources: [...ALL_SOURCES],
  page: '',
  correlationId: '',
  text: '',
};

export function toStoreFilters(filters: LogViewFilters): LogFilters {
  return {
    levels: filters.levels.length === ALL_LEVELS.length ? undefined : filters.levels,
    sources: filters.sources.length === ALL_SOURCES.length ? undefined : filters.sources,
    page: filters.page || undefined,
    correlationId: filters.correlationId.trim() || undefined,
    text: filters.text.trim() || undefined,
  };
}

interface UseLogEntriesOptions {
  filters: LogViewFilters;
  follow: boolean;
  pageSize?: number;
  /** Debounce applied to live refreshes and text search (ms). */
  debounceMs?: number;
}

export interface LogEntriesState {
  entries: StoredLogRecord[];
  hasMore: boolean;
  isLoading: boolean;
  /** Entries appended since the last refresh while Follow was off. */
  pendingCount: number;
  /** Total entries in the store (all sources, unfiltered). */
  total: number;
  refresh: () => void;
  loadOlder: () => void;
}

export function useLogEntries({ filters, follow, pageSize = 200, debounceMs = 300 }: UseLogEntriesOptions): LogEntriesState {
  const [entries, setEntries] = useState<StoredLogRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [version, setVersion] = useState(0);
  const requestRef = useRef(0);
  const followRef = useRef(follow);
  followRef.current = follow;

  const storeFilters = useMemo(() => toStoreFilters(filters), [filters]);

  const refresh = useCallback(() => {
    setVersion((value) => value + 1);
  }, []);

  // Initial / filtered load (newest page). Debounced so typing a search
  // string does not issue a cursor walk per keystroke.
  useEffect(() => {
    const requestId = ++requestRef.current;
    setIsLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const [page, count] = await Promise.all([readLogPage({ filters: storeFilters, limit: pageSize }), countLogs()]);
          if (requestRef.current !== requestId) return;
          setEntries(page.records);
          setHasMore(page.hasMore);
          setTotal(count);
          setPendingCount(0);
        } catch {
          if (requestRef.current !== requestId) return;
          setEntries([]);
          setHasMore(false);
        } finally {
          if (requestRef.current === requestId) setIsLoading(false);
        }
      })();
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [storeFilters, pageSize, version, debounceMs]);

  const loadOlder = useCallback(() => {
    const oldest = entries[entries.length - 1];
    if (!oldest) return;
    const requestId = requestRef.current;
    setIsLoading(true);
    void (async () => {
      try {
        const page = await readLogPage({ filters: storeFilters, limit: pageSize, beforeSeq: oldest.seq });
        if (requestRef.current !== requestId) return;
        setEntries((current) => {
          const known = new Set(current.map((entry) => entry.seq));
          return [...current, ...page.records.filter((entry) => !known.has(entry.seq))];
        });
        setHasMore(page.hasMore);
      } catch {
        if (requestRef.current === requestId) setHasMore(false);
      } finally {
        if (requestRef.current === requestId) setIsLoading(false);
      }
    })();
  }, [entries, storeFilters, pageSize]);

  // Live updates: refresh (debounced) while following, otherwise count.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToLogUpdates((message) => {
      if (message.type === 'cleared') {
        setPendingCount(0);
        refresh();
        return;
      }
      if (followRef.current) {
        if (timer) return;
        timer = setTimeout(() => {
          timer = null;
          refresh();
        }, debounceMs);
      } else {
        setPendingCount((count) => count + message.count);
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [refresh, debounceMs]);

  // Turning Follow back on picks up what accumulated meanwhile.
  useEffect(() => {
    if (follow) refresh();
  }, [follow, refresh]);

  return { entries, hasMore, isLoading, pendingCount, total, refresh, loadOlder };
}
