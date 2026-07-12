'use client';

import {
  useDatabaseAccounts,
  useDatabaseBudget,
  useDatabaseCategories,
  useDatabaseCollections,
  useDatabaseCompanies,
  useDatabaseDiagnostics,
  useDatabaseLifecycle,
  useDatabaseProjects,
  useDatabaseStatus,
  useDatabaseSubscriptions,
  useDatabaseTransactions,
  useDatabaseTrips,
  useDatabaseUsers,
} from './DatabaseContext';

export function useAppShellSlice() {
  const status = useDatabaseStatus();

  return {
    isDatabaseLoaded: status.isDatabaseLoaded,
    workerStatus: status.workerStatus,
  };
}

export function useSqlQuerySlice() {
  const diagnostics = useDatabaseDiagnostics();
  const status = useDatabaseStatus();

  return {
    executeCustomQuery: diagnostics.executeCustomQuery,
    isDatabaseLoaded: status.isDatabaseLoaded,
  };
}

export function useProjectsSlice() {
  const collections = useDatabaseCollections();
  const projects = useDatabaseProjects();
  const transactions = useDatabaseTransactions();

  return {
    projects: collections.projects,
    transactionVersion: collections.transactionVersion,
    getTransactionsByProjectPaginated: transactions.getTransactionsByProjectPaginated,
    getAllProjectCosts: transactions.getAllProjectCosts,
    addProject: projects.addProject,
    updateProject: projects.updateProject,
    deleteProject: projects.deleteProject,
  };
}

export function useTripsSlice() {
  const collections = useDatabaseCollections();
  const trips = useDatabaseTrips();

  return {
    trips: collections.trips,
    addTrip: trips.addTrip,
    updateTrip: trips.updateTrip,
    deleteTrip: trips.deleteTrip,
  };
}

export function useTransactionComposerSlice() {
  const transactions = useDatabaseTransactions();
  const categories = useDatabaseCategories();
  const companies = useDatabaseCompanies();
  const accountMethods = useDatabaseAccounts();
  const collections = useDatabaseCollections();

  return {
    addTransaction: transactions.addTransaction,
    addCategory: categories.addCategory,
    addCompany: companies.addCompany,
    categories: collections.categories,
    companies: collections.companies,
    accounts: collections.accounts,
    getAccountCards: accountMethods.getAccountCards,
    projects: collections.projects,
  };
}

export function useTransactionReportSlice() {
  const collections = useDatabaseCollections();
  const transactions = useDatabaseTransactions();

  return {
    transactionVersion: collections.transactionVersion,
    categories: collections.categories,
    companies: collections.companies,
    projects: collections.projects,
    accounts: collections.accounts,
    users: collections.users,
    trips: collections.trips,
    recurringSeries: collections.recurringSeries,
    getTransactionsPaginated: transactions.getTransactionsPaginated,
    getTransactionsForExport: transactions.getTransactionsForExport,
    setTransactionComment: transactions.setTransactionComment,
  };
}

export function useTransactionQuickActionsSlice() {
  const collections = useDatabaseCollections();
  const transactions = useDatabaseTransactions();
  const companies = useDatabaseCompanies();

  return {
    categories: collections.categories,
    companies: collections.companies,
    trips: collections.trips,
    recurringSeries: collections.recurringSeries,
    setTransactionCategory: transactions.setTransactionCategory,
    setTransactionCompany: transactions.setTransactionCompany,
    linkTransactionToSeries: transactions.linkTransactionToSeries,
    unlinkTransactionFromSeries: transactions.unlinkTransactionFromSeries,
    updateTransactionLabels: transactions.updateTransactionLabels,
    addCompany: companies.addCompany,
    updateCompany: companies.updateCompany,
  };
}

export function useTransactionLabelingSlice() {
  const collections = useDatabaseCollections();
  const transactions = useDatabaseTransactions();

  return {
    projects: collections.projects,
    trips: collections.trips,
    updateTransactionLabels: transactions.updateTransactionLabels,
  };
}

export function useAiDatabaseToolsSlice() {
  const collections = useDatabaseCollections();
  const diagnostics = useDatabaseDiagnostics();
  const transactions = useDatabaseTransactions();
  const subscriptions = useDatabaseSubscriptions();

  return {
    categories: collections.categories,
    companies: collections.companies,
    projects: collections.projects,
    trips: collections.trips,
    executeCustomQuery: diagnostics.executeCustomQuery,
    applyTransactionClassifications: transactions.applyTransactionClassifications,
    getUnmatchedRecurringClusters: subscriptions.getUnmatchedRecurringClusters,
    addMerchantRule: subscriptions.addMerchantRule,
    runSubscriptionScan: subscriptions.runSubscriptionScan,
  };
}

export function useCsvImportSlice() {
  const collections = useDatabaseCollections();
  const transactions = useDatabaseTransactions();
  const accounts = useDatabaseAccounts();
  const subscriptions = useDatabaseSubscriptions();

  return {
    accounts: collections.accounts,
    generateTransactionHash: transactions.generateTransactionHash,
    truncateImportTable: transactions.truncateImportTable,
    insertIntoTempTable: transactions.insertIntoTempTable,
    deleteFromTempTable: transactions.deleteFromTempTable,
    updateTempTransactionHashes: transactions.updateTempTransactionHashes,
    checkDuplicateTransactions: transactions.checkDuplicateTransactions,
    bulkInsertFromTempTable: transactions.bulkInsertFromTempTable,
    findAccountsByLastFour: accounts.findAccountsByLastFour,
    getAccountCards: accounts.getAccountCards,
    runSubscriptionScan: subscriptions.runSubscriptionScan,
  };
}

