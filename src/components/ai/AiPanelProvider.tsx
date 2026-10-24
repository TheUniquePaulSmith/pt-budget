'use client';

/**
 * Owns the AI panel's open/closed state so any part of the shell (header
 * launcher, sidebar, mobile menu, the Subscriptions page) can open it without
 * prop drilling. The AI feature extends this with window modes
 * (sidebar / maximized / pop-out) and the transcript; the shell only ever
 * calls `useAiPanel()`.
 */

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import AiSidePanel from './AiSidePanel';

export interface AiPanelContextValue {
  isOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  togglePanel: () => void;
}

const AiPanelContext = createContext<AiPanelContextValue | null>(null);

export function AiPanelProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  const openPanel = useCallback(() => setIsOpen(true), []);
  const closePanel = useCallback(() => setIsOpen(false), []);
  const togglePanel = useCallback(() => setIsOpen((open) => !open), []);

  const value = useMemo(
    () => ({ isOpen, openPanel, closePanel, togglePanel }),
    [closePanel, isOpen, openPanel, togglePanel]
  );

  return (
    <AiPanelContext.Provider value={value}>
      {children}
      <AiSidePanel open={isOpen} onClose={closePanel} />
    </AiPanelContext.Provider>
  );
}

export function useAiPanel(): AiPanelContextValue {
  const value = useContext(AiPanelContext);
  if (!value) {
    throw new Error('useAiPanel must be used within an AiPanelProvider');
  }
  return value;
}
