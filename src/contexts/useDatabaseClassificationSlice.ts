"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import type {
  ClassificationRuleInput,
  MerchantRuleMatchType,
  TransactionType,
} from '../types/database';
import type {
  ClassificationScanSummary,
  ImportClassificationPreview,
  TransferCandidate,
  TransferPairPreview,
  TypeDecision,
} from '../types/classification';

/**
 * Provider-domain slice for transaction classification (schema v4): type
 * rules, the on-demand scan, the import-time preview and the manual
 * transfer actions. Mutations refresh the transaction list (and the rules
 * collection when a rule changes); the import methods leave refreshing to the
 * bulk insert that follows them.
 */
export interface DatabaseClassificationSlice {
  addClassificationRule: (input: ClassificationRuleInput) => Promise<number>;
  updateClassificationRule: (id: number, input: ClassificationRuleInput) => Promise<void>;
  deleteClassificationRule: (id: number) => Promise<void>;
  previewClassificationRuleMatches: (rule: {
    pattern: string;
    match_type: MerchantRuleMatchType;
    type: TransactionType;
    account_id?: number | null;
  }) => Promise<number>;
  runClassificationScan: () => Promise<ClassificationScanSummary>;
  countTypeReviews: () => Promise<number>;
  confirmTransactionType: (id: number) => Promise<void>;
  linkTransfer: (firstId: number, secondId: number) => Promise<void>;
  unlinkTransfer: (id: number) => Promise<void>;
  getTransferCandidates: (id: number) => Promise<TransferCandidate[]>;
  previewImportClassification: () => Promise<ImportClassificationPreview>;
  decisionsForTransferPairs: (pairs: TransferPairPreview[]) => TypeDecision[];
  applyStagedClassification: (decisions: TypeDecision[]) => Promise<number>;
  applyClassificationDecisions: (decisions: TypeDecision[]) => Promise<number>;
}

type ClassificationHost = Pick<DatabaseService, 'classification'>;

interface UseDatabaseClassificationSliceOptions {
  databaseService: ClassificationHost | null;
  refreshTransactions: () => Promise<void>;
  refreshClassificationRules: () => Promise<void>;
}

export function useDatabaseClassificationSlice({
  databaseService,
  refreshTransactions,
  refreshClassificationRules,
}: UseDatabaseClassificationSliceOptions): DatabaseClassificationSlice {
  const requireService = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }
    return databaseService.classification;
  }, [databaseService]);

  const addClassificationRule = useCallback(
    async (input: ClassificationRuleInput) => {
      const id = await requireService().addRule(input);
      await refreshClassificationRules();
      return id;
    },
    [refreshClassificationRules, requireService]
  );

  const updateClassificationRule = useCallback(
    async (id: number, input: ClassificationRuleInput) => {
      await requireService().updateRule(id, input);
      await refreshClassificationRules();
    },
    [refreshClassificationRules, requireService]
  );

  const deleteClassificationRule = useCallback(
    async (id: number) => {
      await requireService().deleteRule(id);
      await refreshClassificationRules();
    },
    [refreshClassificationRules, requireService]
  );

  const previewClassificationRuleMatches = useCallback(
    async (rule: { pattern: string; match_type: MerchantRuleMatchType; type: TransactionType; account_id?: number | null }) =>
      requireService().previewRuleMatches(rule),
    [requireService]
  );

  const runClassificationScan = useCallback(async () => {
    const summary = await requireService().runScan();
    await refreshTransactions();
    return summary;
  }, [refreshTransactions, requireService]);

  const countTypeReviews = useCallback(async () => requireService().countNeedsReview(), [requireService]);

  const confirmTransactionType = useCallback(
    async (id: number) => {
      await requireService().confirmType(id);
      await refreshTransactions();
    },
    [refreshTransactions, requireService]
  );

  const linkTransfer = useCallback(
    async (firstId: number, secondId: number) => {
      await requireService().linkTransfer(firstId, secondId);
      await refreshTransactions();
    },
    [refreshTransactions, requireService]
  );

  const unlinkTransfer = useCallback(
    async (id: number) => {
      await requireService().unlinkTransfer(id);
      await refreshTransactions();
    },
    [refreshTransactions, requireService]
  );

  const getTransferCandidates = useCallback(
    async (id: number) => requireService().getTransferCandidates(id),
    [requireService]
  );

  const previewImportClassification = useCallback(
    async () => requireService().previewImport(),
    [requireService]
  );

  const decisionsForTransferPairs = useCallback(
    (pairs: TransferPairPreview[]) => requireService().decisionsForPairs(pairs),
    [requireService]
  );

  const applyStagedClassification = useCallback(
    async (decisions: TypeDecision[]) => requireService().applyStagedDecisions(decisions),
    [requireService]
  );

  const applyClassificationDecisions = useCallback(
    async (decisions: TypeDecision[]) => requireService().applyDecisions(decisions),
    [requireService]
  );

  return useMemo(
    () => ({
      addClassificationRule,
      updateClassificationRule,
      deleteClassificationRule,
      previewClassificationRuleMatches,
      runClassificationScan,
      countTypeReviews,
      confirmTransactionType,
      linkTransfer,
      unlinkTransfer,
      getTransferCandidates,
      previewImportClassification,
      decisionsForTransferPairs,
      applyStagedClassification,
      applyClassificationDecisions,
    }),
    [
      addClassificationRule,
      updateClassificationRule,
      deleteClassificationRule,
      previewClassificationRuleMatches,
      runClassificationScan,
      countTypeReviews,
      confirmTransactionType,
      linkTransfer,
      unlinkTransfer,
      getTransferCandidates,
      previewImportClassification,
      decisionsForTransferPairs,
      applyStagedClassification,
      applyClassificationDecisions,
    ]
  );
}
