'use client';

import React, { useMemo, useState } from 'react';
import { Box, Chip, Stack, Typography } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { LineChart } from '@mui/x-charts/LineChart';
import { useTranslation } from 'react-i18next';

import { useFormatters } from '@/contexts/useFormatters';
import type { LoanSummary } from '@/types/loans';

const PRINCIPAL_COLOR = '#1976d2';
const INTEREST_COLOR = '#ef6c00';
const PROJECTED_PRINCIPAL_COLOR = '#90caf9';
const PROJECTED_INTEREST_COLOR = '#ffcc80';
const CHARGE_COLOR = '#d32f2f';
const BALANCE_COLOR = '#5c6bc0';

/** Upcoming projected payments drawn after the actual ones. */
const PROJECTION_BARS = 24;

interface LoanPrincipalInterestChartProps {
  summary: LoanSummary;
  /** The loan's currency (its linked account's); null for the default currency. */
  currency?: string | null;
}

/**
 * Principal versus interest per payment: actual payments in full color,
 * then the projected schedule in a lighter tint; a missed-promo deferred
 * interest charge shows as its own red bar. Below it, the balance over the
 * same timeline.
 */
export default function LoanPrincipalInterestChart({ summary, currency }: LoanPrincipalInterestChartProps) {
  const { t } = useTranslation('loans');
  const { money, shortMonth } = useFormatters();
  const [showProjection, setShowProjection] = useState(true);

  const data = useMemo(() => {
    const shortDate = (iso: string) => {
      const [year, month] = iso.split('-');
      return t('principalInterestChart.axisLabel', { month: shortMonth(Number(month)), year: year.slice(2) });
    };

    const labels: string[] = [];
    const principal: (number | null)[] = [];
    const interest: (number | null)[] = [];
    const projectedPrincipal: (number | null)[] = [];
    const projectedInterest: (number | null)[] = [];
    const charges: (number | null)[] = [];
    const balance: number[] = [];

    for (const entry of summary.ledger) {
      labels.push(shortDate(entry.date));
      balance.push(entry.balance_after);
      if (entry.kind === 'deferred_interest_charge') {
        principal.push(null);
        interest.push(null);
        charges.push(entry.amount);
      } else {
        principal.push(entry.principal);
        interest.push(entry.interest);
        charges.push(null);
      }
      projectedPrincipal.push(null);
      projectedInterest.push(null);
    }

    const projected = showProjection ? summary.projection?.schedule.slice(0, PROJECTION_BARS) ?? [] : [];
    for (const entry of projected) {
      labels.push(shortDate(entry.date));
      balance.push(entry.balance_after);
      principal.push(null);
      interest.push(null);
      if (entry.deferred_charge) {
        charges.push(entry.amount);
        projectedPrincipal.push(null);
        projectedInterest.push(null);
      } else {
        charges.push(null);
        projectedPrincipal.push(entry.principal);
        projectedInterest.push(entry.interest);
      }
    }

    return {
      labels,
      principal,
      interest,
      projectedPrincipal,
      projectedInterest,
      charges,
      balance,
      hasCharges: charges.some((value) => value != null),
      hasProjection: projected.length > 0,
      projectionTruncated: (summary.projection?.schedule.length ?? 0) > PROJECTION_BARS,
    };
  }, [shortMonth, showProjection, summary, t]);

  if (data.labels.length === 0) {
    return (
      <Box display="flex" alignItems="center" justifyContent="center" height={200}>
        <Typography color="text.secondary">{t('principalInterestChart.empty')}</Typography>
      </Box>
    );
  }

  const formatAmount = (value: number) => money(value, currency);
  const valueFormatter = (value: number | null) => (value == null ? '' : formatAmount(value));

  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" mb={1}>
        <Chip size="small" label={t('principalInterestChart.principal')} sx={{ bgcolor: PRINCIPAL_COLOR, color: 'common.white' }} />
        <Chip size="small" label={t('principalInterestChart.interest')} sx={{ bgcolor: INTEREST_COLOR, color: 'common.white' }} />
        {data.hasCharges && <Chip size="small" label={t('principalInterestChart.deferredCharge')} sx={{ bgcolor: CHARGE_COLOR, color: 'common.white' }} />}
        {summary.projection && (
          <Chip
            size="small"
            label={showProjection ? t('principalInterestChart.projected') : t('principalInterestChart.showProjection')}
            variant={showProjection ? 'filled' : 'outlined'}
            onClick={() => setShowProjection((value) => !value)}
            data-testid="loan-chart-projection-toggle"
          />
        )}
        {data.projectionTruncated && showProjection && (
          <Typography variant="caption" color="text.secondary">
            {t('principalInterestChart.firstShown', { count: PROJECTION_BARS })}
          </Typography>
        )}
      </Stack>
      <Box height={280} data-testid="loan-principal-interest-chart">
        <BarChart
          series={[
            { data: data.principal, label: t('principalInterestChart.principal'), color: PRINCIPAL_COLOR, stack: 'payment', valueFormatter },
            { data: data.interest, label: t('principalInterestChart.interest'), color: INTEREST_COLOR, stack: 'payment', valueFormatter },
            ...(data.hasProjection
              ? [
                  { data: data.projectedPrincipal, label: t('principalInterestChart.projectedPrincipal'), color: PROJECTED_PRINCIPAL_COLOR, stack: 'payment', valueFormatter },
                  { data: data.projectedInterest, label: t('principalInterestChart.projectedInterest'), color: PROJECTED_INTEREST_COLOR, stack: 'payment', valueFormatter },
                ]
              : []),
            ...(data.hasCharges ? [{ data: data.charges, label: t('principalInterestChart.deferredCharge'), color: CHARGE_COLOR, stack: 'payment', valueFormatter }] : []),
          ]}
          xAxis={[{ scaleType: 'band', data: data.labels }]}
          yAxis={[{ width: 80, valueFormatter: (value: number) => formatAmount(value) }]}
          margin={{ top: 10, right: 10, bottom: 30, left: 10 }}
          hideLegend
        />
      </Box>
      <Typography variant="subtitle2" sx={{ mt: 2 }}>
        {t('principalInterestChart.balanceAfter')}
      </Typography>
      <Box height={200}>
        <LineChart
          series={[{ data: data.balance, label: t('principalInterestChart.balance'), color: BALANCE_COLOR, area: true, valueFormatter, showMark: data.balance.length <= 24 }]}
          xAxis={[{ scaleType: 'point', data: data.labels }]}
          yAxis={[{ width: 80, valueFormatter: (value: number) => formatAmount(value), min: 0 }]}
          margin={{ top: 10, right: 10, bottom: 30, left: 10 }}
          hideLegend
        />
      </Box>
    </Box>
  );
}
