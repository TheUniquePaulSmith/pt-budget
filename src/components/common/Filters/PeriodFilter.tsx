'use client';

/**
 * A page's Filter control: one Filter button in the app bar (via the shell's
 * page-actions slot) that opens a panel with the report period: an optional
 * "All time", a "This" row (calendar week / month / year containing today),
 * a "Past" row (rolling week / month / year ending today) and a custom range.
 * Pages add their own sections (the Dashboard's accounts and users) as
 * children. Desktop gets a dropdown anchored to the button; phones get a
 * bottom sheet. Changes apply as they are made; custom dates apply with Apply.
 * Used by the Dashboard and Subscriptions pages.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Divider,
  IconButton,
  Popover,
  Stack,
  SwipeableDrawer,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { ArrowDropDown, Close, FilterList } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { PageActions } from '@/components/common/Layout/slots/PageActionsSlot';
import { useFormatters } from '@/contexts/useFormatters';
import { PAST_PERIODS, THIS_PERIODS, type Period } from '@/lib/periodRange';

type RowPeriod = (typeof THIS_PERIODS)[number] | (typeof PAST_PERIODS)[number];

/** The label for a period: "This Month", "Past Year", "All time", or the custom dates. */
export function usePeriodLabel() {
  const { t } = useTranslation('common');
  const { date } = useFormatters();
  return useCallback(
    (period: Period, customStart?: string, customEnd?: string) => {
      if (period === 'all') return t('periodFilter.allTime');
      if (period === 'custom') {
        return customStart && customEnd
          ? t('periodFilter.label.custom', { start: date(customStart), end: date(customEnd) })
          : t('periodFilter.customRange');
      }
      return t(`periodFilter.label.${period}`);
    },
    [date, t]
  );
}

interface PeriodFilterProps {
  period: Period;
  onPeriodChange: (period: Period) => void;
  /** The applied custom range (yyyy-MM-dd), used when `period` is 'custom'. */
  customStart?: string;
  customEnd?: string;
  onCustomDateChange: (start: string, end: string) => void;
  /** Panel heading, e.g. "Dashboard filters". */
  title: string;
  /** Offer "All time" above the This/Past rows. */
  includeAllTime?: boolean;
  /** The page's default period; Reset returns to it. */
  defaultPeriod: Period;
  /** The page's own sections differ from their defaults (enables Reset). */
  hasOtherActiveFilters?: boolean;
  /** Resets the page's own sections. */
  onResetOther?: () => void;
  /** The page's own sections, shown below the period. */
  children?: React.ReactNode;
  /** data-testid prefix; defaults to "period-filter". */
  testIdPrefix?: string;
}

