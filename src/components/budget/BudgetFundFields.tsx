'use client';

import { Box, FormControl, FormHelperText, InputLabel, MenuItem, Select, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { Category } from '@/types/database';

/** Form state for the optional savings fund on a project or trip. */
export interface BudgetFundFormValue {
  budget_category_id: number | '';
  monthly_contribution: string;
  contribution_start_month: string; // 'YYYY-MM' or ''
}

export const EMPTY_BUDGET_FUND_FORM: BudgetFundFormValue = {
  budget_category_id: '',
  monthly_contribution: '',
  contribution_start_month: '',
};

/** Form state from a persisted project or trip. */
export function budgetFundFormFromEntity(entity: {
  budget_category_id?: number | null;
  monthly_contribution?: number | null;
  contribution_start_month?: string | null;
}): BudgetFundFormValue {
  return {
    budget_category_id: entity.budget_category_id ?? '',
    monthly_contribution: entity.monthly_contribution == null ? '' : String(entity.monthly_contribution),
    contribution_start_month: entity.contribution_start_month ?? '',
  };
}

/** Persisted columns from form state: nothing is linked unless a category is picked. */
export function budgetFundColumnsFromForm(value: BudgetFundFormValue): {
  budget_category_id: number | null;
  monthly_contribution: number | null;
  contribution_start_month: string | null;
} {
  if (value.budget_category_id === '') {
    return { budget_category_id: null, monthly_contribution: null, contribution_start_month: null };
  }
  const monthly = value.monthly_contribution.trim() ? Number.parseFloat(value.monthly_contribution) : NaN;
  return {
    budget_category_id: Number(value.budget_category_id),
    monthly_contribution: Number.isFinite(monthly) && monthly > 0 ? monthly : null,
    contribution_start_month: /^\d{4}-\d{2}$/.test(value.contribution_start_month.trim()) ? value.contribution_start_month.trim() : null,
  };
}

interface BudgetFundFieldsProps {
  categories: Category[];
  value: BudgetFundFormValue;
  onChange: (next: BudgetFundFormValue) => void;
  /** 'project' or 'trip': used in labels and helper copy. */
  entityLabel: string;
  /** Fallback start shown in the helper text when no start month is set (the entity's start date). */
  fallbackStartDate?: string;
  idPrefix?: string;
}

export function BudgetFundFields({ categories, value, onChange, entityLabel, fallbackStartDate, idPrefix = 'budget-fund' }: BudgetFundFieldsProps) {
  const { t } = useTranslation(['budget', 'common']);
  const { money, month, symbol } = useFormatters();
  const expenseCategories = categories.filter((category) => category.type === 'expense');
  const linked = value.budget_category_id !== '';
  const category = expenseCategories.find((item) => item.id === value.budget_category_id);
  const monthly = Number.parseFloat(value.monthly_contribution);
  const startMonth = /^\d{4}-\d{2}$/.test(value.contribution_start_month)
    ? value.contribution_start_month
    : fallbackStartDate && fallbackStartDate.length >= 7 ? fallbackStartDate.slice(0, 7) : null;
  const categoryLabelId = `${idPrefix}-category-label`;
  // The entity word is translated; an unknown label falls through unchanged.
  const entity = entityLabel === 'project'
    ? t('fundFields.entity.project')
    : entityLabel === 'trip'
      ? t('fundFields.entity.trip')
      : entityLabel;

  let helper: string;
  if (!linked) {
    helper = t('fundFields.helpUnlinked', { entity });
  } else if (!(monthly > 0)) {
    helper = t('fundFields.helpNoContribution', { category: category?.name ?? t('fundFields.categoryFallback') });
  } else if (!startMonth) {
    helper = t('fundFields.helpNoStart');
  } else {
    helper = t('fundFields.helpReserves', {
      amount: money(monthly),
      category: category?.name ?? t('fundFields.theCategoryFallback'),
      month: month(startMonth),
      entity,
    });
  }

  return (
    <Box data-testid={`${idPrefix}-fields`}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('fundFields.title')}</Typography>
      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <FormControl sx={{ flex: 1, minWidth: 220 }}>
          <InputLabel id={categoryLabelId}>{t('fundFields.linkedCategory')}</InputLabel>
          <Select
            labelId={categoryLabelId}
            label={t('fundFields.linkedCategory')}
            value={value.budget_category_id}
            onChange={(event) => {
              const next = event.target.value as number | '';
              onChange({ ...value, budget_category_id: next === '' ? '' : Number(next) });
            }}
            displayEmpty={false}
          >
            <MenuItem value="">
              <em>{t('fundFields.notLinked')}</em>
            </MenuItem>
            {expenseCategories.map((item) => (
              <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          sx={{ flex: 1, minWidth: 180 }}
          label={t('fundFields.monthlyContribution')}
          type="number"
          value={value.monthly_contribution}
          onChange={(event) => onChange({ ...value, monthly_contribution: event.target.value })}
          disabled={!linked}
          slotProps={{ htmlInput: { step: '0.01', min: '0' }, input: { startAdornment: symbol() } }}
        />
        <TextField
          sx={{ flex: 1, minWidth: 180 }}
          label={t('fundFields.startMonth')}
          type="month"
          value={value.contribution_start_month}
          onChange={(event) => onChange({ ...value, contribution_start_month: event.target.value })}
          disabled={!linked}
          slotProps={{ inputLabel: { shrink: true } }}
        />
      </Box>
      <FormHelperText sx={{ mx: 0 }}>{helper}</FormHelperText>
    </Box>
  );
}
