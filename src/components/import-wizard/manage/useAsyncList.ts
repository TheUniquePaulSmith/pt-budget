'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { logger } from '@/lib/logging';

const log = logger.child({ component: 'ImportManage' });

export interface AsyncList<T> {
  /** null until the first load has answered. */
  items: T[] | null;
  /** The last load failed; `items` keeps what was loaded before, if anything. */
  failed: boolean;
  reload: () => Promise<void>;
}

/**
 * Loads a list on mount, again whenever `reloadKey` changes, and on demand.
 * Only the newest request may answer, so a slow earlier read never overwrites
 * a later one.
 */
export function useAsyncList<T>(operation: string, load: () => Promise<T[]>, reloadKey?: unknown): AsyncList<T> {
  const [items, setItems] = useState<T[] | null>(null);
  const [failed, setFailed] = useState(false);
  const latestRequest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latestRequest.current;
    try {
      const loaded = await load();
      if (request !== latestRequest.current) return;
      setItems(loaded);
      setFailed(false);
    } catch (error) {
      log.error('Failed to load import management list', { operation, error });
      if (request !== latestRequest.current) return;
      setFailed(true);
    }
  }, [load, operation]);

  useEffect(() => {
    void reload();
    return () => {
      // Whatever is still in flight belongs to an older key or an unmounted view.
      latestRequest.current += 1;
    };
  }, [reload, reloadKey]);

  return { items, failed, reload };
}
