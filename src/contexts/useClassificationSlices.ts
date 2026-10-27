'use client';

// Page-facing slices for transaction classification (schema v4): type rules
// and the scan on the Transactions page, the manual transfer actions in the
// row menu, and the detection step of the CSV import. Re-exported from
// useDatabaseSlices.ts (the hub).

import { useDatabaseClassification, useDatabaseCollections } from './DatabaseContext';

/** Transactions page: rules management, the on-demand scan and the review count. */
export function useClassificationRulesSlice() {
  const collections = useDatabaseCollections();
  const classification = useDatabaseClassification();

  return {
    accounts: collections.accounts,
    classificationRules: collections.classificationRules,
    transactionVersion: collections.transactionVersion,
    addClassificationRule: classification.addClassificationRule,
    updateClassificationRule: classification.updateClassificationRule,
    deleteClassificationRule: classification.deleteClassificationRule,
    previewClassificationRuleMatches: classification.previewClassificationRuleMatches,
    runClassificationScan: classification.runClassificationScan,
    countTypeReviews: classification.countTypeReviews,
  };
}

/** Row menu and dialogs: confirm an automatic type, link or unlink a transfer. */
export function useTransactionTypeActionsSlice() {
  const collections = useDatabaseCollections();
  const classification = useDatabaseClassification();

  return {
    accounts: collections.accounts,
    confirmTransactionType: classification.confirmTransactionType,
    linkTransfer: classification.linkTransfer,
    unlinkTransfer: classification.unlinkTransfer,
    getTransferCandidates: classification.getTransferCandidates,
    addClassificationRule: classification.addClassificationRule,
    previewClassificationRuleMatches: classification.previewClassificationRuleMatches,
  };
}

/** CSV import: detect transfers / refunds in the staged rows and apply the user's choice. */
export function useImportClassificationSlice() {
  const classification = useDatabaseClassification();

  return {
    previewImportClassification: classification.previewImportClassification,
    decisionsForTransferPairs: classification.decisionsForTransferPairs,
    applyStagedClassification: classification.applyStagedClassification,
    applyClassificationDecisions: classification.applyClassificationDecisions,
  };
}
