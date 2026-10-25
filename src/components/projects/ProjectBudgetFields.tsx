'use client';

import { BudgetFundFields, type BudgetFundFormValue } from '@/components/budget/BudgetFundFields';
import type { Category } from '@/types/database';

interface ProjectBudgetFieldsProps {
  categories: Category[];
  value: BudgetFundFormValue;
  onChange: (next: BudgetFundFormValue) => void;
  startDate?: string;
}

/** Linked budget category, monthly contribution and start month for a project's savings fund. */
export function ProjectBudgetFields({ categories, value, onChange, startDate }: ProjectBudgetFieldsProps) {
  return (
    <BudgetFundFields
      categories={categories}
      value={value}
      onChange={onChange}
      entityLabel="project"
      fallbackStartDate={startDate}
      idPrefix="project-budget"
    />
  );
}
