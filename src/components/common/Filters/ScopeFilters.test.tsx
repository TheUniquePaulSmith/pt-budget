// @vitest-environment jsdom

import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageActionsOutlet, PageActionsProvider } from '@/components/common/Layout/slots/PageActionsSlot';
import { ScopeFilterChips, ScopeFiltersProvider, hasActiveScopeFilters, useScopeFilters } from './ScopeFilters';

/** A stand-in report page: shows the shared selection and its footer chips. */
function ReportPage({ name }: { name: string }) {
  const { scopeFilters, setScopeFilters } = useScopeFilters();
  return (
    <div data-testid={`page-${name}`}>
      <span data-testid="selection">{JSON.stringify(scopeFilters)}</span>
      <button onClick={() => setScopeFilters({ accountIds: [2, 3] })}>pick accounts</button>
      <ScopeFilterChips scopeFilters={scopeFilters} onChange={setScopeFilters} />
    </div>
  );
}

function Shell() {
  const [page, setPage] = useState<'dashboard' | 'subscriptions'>('dashboard');
  return (
    <PageActionsProvider>
      <ScopeFiltersProvider>
        <button onClick={() => setPage(page === 'dashboard' ? 'subscriptions' : 'dashboard')}>switch page</button>
        {/* Pages remount on navigation, as in AppShell. */}
        <ReportPage key={page} name={page} />
        <footer>
          <PageActionsOutlet slot="statusBar" />
        </footer>
      </ScopeFiltersProvider>
    </PageActionsProvider>
  );
}

describe('shared account/user filters', () => {
  it('carry over between report pages and show as removable chips in the status bar', () => {
    render(<Shell />);

    fireEvent.click(screen.getByRole('button', { name: 'pick accounts' }));
    fireEvent.click(screen.getByRole('button', { name: 'switch page' }));

    expect(screen.getByTestId('page-subscriptions')).toBeInTheDocument();
    expect(screen.getByTestId('selection')).toHaveTextContent('{"accountIds":[2,3]}');

    const footer = screen.getByTestId('status-bar-page-actions');
    const chip = within(footer).getByText('Accounts: 2 selected');
    fireEvent.click(within(chip.closest('.MuiChip-root') as HTMLElement).getByTestId('CancelIcon'));

    expect(screen.getByTestId('selection')).toHaveTextContent('{"accountIds":[]}');
    expect(within(footer).queryByText('Accounts: 2 selected')).not.toBeInTheDocument();
  });

  it('keeps a page-local selection outside the shell', () => {
    render(<ReportPage name="alone" />);
    fireEvent.click(screen.getByRole('button', { name: 'pick accounts' }));
    expect(screen.getByTestId('selection')).toHaveTextContent('{"accountIds":[2,3]}');
    // No status bar outlet: the chips render inline.
    expect(screen.getByText('Accounts: 2 selected')).toBeInTheDocument();
  });

  it('knows when account or user filters are set', () => {
    expect(hasActiveScopeFilters({})).toBe(false);
    expect(hasActiveScopeFilters({ accountIds: [], userIds: [] })).toBe(false);
    expect(hasActiveScopeFilters({ userIds: [2] })).toBe(true);
  });
});
