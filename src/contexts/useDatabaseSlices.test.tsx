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
  useDatabaseTransactions,
  useDatabaseTrips,
  useDatabaseUsers,
} from './DatabaseContext';
import {
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
      workerStatus: {
        isWorkerAlive: true,
        isConnected: true,
        dbStatus: 'connected',
        version: '1.0.0',
        lastHeartbeat: 123,
      },
    },
    collections: {
      transactions: [{ id: 1, description: 'Rent' }],
      categories: [{ id: 2, name: 'Housing' }],
      companies: [{ id: 3, name: 'Landlord LLC' }],
      accounts: [{ id: 4, name: 'Checking' }],
      projects: [{ id: 5, name: 'Kitchen Remodel' }],
      users: [{ id: 6, display_name: 'Pat' }],
      trips: [{ id: 7, name: 'Seattle' }],
    },
    lifecycle: {
      createOrOpenDatabase: vi.fn(),
      loadDatabaseFromFile: vi.fn(),
      exportDatabase,
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
      generateTransactionHash: vi.fn(),
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

    expect(result.current.transactions).toBe(slices.collections.transactions);
    expect(result.current.categories).toBe(slices.collections.categories);
    expect(result.current.accounts).toBe(slices.collections.accounts);
    expect(result.current.users).toBe(slices.collections.users);
    expect(result.current.exportDatabase).toBe(slices.lifecycle.exportDatabase);
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

  it('maps settings state from grouped lifecycle and status slices', () => {
    const slices = mockDatabaseHooks();

    const { result } = renderHook(() => useSettingsSlice());

    expect(result.current.exportDatabase).toBe(slices.lifecycle.exportDatabase);
    expect(result.current.isDatabaseLoaded).toBe(true);
    expect(result.current.error).toBe('database warning');
  });
});