"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import type { BudgetFundLink } from '../types/database';

/**
 * Provider-domain slice for savings funds (projects/trips linked to a budget
 * category, schema v3). Owned by the budgets feature after the foundation
 * lands; fund balance math is added there.
 */
export interface DatabaseBudgetFundsSlice {
  listLinkedFunds: () => Promise<BudgetFundLink[]>;
  getFundSpendSince: (
    entityType: BudgetFundLink['entity_type'],
    entityId: number,
    month: string
  ) => Promise<number>;
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

  return useMemo(() => ({ listLinkedFunds, getFundSpendSince }), [getFundSpendSince, listLinkedFunds]);
}
