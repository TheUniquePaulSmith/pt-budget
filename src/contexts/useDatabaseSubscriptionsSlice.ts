"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import type { SeedMerchantRulesResult } from '../lib/merchantRulesSeedService';
import type {
  MerchantRuleKind,
  MerchantRuleMatchType,
  RecurringSeries,
  RecurringSeriesStatus,
  SubscriptionScanSummary,
  Transaction,
  UnmatchedCluster,
} from '../types/database';

export interface MerchantRuleInput {
  pattern: string;
  match_type: MerchantRuleMatchType;
  merchant_name: string;
  service_name?: string | null;
  default_kind: MerchantRuleKind;
  priority?: number;
  notes?: string | null;
}

export interface MerchantRuleUpdate {
  pattern: string;
  match_type: MerchantRuleMatchType;
  priority: number;
  merchant_name: string;
  service_name?: string | null;
  default_kind: MerchantRuleKind;
  enabled: boolean;
  notes?: string | null;
}

export interface RecurringSeriesUpdate {
  name: string;
  kind: RecurringSeries['kind'];
  cadence: RecurringSeries['cadence'];
  expected_amount: number | null;
  status: RecurringSeriesStatus;
  notes?: string | null;
}

export interface RecurringSeriesCompanyInput {
  companyId?: number | null;
  companyName?: string | null;
}

export interface DatabaseSubscriptionsSlice {
  runSubscriptionScan: () => Promise<SubscriptionScanSummary>;
  addMerchantRule: (rule: MerchantRuleInput) => Promise<number>;
  updateMerchantRule: (id: number, updates: MerchantRuleUpdate) => Promise<void>;
  deleteMerchantRule: (id: number) => Promise<void>;
  previewMerchantRuleMatches: (rule: {
    pattern: string;
    match_type: MerchantRuleMatchType;
  }) => Promise<number>;
  updateRecurringSeries: (id: number, updates: RecurringSeriesUpdate) => Promise<void>;
  updateRecurringSeriesStatus: (id: number, status: RecurringSeriesStatus) => Promise<void>;
  setRecurringSeriesCompany: (id: number, input: RecurringSeriesCompanyInput) => Promise<void>;
  deleteRecurringSeries: (id: number) => Promise<void>;
  getRecurringSeriesWithStats: (range?: { startDate?: string; endDate?: string }) => Promise<RecurringSeries[]>;
  getTransactionsByIds: (ids: number[]) => Promise<Transaction[]>;
  getSeriesTransactions: (seriesId: number) => Promise<Transaction[]>;
  getUnmatchedRecurringClusters: (minOccurrences?: number) => Promise<UnmatchedCluster[]>;
  reseedCommunityRules: () => Promise<SeedMerchantRulesResult>;
  getMerchantRuleCounts: () => Promise<{ community: number; user: number }>;
  getMerchantRulesSeedVersion: () => Promise<number>;
}

type SubscriptionsService = Pick<
  DatabaseService,
  | 'runSubscriptionScan'
  | 'addMerchantRule'
  | 'updateMerchantRule'
  | 'deleteMerchantRule'
  | 'previewMerchantRuleMatches'
  | 'updateRecurringSeries'
  | 'updateRecurringSeriesStatus'
  | 'setRecurringSeriesCompany'
  | 'deleteRecurringSeries'
  | 'getRecurringSeriesWithStats'
  | 'getTransactionsByIds'
  | 'getSeriesTransactions'
  | 'getUnmatchedRecurringClusters'
  | 'seedCommunityMerchantRules'
  | 'getMerchantRuleCounts'
  | 'getMerchantRulesSeedVersion'
>;

interface UseDatabaseSubscriptionsSliceOptions {
  databaseService: SubscriptionsService | null;
  refreshTransactions: () => Promise<void>;
  refreshCompanies: () => Promise<void>;
  refreshMerchantRules: () => Promise<void>;
  refreshRecurringSeries: () => Promise<void>;
}

