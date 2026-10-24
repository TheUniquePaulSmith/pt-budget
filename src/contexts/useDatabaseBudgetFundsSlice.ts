"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import type { BudgetFundLink } from '../types/database';
import type { BudgetFundStatus } from '../types/budgetCarry';

/**
 * Provider-domain slice for savings funds (projects/trips linked to a budget
 * category, schema v3). Owned by the budgets feature.
 */
export interface DatabaseBudgetFundsSlice {
  listLinkedFunds: () => Promise<BudgetFundLink[]>;
  getFundSpendSince: (
    entityType: BudgetFundLink['entity_type'],
    entityId: number,
    month: string
  ) => Promise<number>;
  /** Every linked fund with contributed / spent / balance as of a month ('YYYY-MM'). */
  getFundStatus: (month: string) => Promise<BudgetFundStatus[]>;
}

type BudgetFundsService = Pick<DatabaseService, 'budgetFunds'>;

interface UseDatabaseBudgetFundsSliceOptions {
  databaseService: BudgetFundsService | null;
}

export function useDatabaseBudgetFundsSlice({
  databaseService,
}: UseDatabaseBudgetFundsSliceOptions): DatabaseBudgetFundsSlice {
  const requireService = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    return databaseService.budgetFunds;
  }, [databaseService]);

  const listLinkedFunds = useCallback(async () => requireService().listLinkedFunds(), [requireService]);

  const getFundSpendSince = useCallback(
    async (entityType: BudgetFundLink['entity_type'], entityId: number, month: string) =>
      requireService().getSpendSince(entityType, entityId, month),
    [requireService]
  );

  const getFundStatus = useCallback(
    async (month: string) => requireService().getFundStatus(month),
    [requireService]
  );

  return useMemo(
    () => ({ listLinkedFunds, getFundSpendSince, getFundStatus }),
    [getFundSpendSince, getFundStatus, listLinkedFunds]
  );
}
