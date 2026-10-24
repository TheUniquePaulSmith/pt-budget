'use client';

import { BudgetFundFields, type BudgetFundFormValue } from '@/components/budget/BudgetFundFields';
import type { Category } from '@/types/database';

interface TripBudgetFieldsProps {
  categories: Category[];
  value: BudgetFundFormValue;
  onChange: (next: BudgetFundFormValue) => void;
  startDate?: string;
}

/** Linked budget category, monthly contribution and start month for a trip's savings fund. */
export function TripBudgetFields({ categories, value, onChange, startDate }: TripBudgetFieldsProps) {
  return (
    <BudgetFundFields
      categories={categories}
      value={value}
      onChange={onChange}
      entityLabel="trip"
      fallbackStartDate={startDate}
      idPrefix="trip-budget"
    />
  );
}
