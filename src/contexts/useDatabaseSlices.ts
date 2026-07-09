'use client';

import {
  useDatabaseAccounts,
  useDatabaseCategories,
  useDatabaseCollections,
  useDatabaseCompanies,
  useDatabaseDiagnostics,
  useDatabaseLifecycle,
  useDatabaseProjects,
  useDatabaseStatus,
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
  const collections = useDatabaseCollections();

  return {
    addTransaction: transactions.addTransaction,
    addCategory: categories.addCategory,
    addCompany: companies.addCompany,
    categories: collections.categories,
    companies: collections.companies,
    accounts: collections.accounts,
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
    getTransactionsPaginated: transactions.getTransactionsPaginated,
    getTransactionsForExport: transactions.getTransactionsForExport,
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

  return {
    categories: collections.categories,
    companies: collections.companies,
    projects: collections.projects,
    trips: collections.trips,
    executeCustomQuery: diagnostics.executeCustomQuery,
    applyTransactionClassifications: transactions.applyTransactionClassifications,
  };
}

export function useCsvImportSlice() {
  const collections = useDatabaseCollections();
  const transactions = useDatabaseTransactions();
  const accounts = useDatabaseAccounts();

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
  };
}

export function useDashboardSlice() {
  const collections = useDatabaseCollections();
  const lifecycle = useDatabaseLifecycle();
  const transactions = useDatabaseTransactions();

  return {
    transactionVersion: collections.transactionVersion,
    categories: collections.categories,
    accounts: collections.accounts,
    users: collections.users,
    exportDatabase: lifecycle.exportDatabase,
    getRecentTransactions: transactions.getRecentTransactions,
    getDashboardSummary: transactions.getDashboardSummary,
    getChartData: transactions.getChartData,
  };
}

export function useAccountManagementSlice() {
  const collections = useDatabaseCollections();
  const accounts = useDatabaseAccounts();
  const users = useDatabaseUsers();

  return {
    accounts: collections.accounts,
    users: collections.users,
    addAccount: accounts.addAccount,
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
  };
}

export function useSettingsSlice() {
  const lifecycle = useDatabaseLifecycle();
  const status = useDatabaseStatus();

  return {
    exportDatabase: lifecycle.exportDatabase,
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