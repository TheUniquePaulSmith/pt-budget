'use client';

import React from 'react';
import { Box } from '@mui/material';
import {
  AccountBalance as OwedIcon,
  EventAvailable as DeadlineIcon,
  Paid as PaidIcon,
  Percent as InterestIcon,
} from '@mui/icons-material';

import StatCard from '@/components/common/Charts/StatCard';
import { monthlyLoanCommitment } from '@/lib/loanMath';
import type { Loan } from '@/types/database';
import type { LoanSummary } from '@/types/loans';
import { formatCurrency } from './loanPresentation';

interface LoansSummaryTilesProps {
  loans: Loan[];
  summaries: Record<number, LoanSummary>;
}

export default function LoansSummaryTiles({ loans, summaries }: LoansSummaryTilesProps) {
  const active = loans.filter((loan) => loan.status === 'active');
  const totalOwed = active.reduce((total, loan) => total + (summaries[loan.id]?.payoffAmount ?? 0), 0);
  const interestPaid = loans.reduce((total, loan) => total + (summaries[loan.id]?.totalInterestPaid ?? 0), 0);
  const monthly = monthlyLoanCommitment(loans);
  const deadlines = active.filter((loan) => {
    const deferred = summaries[loan.id]?.deferred;
    return deferred && !deferred.charged && !summaries[loan.id]?.isPaidOff && deferred.daysUntilPromoEnd >= 0 && deferred.daysUntilPromoEnd <= 90;
  });
  const atRisk = active.filter((loan) => {
    const deferred = summaries[loan.id]?.deferred;
    return deferred && !deferred.charged && !deferred.onTrack && !summaries[loan.id]?.isPaidOff;
  }).length;

  return (
    <Box display="flex" flexWrap="wrap" gap={3} mb={4}>
      <Box flex="1 1 240px">
        <StatCard title="Total Owed" value={formatCurrency(totalOwed)} icon={<OwedIcon />} color="primary" subtitle={`${active.length} active loan${active.length === 1 ? '' : 's'}`} />
      </Box>
      <Box flex="1 1 240px">
        <StatCard title="Monthly Payments" value={formatCurrency(monthly)} icon={<PaidIcon />} color="success" subtitle="Expected payments on active loans" />
      </Box>
      <Box flex="1 1 240px">
        <StatCard title="Interest Paid" value={formatCurrency(interestPaid)} icon={<InterestIcon />} color="warning" subtitle="Across all loans to date" />
      </Box>
      <Box flex="1 1 240px">
        <StatCard
          title="Promo Deadlines"
          value={String(deadlines.length)}
          icon={<DeadlineIcon />}
          color={atRisk > 0 ? 'error' : 'primary'}
          subtitle={atRisk > 0 ? `${atRisk} not on track to avoid deferred interest` : 'Pay-by dates in the next 90 days'}
        />
      </Box>
    </Box>
  );
}
