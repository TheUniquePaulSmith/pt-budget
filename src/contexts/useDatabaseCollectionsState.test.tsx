// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDatabaseCollectionsState } from './useDatabaseCollectionsState';

function createServiceMock() {
  return {
    getCategories: vi.fn().mockResolvedValue([{ id: 2, name: 'Housing' }]),
    getCompanies: vi.fn().mockResolvedValue([{ id: 3, name: 'Landlord LLC' }]),
    getAccounts: vi.fn().mockResolvedValue([{ id: 4, name: 'Checking' }]),
    getProjects: vi.fn().mockResolvedValue([{ id: 5, name: 'Kitchen Remodel' }]),
    getUsers: vi.fn().mockResolvedValue([{ id: 6, display_name: 'Pat' }]),
    getTrips: vi.fn().mockResolvedValue([{ id: 7, name: 'Seattle' }]),
    getMerchantRules: vi.fn().mockResolvedValue([{ id: 8, rule_key: 'community:netflix' }]),
    getRecurringSeriesWithStats: vi.fn().mockResolvedValue([{ id: 9, name: 'Netflix' }]),
    getNotifications: vi.fn().mockResolvedValue([{ id: 10, title: 'Pay rent' }]),
    seedCommunityMerchantRules: vi.fn().mockResolvedValue({ skipped: true }),
    classification: {
      listRules: vi.fn().mockResolvedValue([{ id: 11, pattern: 'PYMT BY FUNDS TRANSFER' }]),
      runInitialScanIfNeeded: vi.fn().mockResolvedValue(null),
    },
  };
}

describe('useDatabaseCollectionsState', () => {
  it('loads all provider-backed collections with the supplied service', async () => {
    const service = createServiceMock();

    const { result } = renderHook(() =>
      useDatabaseCollectionsState({
        getDatabaseService: () => null,
      })
    );

    await act(async () => {
      await result.current.loadAllData(service);
    });

    expect(result.current.collections).toEqual({
      transactionVersion: 0,
      budgetVersion: 0,
      categories: [{ id: 2, name: 'Housing' }],
      companies: [{ id: 3, name: 'Landlord LLC' }],
      accounts: [{ id: 4, name: 'Checking' }],
      projects: [{ id: 5, name: 'Kitchen Remodel' }],
      users: [{ id: 6, display_name: 'Pat' }],
      trips: [{ id: 7, name: 'Seattle' }],
      merchantRules: [{ id: 8, rule_key: 'community:netflix' }],
      recurringSeries: [{ id: 9, name: 'Netflix' }],
      notifications: [{ id: 10, title: 'Pay rent' }],
      classificationRules: [{ id: 11, pattern: 'PYMT BY FUNDS TRANSFER' }],
    });
    expect(service.seedCommunityMerchantRules).toHaveBeenCalledTimes(1);
    // The one-time classification of pre-v4 rows runs on every open path (a no-op after the first).
    expect(service.classification.runInitialScanIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('still loads collections when the initial classification scan fails', async () => {
    const service = createServiceMock();
    service.classification.runInitialScanIfNeeded.mockRejectedValue(new Error('busy'));

    const { result } = renderHook(() =>
      useDatabaseCollectionsState({
        getDatabaseService: () => null,
      })
    );

    await act(async () => {
      await result.current.loadAllData(service);
    });

    expect(result.current.collections.classificationRules).toEqual([{ id: 11, pattern: 'PYMT BY FUNDS TRANSFER' }]);
  });

  it('still loads collections when community rule seeding fails', async () => {
    const service = createServiceMock();
    service.seedCommunityMerchantRules.mockRejectedValue(new Error('offline'));

    const { result } = renderHook(() =>
      useDatabaseCollectionsState({
        getDatabaseService: () => null,
      })
    );

    await act(async () => {
      await result.current.loadAllData(service);
    });

    expect(result.current.collections.categories).toEqual([{ id: 2, name: 'Housing' }]);
  });

  it('increments transactionVersion when refreshTransactions is called', async () => {
    const service = createServiceMock();

    const { result } = renderHook(() =>
      useDatabaseCollectionsState({
        getDatabaseService: () => service,
      })
    );

    await act(async () => {
      await result.current.loadAllData(service);
    });

    const versionBefore = result.current.collections.transactionVersion;

    await act(async () => {
      await result.current.refreshTransactions();
    });

    expect(result.current.collections.transactionVersion).toBe(versionBefore + 1);
  });

  it('no-ops refresh calls when no database service is available', async () => {
    const { result } = renderHook(() =>
      useDatabaseCollectionsState({
        getDatabaseService: () => null,
      })
    );

    await act(async () => {
      await result.current.refreshUsers();
    });

    expect(result.current.collections.users).toEqual([]);
  });
});
