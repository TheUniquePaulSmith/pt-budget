"use client";

import { useCallback, useMemo } from 'react';

import type { DatabaseService } from '../lib/databaseService';
import type {
  BudgetPeriod,
  BudgetPlanWithCategories,
  BudgetStatus,
  IncomeSource,
} from '../types/database';

export interface BudgetPlanInput {
  effectiveMonth: string;
  totalAmount?: number | null;
  notes?: string | null;
  categories: Array<{ category_id: number; amount: number }>;
}

export type IncomeSourceInput = Omit<
  IncomeSource,
  'id' | 'created_at' | 'updated_at' | 'account_name'
>;

export interface DatabaseBudgetSlice {
  getBudgetPlans: () => Promise<BudgetPlanWithCategories[]>;
  saveBudgetPlan: (input: BudgetPlanInput) => Promise<number>;
  deleteBudgetPlan: (id: number) => Promise<void>;
  getEffectiveBudgetPlan: (month: string) => Promise<BudgetPlanWithCategories | null>;
  getBudgetStatus: (period: BudgetPeriod) => Promise<BudgetStatus>;
  getIncomeSources: () => Promise<IncomeSource[]>;
  addIncomeSource: (input: IncomeSourceInput) => Promise<number>;
  updateIncomeSource: (id: number, input: IncomeSourceInput) => Promise<void>;
  deleteIncomeSource: (id: number) => Promise<void>;
}

type BudgetService = Pick<
  DatabaseService,
  | 'getBudgetPlans'
  | 'saveBudgetPlan'
  | 'deleteBudgetPlan'
  | 'getEffectiveBudgetPlan'
  | 'getBudgetStatus'
  | 'getIncomeSources'
  | 'addIncomeSource'
  | 'updateIncomeSource'
  | 'deleteIncomeSource'
>;

interface UseDatabaseBudgetSliceOptions {
  databaseService: BudgetService | null;
  refreshBudgets: () => Promise<void>;
}

export function useDatabaseBudgetSlice({
  databaseService,
  refreshBudgets,
}: UseDatabaseBudgetSliceOptions): DatabaseBudgetSlice {
  const requireService = useCallback(() => {
    if (!databaseService) {
      throw new Error('Database service not initialized');
    }

    return databaseService;
  }, [databaseService]);

  const getBudgetPlans = useCallback(
    async (): Promise<BudgetPlanWithCategories[]> => requireService().getBudgetPlans(),
    [requireService]
  );

  const saveBudgetPlan = useCallback(
    async (input: BudgetPlanInput): Promise<number> => {
      const id = await requireService().saveBudgetPlan(input);
      await refreshBudgets();
      return id;
    },
    [refreshBudgets, requireService]
  );

  const deleteBudgetPlan = useCallback(
    async (id: number): Promise<void> => {
      await requireService().deleteBudgetPlan(id);
      await refreshBudgets();
    },
    [refreshBudgets, requireService]
  );

  const getEffectiveBudgetPlan = useCallback(
    async (month: string): Promise<BudgetPlanWithCategories | null> =>
      requireService().getEffectiveBudgetPlan(month),
    [requireService]
  );

  const getBudgetStatus = useCallback(
    async (period: BudgetPeriod): Promise<BudgetStatus> => requireService().getBudgetStatus(period),
    [requireService]
  );

  const getIncomeSources = useCallback(
    async (): Promise<IncomeSource[]> => requireService().getIncomeSources(),
    [requireService]
  );

  const addIncomeSource = useCallback(
    async (input: IncomeSourceInput): Promise<number> => {
      const id = await requireService().addIncomeSource(input);
      await refreshBudgets();
      return id;
    },
    [refreshBudgets, requireService]
  );

  const updateIncomeSource = useCallback(
    async (id: number, input: IncomeSourceInput): Promise<void> => {
      await requireService().updateIncomeSource(id, input);
      await refreshBudgets();
    },
    [refreshBudgets, requireService]
  );

  const deleteIncomeSource = useCallback(
    async (id: number): Promise<void> => {
      await requireService().deleteIncomeSource(id);
      await refreshBudgets();
    },
    [refreshBudgets, requireService]
  );

  return useMemo(
    () => ({
      getBudgetPlans,
      saveBudgetPlan,
      deleteBudgetPlan,
      getEffectiveBudgetPlan,
      getBudgetStatus,
      getIncomeSources,
      addIncomeSource,
      updateIncomeSource,
      deleteIncomeSource,
    }),
    [
      addIncomeSource,
      deleteBudgetPlan,
      deleteIncomeSource,
      getBudgetPlans,
      getBudgetStatus,
      getEffectiveBudgetPlan,
      getIncomeSources,
      saveBudgetPlan,
      updateIncomeSource,
    ]
  );
}