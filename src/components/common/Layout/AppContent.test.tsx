// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock factories are hoisted above the imports, so the helper must be hoisted too.
const { stub } = vi.hoisted(() => ({
  stub: (testId: string) => ({
    default: () => React.createElement('div', { 'data-testid': testId }),
  }),
}));

vi.mock('@/components/dashboard/Dashboard', () => ({
  default: ({ onNavigateToBudget }: { onNavigateToBudget?: () => void }) => (
    <div data-testid="page-dashboard">
      <button onClick={onNavigateToBudget}>Go to budget</button>
    </div>
  ),
}));
vi.mock('@/components/projects/ManageProjects', () => stub('page-projects'));
vi.mock('@/components/trips/ManageTrips', () => stub('page-trips'));
vi.mock('@/components/budget/BudgetPage', () => stub('page-budget'));
vi.mock('@/components/accounts/ManageAccounts', () => stub('page-accounts'));
vi.mock('@/components/transactions/TransactionReport', () => stub('page-transactions'));
vi.mock('@/components/subscriptions/SubscriptionsPage', () => ({
  default: ({ onOpenAiPanel }: { onOpenAiPanel?: () => void }) => (
    <div data-testid="page-subscriptions">
      <button onClick={onOpenAiPanel}>Open AI from subscriptions</button>
    </div>
  ),
}));
vi.mock('@/components/notifications/NotificationsPage', () => stub('page-notifications'));
vi.mock('@/components/sql-query/SQLQueryPage', () => stub('page-sql-query'));
vi.mock('@/components/settings/SettingsPage', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="page-settings">
      <button onClick={onClose}>Close settings</button>
    </div>
  ),
}));
vi.mock('@/components/common/Console/DeveloperConsolePage', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="page-developer-console">
      <button onClick={onClose}>Close console</button>
    </div>
  ),
}));
vi.mock('@/components/ai/AiSidePanel', () => ({
  default: ({ open }: { open: boolean }) => <div data-testid="ai-side-panel" data-open={String(open)} />,
}));
vi.mock('@/components/common/StatusBar/DatabaseStatusBar', () => stub('database-status-bar'));
vi.mock('@/components/data-management/ManageData', () => stub('manage-data'));
const runtimeMounts = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/components/notifications/NotificationsRuntime', () => {
  function NotificationsRuntimeStub() {
    React.useEffect(() => {
      runtimeMounts.count += 1;
    }, []);
    return React.createElement('div', { 'data-testid': 'notifications-runtime' });
  }
  return { default: NotificationsRuntimeStub };
});

const mockUseAppShellSlice = vi.fn();
const mockUseNotificationBadgeSlice = vi.fn();

vi.mock('@/contexts/useDatabaseSlices', () => ({
  useAppShellSlice: () => mockUseAppShellSlice(),
  useNotificationBadgeSlice: () => mockUseNotificationBadgeSlice(),
}));

import AppContent from './AppContent';
import { getNavigationPages } from './pageRegistry';
import { SIDEBAR_EXPANDED_STORAGE_KEY } from './sidebarPreference';

function installMatchMedia(matches = false) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  runtimeMounts.count = 0;
  installMatchMedia(false);
  mockUseAppShellSlice.mockReturnValue({
    isDatabaseLoaded: true,
    workerStatus: null,
    syncStatus: { state: 'disabled' },
    syncNow: vi.fn(),
    reconnectCloudSource: vi.fn(),
    resolveCloudConflict: vi.fn(),
  });
  mockUseNotificationBadgeSlice.mockReturnValue({
    notifications: [
      { id: 1, status: 'active', due_date: '2000-01-01' },
      { id: 2, status: 'active', due_date: null },
      { id: 3, status: 'active', due_date: '2999-01-01' },
      { id: 4, status: 'done', due_date: '2000-01-01' },
    ],
    setNotificationStatus: vi.fn(),
  });
});

