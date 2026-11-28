'use client';

/**
 * The shell's page navigation for controls that live inside a page but lead
 * to another one (a notification's "Import a newer statement"). Outside the
 * shell (tests, the setup gate) there is none and such controls hide.
 */

import { createContext, useContext } from 'react';

import type { PageId } from '../pageRegistry';

const ShellNavigationContext = createContext<((page: PageId) => void) | null>(null);

export const ShellNavigationProvider = ShellNavigationContext.Provider;

export function useShellNavigate(): ((page: PageId) => void) | null {
  return useContext(ShellNavigationContext);
}
