'use client';

import React, { useMemo } from 'react';
import { Box, Typography } from '@mui/material';
import {
  AccountBalance as OwedIcon,
  EventAvailable as DeadlineIcon,
  Paid as PaidIcon,
  Percent as InterestIcon,
} from '@mui/icons-material';
import { useTranslation } from 'react-i18next';

import StatCard from '@/components/common/Charts/StatCard';
import { useCurrencyPreferencesSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { convertToDefault } from '@/lib/currencies';
import type { Loan } from '@/types/database';
import type { LoanSummary } from '@/types/loans';

interface LoansSummaryTilesProps {
  loans: Loan[];
  summaries: Record<number, LoanSummary>;
}

export default function LoansSummaryTiles({ loans, summaries }: LoansSummaryTilesProps) {
  const { t } = useTranslation('loans');
  const { money } = useFormatters();
  const { defaultCurrency, exchangeRates } = useCurrencyPreferencesSlice();

  const active = loans.filter((loan) => loan.status === 'active');

  // Cross-loan totals are shown in the default currency: each loan's figure is
  // converted with the household's exchange rates; loans whose rate is
  // unknown are left out and counted in the footnote.
  const totals = useMemo(() => {
    let totalOwed = 0;
    let interestPaid = 0;
    let monthly = 0;
    const skipped = new Set<number>();
    const convert = (loan: Loan, amount: number): number | null =>
      convertToDefault(amount, loan.account_currency ?? defaultCurrency, defaultCurrency, exchangeRates);

    for (const loan of loans) {
      const isActive = loan.status === 'active';
      const owed = isActive ? convert(loan, summaries[loan.id]?.payoffAmount ?? 0) : 0;
      const interest = convert(loan, summaries[loan.id]?.totalInterestPaid ?? 0);
      const payment = isActive && loan.expected_payment != null && loan.expected_payment > 0 ? convert(loan, Number(loan.expected_payment)) : 0;
      if (owed == null || interest == null || payment == null) {
        skipped.add(loan.id);
        continue;
      }
      totalOwed += owed;
      interestPaid += interest;
      monthly += payment;
    }
    return { totalOwed, interestPaid, monthly: Math.round(monthly * 100) / 100, skipped: skipped.size };
  }, [defaultCurrency, exchangeRates, loans, summaries]);

  const deadlines = active.filter((loan) => {
    const deferred = summaries[loan.id]?.deferred;
    return deferred && !deferred.charged && !summaries[loan.id]?.isPaidOff && deferred.daysUntilPromoEnd >= 0 && deferred.daysUntilPromoEnd <= 90;
  });
  const atRisk = active.filter((loan) => {
    const deferred = summaries[loan.id]?.deferred;
    return deferred && !deferred.charged && !deferred.onTrack && !summaries[loan.id]?.isPaidOff;
  }).length;

  return (
    <Box mb={4}>
      <Box display="flex" flexWrap="wrap" gap={3}>
        <Box flex="1 1 240px">
          <StatCard title={t('summaryTiles.totalOwed')} value={money(totals.totalOwed)} icon={<OwedIcon />} color="primary" subtitle={t('summaryTiles.activeLoans', { count: active.length })} />
        </Box>
        <Box flex="1 1 240px">
          <StatCard title={t('summaryTiles.monthlyPayments')} value={money(totals.monthly)} icon={<PaidIcon />} color="success" subtitle={t('summaryTiles.monthlySubtitle')} />
        </Box>
        <Box flex="1 1 240px">
          <StatCard title={t('summaryTiles.interestPaid')} value={money(totals.interestPaid)} icon={<InterestIcon />} color="warning" subtitle={t('summaryTiles.interestSubtitle')} />
        </Box>
        <Box flex="1 1 240px">
          <StatCard
            title={t('summaryTiles.promoDeadlines')}
            value={String(deadlines.length)}
            icon={<DeadlineIcon />}
            color={atRisk > 0 ? 'error' : 'primary'}
            subtitle={atRisk > 0 ? t('summaryTiles.atRisk', { count: atRisk }) : t('summaryTiles.deadlinesSubtitle')}
          />
        </Box>
      </Box>
      {totals.skipped > 0 && (
        <Typography variant="caption" color="text.secondary" display="block" mt={1} data-testid="loans-other-currencies-note">
          {t('summaryTiles.otherCurrencies', { count: totals.skipped })}
        </Typography>
      )}
    </Box>
  );
}
