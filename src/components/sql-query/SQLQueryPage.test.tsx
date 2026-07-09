// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mui/material', async () => {
  const actual = await vi.importActual<typeof import('@mui/material')>('@mui/material');

  return {
    ...actual,
    useMediaQuery: () => false,
  };
});

vi.mock('@/contexts/useDatabaseSlices', () => ({
  useSqlQuerySlice: vi.fn(),
}));

vi.mock('@mui/icons-material', () => {
  const createIcon = (testId: string) => {
    function MockIcon() {
      return React.createElement('span', { 'data-testid': testId });
    }

    return MockIcon;
  };

  return {
    PlayArrow: createIcon('play-arrow-icon'),
    Clear: createIcon('clear-icon'),
    Storage: createIcon('storage-icon'),
    ExpandMore: createIcon('expand-more-icon'),
    ContentCopy: createIcon('content-copy-icon'),
    History: createIcon('history-icon'),
  };
});

import SQLQueryPage from './SQLQueryPage';
import { useSqlQuerySlice } from '@/contexts/useDatabaseSlices';

const mockedUseSqlQuerySlice = vi.mocked(useSqlQuerySlice);

function renderPage() {
  return render(
    <ThemeProvider theme={createTheme()}>
      <SQLQueryPage />
    </ThemeProvider>
  );
}

describe('SQLQueryPage', () => {
  beforeEach(() => {
    mockedUseSqlQuerySlice.mockReset();
  });

  it('shows an error when a query is executed before the database is loaded', async () => {
    const executeCustomQuery = vi.fn();
    mockedUseSqlQuerySlice.mockReturnValue({
      executeCustomQuery,
      isDatabaseLoaded: false,
    } as never);

    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByTestId('sql-query-input'), 'SELECT 1;');
    await user.click(screen.getByRole('button', { name: 'Execute Query' }));

    expect(await screen.findByText('Database not loaded')).toBeInTheDocument();
    expect(executeCustomQuery).not.toHaveBeenCalled();
  });

  it('renders query results and records history when execution succeeds', async () => {
    const executeCustomQuery = vi.fn().mockResolvedValue([{ count: 3 }]);
    mockedUseSqlQuerySlice.mockReturnValue({
      executeCustomQuery,
      isDatabaseLoaded: true,
    } as never);

    renderPage();
    const user = userEvent.setup();
    const query = 'SELECT COUNT(*) AS count FROM transactions;';

    await user.type(screen.getByTestId('sql-query-input'), query);
    await user.click(screen.getByRole('button', { name: 'Execute Query' }));

    await waitFor(() => {
      expect(executeCustomQuery).toHaveBeenCalledWith(query, 10000);
    });

    expect(await screen.findByText('Query Results')).toBeInTheDocument();
    expect(screen.getByText('count')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/Query History \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
  });

  it('allows direct range edits that stay aligned with rows per page', async () => {
    const rows = Array.from({ length: 260 }, (_, index) => ({ value: `row-${index + 1}` }));
    const executeCustomQuery = vi.fn().mockResolvedValue(rows);
    mockedUseSqlQuerySlice.mockReturnValue({
      executeCustomQuery,
      isDatabaseLoaded: true,
    } as never);

    renderPage();
    const user = userEvent.setup();

    await user.type(screen.getByTestId('sql-query-input'), 'SELECT value FROM transactions;');
    await user.click(screen.getByRole('button', { name: 'Execute Query' }));

    expect(await screen.findByText('row-1')).toBeInTheDocument();
    expect(screen.getByTestId('sql-query-range-start')).toHaveValue('1');
    expect(screen.getByTestId('sql-query-range-end')).toHaveValue('25');

    await user.click(screen.getByRole('combobox', { name: /rows per page/i }));
    await user.click(await screen.findByRole('option', { name: '100' }));

    const endInput = screen.getByTestId('sql-query-range-end');
    await user.clear(endInput);
    await user.type(endInput, '260');
    await user.tab();

    await waitFor(() => {
      expect(screen.getByText('row-201')).toBeInTheDocument();
    });

    expect(screen.getByTestId('sql-query-range-start')).toHaveValue('201');
    expect(screen.getByTestId('sql-query-range-end')).toHaveValue('260');
    expect(screen.queryByText('row-1')).not.toBeInTheDocument();
  });
});