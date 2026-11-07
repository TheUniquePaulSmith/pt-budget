// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PageActionsOutlet, PageActionsProvider } from '@/components/common/Layout/slots/PageActionsSlot';
import PeriodFilter from './PeriodFilter';

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

function renderFilter(overrides: Partial<React.ComponentProps<typeof PeriodFilter>> = {}) {
  const props = {
    period: 'thisMonth' as const,
    onPeriodChange: vi.fn(),
    onCustomDateChange: vi.fn(),
    title: 'Dashboard filters',
    defaultPeriod: 'thisMonth' as const,
    ...overrides,
  };
  render(
    <PageActionsProvider>
      <header>
        <PageActionsOutlet slot="appBar" />
      </header>
      <main>
        <PeriodFilter {...props} />
      </main>
    </PageActionsProvider>
  );
  return props;
}

const openPanel = (summary: string) => {
  fireEvent.click(screen.getByRole('button', { name: `Filter: ${summary}` }));
  return screen.getByTestId('period-filter-panel');
};

describe('PeriodFilter', () => {
  // Desktop by default; the phone test switches to a matching (max-width) query.
  beforeEach(() => installMatchMedia(false));

  it('puts the Filter button in the app bar with the current period and no count', () => {
    renderFilter();

    const button = within(screen.getByTestId('app-bar-page-actions')).getByRole('button', { name: 'Filter: This Month' });
    expect(button).toHaveTextContent('FilterThis Month');
  });

  it('offers This and Past rows of the same units', () => {
    const props = renderFilter();
    const panel = openPanel('This Month');

    expect(within(panel).getByRole('heading', { name: 'Dashboard filters' })).toBeInTheDocument();
    expect(within(panel).getByRole('group', { name: 'This' })).toHaveTextContent('WeekMonthYear');
    expect(within(panel).getByRole('group', { name: 'Past' })).toHaveTextContent('WeekMonthYear');
    expect(within(panel).getByRole('button', { name: 'This Month' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(panel).queryByRole('button', { name: 'All time' })).not.toBeInTheDocument();

    fireEvent.click(within(panel).getByRole('button', { name: 'This Year' }));
    expect(props.onPeriodChange).toHaveBeenLastCalledWith('thisYear');
    fireEvent.click(within(panel).getByRole('button', { name: 'Past Week' }));
    expect(props.onPeriodChange).toHaveBeenLastCalledWith('pastWeek');
  });

  it('offers All time where the page supports it', () => {
    const props = renderFilter({ period: 'all', defaultPeriod: 'all', includeAllTime: true });
    const panel = openPanel('All time');

    const allTime = within(panel).getByRole('button', { name: 'All time' });
    expect(allTime).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(panel).getByRole('button', { name: 'Past Month' }));
    expect(props.onPeriodChange).toHaveBeenLastCalledWith('pastMonth');
    fireEvent.click(allTime);
    expect(props.onPeriodChange).toHaveBeenLastCalledWith('all');
  });

  it('applies a custom range only once both dates are set', () => {
    const props = renderFilter();
    const panel = openPanel('This Month');

    fireEvent.click(within(panel).getByRole('button', { name: 'Custom Range' }));
    expect(props.onPeriodChange).not.toHaveBeenCalled();

    const apply = within(panel).getByRole('button', { name: 'Apply' });
    expect(apply).toBeDisabled();
    fireEvent.change(within(panel).getByLabelText('Start Date'), { target: { value: '2026-01-01' } });
    fireEvent.change(within(panel).getByLabelText('End Date'), { target: { value: '2026-03-31' } });
    fireEvent.click(apply);

    expect(props.onCustomDateChange).toHaveBeenCalledWith('2026-01-01', '2026-03-31');
    expect(props.onPeriodChange).toHaveBeenCalledWith('custom');
  });

  it('resets the period and the page sections to their defaults', () => {
    const onResetOther = vi.fn();
    const props = renderFilter({ period: 'pastYear', hasOtherActiveFilters: true, onResetOther });
    fireEvent.click(within(openPanel('Past Year')).getByRole('button', { name: 'Reset' }));

    expect(props.onPeriodChange).toHaveBeenCalledWith('thisMonth');
    expect(props.onCustomDateChange).toHaveBeenCalledWith('', '');
    expect(onResetOther).toHaveBeenCalled();
  });

  it('disables Reset when everything is at its default', () => {
    renderFilter();
    expect(within(openPanel('This Month')).getByRole('button', { name: 'Reset' })).toBeDisabled();
  });

  it('uses a plain icon button and a bottom sheet on phones', () => {
    installMatchMedia(true);
    renderFilter({ period: 'thisWeek' });

    const button = within(screen.getByTestId('app-bar-page-actions')).getByRole('button', { name: 'Filter: This Week' });
    expect(button).toHaveTextContent('');
    fireEvent.click(button);
    expect(screen.getByTestId('period-filter-panel')).toBeInTheDocument();
  });

  it('renders inline when no app bar slot is present', () => {
    render(
      <PeriodFilter
        period="thisMonth"
        onPeriodChange={vi.fn()}
        onCustomDateChange={vi.fn()}
        title="Filters"
        defaultPeriod="thisMonth"
      />
    );
    expect(screen.getByRole('button', { name: 'Filter: This Month' })).toBeInTheDocument();
  });
});
