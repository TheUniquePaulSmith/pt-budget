'use client';

import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Edit } from '@mui/icons-material';

import { useBudgetFundsSlice, useBudgetPageSlice } from '@/contexts/useDatabaseSlices';
import { asCarryStatus, currentMonthKey, periodMonthBounds } from '@/lib/budgetCarry';
import { logger } from '@/lib/logging';
import type { BudgetFundStatus, BudgetStatusWithCarry } from '@/types/budgetCarry';
import type { BudgetPeriod, BudgetPlanWithCategories, BudgetStatus, IncomeSource } from '@/types/database';

import { BudgetFundsCard } from './BudgetFundsCard';
import { BudgetHistoryList } from './BudgetHistoryList';
import { BudgetPeriodSelector } from './BudgetPeriodSelector';
import { BudgetPlanEditor } from './BudgetPlanEditor';
import { BudgetStatusPanel } from './BudgetStatusPanel';
import { IncomeSourcesManager } from './IncomeSourcesManager';

const log = logger.child({ component: 'BudgetPage' });

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
  const { getFundStatus } = useBudgetFundsSlice();
  const [period, setPeriod] = useState<BudgetPeriod>({ type: 'month', key: currentMonthKey() });
  const [status, setStatus] = useState<BudgetStatusWithCarry | null>(null);
  const [plans, setPlans] = useState<BudgetPlanWithCategories[]>([]);
  const [incomeSources, setIncomeSources] = useState<IncomeSource[]>([]);
  const [history, setHistory] = useState<BudgetStatus[]>([]);
  const [funds, setFunds] = useState<BudgetFundStatus[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const historyPeriods = useMemo(() => previousMonths(12), []);
  const fundsAsOfMonth = useMemo(() => periodMonthBounds(period).end, [period]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      getBudgetStatus(period),
      getBudgetPlans(),
      getIncomeSources(),
      Promise.all(historyPeriods.map((historyPeriod) => getBudgetStatus(historyPeriod))),
      getFundStatus(fundsAsOfMonth),
    ]).then(([nextStatus, nextPlans, nextSources, nextHistory, nextFunds]) => {
      if (cancelled) return;
      setStatus(asCarryStatus(nextStatus));
      setPlans(nextPlans);
      setIncomeSources(nextSources);
      setHistory(nextHistory);
      setFunds(nextFunds);
    }).catch((error) => {
      log.error('Failed to load budget page', { operation: 'loadBudgetPage', error });
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [budgetVersion, transactionVersion, period, fundsAsOfMonth, getBudgetPlans, getBudgetStatus, getFundStatus, getIncomeSources, historyPeriods]);

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
            <Stack spacing={3}>
              <BudgetFundsCard funds={funds} loading={loading} asOfMonth={fundsAsOfMonth} />
              <IncomeSourcesManager
                accounts={accounts}
                users={users}
                sources={incomeSources}
                onAdd={async (input) => { await addIncomeSource(input); }}
                onUpdate={async (id, input) => { await updateIncomeSource(id, input); }}
                onDelete={async (id) => { await deleteIncomeSource(id); }}
              />
            </Stack>
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