describe('AppContent shell', () => {
  it('renders a nav control per registry page with its label and test id, and the dashboard by default', async () => {
    render(<AppContent />);

    for (const page of getNavigationPages()) {
      const control = screen.getByTestId(page.testId);
      expect(control).toHaveAccessibleName(page.label);
    }
    expect(screen.getByTestId('nav-dashboard')).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByTestId('page-dashboard')).toBeInTheDocument();
  });

  it('mounts the shell slots and the headless notifications runtime once', () => {
    render(<AppContent />);

    expect(screen.getAllByTestId('notifications-runtime')).toHaveLength(1);
    expect(screen.getByTestId('notification-bell-button')).toHaveAccessibleName('Notifications');
    expect(screen.getByTestId('ai-launcher-button')).toHaveAccessibleName('Local AI');
    expect(screen.getByTestId('database-status-bar')).toBeInTheDocument();
    expect(screen.getByTestId('manage-data')).toBeInTheDocument();
    expect(screen.getByTestId('ai-side-panel')).toHaveAttribute('data-open', 'false');
  });

  it('shows the count of due notifications on the bell and navigates to the notifications page', async () => {
    render(<AppContent />);

    // Two due (past date + no date); the future one and the completed one are not counted.
    expect(screen.getByTestId('notification-bell-badge')).toHaveTextContent('2');

    fireEvent.click(screen.getByTestId('notification-bell-button'));
    expect(await screen.findByTestId('page-notifications')).toBeInTheDocument();
    expect(screen.getByTestId('nav-notifications')).toHaveAttribute('aria-current', 'page');
  });

  it('navigates between pages through the registry', async () => {
    render(<AppContent />);

    fireEvent.click(screen.getByRole('button', { name: 'SQL Query' }));
    expect(await screen.findByTestId('page-sql-query')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Subscriptions' }));
    expect(await screen.findByTestId('page-subscriptions')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open AI from subscriptions' }));
    expect(screen.getByTestId('ai-side-panel')).toHaveAttribute('data-open', 'true');
  });

  it('opens settings full-screen and returns to the previous page on close', async () => {
    render(<AppContent />);

    fireEvent.click(screen.getByRole('button', { name: 'Trips' }));
    expect(await screen.findByTestId('page-trips')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(await screen.findByTestId('page-settings')).toBeInTheDocument();
    // Full-screen pages render without the app chrome.
    expect(screen.queryByTestId('nav-dashboard')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('notifications-runtime')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    await waitFor(() => expect(screen.getByTestId('page-trips')).toBeInTheDocument());
    expect(screen.getByTestId('nav-trips')).toHaveAttribute('aria-current', 'page');
  });

  it('never remounts the notifications runtime while navigating, including to full-screen pages', async () => {
    render(<AppContent />);
    await screen.findByTestId('page-dashboard');
    expect(runtimeMounts.count).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    await screen.findByTestId('page-settings');
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    await screen.findByTestId('page-dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Developer Console' }));
    await screen.findByTestId('page-developer-console');
    fireEvent.click(screen.getByRole('button', { name: 'Close console' }));
    await screen.findByTestId('page-dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Trips' }));
    await screen.findByTestId('page-trips');

    expect(screen.getAllByTestId('notifications-runtime')).toHaveLength(1);
    expect(runtimeMounts.count).toBe(1);
  });

  it('opens the developer console from its header button', async () => {
    render(<AppContent />);

    fireEvent.click(screen.getByRole('button', { name: 'Developer Console' }));
    expect(await screen.findByTestId('page-developer-console')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close console' }));
    expect(await screen.findByTestId('page-dashboard')).toBeInTheDocument();
  });

  it('lets a page navigate through the registry props', async () => {
    render(<AppContent />);

    fireEvent.click(await screen.findByRole('button', { name: 'Go to budget' }));
    expect(await screen.findByTestId('page-budget')).toBeInTheDocument();
  });

  it('renders nothing until the database is loaded', () => {
    mockUseAppShellSlice.mockReturnValue({
      isDatabaseLoaded: false,
      workerStatus: null,
      syncStatus: { state: 'disabled' },
      syncNow: vi.fn(),
      reconnectCloudSource: vi.fn(),
      resolveCloudConflict: vi.fn(),
    });

    const { container } = render(<AppContent />);
    expect(container.querySelector('[data-testid^="nav-"]')).toBeNull();
  });

  it('uses the bottom navigation and the More sheet with the same registry controls below the md breakpoint', async () => {
    installMatchMedia(true);
    render(<AppContent />);

    // No rail on phones; the bar carries the first mobileNav pages.
    expect(screen.queryByTestId('sidebar-rail')).not.toBeInTheDocument();
    const bar = screen.getByTestId('mobile-bottom-nav');
    expect(within(bar).getByTestId('nav-dashboard')).toHaveAccessibleName('Dashboard');
    expect(within(bar).getByTestId('nav-transactions')).toHaveAccessibleName('Transactions');
    expect(within(bar).getByTestId('nav-budget')).toHaveAccessibleName('Budget');
    expect(within(bar).getByTestId('nav-accounts')).toHaveAccessibleName('Accounts');
    expect(within(bar).queryByTestId('nav-sql-query')).not.toBeInTheDocument();

    fireEvent.click(within(bar).getByTestId('nav-transactions'));
    expect(await screen.findByTestId('page-transactions')).toBeInTheDocument();
    expect(within(bar).getByTestId('nav-transactions')).toHaveAttribute('aria-current', 'page');

    // Everything else is one tap away in the More sheet, including Settings.
    expect(screen.queryByRole('button', { name: 'SQL Query' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('nav-more'));
    const sheet = await screen.findByTestId('mobile-more-sheet');
    expect(within(sheet).getByTestId('nav-settings')).toHaveAccessibleName('Settings');
    expect(within(sheet).getByTestId('ai-launcher-menu-item')).toBeInTheDocument();
    fireEvent.click(within(sheet).getByTestId('nav-sql-query'));
    expect(await screen.findByTestId('page-sql-query')).toBeInTheDocument();
  });

  it('collapses the rail to icons that keep their accessible names and remembers the choice', async () => {
    render(<AppContent />);

    const rail = screen.getByTestId('sidebar-rail');
    expect(rail).toHaveAttribute('data-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(rail).toHaveAttribute('data-expanded', 'false');
    expect(window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY)).toBe('false');

    // Collapsed items are icon-only yet still resolve by their page label.
    for (const page of getNavigationPages()) {
      expect(screen.getByTestId(page.testId)).toHaveAccessibleName(page.label);
    }
    fireEvent.click(screen.getByRole('button', { name: 'SQL Query' }));
    expect(await screen.findByTestId('page-sql-query')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(rail).toHaveAttribute('data-expanded', 'true');
    expect(window.localStorage.getItem(SIDEBAR_EXPANDED_STORAGE_KEY)).toBe('true');
  });

  it('starts collapsed when the stored preference says so', () => {
    window.localStorage.setItem(SIDEBAR_EXPANDED_STORAGE_KEY, 'false');
    render(<AppContent />);

    expect(screen.getByTestId('sidebar-rail')).toHaveAttribute('data-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('shows the current page label in the app bar', async () => {
    render(<AppContent />);

    expect(screen.getByTestId('app-bar-title')).toHaveTextContent('Dashboard');
    fireEvent.click(screen.getByRole('button', { name: 'Budget' }));
    await waitFor(() => expect(screen.getByTestId('app-bar-title')).toHaveTextContent('Budget'));
  });
});
