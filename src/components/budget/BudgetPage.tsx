'use client';

import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Edit } from '@mui/icons-material';

import { useBudgetPageSlice } from '@/contexts/useDatabaseSlices';
import type { BudgetPeriod, BudgetPlanWithCategories, BudgetStatus, IncomeSource } from '@/types/database';

import { BudgetHistoryList } from './BudgetHistoryList';
import { BudgetPeriodSelector } from './BudgetPeriodSelector';
import { BudgetPlanEditor } from './BudgetPlanEditor';
import { BudgetStatusPanel } from './BudgetStatusPanel';
import { IncomeSourcesManager } from './IncomeSourcesManager';

const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

function previousMonths(count: number): BudgetPeriod[] {
  const now = new Date();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(now.getFullYear(), now.getMonth() - index, 1));
    return { type: 'month', key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}` };
  });
}

export default function BudgetPage() {
  const {
    categories,
    accounts,
    users,
    budgetVersion,
    transactionVersion,
    getBudgetPlans,
    saveBudgetPlan,
    deleteBudgetPlan,
    getBudgetStatus,
    getIncomeSources,
    addIncomeSource,
    updateIncomeSource,
    deleteIncomeSource,
  } = useBudgetPageSlice();
  const [period, setPeriod] = useState<BudgetPeriod>({ type: 'month', key: currentMonth() });
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [plans, setPlans] = useState<BudgetPlanWithCategories[]>([]);
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([]);
  const [history, setHistory] = useState<BudgetStatus[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const historyPeriods = useMemo(() => previousMonths(12), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getBudgetStatus(period),
      getBudgetPlans(),
      getIncomeSources(),
      Promise.all(historyPeriods.map((historyPeriod) => getBudgetStatus(historyPeriod))),
    ]).then(([nextStatus, nextPlans, nextSources, nextHistory]) => {
      if (cancelled) return;
      setStatus(nextStatus);
      setPlans(nextPlans);
      setIncomeSources(nextSources);
      setHistory(nextHistory);
    }).catch((error) => {
      console.error('Failed to load budget page:', error);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [budgetVersion, transactionVersion, period, getBudgetPlans, getBudgetStatus, getIncomeSources, historyPeriods]);

  return (
    <Box sx={{ flexGrow: 1, p: { xs: 2, sm: 3 } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={2} sx={{ mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight={700}>Budget</Typography>
          <Typography variant="body2" color="text.secondary">Monthly plans carry forward until changed. Quarter and year views roll up effective monthly budgets.</Typography>
        </Box>
        <Button variant="contained" startIcon={<Edit />} onClick={() => setEditorOpen(true)}>Manage Plan</Button>
      </Stack>

      <Stack spacing={3}>
        <BudgetPeriodSelector period={period} onChange={setPeriod} />
        <BudgetStatusPanel status={status} loading={loading} />
        <Stack direction={{ xs: 'column', lg: 'row' }} spacing={3}>
          <Box flex={2}><BudgetHistoryList statuses={history} onSelect={setPeriod} /></Box>
          <Box flex={1}>
            <IncomeSourcesManager
              accounts={accounts}
              users={users}
              sources={incomeSources}
              onAdd={async (input) => { await addIncomeSource(input); }}
              onUpdate={async (id, input) => { await updateIncomeSource(id, input); }}
              onDelete={async (id) => { await deleteIncomeSource(id); }}
            />
          </Box>
        </Stack>
      </Stack>

      <BudgetPlanEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        categories={categories}
        plans={plans}
        onSave={async (input) => { await saveBudgetPlan(input); }}
        onDelete={async (id) => { await deleteBudgetPlan(id); setEditorOpen(false); }}
      />
    </Box>
  );
}