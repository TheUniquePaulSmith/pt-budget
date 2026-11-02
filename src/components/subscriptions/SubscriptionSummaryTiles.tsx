'use client';

import React from 'react';
import { Box } from '@mui/material';
import {
  Autorenew as AutorenewIcon,
  ReceiptLong as BillsIcon,
  EventRepeat as DueIcon,
  Paid as PaidIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import StatCard from '@/components/common/Charts/StatCard';
import { useFormatters } from '@/contexts/useFormatters';
import { monthlyEquivalent } from '@/lib/recurringCadence';
import { addDaysISO, todayLocalISO } from '@/lib/dateOnly';
import type { RecurringSeries } from '@/types/database';

interface SubscriptionSummaryTilesProps {
  series: RecurringSeries[];
}

const SubscriptionSummaryTiles: React.FC<SubscriptionSummaryTilesProps> = ({ series }) => {
  const { t } = useTranslation('subscriptions');
  const { money } = useFormatters();
  const active = series.filter((item) => item.status === 'active');
  const activeSubscriptions = active.filter((item) => item.kind === 'subscription');
  const activeBills = active.filter((item) => item.kind === 'bill');

  // Cross-series estimate: shown in the default currency.
  const monthlyTotal = active.reduce((total, item) => total + monthlyEquivalent(item), 0);

  const today = todayLocalISO();
  const in30Days = addDaysISO(today, 30);
  const dueSoon = active.filter(
    (item) =>
      item.next_expected_date &&
      item.next_expected_date >= today &&
      item.next_expected_date <= in30Days
  );

  return (
    <Box display="flex" flexWrap="wrap" gap={3} mb={4}>
      <Box flex="1 1 240px">
        <StatCard
          title={t('summaryTiles.estMonthlyCost')}
          value={money(monthlyTotal)}
          icon={<PaidIcon />}
          color="primary"
          subtitle={t('summaryTiles.estMonthlySubtitle')}
        />
      </Box>
      <Box flex="1 1 240px">
        <StatCard
          title={t('summaryTiles.subscriptions')}
          value={String(activeSubscriptions.length)}
          icon={<AutorenewIcon />}
          color="success"
          subtitle={t('summaryTiles.subscriptionsSubtitle')}
        />
      </Box>
      <Box flex="1 1 240px">
        <StatCard
          title={t('summaryTiles.recurringBills')}
          value={String(activeBills.length)}
          icon={<BillsIcon />}
          color="warning"
          subtitle={t('summaryTiles.billsSubtitle')}
        />
      </Box>
      <Box flex="1 1 240px">
        <StatCard
          title={t('summaryTiles.dueIn30Days')}
          value={String(dueSoon.length)}
          icon={<DueIcon />}
          color="error"
          subtitle={t('summaryTiles.dueSubtitle')}
        />
      </Box>
    </Box>
  );
};

export default SubscriptionSummaryTiles;
