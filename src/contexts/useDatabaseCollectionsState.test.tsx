// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useDatabaseCollectionsState } from './useDatabaseCollectionsState';

function createServiceMock() {
  return {
    getTransactions: vi
      .fn()
      .mockResolvedValue([{ id: 1, description: 'Rent' }]),
    getCategories: vi.fn().mockResolvedValue([{ id: 2, name: 'Housing' }]),
    getCompanies: vi.fn().mockResolvedValue([{ id: 3, name: 'Landlord LLC' }]),
    getAccounts: vi.fn().mockResolvedValue([{ id: 4, name: 'Checking' }]),
    getProjects: vi.fn().mockResolvedValue([{ id: 5, name: 'Kitchen Remodel' }]),
    getUsers: vi.fn().mockResolvedValue([{ id: 6, display_name: 'Pat' }]),
    getTrips: vi.fn().mockResolvedValue([{ id: 7, name: 'Seattle' }]),
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
      transactions: [{ id: 1, description: 'Rent' }],
      categories: [{ id: 2, name: 'Housing' }],
      companies: [{ id: 3, name: 'Landlord LLC' }],
      accounts: [{ id: 4, name: 'Checking' }],
      projects: [{ id: 5, name: 'Kitchen Remodel' }],
      users: [{ id: 6, display_name: 'Pat' }],
      trips: [{ id: 7, name: 'Seattle' }],
    });
  });

  it('refreshes an individual collection from the active database service', async () => {
    const service = createServiceMock();
    service.getTransactions
      .mockResolvedValueOnce([{ id: 1, description: 'Rent' }])
      .mockResolvedValueOnce([{ id: 8, description: 'Updated transaction' }]);

    const { result } = renderHook(() =>
      useDatabaseCollectionsState({
        getDatabaseService: () => service,
      })
    );

    await act(async () => {
      await result.current.loadAllData(service);
    });

    await act(async () => {
      await result.current.refreshTransactions();
    });

    expect(service.getTransactions).toHaveBeenCalledTimes(2);
    expect(result.current.collections.transactions).toEqual([
      { id: 8, description: 'Updated transaction' },
    ]);
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