// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./DatabaseContext', () => ({
  useDatabaseAccounts: vi.fn(),
  useDatabaseCategories: vi.fn(),
  useDatabaseCollections: vi.fn(),
  useDatabaseCompanies: vi.fn(),
  useDatabaseDiagnostics: vi.fn(),
  useDatabaseLifecycle: vi.fn(),
  useDatabaseProjects: vi.fn(),
  useDatabaseStatus: vi.fn(),
  useDatabaseSubscriptions: vi.fn(),
  useDatabaseTransactions: vi.fn(),
  useDatabaseTrips: vi.fn(),
  useDatabaseUsers: vi.fn(),
}));

import {
  useDatabaseAccounts,
  useDatabaseCategories,
  useDatabaseCollections,
  useDatabaseCompanies,
  useDatabaseDiagnostics,
  useDatabaseLifecycle,
  useDatabaseProjects,
  useDatabaseStatus,
  useDatabaseSubscriptions,
  useDatabaseTransactions,
  useDatabaseTrips,
  useDatabaseUsers,
} from './DatabaseContext';
import {
  useAiDatabaseToolsSlice,
  useAppShellSlice,
  useDashboardSlice,
  useManageDataSlice,
  useSettingsSlice,
  useTransactionComposerSlice,
} from './useDatabaseSlices';

const mockedUseDatabaseAccounts = vi.mocked(useDatabaseAccounts);
const mockedUseDatabaseCategories = vi.mocked(useDatabaseCategories);
const mockedUseDatabaseCollections = vi.mocked(useDatabaseCollections);
const mockedUseDatabaseCompanies = vi.mocked(useDatabaseCompanies);
const mockedUseDatabaseDiagnostics = vi.mocked(useDatabaseDiagnostics);
const mockedUseDatabaseLifecycle = vi.mocked(useDatabaseLifecycle);
const mockedUseDatabaseProjects = vi.mocked(useDatabaseProjects);
const mockedUseDatabaseStatus = vi.mocked(useDatabaseStatus);
const mockedUseDatabaseSubscriptions = vi.mocked(useDatabaseSubscriptions);
const mockedUseDatabaseTransactions = vi.mocked(useDatabaseTransactions);
const mockedUseDatabaseTrips = vi.mocked(useDatabaseTrips);
const mockedUseDatabaseUsers = vi.mocked(useDatabaseUsers);

function mockDatabaseHooks() {
  const exportDatabase = vi.fn();
  const addTransaction = vi.fn();
  const addCategory = vi.fn();
  const addCompany = vi.fn();

  const slices = {
    status: {
      isInitialized: true,
      isDatabaseLoaded: true,
      isLoading: false,
      error: 'database warning',
      databaseSource: 'local',
      databaseSourceState: {
        source: 'local',
        linkedFiles: {},
        lastLocalWriteTimestamp: null,
        lastCloudSyncTimestamp: null,
        lastCloudFileTimestamp: null,
        lastSyncError: null,
      },
      workerStatus: {
        isWorkerAlive: true,
        isConnected: true,
        dbStatus: 'connected',
        version: '1.0.0',
        lastHeartbeat: 123,
      },
    },
    collections: {
      transactionVersion: 0,
      categories: [{ id: 2, name: 'Housing' }],
      companies: [{ id: 3, name: 'Landlord LLC' }],
      accounts: [{ id: 4, name: 'Checking' }],
      projects: [{ id: 5, name: 'Kitchen Remodel' }],
      users: [{ id: 6, display_name: 'Pat' }],
      trips: [{ id: 7, name: 'Seattle' }],
      merchantRules: [],
      recurringSeries: [],
    },
    lifecycle: {
      createOrOpenDatabase: vi.fn(),
      loadDatabaseFromFile: vi.fn(),
      exportDatabase,
      connectCloudSource: vi.fn(),
      migrateDatabaseToCloud: vi.fn(),
      saveDatabaseToCurrentCloud: vi.fn(),
      switchToLocalSource: vi.fn(),
    },
    transactions: {
      addTransaction,
      getAllTransactionHashes: vi.fn(),
      truncateImportTable: vi.fn(),
      insertIntoTempTable: vi.fn(),
      deleteFromTempTable: vi.fn(),
      updateTempTransactionHashes: vi.fn(),
      checkDuplicateTransactions: vi.fn(),
      bulkInsertFromTempTable: vi.fn(),
      updateTransactionLabels: vi.fn(),
      applyTransactionClassifications: vi.fn(),
      generateTransactionHash: vi.fn(),
      getRecentTransactions: vi.fn(),
      getDashboardSummary: vi.fn(),
      getChartData: vi.fn(),
      getTransactionsPaginated: vi.fn(),
      getTransactionsForExport: vi.fn(),
      getAllProjectCosts: vi.fn(),
      getTransactionsByProjectPaginated: vi.fn(),
      getTransactionsByTripPaginated: vi.fn(),
    },
    categories: {
      addCategory,
    },
    companies: {
      addCompany,
    },
    accounts: {
      addAccount: vi.fn(),
      deleteAccount: vi.fn(),
      getAccountCards: vi.fn(),
      addAccountCard: vi.fn(),
      deleteAccountCard: vi.fn(),
      findAccountsByLastFour: vi.fn(),
    },
    projects: {
      addProject: vi.fn(),
      updateProject: vi.fn(),
      deleteProject: vi.fn(),
    },
    users: {
      addUser: vi.fn(),
      updateUser: vi.fn(),
      deleteUser: vi.fn(),
    },
    trips: {
      addTrip: vi.fn(),
      updateTrip: vi.fn(),
      deleteTrip: vi.fn(),
    },
    diagnostics: {
      executeCustomQuery: vi.fn(),
    },
    subscriptions: {
      runSubscriptionScan: vi.fn(),
      addMerchantRule: vi.fn(),
      updateMerchantRule: vi.fn(),
      deleteMerchantRule: vi.fn(),
      previewMerchantRuleMatches: vi.fn(),
      updateRecurringSeries: vi.fn(),
      updateRecurringSeriesStatus: vi.fn(),
      deleteRecurringSeries: vi.fn(),
      getSeriesTransactions: vi.fn(),
      getUnmatchedRecurringClusters: vi.fn(),
      reseedCommunityRules: vi.fn(),
      getMerchantRuleCounts: vi.fn(),
      getMerchantRulesSeedVersion: vi.fn(),
    },
  } as const;

  mockedUseDatabaseStatus.mockReturnValue(slices.status as never);
  mockedUseDatabaseCollections.mockReturnValue(slices.collections as never);
  mockedUseDatabaseLifecycle.mockReturnValue(slices.lifecycle as never);
  mockedUseDatabaseTransactions.mockReturnValue(slices.transactions as never);
  mockedUseDatabaseCategories.mockReturnValue(slices.categories as never);
  mockedUseDatabaseCompanies.mockReturnValue(slices.companies as never);
  mockedUseDatabaseAccounts.mockReturnValue(slices.accounts as never);
  mockedUseDatabaseProjects.mockReturnValue(slices.projects as never);
  mockedUseDatabaseUsers.mockReturnValue(slices.users as never);
  mockedUseDatabaseTrips.mockReturnValue(slices.trips as never);
  mockedUseDatabaseDiagnostics.mockReturnValue(slices.diagnostics as never);
  mockedUseDatabaseSubscriptions.mockReturnValue(slices.subscriptions as never);

  return slices;
}

