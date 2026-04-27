// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DatabaseService } from '../lib/databaseService';
import { SampleDataService } from '../lib/sampleDataService';
import { useDatabaseInitialization } from './useDatabaseInitialization';

vi.mock('../lib/databaseService', () => ({
  DatabaseService: vi.fn(),
}));

vi.mock('../lib/sampleDataService', () => ({
  SampleDataService: {
    shouldLoadSampleData: vi.fn(),
    loadAllSampleData: vi.fn(),
  },
}));

type MockService = {
  dbExistsBeforeInit: boolean;
  initialize: ReturnType<typeof vi.fn>;
  openExistingDatabase: ReturnType<typeof vi.fn>;
  createNewDatabase: ReturnType<typeof vi.fn>;
  loadDatabaseFromFile: ReturnType<typeof vi.fn>;
  getWorkerService: ReturnType<typeof vi.fn>;
};

const mockedDatabaseService = vi.mocked(DatabaseService);
const mockedShouldLoadSampleData = vi.mocked(
  SampleDataService.shouldLoadSampleData
);
const mockedLoadAllSampleData = vi.mocked(SampleDataService.loadAllSampleData);

const compatibleBrowserResults = {
  overallCompatible: true,
} as any;

function createServiceMock(overrides: Partial<MockService> = {}): MockService {
  const workerService = {
    onStatusChange: vi.fn(() => vi.fn()),
    destroy: vi.fn(),
  };

  return {
    dbExistsBeforeInit: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    openExistingDatabase: vi.fn().mockResolvedValue(undefined),
    createNewDatabase: vi.fn().mockResolvedValue(undefined),
    loadDatabaseFromFile: vi.fn().mockResolvedValue(undefined),
    getWorkerService: vi.fn(() => workerService),
    ...overrides,
  };
}

describe('useDatabaseInitialization', () => {
  beforeEach(() => {
    localStorage.clear();
    mockedDatabaseService.mockReset();
    mockedShouldLoadSampleData.mockReset();
    mockedLoadAllSampleData.mockReset();
  });

  afterEach(() => {
    delete window.__budgetTrackerTestApi;
  });

  it('moves to browser testing when no cached compatibility result exists', async () => {
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );

    await waitFor(() => {
      expect(result.current.initializationState).toBe('testing-browser');
    });

    expect(mockedDatabaseService).not.toHaveBeenCalled();
  });

  it('uses cached compatible browser results to initialize and open an existing database', async () => {
    localStorage.setItem(
      'budgetApp_browserTestPassed',
      JSON.stringify(compatibleBrowserResults)
    );

    const service = createServiceMock({ dbExistsBeforeInit: true });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );

    await waitFor(() => {
      expect(result.current.initializationState).toBe('initialized');
    });

    expect(service.initialize).toHaveBeenCalledTimes(1);
    expect(service.getWorkerService).toHaveBeenCalledTimes(1);
    expect(service.openExistingDatabase).toHaveBeenCalledTimes(1);
    expect(loadAllData).toHaveBeenCalledWith(service);
    expect(result.current.databaseService).toBe(service);
  });

  it('creates a new database and loads sample data when requested', async () => {
    const service = createServiceMock({ dbExistsBeforeInit: false });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    mockedShouldLoadSampleData.mockReturnValue(true);
    mockedLoadAllSampleData.mockResolvedValue(undefined);
    const loadAllData = vi.fn().mockResolvedValue(undefined);

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );

    await waitFor(() => {
      expect(result.current.initializationState).toBe('testing-browser');
    });

    await act(async () => {
      await result.current.handleBrowserTestComplete(
        true,
        compatibleBrowserResults
      );
    });

    await waitFor(() => {
      expect(result.current.initializationState).toBe('needs-setup');
    });

    await act(async () => {
      await result.current.createOrOpenDatabase(true);
    });

    expect(service.createNewDatabase).toHaveBeenCalledTimes(1);
    expect(mockedShouldLoadSampleData).toHaveBeenCalledTimes(1);
    expect(mockedLoadAllSampleData).toHaveBeenCalledTimes(1);
    expect(loadAllData).toHaveBeenLastCalledWith(service);
    expect(result.current.initializationState).toBe('initialized');
    expect(result.current.isLoading).toBe(false);
  });

  it('loads a database file through the initialized service', async () => {
    const service = createServiceMock({ dbExistsBeforeInit: false });
    mockedDatabaseService.mockImplementation(
      () => service as unknown as DatabaseService
    );
    const loadAllData = vi.fn().mockResolvedValue(undefined);
    const file = new File(['db-bytes'], 'budget.db', {
      type: 'application/octet-stream',
    });

    const { result } = renderHook(() =>
      useDatabaseInitialization({ loadAllData })
    );

    await waitFor(() => {
      expect(result.current.initializationState).toBe('testing-browser');
    });

    await act(async () => {
      await result.current.handleBrowserTestComplete(
        true,
        compatibleBrowserResults
      );
    });

    await waitFor(() => {
      expect(result.current.initializationState).toBe('needs-setup');
    });

    await act(async () => {
      await result.current.loadDatabaseFromFile(file);
    });

    expect(service.loadDatabaseFromFile).toHaveBeenCalledWith(file);
    expect(loadAllData).toHaveBeenLastCalledWith(service);
    expect(result.current.initializationState).toBe('initialized');
  });
});