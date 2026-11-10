'use client';

// Page-facing slices for statement import (schema v7). Re-exported from
// useDatabaseSlices.ts (the hub).

import {
  useDatabaseAccounts,
  useDatabaseClassification,
  useDatabaseCollections,
  useDatabaseImports,
  useDatabaseLoans,
  useDatabaseSubscriptions,
  useDatabaseUsers,
} from './DatabaseContext';

/**
 * The Import Wizard: reading a file is pure (src/lib/statementImport); this
 * is everything the wizard needs from the database to place, stage and commit
 * it. After the last file is committed the wizard runs `applyLoanRules` (loan
 * rules claim their payments first) and then `runSubscriptionScan`.
 */
export function useImportWizardSlice() {
  const collections = useDatabaseCollections();
  const imports = useDatabaseImports();
  const accounts = useDatabaseAccounts();
  const users = useDatabaseUsers();
  const classification = useDatabaseClassification();
  const subscriptions = useDatabaseSubscriptions();
  const loans = useDatabaseLoans();

  return {
    accounts: collections.accounts,
    users: collections.users,
    defaultCurrency: collections.currencyPreferences.defaultCurrency,
    // Inline account / person creation (mutations refresh the collections).
    addAccountWithCard: accounts.addAccountWithCard,
    addUser: users.addUser,
    getAccountCards: accounts.getAccountCards,
    // Saved layouts and what files call each account.
    findImportProfiles: imports.findImportProfiles,
    saveImportProfile: imports.saveImportProfile,
    recordImportProfileUse: imports.recordImportProfileUse,
    resolveImportAccounts: imports.resolveImportAccounts,
    addAccountIdentifier: imports.addAccountIdentifier,
    getAccountImportCoverage: imports.getAccountImportCoverage,
    // Staging, transfer / refund detection on the staged rows, commit.
    stageImportRows: imports.stageImportRows,
    discardStagedImport: imports.discardStagedImport,
    previewImportClassification: classification.previewImportClassification,
    decisionsForTransferPairs: classification.decisionsForTransferPairs,
    commitStagedImport: imports.commitStagedImport,
    undoImportBatch: imports.undoImportBatch,
    applyLoanRules: loans.applyLoanRules,
    runSubscriptionScan: subscriptions.runSubscriptionScan,
  };
}

/** Import history with undo, saved layouts and account identifiers. */
export function useImportManageSlice() {
  const collections = useDatabaseCollections();
  const imports = useDatabaseImports();
  const subscriptions = useDatabaseSubscriptions();

  return {
    accounts: collections.accounts,
    // Bumps whenever transactions change, so the history list knows to reload.
    transactionVersion: collections.transactionVersion,
    listImportBatches: imports.listImportBatches,
    getImportBatchImpact: imports.getImportBatchImpact,
    undoImportBatch: imports.undoImportBatch,
    // An undo removes rows the detected series were built from.
    runSubscriptionScan: subscriptions.runSubscriptionScan,
    listImportProfiles: imports.listImportProfiles,
    saveImportProfile: imports.saveImportProfile,
    deleteImportProfile: imports.deleteImportProfile,
    listAccountIdentifiers: imports.listAccountIdentifiers,
    addAccountIdentifier: imports.addAccountIdentifier,
    removeAccountIdentifier: imports.removeAccountIdentifier,
  };
}
