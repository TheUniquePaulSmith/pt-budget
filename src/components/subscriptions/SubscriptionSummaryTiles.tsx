'use client';

import React from 'react';
import { Box } from '@mui/material';
import {
  Autorenew as AutorenewIcon,
  ReceiptLong as BillsIcon,
  EventRepeat as DueIcon,
  Paid as PaidIcon,
} from '@mui/icons-material';

import StatCard from '@/components/common/Charts/StatCard';
import { monthlyEquivalent } from '@/lib/recurringCadence';
import type { RecurringSeries } from '@/types/database';

const CURRENCY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

interface SubscriptionSummaryTilesProps {
  series: RecurringSeries[];
}

const SubscriptionSummaryTiles: React.FC<SubscriptionSummaryTilesProps> = ({ series }) => {
  const active = series.filter((item) => item.status === 'active');
  const activeSubscriptions = active.filter((item) => item.kind === 'subscription');
  const activeBills = active.filter((item) => item.kind === 'bill');

  const monthlyTotal = active.reduce((total, item) => total + monthlyEquivalent(item), 0);

  const today = new Date().toISOString().split('T')[0];
  const in30Days = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
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
          title="Est. Monthly Cost"
          value={CURRENCY.format(monthlyTotal)}
          icon={<PaidIcon />}
          color="primary"
          subtitle="Active subscriptions + bills"
        />
      </Box>
      <Box flex="1 1 240px">
        <StatCard
          title="Subscriptions"
          value={String(activeSubscriptions.length)}
          icon={<AutorenewIcon />}
          color="success"
          subtitle="Active fixed services"
        />
      </Box>
      <Box flex="1 1 240px">
        <StatCard
          title="Recurring Bills"
          value={String(activeBills.length)}
          icon={<BillsIcon />}
          color="warning"
          subtitle="Utilities, telecom, cloud"
        />
      </Box>
      <Box flex="1 1 240px">
        <StatCard
          title="Due in 30 Days"
          value={String(dueSoon.length)}
          icon={<DueIcon />}
          color="error"
          subtitle="Expected upcoming charges"
        />
      </Box>
    </Box>
  );
};

export default SubscriptionSummaryTiles;
