'use client';

/**
 * Page-actions slots: let the current page put its own controls into the
 * shell. `appBar` sits in the app bar between the page title and the global
 * actions (the Dashboard's Filter button); `statusBar` is the left side of the
 * bottom status bar (the Dashboard's active-filter chips). The shell renders a
 * `PageActionsOutlet` for each inside `PageActionsProvider`; a page renders
 * `<PageActions slot="…">`, which portals its children there. Outside a
 * provider (component tests, a page rendered on its own) the children render
 * inline, so the controls are never lost.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, type SxProps, type Theme } from '@mui/material';

export type PageActionsSlotName = 'appBar' | 'statusBar';

type Outlets = Partial<Record<PageActionsSlotName, HTMLElement | null>>;

// undefined = no provider (render inline).
const OutletsContext = createContext<Outlets | undefined>(undefined);
const RegisterContext = createContext<((slot: PageActionsSlotName, element: HTMLElement | null) => void) | null>(null);

export function PageActionsProvider({ children }: { children: React.ReactNode }) {
  const [outlets, setOutlets] = useState<Outlets>({});
  const register = useCallback((slot: PageActionsSlotName, element: HTMLElement | null) => {
    setOutlets((current) => (current[slot] === element ? current : { ...current, [slot]: element }));
  }, []);
  return (
    <RegisterContext.Provider value={register}>
      <OutletsContext.Provider value={outlets}>{children}</OutletsContext.Provider>
    </RegisterContext.Provider>
  );
}

export function PageActionsOutlet({ slot, sx }: { slot: PageActionsSlotName; sx?: SxProps<Theme> }) {
  const register = useContext(RegisterContext);
  const ref = useMemo(
    () => (register ? (element: HTMLElement | null) => register(slot, element) : undefined),
    [register, slot]
  );
  return (
    <Box
      ref={ref}
      data-testid={slot === 'appBar' ? 'app-bar-page-actions' : 'status-bar-page-actions'}
      sx={[{ display: 'flex', alignItems: 'center', minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}
    />
  );
}

export function PageActions({ slot, children }: { slot: PageActionsSlotName; children: React.ReactNode }) {
  const outlets = useContext(OutletsContext);
  if (outlets === undefined) return <>{children}</>;
  const outlet = outlets[slot];
  return outlet ? createPortal(children, outlet) : null;
}
