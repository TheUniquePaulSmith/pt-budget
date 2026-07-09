// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Account, User } from '../types/database';
import { useDatabaseAccountManagementSlices } from './useDatabaseAccountManagementSlices';

type AccountInput = Omit<
  Account,
  'id' | 'created_at' | 'updated_at' | 'owner_user_id'
>;
type UserInput = Omit<User, 'id' | 'created_at' | 'updated_at'>;

function createServiceMock() {
  return {
    addAccount: vi.fn().mockResolvedValue(41),
    deleteAccount: vi.fn().mockResolvedValue(undefined),
    getAccountCards: vi.fn().mockResolvedValue([]),
    addAccountCard: vi.fn().mockResolvedValue(7),
    deleteAccountCard: vi.fn().mockResolvedValue(undefined),
    findAccountsByLastFour: vi.fn().mockResolvedValue([]),
    addUser: vi.fn().mockResolvedValue(9),
    updateUser: vi.fn().mockResolvedValue(undefined),
    deleteUser: vi.fn().mockResolvedValue(undefined),
  };
}

describe('useDatabaseAccountManagementSlices', () => {
  it('throws when account mutations run without an initialized service', async () => {
    const refreshAccounts = vi.fn().mockResolvedValue(undefined);
    const refreshUsers = vi.fn().mockResolvedValue(undefined);
    const account: AccountInput = {
      name: 'Checking',
      type: 'checking',
      balance: 1250,
      institution: 'Local Bank',
      currency: 'USD',
      is_active: true,
    } as AccountInput;

    const { result } = renderHook(() =>
      useDatabaseAccountManagementSlices({
        databaseService: null,
        refreshAccounts,
        refreshUsers,
      })
    );

    await expect(result.current.accountsSlice.addAccount(account, 1)).rejects.toThrow(
      'Database service not initialized'
    );
    expect(refreshAccounts).not.toHaveBeenCalled();
    expect(refreshUsers).not.toHaveBeenCalled();
  });

  it('refreshes cached accounts after adding an account card', async () => {
    const refreshAccounts = vi.fn().mockResolvedValue(undefined);
    const refreshUsers = vi.fn().mockResolvedValue(undefined);
    const service = createServiceMock();

    const { result } = renderHook(() =>
      useDatabaseAccountManagementSlices({
        databaseService: service,
        refreshAccounts,
        refreshUsers,
      })
    );

    let accountCardId = 0;
    await act(async () => {
      accountCardId = await result.current.accountsSlice.addAccountCard({
        account_id: 3,
        last_four: '4242',
        nickname: 'Travel Card',
      });
    });

    expect(service.addAccountCard).toHaveBeenCalledWith({
      account_id: 3,
      last_four: '4242',
      nickname: 'Travel Card',
    });
    expect(refreshAccounts).toHaveBeenCalledTimes(1);
    expect(accountCardId).toBe(7);
  });

  it('refreshes cached users after updating a user', async () => {
    const refreshAccounts = vi.fn().mockResolvedValue(undefined);
    const refreshUsers = vi.fn().mockResolvedValue(undefined);
    const service = createServiceMock();
    const updates: Partial<UserInput> = {
      display_name: 'Pat Doe',
      email: 'pat@example.com',
    };

    const { result } = renderHook(() =>
      useDatabaseAccountManagementSlices({
        databaseService: service,
        refreshAccounts,
        refreshUsers,
      })
    );

    await act(async () => {
      await result.current.usersSlice.updateUser(9, updates);
    });

    expect(service.updateUser).toHaveBeenCalledWith(9, updates);
    expect(refreshUsers).toHaveBeenCalledTimes(1);
    expect(refreshAccounts).not.toHaveBeenCalled();
  });
});

