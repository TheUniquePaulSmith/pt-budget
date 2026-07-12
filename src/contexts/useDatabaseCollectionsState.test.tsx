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
    seedCommunityMerchantRules: vi.fn().mockResolvedValue({ skipped: true }),
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
      categories: [{ id: 2, name: 'Housing' }],
      companies: [{ id: 3, name: 'Landlord LLC' }],
      accounts: [{ id: 4, name: 'Checking' }],
      projects: [{ id: 5, name: 'Kitchen Remodel' }],
      users: [{ id: 6, display_name: 'Pat' }],
      trips: [{ id: 7, name: 'Seattle' }],
      merchantRules: [{ id: 8, rule_key: 'community:netflix' }],
      recurringSeries: [{ id: 9, name: 'Netflix' }],
    });
    expect(service.seedCommunityMerchantRules).toHaveBeenCalledTimes(1);
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
