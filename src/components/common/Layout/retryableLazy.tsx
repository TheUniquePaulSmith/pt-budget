'use client';

/**
 * `React.lazy` that can try again. A plain lazy component remembers a failed
 * import forever, so a page whose code could not be fetched (offline, without
 * offline mode) would stay broken until a full reload. Here a failed import
 * is replaced by a fresh one, but only when PageLoadBoundary retries (it
 * provides the attempt number through PageRetryContext). Replacing it on
 * every render instead would refetch in a loop and never reach the boundary.
 */

import React, { createContext, lazy, useContext, type ComponentType } from 'react';

/** The page's load attempt; PageLoadBoundary increments it on Try again or when back online. */
export const PageRetryContext = createContext(0);

export function retryableLazy<P extends object>(factory: () => Promise<{ default: ComponentType<P> }>): ComponentType<P> {
  let failed = false;
  /** The boundary attempt the current lazy component belongs to; set on its first render. */
  let attemptOfCurrent: number | null = null;
  const create = (): React.LazyExoticComponent<ComponentType<P>> =>
    lazy(() =>
      factory().catch((error: unknown) => {
        failed = true;
        throw error;
      }),
    );
  let current = create();

  function RetryableLazy(props: P) {
    const attempt = useContext(PageRetryContext);
    if (attemptOfCurrent === null) attemptOfCurrent = attempt;
    if (failed && attempt !== attemptOfCurrent) {
      failed = false;
      attemptOfCurrent = attempt;
      current = create();
    }
    const Current = current;
    return <Current {...(props as P & React.JSX.IntrinsicAttributes)} />;
  }
  return RetryableLazy;
}