export function useDatabaseSubscriptionsSlice({
  databaseService,
  refreshTransactions,
  refreshCompanies,
  refreshMerchantRules,
  refreshRecurringSeries,
}: UseDatabaseSubscriptionsSliceOptions): DatabaseSubscriptionsSlice {
  const requireService = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    return databaseService;
  }, [databaseService]);

  const runSubscriptionScan = useCallback(async (): Promise<SubscriptionScanSummary> => {
    const summary = await requireService().runSubscriptionScan();
    // A scan can assign companies to transactions and create/update series
    await Promise.all([refreshTransactions(), refreshCompanies(), refreshRecurringSeries()]);
    return summary;
  }, [refreshCompanies, refreshRecurringSeries, refreshTransactions, requireService]);

  const addMerchantRule = useCallback(
    async (rule: MerchantRuleInput): Promise<number> => {
      const id = await requireService().addMerchantRule(rule);
      await refreshMerchantRules();
      return id;
    },
    [refreshMerchantRules, requireService]
  );

  const updateMerchantRule = useCallback(
    async (id: number, updates: MerchantRuleUpdate): Promise<void> => {
      await requireService().updateMerchantRule(id, updates);
      await refreshMerchantRules();
    },
    [refreshMerchantRules, requireService]
  );

  const deleteMerchantRule = useCallback(
    async (id: number): Promise<void> => {
      await requireService().deleteMerchantRule(id);
      await refreshMerchantRules();
    },
    [refreshMerchantRules, requireService]
  );

  const previewMerchantRuleMatches = useCallback(
    async (rule: { pattern: string; match_type: MerchantRuleMatchType }): Promise<number> =>
      requireService().previewMerchantRuleMatches(rule),
    [requireService]
  );

  const updateRecurringSeries = useCallback(
    async (id: number, updates: RecurringSeriesUpdate): Promise<void> => {
      await requireService().updateRecurringSeries(id, updates);
      await refreshRecurringSeries();
    },
    [refreshRecurringSeries, requireService]
  );

  const updateRecurringSeriesStatus = useCallback(
    async (id: number, status: RecurringSeriesStatus): Promise<void> => {
      await requireService().updateRecurringSeriesStatus(id, status);
      await refreshRecurringSeries();
    },
    [refreshRecurringSeries, requireService]
  );

  const setRecurringSeriesCompany = useCallback(
    async (id: number, input: RecurringSeriesCompanyInput): Promise<void> => {
      await requireService().setRecurringSeriesCompany(id, input);
      // A new company name may have created a row, so refresh both.
      await Promise.all([refreshRecurringSeries(), refreshCompanies()]);
    },
    [refreshCompanies, refreshRecurringSeries, requireService]
  );

  const deleteRecurringSeries = useCallback(
    async (id: number): Promise<void> => {
      await requireService().deleteRecurringSeries(id);
      await refreshRecurringSeries();
    },
    [refreshRecurringSeries, requireService]
  );

  const getRecurringSeriesWithStats = useCallback(
    async (range?: { startDate?: string; endDate?: string }): Promise<RecurringSeries[]> =>
      requireService().getRecurringSeriesWithStats(range),
    [requireService]
  );

  const getTransactionsByIds = useCallback(
    async (ids: number[]): Promise<Transaction[]> => requireService().getTransactionsByIds(ids),
    [requireService]
  );

  const getSeriesTransactions = useCallback(
    async (seriesId: number): Promise<Transaction[]> =>
      requireService().getSeriesTransactions(seriesId),
    [requireService]
  );

  const getUnmatchedRecurringClusters = useCallback(
    async (minOccurrences?: number): Promise<UnmatchedCluster[]> =>
      requireService().getUnmatchedRecurringClusters(minOccurrences),
    [requireService]
  );

  const reseedCommunityRules = useCallback(async (): Promise<SeedMerchantRulesResult> => {
    const result = await requireService().seedCommunityMerchantRules(true);
    await refreshMerchantRules();
    return result;
  }, [refreshMerchantRules, requireService]);

  const getMerchantRuleCounts = useCallback(
    async () => requireService().getMerchantRuleCounts(),
    [requireService]
  );

  const getMerchantRulesSeedVersion = useCallback(
    async () => requireService().getMerchantRulesSeedVersion(),
    [requireService]
  );

  return useMemo(
    () => ({
      runSubscriptionScan,
      addMerchantRule,
      updateMerchantRule,
      deleteMerchantRule,
      previewMerchantRuleMatches,
      updateRecurringSeries,
      updateRecurringSeriesStatus,
      setRecurringSeriesCompany,
      deleteRecurringSeries,
      getRecurringSeriesWithStats,
      getTransactionsByIds,
      getSeriesTransactions,
      getUnmatchedRecurringClusters,
      reseedCommunityRules,
      getMerchantRuleCounts,
      getMerchantRulesSeedVersion,
    }),
    [
      runSubscriptionScan,
      addMerchantRule,
      updateMerchantRule,
      deleteMerchantRule,
      previewMerchantRuleMatches,
      updateRecurringSeries,
      updateRecurringSeriesStatus,
      setRecurringSeriesCompany,
      deleteRecurringSeries,
      getRecurringSeriesWithStats,
      getTransactionsByIds,
      getSeriesTransactions,
      getUnmatchedRecurringClusters,
      reseedCommunityRules,
      getMerchantRuleCounts,
      getMerchantRulesSeedVersion,
    ]
  );
}
