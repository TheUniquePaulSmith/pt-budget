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

vi.mock('./useSqlSchema', () => ({
  useSqlSchema: () => ({
    schema: null,
    schemaError: null,
    schemaLoading: false,
    refreshSchema: vi.fn(),
  }),
}));

vi.mock('./SqlEditor', () => ({
  default: ({ value, onChange, 'data-testid': testId }: {
    value: string;
    onChange: (value: string) => void;
    'data-testid'?: string;
  }) => (
    <textarea
      data-testid={testId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

vi.mock('@/components/common/DataGrid/AppDataGrid', () => ({
  AppDataGrid: ({ rows, columns }: { rows: any[]; columns: Array<{ field: string; headerName?: string }> }) => (
    <div role="grid">
      <div role="row">
        {columns.map((column) => (
          <div role="columnheader" key={column.field}>{column.headerName ?? column.field}</div>
        ))}
      </div>
      {rows.map((row) => (
        <div role="row" key={row.__idx}>
          {columns.map((column) => (
            <div role="gridcell" key={column.field}>{String(row[column.field] ?? '')}</div>
          ))}
        </div>
      ))}
    </div>
  ),
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
    ListAlt: createIcon('list-alt-icon'),
    AutoFixHigh: createIcon('auto-fix-high-icon'),
    Close: createIcon('close-icon'),
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

    await user.type(await screen.findByTestId('sql-query-input'), 'SELECT 1;');
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

    await user.type(await screen.findByTestId('sql-query-input'), query);
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

  it('renders larger result sets in a grid', async () => {
    const rows = Array.from({ length: 260 }, (_, index) => ({ value: `row-${index + 1}` }));
    const executeCustomQuery = vi.fn().mockResolvedValue(rows);
    mockedUseSqlQuerySlice.mockReturnValue({
      executeCustomQuery,
      isDatabaseLoaded: true,
    } as never);

    renderPage();
    const user = userEvent.setup();

    await user.type(await screen.findByTestId('sql-query-input'), 'SELECT value FROM transactions;');
    await user.click(screen.getByRole('button', { name: 'Execute Query' }));

    expect(await screen.findByRole('grid')).toBeInTheDocument();
    expect(screen.getAllByRole('gridcell')).toHaveLength(260);
    expect(screen.getByText('row-1')).toBeInTheDocument();
    expect(screen.getByText('row-260')).toBeInTheDocument();
  });
});