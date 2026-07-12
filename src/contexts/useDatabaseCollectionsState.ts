"use client";

import { useCallback, useMemo, useState } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import type {
  Account,
  Category,
  Company,
  MerchantRule,
  Project,
  RecurringSeries,
  Trip,
  User,
} from '../types/database';

export interface DatabaseCollectionsSlice {
  transactionVersion: number;
  budgetVersion: number;
  categories: Category[];
  companies: Company[];
  accounts: Account[];
  projects: Project[];
  users: User[];
  trips: Trip[];
  merchantRules: MerchantRule[];
  recurringSeries: RecurringSeries[];
}

type CollectionDataService = Pick<
  DatabaseService,
  | 'getCategories'
  | 'getCompanies'
  | 'getAccounts'
  | 'getProjects'
  | 'getUsers'
  | 'getTrips'
  | 'getMerchantRules'
  | 'getRecurringSeriesWithStats'
  | 'seedCommunityMerchantRules'
>;

interface UseDatabaseCollectionsStateOptions {
  getDatabaseService: () => CollectionDataService | null;
}

interface UseDatabaseCollectionsStateResult {
  collections: DatabaseCollectionsSlice;
  loadAllData: (service: CollectionDataService) => Promise<void>;
  refreshTransactions: () => Promise<void>;
  refreshBudgets: () => Promise<void>;
  refreshCategories: () => Promise<void>;
  refreshCompanies: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshTrips: () => Promise<void>;
  refreshMerchantRules: () => Promise<void>;
  refreshRecurringSeries: () => Promise<void>;
}

export function useDatabaseCollectionsState({
  getDatabaseService,
}: UseDatabaseCollectionsStateOptions): UseDatabaseCollectionsStateResult {
  const [transactionVersion, setTransactionVersion] = useState(0);
  const [budgetVersion, setBudgetVersion] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [merchantRules, setMerchantRules] = useState<MerchantRule[]>([]);
  const [recurringSeries, setRecurringSeries] = useState<RecurringSeries[]>([]);

  const loadAllData = useCallback(async (service: CollectionDataService) => {
    // Seed/refresh the bundled community merchant rules before reading
    // collections. loadAllData is the single choke point every open path
    // (new, existing, cloud, source switch) passes through. Non-fatal: the
    // app must still load if the bundled JSON cannot be fetched.
    try {
      await service.seedCommunityMerchantRules();
    } catch (err) {
      console.warn('Failed to seed community merchant rules:', err);
    }

    try {
      const [
        categoriesData,
        companiesData,
        accountsData,
        projectsData,
        usersData,
        tripsData,
        merchantRulesData,
        recurringSeriesData,
      ] = await Promise.all([
        service.getCategories(),
        service.getCompanies(),
        service.getAccounts(),
        service.getProjects(),
        service.getUsers(),
        service.getTrips(),
        service.getMerchantRules(),
        service.getRecurringSeriesWithStats(),
      ]);

      setCategories(categoriesData);
      setCompanies(companiesData);
      setAccounts(accountsData);
      setProjects(projectsData);
      setUsers(usersData);
      setTrips(tripsData);
      setMerchantRules(merchantRulesData);
      setRecurringSeries(recurringSeriesData);
    } catch (err) {
      console.error('Failed to load data:', err);
      throw err;
    }
  }, []);

  // Incrementing transactionVersion signals components to re-fetch transaction data from the DB.
  const refreshTransactions = useCallback(async () => {
    setTransactionVersion(v => v + 1);
  }, []);

  const refreshBudgets = useCallback(async () => {
    setBudgetVersion(v => v + 1);
  }, []);

  const refreshCategories = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) return;

    try {
      const data = await databaseService.getCategories();
      setCategories(data);
    } catch (err) {
      console.error('Failed to refresh categories:', err);
    }
  }, [getDatabaseService]);

  const refreshCompanies = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) return;

    try {
      const data = await databaseService.getCompanies();
      setCompanies(data);
    } catch (err) {
      console.error('Failed to refresh companies:', err);
    }
  }, [getDatabaseService]);

  const refreshAccounts = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) return;

    try {
      const data = await databaseService.getAccounts();
      setAccounts(data);
    } catch (err) {
      console.error('Failed to refresh accounts:', err);
    }
  }, [getDatabaseService]);

  const refreshProjects = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) return;

    try {
      const data = await databaseService.getProjects();
      setProjects(data);
    } catch (err) {
      console.error('Failed to refresh projects:', err);
    }
  }, [getDatabaseService]);

  const refreshUsers = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) return;

    try {
      const data = await databaseService.getUsers();
      setUsers(data);
    } catch (err) {
      console.error('Failed to refresh users:', err);
    }
  }, [getDatabaseService]);

  const refreshTrips = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) return;

    try {
      const data = await databaseService.getTrips();
      setTrips(data);
    } catch (err) {
      console.error('Failed to refresh trips:', err);
    }
  }, [getDatabaseService]);

  const refreshMerchantRules = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) return;

    try {
      const data = await databaseService.getMerchantRules();
      setMerchantRules(data);
    } catch (err) {
      console.error('Failed to refresh merchant rules:', err);
    }
  }, [getDatabaseService]);

  const refreshRecurringSeries = useCallback(async () => {
    const databaseService = getDatabaseService();
    if (!databaseService) return;

    try {
      const data = await databaseService.getRecurringSeriesWithStats();
      setRecurringSeries(data);
    } catch (err) {
      console.error('Failed to refresh recurring series:', err);
    }
  }, [getDatabaseService]);

  const collections = useMemo(
    () => ({
      transactionVersion,
      budgetVersion,
      categories,
      companies,
      accounts,
      projects,
      users,
      trips,
      merchantRules,
      recurringSeries,
    }),
    [transactionVersion, budgetVersion, categories, companies, accounts, projects, users, trips, merchantRules, recurringSeries]
  );

  return {
    collections,
    loadAllData,
    refreshTransactions,
    refreshBudgets,
    refreshCategories,
    refreshCompanies,
    refreshAccounts,
    refreshProjects,
    refreshUsers,
    refreshTrips,
    refreshMerchantRules,
    refreshRecurringSeries,
  };
}
