'use client';

// Page-facing slices for the AI feature's tool registry, provider setup and
// tool execution. Re-exported from useDatabaseSlices.ts (the hub); owned by
// the AI agent.

import { useMemo } from 'react';

import type { AiDatabaseToolContext } from '@/lib/aiDatabaseTools';
import type { AiWriteMode } from '@/types/ai';
import {
  useDatabaseAiTools,
  useDatabaseBudget,
  useDatabaseCategories,
  useDatabaseCollections,
  useDatabaseDiagnostics,
  useDatabaseNotifications,
  useDatabaseStatus,
  useDatabaseSubscriptions,
  useDatabaseTransactions,
} from './DatabaseContext';

/** Tools tab: packs and per-tool enable/consent settings. */
export function useAiToolsSlice() {
  const aiTools = useDatabaseAiTools();
  const status = useDatabaseStatus();

  return useMemo(
    () => ({
      isDatabaseLoaded: status.isDatabaseLoaded,
      listToolPacks: aiTools.listToolPacks,
      getToolPack: aiTools.getToolPack,
      upsertToolPack: aiTools.upsertToolPack,
      setToolPackEnabled: aiTools.setToolPackEnabled,
      deleteToolPack: aiTools.deleteToolPack,
      listToolSettings: aiTools.listToolSettings,
      upsertToolSetting: aiTools.upsertToolSetting,
      deleteToolSetting: aiTools.deleteToolSetting,
      getToolCallLimit: aiTools.getToolCallLimit,
      setToolCallLimit: aiTools.setToolCallLimit,
    }),
    [aiTools, status.isDatabaseLoaded]
  );
}

/** Provider setup (Local / Cloud): the encrypted-DB-backed profile document. */
export function useAiProviderSlice() {
  const aiTools = useDatabaseAiTools();
  const status = useDatabaseStatus();

  return useMemo(
    () => ({
      isDatabaseLoaded: status.isDatabaseLoaded,
      getAiProviderConfig: aiTools.getAiProviderConfig,
      setAiProviderConfig: aiTools.setAiProviderConfig,
      clearAiProviderConfig: aiTools.clearAiProviderConfig,
    }),
    [aiTools, status.isDatabaseLoaded]
  );
}

/**
 * Everything the chat loop's tools can touch: the six original tool
 * capabilities plus the slice methods behind the extended built-in tools and
 * JSON pack execution. The write mode (review | autoApply) is supplied by the
 * caller so classification staging keeps its existing behaviour.
 */
export function useAiToolExecutionSlice(writeMode: AiWriteMode): AiDatabaseToolContext {
  const collections = useDatabaseCollections();
  const diagnostics = useDatabaseDiagnostics();
  const transactions = useDatabaseTransactions();
  const subscriptions = useDatabaseSubscriptions();
  const categories = useDatabaseCategories();
  const budget = useDatabaseBudget();
  const notifications = useDatabaseNotifications();
  const aiTools = useDatabaseAiTools();

  return useMemo<AiDatabaseToolContext>(
    () => ({
      categories: collections.categories,
      companies: collections.companies,
      projects: collections.projects,
      trips: collections.trips,
      accounts: collections.accounts,
      writeMode,
      executeCustomQuery: diagnostics.executeCustomQuery,
      applyTransactionClassifications: transactions.applyTransactionClassifications,
      getUnmatchedRecurringClusters: subscriptions.getUnmatchedRecurringClusters,
      getBudgetStatus: budget.getBudgetStatus,
      addTransaction: transactions.addTransaction,
      updateTransaction: transactions.updateTransaction,
      deleteTransaction: transactions.deleteTransaction,
      addCategory: categories.addCategory,
      setTransactionCategory: transactions.setTransactionCategory,
      createNotification: notifications.createNotification,
      executeToolPackSql: aiTools.executeToolPackSql,
    }),
    [
      aiTools.executeToolPackSql,
      budget.getBudgetStatus,
      categories.addCategory,
      collections.accounts,
      collections.categories,
      collections.companies,
      collections.projects,
      collections.trips,
      diagnostics.executeCustomQuery,
      notifications.createNotification,
      subscriptions.getUnmatchedRecurringClusters,
      transactions.addTransaction,
      transactions.applyTransactionClassifications,
      transactions.deleteTransaction,
      transactions.setTransactionCategory,
      transactions.updateTransaction,
      writeMode,
    ]
  );
}
