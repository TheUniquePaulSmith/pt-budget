"use client";

import { useCallback, useMemo, useState } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import type {
  Account,
  Category,
  Company,
  Project,
  Transaction,
  Trip,
  User,
} from '../types/database';

export interface DatabaseCollectionsSlice {
  transactions: Transaction[];
  categories: Category[];
  companies: Company[];
  accounts: Account[];
  projects: Project[];
  users: User[];
  trips: Trip[];
}

type CollectionDataService = Pick<
  DatabaseService,
  | 'getTransactions'
  | 'getCategories'
  | 'getCompanies'
  | 'getAccounts'
  | 'getProjects'
  | 'getUsers'
  | 'getTrips'
>;

interface UseDatabaseCollectionsStateOptions {
  getDatabaseService: () => CollectionDataService | null;
}

interface UseDatabaseCollectionsStateResult {
  collections: DatabaseCollectionsSlice;
  loadAllData: (service: CollectionDataService) => Promise<void>;
  refreshTransactions: () => Promise<void>;
  refreshCategories: () => Promise<void>;
  refreshCompanies: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshTrips: () => Promise<void>;
}

export function useDatabaseCollectionsState({
  getDatabaseService,
}: UseDatabaseCollectionsStateOptions): UseDatabaseCollectionsStateResult {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);

  const loadAllData = useCallback(async (service: CollectionDataService) => {
    try {
      const [
        transactionsData,
        categoriesData,
        companiesData,
        accountsData,
        projectsData,
        usersData,
        tripsData,
      ] = await Promise.all([
        service.getTransactions(),
        service.getCategories(),
        service.getCompanies(),
        service.getAccounts(),
        service.getProjects(),
        service.getUsers(),
        service.getTrips(),
      ]);

      setTransactions(transactionsData);
      setCategories(categoriesData);
      setCompanies(companiesData);
      setAccounts(accountsData);
      setProjects(projectsData);
      setUsers(usersData);
      setTrips(tripsData);
    } catch (err) {
      console.error('Failed to load data:', err);
      throw err;
    }
  }, []);

  const refreshTransactions = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) {
      return;
    }

    try {
      const data = await databaseService.getTransactions();
      setTransactions(data);
    } catch (err) {
      console.error('Failed to refresh transactions:', err);
    }
  }, [getDatabaseService]);

  const refreshCategories = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) {
      return;
    }

    try {
      const data = await databaseService.getCategories();
      setCategories(data);
    } catch (err) {
      console.error('Failed to refresh categories:', err);
    }
  }, [getDatabaseService]);

  const refreshCompanies = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) {
      return;
    }

    try {
      const data = await databaseService.getCompanies();
      setCompanies(data);
    } catch (err) {
      console.error('Failed to refresh companies:', err);
    }
  }, [getDatabaseService]);

  const refreshAccounts = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) {
      return;
    }

    try {
      const data = await databaseService.getAccounts();
      setAccounts(data);
    } catch (err) {
      console.error('Failed to refresh accounts:', err);
    }
  }, [getDatabaseService]);

  const refreshProjects = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) {
      return;
    }

    try {
      const data = await databaseService.getProjects();
      setProjects(data);
    } catch (err) {
      console.error('Failed to refresh projects:', err);
    }
  }, [getDatabaseService]);

  const refreshUsers = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) {
      return;
    }

    try {
      const data = await databaseService.getUsers();
      setUsers(data);
    } catch (err) {
      console.error('Failed to refresh users:', err);
    }
  }, [getDatabaseService]);

  const refreshTrips = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) {
      return;
    }

    try {
      const data = await databaseService.getTrips();
      setTrips(data);
    } catch (err) {
      console.error('Failed to refresh trips:', err);
    }
  }, [getDatabaseService]);

  const collections = useMemo(
    () => ({
      transactions,
      categories,
      companies,
      accounts,
      projects,
      users,
      trips,
    }),
    [transactions, categories, companies, accounts, projects, users, trips]
  );

  return {
    collections,
    loadAllData,
    refreshTransactions,
    refreshCategories,
    refreshCompanies,
    refreshAccounts,
    refreshProjects,
    refreshUsers,
    refreshTrips,
  };
}