export function useSubscriptionsSlice() {
  const collections = useDatabaseCollections();
  const subscriptions = useDatabaseSubscriptions();

  return {
    transactionVersion: collections.transactionVersion,
    companies: collections.companies,
    merchantRules: collections.merchantRules,
    recurringSeries: collections.recurringSeries,
    runSubscriptionScan: subscriptions.runSubscriptionScan,
    addMerchantRule: subscriptions.addMerchantRule,
    updateMerchantRule: subscriptions.updateMerchantRule,
    deleteMerchantRule: subscriptions.deleteMerchantRule,
    previewMerchantRuleMatches: subscriptions.previewMerchantRuleMatches,
    updateRecurringSeries: subscriptions.updateRecurringSeries,
    updateRecurringSeriesStatus: subscriptions.updateRecurringSeriesStatus,
    deleteRecurringSeries: subscriptions.deleteRecurringSeries,
    getRecurringSeriesWithStats: subscriptions.getRecurringSeriesWithStats,
    getTransactionsByIds: subscriptions.getTransactionsByIds,
    getSeriesTransactions: subscriptions.getSeriesTransactions,
    getUnmatchedRecurringClusters: subscriptions.getUnmatchedRecurringClusters,
  };
}

export function useDashboardSlice() {
  const collections = useDatabaseCollections();
  const lifecycle = useDatabaseLifecycle();
  const transactions = useDatabaseTransactions();
  const budgets = useDatabaseBudget();

  return {
    transactionVersion: collections.transactionVersion,
    budgetVersion: collections.budgetVersion,
    categories: collections.categories,
    accounts: collections.accounts,
    users: collections.users,
    exportDatabase: lifecycle.exportDatabase,
    getRecentTransactions: transactions.getRecentTransactions,
    getDashboardSummary: transactions.getDashboardSummary,
    getChartData: transactions.getChartData,
    setTransactionComment: transactions.setTransactionComment,
    getBudgetStatus: budgets.getBudgetStatus,
  };
}

export function useBudgetPageSlice() {
  const collections = useDatabaseCollections();
  const budgets = useDatabaseBudget();

  return {
    categories: collections.categories,
    accounts: collections.accounts,
    users: collections.users,
    budgetVersion: collections.budgetVersion,
    transactionVersion: collections.transactionVersion,
    getBudgetPlans: budgets.getBudgetPlans,
    saveBudgetPlan: budgets.saveBudgetPlan,
    deleteBudgetPlan: budgets.deleteBudgetPlan,
    getEffectiveBudgetPlan: budgets.getEffectiveBudgetPlan,
    getBudgetStatus: budgets.getBudgetStatus,
    getIncomeSources: budgets.getIncomeSources,
    addIncomeSource: budgets.addIncomeSource,
    updateIncomeSource: budgets.updateIncomeSource,
    deleteIncomeSource: budgets.deleteIncomeSource,
  };
}

export function useAccountManagementSlice() {
  const collections = useDatabaseCollections();
  const accounts = useDatabaseAccounts();
  const users = useDatabaseUsers();

  return {
    accounts: collections.accounts,
    users: collections.users,
    addAccountWithCard: accounts.addAccountWithCard,
    deleteAccount: accounts.deleteAccount,
    addUser: users.addUser,
    updateUser: users.updateUser,
    deleteUser: users.deleteUser,
    getAccountCards: accounts.getAccountCards,
    addAccountCard: accounts.addAccountCard,
    deleteAccountCard: accounts.deleteAccountCard,
  };
}

export function useManageDataSlice() {
  const collections = useDatabaseCollections();
  const categories = useDatabaseCategories();
  const companies = useDatabaseCompanies();

  return {
    categories: collections.categories,
    companies: collections.companies,
    addCategory: categories.addCategory,
    addCompany: companies.addCompany,
    updateCompany: companies.updateCompany,
  };
}

export function useSettingsSlice() {
  const lifecycle = useDatabaseLifecycle();
  const status = useDatabaseStatus();
  const subscriptions = useDatabaseSubscriptions();

  return {
    exportDatabase: lifecycle.exportDatabase,
    reseedCommunityRules: subscriptions.reseedCommunityRules,
    getMerchantRuleCounts: subscriptions.getMerchantRuleCounts,
    getMerchantRulesSeedVersion: subscriptions.getMerchantRulesSeedVersion,
    connectCloudSource: lifecycle.connectCloudSource,
    migrateDatabaseToCloud: lifecycle.migrateDatabaseToCloud,
    saveDatabaseToCurrentCloud: lifecycle.saveDatabaseToCurrentCloud,
    switchToLocalSource: lifecycle.switchToLocalSource,
    setEncryptionPassword: lifecycle.setEncryptionPassword,
    clearEncryptionPassword: lifecycle.clearEncryptionPassword,
    isDatabaseLoaded: status.isDatabaseLoaded,
    databaseSource: status.databaseSource,
    databaseSourceState: status.databaseSourceState,
    error: status.error,
  };
}