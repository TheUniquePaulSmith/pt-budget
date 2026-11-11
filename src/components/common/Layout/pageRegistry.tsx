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
 *   - an accessible name equal to the page's label at desktop width. `label`
 *     is the English source text; nav controls render `getPageLabel(page, t)`,
 *     which resolves the `shell:nav.<id>` translation (English by default, so
 *     the e2e suite keeps clicking `getByRole('button', { name: 'SQL Query' })`).
 */

import React, { type ComponentType } from 'react';
import type { TFunction } from 'i18next';
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
  RequestQuote as LoansIcon,
  Savings as BudgetIcon,
  Settings as SettingsIcon,
  UploadFile as ImportIcon,
} from '@mui/icons-material';

import { useAiPanel } from '@/components/ai/AiPanelProvider';

import { retryableLazy } from './retryableLazy';

export type PageId =
  | 'dashboard'
  | 'projects'
  | 'trips'
  | 'budget'
  | 'accounts'
  | 'loans'
  | 'transactions'
  | 'import'
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

const DashboardPage = retryableLazy(() => import('@/components/dashboard/Dashboard'));
const ManageProjectsPage = retryableLazy(() => import('@/components/projects/ManageProjects'));
const ManageTripsPage = retryableLazy(() => import('@/components/trips/ManageTrips'));
const BudgetPage = retryableLazy(() => import('@/components/budget/BudgetPage'));
const ManageAccountsPage = retryableLazy(() => import('@/components/accounts/ManageAccounts'));
const LoansPage = retryableLazy(() => import('@/components/loans/LoansPage'));
const TransactionReportPage = retryableLazy(() => import('@/components/transactions/TransactionReport'));
const ImportPage = retryableLazy(() => import('@/components/import-wizard/ImportPage'));
const SubscriptionsPage = retryableLazy(() => import('@/components/subscriptions/SubscriptionsPage'));
const NotificationsPage = retryableLazy(() => import('@/components/notifications/NotificationsPage'));
const SQLQueryPage = retryableLazy(() => import('@/components/sql-query/SQLQueryPage'));
const SettingsPage = retryableLazy(() => import('@/components/settings/SettingsPage'));
const DeveloperConsolePage = retryableLazy(() => import('@/components/common/Console/DeveloperConsolePage'));

/** Subscriptions can open the AI panel; the panel state lives in AiPanelProvider. */
function SubscriptionsPageAdapter({ navigate }: Pick<PageProps, 'navigate'>) {
  const { openPanel } = useAiPanel();
  return <SubscriptionsPage onOpenAiPanel={openPanel} onNavigateToLoans={() => navigate('loans')} />;
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
    render: ({ navigate }) => (
      <DashboardPage onNavigateToBudget={() => navigate('budget')} onNavigateToSettings={() => navigate('settings')} />
    ),
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
    id: 'loans',
    label: 'Loans',
    icon: LoansIcon,
    section: 'main',
    order: 55,
    testId: 'nav-loans',
    render: () => <LoansPage />,
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
    // The Import Wizard: a full-screen task, opened from the "Import" quick
    // action rather than listed among the pages.
    id: 'import',
    label: 'Import',
    icon: ImportIcon,
    section: 'main',
    order: 65,
    hiddenFromNav: true,
    fullScreen: true,
    testId: 'nav-import',
    render: ({ goBack, navigate }) => (
      <ImportPage onClose={goBack} onViewTransactions={() => navigate('transactions')} />
    ),
  },
  {
    id: 'subscriptions',
    label: 'Subscriptions',
    icon: SubscriptionsIcon,
    section: 'main',
    order: 70,
    testId: 'nav-subscriptions',
    render: ({ navigate }) => <SubscriptionsPageAdapter navigate={navigate} />,
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

/** The page's label in the active language (`t` from `useTranslation('shell')`). */
export function getPageLabel(page: Pick<PageDefinition, 'id' | 'label'>, t: TFunction<'shell'>): string {
  return t(`nav.${page.id}`, { defaultValue: page.label });
}

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
