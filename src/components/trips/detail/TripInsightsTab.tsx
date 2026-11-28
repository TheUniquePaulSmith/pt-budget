'use client';

import React, { useMemo, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import { PieChart } from '@mui/x-charts/PieChart';
import { useTranslation } from 'react-i18next';

import AccountOptionContent from '@/components/accounts/AccountOptionContent';
import { useAccountLabels } from '@/components/accounts/useAccountLabels';
import { useTripDetailSlice } from '@/contexts/useDatabaseSlices';
import { useFormatters } from '@/contexts/useFormatters';
import { accountLabelText } from '@/lib/accountLabels';
import { buildTripInsights, type TripInsightBucket, type TripInsightFilters, type TripInsightView } from '@/lib/tripInsights';
import type { Trip } from '@/types/database';
import type { TripInsightRow } from '@/types/tripExpenses';

const TOP_N = 10;
const FALLBACK_COLORS = ['#5c6bc0', '#26a69a', '#ffa726', '#ef5350', '#ab47bc', '#29b6f6', '#9ccc65', '#8d6e63', '#ec407a', '#78909c'];

type Dimension = 'category' | 'company' | 'account' | 'user';

interface Option {
  key: string;
  id: number | null;
  label: string;
}

const keyOf = (id: number | null) => (id == null ? 'none' : String(id));

export interface TripInsightsTabProps {
  trip: Trip;
  rows: TripInsightRow[];
}

/** Where the trip's money went, for all of it, the personal part or the business part. */
export default function TripInsightsTab({ trip, rows }: TripInsightsTabProps) {
  const { t } = useTranslation(['trips', 'common']);
  const { money, date } = useFormatters();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('sm'));
  const { accounts, users } = useTripDetailSlice();
  const labels = useAccountLabels(accounts, users);
  const hasBusiness = (trip.expense_mode ?? 'personal') !== 'personal';

  const [view, setView] = useState<TripInsightView>(hasBusiness ? 'personal' : 'all');
  const [selected, setSelected] = useState<Record<Dimension, Option[]>>({ category: [], company: [], account: [], user: [] });

  const nameOf = useMemo(
    () => ({
      category: (id: number | null, name: string | null) => (id == null ? t('insights.uncategorized') : name ?? ''),
      company: (id: number | null, name: string | null) => (id == null ? t('insights.noMerchant') : name ?? ''),
      account: (id: number | null) => accountLabelText(labels, id, t('insights.unknownAccount')),
      user: (id: number | null, name: string | null) => (id == null ? t('insights.noPerson') : name ?? ''),
    }),
    [labels, t]
  );

  // The options are whatever the trip's spending rows carry.
  const options = useMemo(() => {
    const collect = (pick: (row: TripInsightRow) => [number | null, string | null], dimension: Dimension) => {
      const seen = new Map<string, Option>();
      for (const row of rows) {
        if (row.type !== 'expense' && row.type !== 'refund') continue;
        const [id, name] = pick(row);
        const key = keyOf(id);
        if (!seen.has(key)) seen.set(key, { key, id, label: nameOf[dimension](id, name) });
      }
      return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
    };
    return {
      category: collect((row) => [row.category_id, row.category_name], 'category'),
      company: collect((row) => [row.company_id, row.company_name], 'company'),
      account: collect((row) => [row.account_id, null], 'account'),
      user: collect((row) => [row.user_id, row.user_name], 'user'),
    };
  }, [nameOf, rows]);

  const filters: TripInsightFilters = {
    view: hasBusiness ? view : 'all',
    categoryIds: selected.category.map((option) => option.id),
    companyIds: selected.company.map((option) => option.id),
    accountIds: selected.account.map((option) => option.id).filter((id): id is number => id != null),
    userIds: selected.user.map((option) => option.id),
  };
  const insights = useMemo(
    () => buildTripInsights(rows, filters),
    // filters is rebuilt each render from `selected` and `view`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, selected, view, hasBusiness]
  );

  const hasFilters = Object.values(selected).some((list) => list.length > 0);
  const addFilter = (dimension: Dimension, bucket: TripInsightBucket | undefined) => {
    if (!bucket) return;
    const id = bucket.key == null ? null : Number(bucket.key);
    const key = keyOf(id);
    setSelected((current) =>
      current[dimension].some((option) => option.key === key)
        ? current
        : { ...current, [dimension]: [...current[dimension], options[dimension].find((option) => option.key === key) ?? { key, id, label: key }] }
    );
  };

  const bucketName = (dimension: Dimension, bucket: TripInsightBucket) => {
    const id = bucket.key == null ? null : Number(bucket.key);
    return nameOf[dimension](id, bucket.label);
  };

  const positive = (buckets: TripInsightBucket[]) => buckets.filter((bucket) => bucket.value > 0);
  const categoryBuckets = positive(insights.byCategory).slice(0, TOP_N);
  const pieData = categoryBuckets.map((bucket, index) => ({
    id: keyOf(bucket.key == null ? null : Number(bucket.key)),
    value: bucket.value,
    label: bucketName('category', bucket),
    color: bucket.color || FALLBACK_COLORS[index % FALLBACK_COLORS.length],
  }));

  const barPanel = (dimension: Dimension, title: string, buckets: TripInsightBucket[], testId: string) => {
    const shown = positive(buckets).slice(0, TOP_N);
    return (
      <Paper variant="outlined" sx={{ p: 2 }} data-testid={testId}>
        <Typography variant="subtitle1" component="h3" fontWeight="bold">
          {title}
        </Typography>
        {shown.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
            {t('insights.nothing')}
          </Typography>
        ) : (
          <BarChart
            layout="horizontal"
            height={Math.max(140, shown.length * 34 + 50)}
            series={[
              {
                data: shown.map((bucket) => bucket.value),
                valueFormatter: (value: number | null) => (value == null ? '' : money(value)),
              },
            ]}
            yAxis={[{ scaleType: 'band', data: shown.map((bucket) => bucketName(dimension, bucket)), width: compact ? 90 : 140 }]}
            xAxis={[{ valueFormatter: (value: number) => money(value) }]}
            hideLegend
            onItemClick={(_, item) => addFilter(dimension, shown[item.dataIndex])}
            margin={{ top: 10, right: 20, bottom: 24, left: 10 }}
          />
        )}
      </Paper>
    );
  };

  const filterInput = (dimension: Dimension, label: string) => (
    <Autocomplete
      multiple
      size="small"
      options={options[dimension]}
      value={selected[dimension]}
      onChange={(_, next) => setSelected((current) => ({ ...current, [dimension]: next }))}
      getOptionLabel={(option) => option.label}
      isOptionEqualToValue={(option, value) => option.key === value.key}
      renderOption={
        dimension === 'account'
          ? (props, option) => {
              const { key, ...rest } = props as typeof props & { key: string };
              return (
                <li key={key} {...rest}>
                  <AccountOptionContent label={option.id == null ? undefined : labels.get(option.id)} fallback={option.label} />
                </li>
              );
            }
          : undefined
      }
      renderInput={(params) => (
        <TextField {...params} label={label} inputProps={{ ...params.inputProps, 'data-testid': `trip-insights-filter-${dimension}` }} />
      )}
      sx={{ minWidth: 200, flex: '1 1 200px' }}
    />
  );

  const viewLabel = t(`insights.view.${filters.view}`);

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          {hasBusiness && (
            <Box>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={view}
                onChange={(_, next: TripInsightView | null) => next && setView(next)}
                aria-label={t('insights.viewLabel')}
              >
                <ToggleButton value="personal" data-testid="trip-insights-view-personal">
                  {t('insights.view.personal')}
                </ToggleButton>
                <ToggleButton value="business" data-testid="trip-insights-view-business">
                  {t('insights.view.business')}
                </ToggleButton>
                <ToggleButton value="all" data-testid="trip-insights-view-all">
                  {t('insights.view.all')}
                </ToggleButton>
              </ToggleButtonGroup>
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.5 }}>
                {t(`insights.viewHelp.${view}`)}
              </Typography>
            </Box>
          )}
          <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap' }}>
            {filterInput('category', t('common:fields.category'))}
            {filterInput('company', t('insights.merchant'))}
            {filterInput('account', t('common:fields.account'))}
            {filterInput('user', t('insights.person'))}
          </Stack>
          {hasFilters && (
            <Box>
              <Button size="small" onClick={() => setSelected({ category: [], company: [], account: [], user: [] })}>
                {t('insights.clearFilters')}
              </Button>
            </Box>
          )}
        </Stack>
      </Paper>

      {insights.missingRateCount > 0 && (
        <Alert severity="warning">{t('overview.missingRates', { count: insights.missingRateCount })}</Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {t('insights.totalLabel', { view: viewLabel })}
        </Typography>
        <Typography variant="h4" component="p" fontWeight="bold" data-testid="trip-insights-total">
          {money(insights.total)}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {t('insights.rowCount', { count: insights.count })}
        </Typography>
      </Paper>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
        <Paper variant="outlined" sx={{ p: 2 }} data-testid="trip-insights-by-category">
          <Typography variant="subtitle1" component="h3" fontWeight="bold">
            {t('insights.byCategory')}
          </Typography>
          {pieData.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
              {t('insights.nothing')}
            </Typography>
          ) : (
            <PieChart
              series={[
                {
                  data: pieData,
                  innerRadius: 40,
                  paddingAngle: 1,
                  valueFormatter: (item) => money(item.value),
                  highlightScope: { fade: 'global', highlight: 'item' },
                },
              ]}
              height={260}
              hideLegend={compact}
              onItemClick={(_, item) => addFilter('category', categoryBuckets[item.dataIndex])}
            />
          )}
        </Paper>
        {barPanel('company', t('insights.byMerchant'), insights.byCompany, 'trip-insights-by-merchant')}
        {barPanel('user', t('insights.byPerson'), insights.byUser, 'trip-insights-by-person')}
        {barPanel('account', t('insights.byAccount'), insights.byAccount, 'trip-insights-by-account')}
      </Box>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" component="h3" fontWeight="bold">
          {t('insights.byDay')}
        </Typography>
        {insights.byDay.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
            {t('insights.nothing')}
          </Typography>
        ) : (
          <BarChart
            height={220}
            series={[{ data: insights.byDay.map((day) => day.value), valueFormatter: (value: number | null) => (value == null ? '' : money(value)) }]}
            xAxis={[{ scaleType: 'band', data: insights.byDay.map((day) => date(String(day.key))) }]}
            yAxis={[{ width: 70, valueFormatter: (value: number) => money(value) }]}
            hideLegend
            margin={{ top: 10, right: 10, bottom: 24, left: 10 }}
          />
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" component="h3" fontWeight="bold" gutterBottom>
          {t('insights.rowsTitle', { view: viewLabel })}
        </Typography>
        {insights.rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t('insights.nothing')}
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Table size="small" aria-label={t('insights.rowsTitle', { view: viewLabel })} data-testid="trip-insights-rows">
              <TableHead>
                <TableRow>
                  <TableCell>{t('common:fields.date')}</TableCell>
                  <TableCell>{t('common:fields.description')}</TableCell>
                  <TableCell>{t('common:fields.category')}</TableCell>
                  <TableCell>{t('insights.person')}</TableCell>
                  <TableCell align="right">{viewLabel}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {insights.rows.map((row) => (
                  <TableRow key={row.transaction_id}>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{date(row.date)}</TableCell>
                    <TableCell>{row.description}</TableCell>
                    <TableCell>
                      <Chip size="small" variant="outlined" label={nameOf.category(row.category_id, row.category_name)} />
                    </TableCell>
                    <TableCell>{nameOf.user(row.user_id, row.user_name)}</TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {money(row.value)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Paper>
    </Stack>
  );
}