export default function PeriodFilter({
  period,
  onPeriodChange,
  customStart = '',
  customEnd = '',
  onCustomDateChange,
  title,
  includeAllTime = false,
  defaultPeriod,
  hasOtherActiveFilters = false,
  onResetOther,
  children,
  testIdPrefix = 'period-filter',
}: PeriodFilterProps) {
  const { t } = useTranslation('common');
  const periodLabel = usePeriodLabel();
  const theme = useTheme();
  // Same breakpoint as the shell's phone layout (bottom navigation).
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const open = isMobile ? sheetOpen : Boolean(anchorEl);

  // Custom dates are drafted here and applied together.
  const [customOpen, setCustomOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(customStart);
  const [draftEnd, setDraftEnd] = useState(customEnd);

  const summary = periodLabel(period, customStart, customEnd);
  const buttonLabel = t('periodFilter.filterButton', { summary });
  const canReset = period !== defaultPeriod || hasOtherActiveFilters;
  const selectedPeriod: Period = customOpen ? 'custom' : period;

  const openPanel = (event: React.MouseEvent<HTMLElement>) => {
    setCustomOpen(period === 'custom');
    setDraftStart(customStart);
    setDraftEnd(customEnd);
    if (isMobile) setSheetOpen(true);
    else setAnchorEl(event.currentTarget);
  };

  const closePanel = () => {
    setAnchorEl(null);
    setSheetOpen(false);
  };

  const choose = (next: Period) => {
    setCustomOpen(false);
    onPeriodChange(next);
  };

  const applyCustom = () => {
    if (!draftStart || !draftEnd) return;
    onCustomDateChange(draftStart, draftEnd);
    onPeriodChange('custom');
  };

  const reset = () => {
    setCustomOpen(false);
    setDraftStart('');
    setDraftEnd('');
    onCustomDateChange('', '');
    onPeriodChange(defaultPeriod);
    onResetOther?.();
  };

  // Visible text is the bare unit ("Week"); the row says This or Past, and the
  // accessible name is the full period ("Past Week").
  const unitLabel = (row: RowPeriod) => {
    if (row.endsWith('Week')) return t('periodFilter.week');
    if (row.endsWith('Month')) return t('fields.month');
    return t('fields.year');
  };

  const periodRow = (rowLabel: string, periods: readonly RowPeriod[]) => (
    <Box sx={{ display: 'grid', gridTemplateColumns: '56px 1fr', alignItems: 'center', columnGap: 1, mt: 1 }}>
      <Typography variant="body2" color="text.secondary">{rowLabel}</Typography>
      <ToggleButtonGroup
        exclusive
        fullWidth
        size="small"
        color="primary"
        value={(periods as readonly Period[]).includes(selectedPeriod) ? selectedPeriod : null}
        onChange={(_event, next: RowPeriod | null) => next && choose(next)}
        aria-label={rowLabel}
      >
        {periods.map((row) => (
          <ToggleButton key={row} value={row} aria-label={periodLabel(row)} sx={{ textTransform: 'none' }}>
            {unitLabel(row)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );

  // A full-width option aligned with the rows' buttons (All time, Custom Range).
  const wideOption = (value: 'all' | 'custom', label: string, onSelect: () => void) => (
    <Box sx={{ display: 'grid', gridTemplateColumns: '56px 1fr', columnGap: 1, mt: 1 }}>
      <Box />
      <ToggleButton
        value={value}
        size="small"
        color="primary"
        fullWidth
        selected={selectedPeriod === value}
        onChange={onSelect}
        sx={{ textTransform: 'none' }}
      >
        {label}
      </ToggleButton>
    </Box>
  );

  const draftInvalid = !draftStart || !draftEnd || draftStart > draftEnd;

  const panel = (
    <Box sx={{ p: 2, width: { xs: '100%', md: 380 } }} data-testid={`${testIdPrefix}-panel`}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, flexGrow: 1 }}>
          {title}
        </Typography>
        <IconButton size="small" onClick={closePanel} aria-label={t('actions.close')}>
          <Close fontSize="small" />
        </IconButton>
      </Box>

      <Typography variant="overline" color="text.secondary" component="h3">
        {t('periodFilter.timePeriod')}
      </Typography>
      {includeAllTime && wideOption('all', t('periodFilter.allTime'), () => choose('all'))}
      {periodRow(t('periodFilter.thisRow'), THIS_PERIODS)}
      {periodRow(t('periodFilter.pastRow'), PAST_PERIODS)}
      {wideOption('custom', t('periodFilter.customRange'), () => setCustomOpen(true))}

      {customOpen && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2 }} alignItems={{ sm: 'flex-start' }}>
          <TextField
            label={t('periodFilter.startDate')}
            type="date"
            size="small"
            value={draftStart}
            onChange={(event) => setDraftStart(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
          <TextField
            label={t('periodFilter.endDate')}
            type="date"
            size="small"
            value={draftEnd}
            onChange={(event) => setDraftEnd(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
          />
          <Button variant="contained" onClick={applyCustom} disabled={draftInvalid} sx={{ flexShrink: 0, minHeight: 40 }}>
            {t('actions.apply')}
          </Button>
        </Stack>
      )}

      {children}

      <Divider sx={{ my: 2 }} />
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Button onClick={reset} disabled={!canReset}>
          {t('actions.reset')}
        </Button>
        <Button variant="contained" onClick={closePanel}>
          {t('actions.done')}
        </Button>
      </Box>
    </Box>
  );

  const buttonProps = {
    onClick: openPanel,
    'aria-label': buttonLabel,
    'aria-haspopup': 'dialog' as const,
    'aria-expanded': open,
    'data-testid': `${testIdPrefix}-button`,
  };

  return (
    <>
      <PageActions slot="appBar">
        {isMobile ? (
          <Tooltip title={buttonLabel}>
            <IconButton color="inherit" {...buttonProps}>
              <FilterList />
            </IconButton>
          </Tooltip>
        ) : (
          <Button
            variant="outlined"
            color="inherit"
            size="small"
            {...buttonProps}
            startIcon={<FilterList fontSize="small" />}
            endIcon={<ArrowDropDown />}
            sx={{ mr: 1, textTransform: 'none', borderColor: 'divider', maxWidth: 360 }}
          >
            <Box component="span" sx={{ fontWeight: 600, mr: 0.75 }}>{t('actions.filter')}</Box>
            <Box component="span" sx={{ color: 'text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {summary}
            </Box>
          </Button>
        )}
      </PageActions>

      {isMobile ? (
        <SwipeableDrawer
          anchor="bottom"
          open={sheetOpen}
          onOpen={() => setSheetOpen(true)}
          onClose={closePanel}
          disableSwipeToOpen
          slotProps={{ paper: { sx: { borderTopLeftRadius: 12, borderTopRightRadius: 12, maxHeight: '85vh' } } }}
        >
          <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'divider', mx: 'auto', mt: 1 }} />
          <Box sx={{ pb: 'env(safe-area-inset-bottom)' }}>{panel}</Box>
        </SwipeableDrawer>
      ) : (
        <Popover
          open={Boolean(anchorEl)}
          anchorEl={anchorEl}
          onClose={closePanel}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          slotProps={{ paper: { sx: { mt: 1 } } }}
        >
          {panel}
        </Popover>
      )}
    </>
  );
}

/** Memoized helper for pages: the period label for the current selection. */
export function useCurrentPeriodLabel(period: Period, customStart?: string, customEnd?: string) {
  const periodLabel = usePeriodLabel();
  return useMemo(() => periodLabel(period, customStart, customEnd), [customEnd, customStart, period, periodLabel]);
}
