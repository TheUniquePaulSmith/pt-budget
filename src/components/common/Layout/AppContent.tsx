'use client';

/**
 * Application entry: wraps the shell in the providers the feature slots need.
 *
 * Pages come from `pageRegistry.tsx`; nothing here names a page id except
 * the default. The shell (`AppShell.tsx`: desktop rail + slim app bar,
 * phone bottom navigation + "More" sheet) MUST keep these invariants, which
 * feature slots and the e2e suite rely on:
 *
 *   - `<AiPanelProvider>` wraps the shell (AI panel state lives there).
 *   - `<NotificationsRuntime />` is mounted exactly once, outside any page.
 *   - `<NotificationBellSlot />` and `<AiLauncherSlot />` are rendered in the
 *     header (and in the phone "More" sheet as `menuItem` variants).
 *   - `<ManageData />` and `<DatabaseStatusBar />` are rendered.
 *   - Pages render through `getPage(id).render(...)` inside `<Suspense>`.
 *   - Every control that navigates to a page carries
 *     `data-testid={page.testId}` AND an accessible name equal to
 *     `page.label` at desktop width (the collapsed icon rail uses
 *     aria-label / Tooltip so `getByRole('button', { name: 'SQL Query' })`
 *     still resolves).
 *   - A `Settings`-named control stays in the header; full-screen pages
 *     (settings, developer console) render without the chrome and close
 *     via `goBack`.
 *   - On phones the bottom bar shows the first `mobileNav` pages and the
 *     "More" action (`data-testid="nav-more"`) opens the rest.
 */

import React from 'react';

import { AiPanelProvider } from '@/components/ai/AiPanelProvider';
import AppShell from './AppShell';

/**
 * Main application component that handles all the routing and state management
 * This is separated from the page.tsx to prevent SSR issues
 */
export default function AppContent() {
  return (
    <AiPanelProvider>
      <AppShell />
    </AiPanelProvider>
  );
}
