'use client';

/**
 * Logging providers.
 *
 *   <LoggingProvider>      installs the persistent IndexedDB sink + console
 *                          capture, tracks the current page and mounts the
 *                          UI interaction tracer. Mounted once in layout.tsx.
 *   <LogContextProvider>   the page-tracking part on its own (also used by
 *                          LoggingProvider); exposes `useLogContext()`.
 *   useLogger(component)   a logger child stamped with the component name;
 *                          the current page and last interaction are added
 *                          by the ambient context at emit time.
 *
 * The current page is discovered without touching the shell: any control
 * carrying `data-testid="nav-<id>"` with `aria-current="page"` names it, and
 * the interaction tracer reports clicks on `nav-<id>` controls (which also
 * covers full-screen pages whose nav controls are not rendered). A shell may
 * additionally call `setPage` from `useLogContext()` directly.
 */

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

import InteractionTracer from '@/components/common/Console/InteractionTracer';
import {
  NAV_TEST_ID_PREFIX,
  getAmbientPage,
  installPersistentLogging,
  logger,
  pageIdFromNavTestId,
  setAmbientPage,
  subscribeAmbientPage,
  type Logger,
} from '@/lib/logging';

interface LogContextValue {
  /** Registry page id currently showing, when known. */
  page: string | undefined;
  setPage: (page: string | undefined) => void;
}

const LogContext = createContext<LogContextValue | undefined>(undefined);

function readCurrentPageFromDom(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const active = document.querySelector<HTMLElement>(`[data-testid^="${NAV_TEST_ID_PREFIX}"][aria-current="page"]`);
  return pageIdFromNavTestId(active?.dataset.testid);
}

export const LogContextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [page, setPageState] = useState<string | undefined>(() => getAmbientPage());

  useEffect(() => subscribeAmbientPage(setPageState), []);

  // Follow `aria-current="page"` on registry nav controls so navigation that
  // bypasses a click (keyboard, goBack from a full-screen page) is tracked too.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined' || typeof document === 'undefined') return undefined;
    let scheduled = false;
    const sync = () => {
      scheduled = false;
      const current = readCurrentPageFromDom();
      if (current) setAmbientPage(current);
    };
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(sync);
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-current'],
    });
    sync();
    return () => observer.disconnect();
  }, []);

  const value = useMemo<LogContextValue>(() => ({ page, setPage: setAmbientPage }), [page]);
  return <LogContext.Provider value={value}>{children}</LogContext.Provider>;
};

export const LoggingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  useEffect(() => {
    installPersistentLogging();
  }, []);

  return (
    <LogContextProvider>
      <InteractionTracer />
      {children}
    </LogContextProvider>
  );
};

/** The current page and a setter; usable anywhere under LoggingProvider (falls back to the ambient value). */
export function useLogContext(): LogContextValue {
  const context = useContext(LogContext);
  if (context) return context;
  return { page: getAmbientPage(), setPage: setAmbientPage };
}

/** A logger stamped with `component`; page and last interaction come from the ambient context. */
export function useLogger(component: string): Logger {
  return useMemo(() => logger.child({ component }), [component]);
}

/** @deprecated The old capture flag; logging is always on. Kept so existing imports compile. */
export function useLogging(): { isLoggingEnabled: boolean; setLoggingEnabled: (enabled: boolean) => void } {
  return { isLoggingEnabled: true, setLoggingEnabled: () => undefined };
}
