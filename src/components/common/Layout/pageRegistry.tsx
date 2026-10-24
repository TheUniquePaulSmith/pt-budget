'use client';

/**
 * Page registry: the single list of top-level pages the shell can show.
 *
 * The shell (AppContent, and later the sidebar / bottom navigation) renders
 * navigation from this list and never hard-codes page ids. A feature that
 * adds a page registers it here once; the shell picks it up everywhere.
 *
 * Contract every nav control must honour (e2e selectors depend on it):
 *   - `data-testid={page.testId}` on the control that navigates to the page
 *   - an accessible name equal to `page.label` at desktop width
 */

import React, { lazy, type ComponentType } from 'react';
import type { SvgIconProps } from '@mui/material';
import {
  AccountBalance as AccountIcon,
  Autorenew as SubscriptionsIcon,
  BugReport as DeveloperConsoleIcon,
  Code as SQLIcon,
  Dashboard as DashboardIcon,
  FlightTakeoff as TripsIcon,
  Home as ProjectsIcon,
  Notifications as NotificationsIcon,
  Receipt as TransactionsIcon,
  Savings as BudgetIcon,
  Settings as SettingsIcon,
} from '@mui/icons-material';

import { useAiPanel } from '@/components/ai/AiPanelProvider';

export type PageId =
  | 'dashboard'
  | 'projects'
  | 'trips'
  | 'budget'
  | 'accounts'
  | 'transactions'
  | 'subscriptions'
  | 'notifications'
  | 'sql-query'
  | 'settings'
  | 'developer-console';

export interface PageProps {
  navigate: (page: PageId) => void;
  /** Returns to the page that was showing before this one (full-screen pages). */
  goBack: () => void;
}

export interface PageDefinition {
  id: PageId;
  label: string;
  icon: ComponentType<SvgIconProps>;
  /** main = primary navigation, tools = developer-facing, system = settings. */
  section: 'main' | 'tools' | 'system';
  /** Sort key within the navigation. */
  order: number;
  /** Candidate for the mobile bottom navigation (the shell picks the first few). */
  mobileNav?: boolean;
  /** Reached from header icons rather than the page list (settings, developer console). */
  hiddenFromNav?: boolean;
  /** Rendered without the app chrome (header / status bar); the page owns its own close control. */
  fullScreen?: boolean;
  /** `nav-<id>`; applied to every control that navigates to this page. */
  testId: string;
  render: (props: PageProps) => React.ReactNode;
}

const DashboardPage = lazy(() => import('@/components/dashboard/Dashboard'));
const ManageProjectsPage = lazy(() => import('@/components/projects/ManageProjects'));
const ManageTripsPage = lazy(() => import('@/components/trips/ManageTrips'));
const BudgetPage = lazy(() => import('@/components/budget/BudgetPage'));
const ManageAccountsPage = lazy(() => import('@/components/accounts/ManageAccounts'));
const TransactionReportPage = lazy(() => import('@/components/transactions/TransactionReport'));
const SubscriptionsPage = lazy(() => import('@/components/subscriptions/SubscriptionsPage'));
const NotificationsPage = lazy(() => import('@/components/notifications/NotificationsPage'));
const SQLQueryPage = lazy(() => import('@/components/sql-query/SQLQueryPage'));
const SettingsPage = lazy(() => import('@/components/settings/SettingsPage'));
const DeveloperConsolePage = lazy(() => import('@/components/common/Console/DeveloperConsolePage'));

/** Subscriptions can open the AI panel; the panel state lives in AiPanelProvider. */
function SubscriptionsPageAdapter() {
  const { openPanel } = useAiPanel();
  return <SubscriptionsPage onOpenAiPanel={openPanel} />;
}

export const PAGE_DEFINITIONS: readonly PageDefinition[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    icon: DashboardIcon,
    section: 'main',
    order: 10,
    mobileNav: true,
    testId: 'nav-dashboard',
    render: ({ navigate }) => <DashboardPage onNavigateToBudget={() => navigate('budget')} />,
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: ProjectsIcon,
    section: 'main',
    order: 20,
    testId: 'nav-projects',
    render: () => <ManageProjectsPage />,
  },
  {
    id: 'trips',
    label: 'Trips',
    icon: TripsIcon,
    section: 'main',
    order: 30,
    testId: 'nav-trips',
    render: () => <ManageTripsPage />,
  },
  {
    id: 'budget',
    label: 'Budget',
    icon: BudgetIcon,
    section: 'main',
    order: 40,
    mobileNav: true,
    testId: 'nav-budget',
    render: () => <BudgetPage />,
  },
  {
    id: 'accounts',
    label: 'Accounts',
    icon: AccountIcon,
    section: 'main',
    order: 50,
    mobileNav: true,
    testId: 'nav-accounts',
    render: () => <ManageAccountsPage />,
  },
  {
    id: 'transactions',
    label: 'Transactions',
    icon: TransactionsIcon,
    section: 'main',
    order: 60,
    mobileNav: true,
    testId: 'nav-transactions',
    render: () => <TransactionReportPage />,
  },
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    icon: SubscriptionsIcon,
    section: 'main',
    order: 70,
    testId: 'nav-subscriptions',
    render: () => <SubscriptionsPageAdapter />,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: NotificationsIcon,
    section: 'main',
    order: 75,
    mobileNav: true,
    testId: 'nav-notifications',
    render: () => <NotificationsPage />,
  },
  {
    id: 'sql-query',
    label: 'SQL Query',
    icon: SQLIcon,
    section: 'tools',
    order: 80,
    testId: 'nav-sql-query',
    render: () => <SQLQueryPage />,
  },
  {
    id: 'developer-console',
    label: 'Developer Console',
    icon: DeveloperConsoleIcon,
    section: 'tools',
    order: 800,
    hiddenFromNav: true,
    fullScreen: true,
    testId: 'nav-developer-console',
    render: ({ goBack }) => <DeveloperConsolePage onClose={goBack} />,
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: SettingsIcon,
    section: 'system',
    order: 900,
    hiddenFromNav: true,
    fullScreen: true,
    testId: 'nav-settings',
    render: ({ goBack }) => <SettingsPage onClose={goBack} />,
  },
];

export const DEFAULT_PAGE_ID: PageId = 'dashboard';

export function getPage(id: PageId): PageDefinition {
  const page = PAGE_DEFINITIONS.find((definition) => definition.id === id);
  if (!page) {
    throw new Error(`Unknown page: ${id}`);
  }
  return page;
}

/** Pages shown in the primary navigation (sidebar, header buttons, mobile drawer), in order. */
export function getNavigationPages(): PageDefinition[] {
  return PAGE_DEFINITIONS.filter((page) => !page.hiddenFromNav).sort((a, b) => a.order - b.order);
}

/** Pages flagged for the mobile bottom navigation, in order. */
export function getMobileNavigationPages(): PageDefinition[] {
  return getNavigationPages().filter((page) => page.mobileNav);
}