describe('useDatabaseSlices', () => {
  beforeEach(() => {
    mockedUseDatabaseAccounts.mockReset();
    mockedUseDatabaseCategories.mockReset();
    mockedUseDatabaseCollections.mockReset();
    mockedUseDatabaseCompanies.mockReset();
    mockedUseDatabaseDiagnostics.mockReset();
    mockedUseDatabaseLifecycle.mockReset();
    mockedUseDatabaseProjects.mockReset();
    mockedUseDatabaseStatus.mockReset();
    mockedUseDatabaseSubscriptions.mockReset();
    mockedUseDatabaseTransactions.mockReset();
    mockedUseDatabaseTrips.mockReset();
    mockedUseDatabaseUsers.mockReset();
  });

  it('maps the app shell slice from grouped status state', () => {
    mockDatabaseHooks();

    const { result } = renderHook(() => useAppShellSlice());

    expect(result.current).toEqual({
      isDatabaseLoaded: true,
      workerStatus: expect.objectContaining({
        isWorkerAlive: true,
        dbStatus: 'connected',
      }),
    });
  });

  it('maps dashboard data from grouped collection and lifecycle slices', () => {
    const slices = mockDatabaseHooks();

    const { result } = renderHook(() => useDashboardSlice());

    expect(result.current.transactionVersion).toBe(slices.collections.transactionVersion);
    expect(result.current.categories).toBe(slices.collections.categories);
    expect(result.current.accounts).toBe(slices.collections.accounts);
    expect(result.current.users).toBe(slices.collections.users);
    expect(result.current.exportDatabase).toBe(slices.lifecycle.exportDatabase);
    expect(result.current.getRecentTransactions).toBe(slices.transactions.getRecentTransactions);
    expect(result.current.getDashboardSummary).toBe(slices.transactions.getDashboardSummary);
    expect(result.current.getChartData).toBe(slices.transactions.getChartData);
  });

  it('maps transaction composer actions from grouped transaction and catalog slices', () => {
    const slices = mockDatabaseHooks();

    const { result } = renderHook(() => useTransactionComposerSlice());

    expect(result.current.addTransaction).toBe(slices.transactions.addTransaction);
    expect(result.current.addCategory).toBe(slices.categories.addCategory);
    expect(result.current.addCompany).toBe(slices.companies.addCompany);
    expect(result.current.accounts).toBe(slices.collections.accounts);
    expect(result.current.projects).toBe(slices.collections.projects);
  });

  it('maps manage-data actions from grouped lifecycle and catalog slices', () => {
    const slices = mockDatabaseHooks();

    const { result } = renderHook(() => useManageDataSlice());

    expect(result.current.addCategory).toBe(slices.categories.addCategory);
    expect(result.current.addCompany).toBe(slices.companies.addCompany);
  });

  it('maps AI database tools from diagnostics, collections, and transaction slices', () => {
    const slices = mockDatabaseHooks();

    const { result } = renderHook(() => useAiDatabaseToolsSlice());

    expect(result.current.categories).toBe(slices.collections.categories);
    expect(result.current.companies).toBe(slices.collections.companies);
    expect(result.current.projects).toBe(slices.collections.projects);
    expect(result.current.trips).toBe(slices.collections.trips);
    expect(result.current.executeCustomQuery).toBe(slices.diagnostics.executeCustomQuery);
    expect(result.current.applyTransactionClassifications).toBe(
      slices.transactions.applyTransactionClassifications
    );
  });

  it('maps settings state from grouped lifecycle and status slices', () => {
    const slices = mockDatabaseHooks();

    const { result } = renderHook(() => useSettingsSlice());

    expect(result.current.exportDatabase).toBe(slices.lifecycle.exportDatabase);
    expect(result.current.connectCloudSource).toBe(
      slices.lifecycle.connectCloudSource
    );
    expect(result.current.databaseSource).toBe('local');
    expect(result.current.databaseSourceState).toBe(
      slices.status.databaseSourceState
    );
    expect(result.current.isDatabaseLoaded).toBe(true);
    expect(result.current.error).toBe('database warning');
  });
});