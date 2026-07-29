"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import type { Account, AccountCard, User } from '../types/database';

export interface DatabaseAccountSlice {
  addAccountWithCard: (
    account: Omit<Account, "id" | "created_at" | "updated_at" | "owner_user_id">,
    ownerUserId: number,
    card: Omit<AccountCard, 'id' | 'created_at' | 'updated_at' | 'account_id'>
  ) => Promise<{ accountId: number; cardId: number }>;
  deleteAccount: (id: number) => Promise<void>;
  updateAccount: (
    id: number,
    updates: Partial<Pick<Account, 'name' | 'type'>>
  ) => Promise<void>;
  getAccountCards: (accountId: number) => Promise<any[]>;
  addAccountCard: (card: {
    account_id: number;
    last_four: string;
    full_number?: string | null;
    nickname?: string;
    user_id?: number;
  }) => Promise<number>;
  deleteAccountCard: (id: number) => Promise<void>;
  updateAccountCard: (
    id: number,
    updates: Partial<Pick<AccountCard, 'last_four' | 'full_number' | 'nickname' | 'user_id'>>
  ) => Promise<void>;
  findAccountsByLastFour: (lastFour: string) => Promise<Account[]>;
  findAccountsByFullNumber: (fullNumber: string) => Promise<Account[]>;
}

export interface DatabaseUserSlice {
  addUser: (
    user: Omit<User, "id" | "created_at" | "updated_at" | "is_primary"> & Partial<Pick<User, "is_primary">>
  ) => Promise<number>;
  updateUser: (
    id: number,
    updates: Partial<Omit<User, "id" | "created_at" | "updated_at">>
  ) => Promise<void>;
  deleteUser: (id: number) => Promise<void>;
}

type AccountManagementService = Pick<
  DatabaseService,
  | 'addAccountWithCard'
  | 'deleteAccount'
  | 'updateAccount'
  | 'getAccountCards'
  | 'addAccountCard'
  | 'deleteAccountCard'
  | 'updateAccountCard'
  | 'findAccountsByLastFour'
  | 'findAccountsByFullNumber'
  | 'addUser'
  | 'updateUser'
  | 'deleteUser'
>;

interface UseDatabaseAccountManagementSlicesOptions {
  databaseService: AccountManagementService | null;
  refreshAccounts: () => Promise<void>;
  refreshUsers: () => Promise<void>;
}

export function useDatabaseAccountManagementSlices({
  databaseService,
  refreshAccounts,
  refreshUsers,
}: UseDatabaseAccountManagementSlicesOptions): {
  accountsSlice: DatabaseAccountSlice;
  usersSlice: DatabaseUserSlice;
} {
  const requireService = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    return databaseService;
  }, [databaseService]);

  const addAccountWithCard = useCallback(
    async (
      account: Omit<Account, "id" | "created_at" | "updated_at" | "owner_user_id">,
      ownerUserId: number,
      card: Omit<AccountCard, 'id' | 'created_at' | 'updated_at' | 'account_id'>
    ): Promise<{ accountId: number; cardId: number }> => {
      const result = await requireService().addAccountWithCard(account, ownerUserId, card);
      await refreshAccounts();
      return result;
    },
    [refreshAccounts, requireService]
  );

  const deleteAccount = useCallback(
    async (id: number): Promise<void> => {
      await requireService().deleteAccount(id);
      await refreshAccounts();
    },
    [refreshAccounts, requireService]
  );

  const updateAccount = useCallback(
    async (id: number, updates: Partial<Pick<Account, 'name' | 'type'>>): Promise<void> => {
      await requireService().updateAccount(id, updates);
      await refreshAccounts();
    },
    [refreshAccounts, requireService]
  );

  const getAccountCards = useCallback(
    async (accountId: number): Promise<any[]> => {
      return requireService().getAccountCards(accountId);
    },
    [requireService]
  );

  const addAccountCard = useCallback(
    async (card: {
      account_id: number;
      last_four: string;
      full_number?: string | null;
      nickname?: string;
      user_id?: number;
    }): Promise<number> => {
      const id = await requireService().addAccountCard(card);
      await refreshAccounts();
      return id;
    },
    [refreshAccounts, requireService]
  );

  const deleteAccountCard = useCallback(
    async (id: number): Promise<void> => {
      await requireService().deleteAccountCard(id);
      await refreshAccounts();
    },
    [refreshAccounts, requireService]
  );

  const updateAccountCard = useCallback(
    async (
      id: number,
      updates: Partial<Pick<AccountCard, 'last_four' | 'full_number' | 'nickname' | 'user_id'>>
    ): Promise<void> => {
      await requireService().updateAccountCard(id, updates);
      await refreshAccounts();
    },
    [refreshAccounts, requireService]
  );

  const findAccountsByLastFour = useCallback(
    async (lastFour: string): Promise<Account[]> => {
      return requireService().findAccountsByLastFour(lastFour);
    },
    [requireService]
  );

  const findAccountsByFullNumber = useCallback(
    async (fullNumber: string): Promise<Account[]> => {
      return requireService().findAccountsByFullNumber(fullNumber);
    },
    [requireService]
  );

  const addUser = useCallback(
    async (user: Omit<User, "id" | "created_at" | "updated_at" | "is_primary"> & Partial<Pick<User, "is_primary">>): Promise<number> => {
      const id = await requireService().addUser(user);
      await refreshUsers();
      return id;
    },
    [refreshUsers, requireService]
  );

  const updateUser = useCallback(
    async (
      id: number,
      updates: Partial<Omit<User, "id" | "created_at" | "updated_at">>
    ): Promise<void> => {
      await requireService().updateUser(id, updates);
      await refreshUsers();
    },
    [refreshUsers, requireService]
  );

  const deleteUser = useCallback(
    async (id: number): Promise<void> => {
      await requireService().deleteUser(id);
      await refreshUsers();
    },
    [refreshUsers, requireService]
  );

  const accountsSlice = useMemo(
    () => ({
      addAccountWithCard,
      deleteAccount,
      updateAccount,
      getAccountCards,
      addAccountCard,
      deleteAccountCard,
      updateAccountCard,
      findAccountsByLastFour,
      findAccountsByFullNumber,
    }),
    [
      addAccountWithCard,
      deleteAccount,
      updateAccount,
      getAccountCards,
      addAccountCard,
      deleteAccountCard,
      updateAccountCard,
      findAccountsByLastFour,
      findAccountsByFullNumber,
    ]
  );

  const usersSlice = useMemo(
    () => ({
      addUser,
      updateUser,
      deleteUser,
    }),
    [addUser, updateUser, deleteUser]
  );

  return {
    accountsSlice,
    usersSlice,
  };
}