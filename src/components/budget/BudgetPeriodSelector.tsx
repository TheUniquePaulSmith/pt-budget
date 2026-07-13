'use client';

import { Box, IconButton, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { ChevronLeft, ChevronRight } from '@mui/icons-material';

import type { BudgetPeriod } from '@/types/database';

interface BudgetPeriodSelectorProps {
  period: BudgetPeriod;
  onChange: (period: BudgetPeriod) => void;
}

function addMonths(month: string, delta: number) {
  const [year, monthNumber] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function currentKey(type: BudgetPeriod['type']) {
  const now = new Date();
  if (type === 'month') return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (type === 'quarter') return `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`;
  return String(now.getFullYear());
}

function shiftPeriod(period: BudgetPeriod, delta: number): BudgetPeriod {
  if (period.type === 'month') return { ...period, key: addMonths(period.key, delta) };
  if (period.type === 'year') return { ...period, key: String(Number(period.key) + delta) };
  const match = period.key.match(/^(\d{4})-Q([1-4])$/);
  const year = Number(match?.[1] ?? new Date().getFullYear());
  const quarter = Number(match?.[2] ?? 1);
  const zeroBased = (year * 4) + (quarter - 1) + delta;
  const nextYear = Math.floor(zeroBased / 4);
  const nextQuarter = (zeroBased % 4) + 1;
  return { ...period, key: `${nextYear}-Q${nextQuarter}` };
}

export function BudgetPeriodSelector({ period, onChange }: BudgetPeriodSelectorProps) {
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton onClick={() => onChange(shiftPeriod(period, -1))} aria-label="Previous period">
          <ChevronLeft />
        </IconButton>
        <Typography variant="h6" sx={{ minWidth: 120, textAlign: 'center' }}>{period.key}</Typography>
        <IconButton onClick={() => onChange(shiftPeriod(period, 1))} aria-label="Next period">
          <ChevronRight />
        </IconButton>
      </Box>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={period.type}
        onChange={(_, value: BudgetPeriod['type'] | null) => {
          if (value) onChange({ type: value, key: currentKey(value) });
        }}
      >
        <ToggleButton value="month">Month</ToggleButton>
        <ToggleButton value="quarter">Quarter</ToggleButton>
        <ToggleButton value="year">Year</ToggleButton>
      </ToggleButtonGroup>
    </Box>
  );
}