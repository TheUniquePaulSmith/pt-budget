// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mui/material', async () => {
  const actual = await vi.importActual<typeof import('@mui/material')>('@mui/material');

  return {
    ...actual,
    useMediaQuery: () => false,
  };
});

vi.mock('@/contexts/useDatabaseSlices', () => ({
  useTransactionReportSlice: vi.fn(),
}));

vi.mock('@mui/icons-material', () => {
  const createIcon = (testId: string) => {
    function MockIcon() {
      return React.createElement('span', { 'data-testid': testId });
    }

    return MockIcon;
  };

  return {
    FilterList: createIcon('filter-list-icon'),
    ClearAll: createIcon('clear-all-icon'),
    Download: createIcon('download-icon'),
    Receipt: createIcon('receipt-icon'),
    ViewColumn: createIcon('view-column-icon'),
    ExpandMore: createIcon('expand-more-icon'),
    ExpandLess: createIcon('expand-less-icon'),
    Label: createIcon('label-icon'),
  };
});

vi.mock('@mui/x-date-pickers/LocalizationProvider', () => ({
  LocalizationProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@mui/x-date-pickers/AdapterDateFns', () => ({
  AdapterDateFns: class AdapterDateFnsMock {},
}));

vi.mock('@mui/x-date-pickers/DatePicker', () => ({
  DatePicker: ({ label }: { label: string }) => (
    <input aria-label={label} data-testid={`date-picker-${label.toLowerCase().replace(/\s+/g, '-')}`} />
  ),
}));

vi.mock('./TransactionLabelDialog', () => ({
  default: ({ open, transaction }: { open: boolean; transaction: { description?: string } | null }) =>
    open ? <div data-testid="transaction-label-dialog">{transaction?.description}</div> : null,
}));

import TransactionReport from './TransactionReport';
import { useTransactionReportSlice } from '@/contexts/useDatabaseSlices';
import type { Account, Category, Company, Project, Transaction, TransactionQueryParams } from '@/types/database';

const mockedUseTransactionReportSlice = vi.mocked(useTransactionReportSlice);

const categories: Category[] = [
  { id: 1, name: 'Salary', type: 'income', color: '#4caf50', created_at: '2026-04-25T00:00:00.000Z', updated_at: '2026-04-25T00:00:00.000Z' },
  { id: 2, name: 'Groceries', type: 'expense', color: '#f44336', created_at: '2026-04-25T00:00:00.000Z', updated_at: '2026-04-25T00:00:00.000Z' },
];

const companies: Company[] = [
  { id: 1, name: 'Employer Inc', created_at: '2026-04-25T00:00:00.000Z', updated_at: '2026-04-25T00:00:00.000Z' },
  { id: 2, name: 'Fresh Market', created_at: '2026-04-25T00:00:00.000Z', updated_at: '2026-04-25T00:00:00.000Z' },
];

const accounts: Account[] = [
  { id: 1, name: 'Primary Checking', type: 'checking', owner_user_id: 1, owner_display_name: 'Pat', created_at: '2026-04-25T00:00:00.000Z', updated_at: '2026-04-25T00:00:00.000Z' },
];

const projects: Project[] = [
  { id: 4, name: 'Kitchen Remodel', company_name: 'Acme Builders', contact_details: 'builder@example.com', project_category: 'other', status: 'in_progress', start_date: null, end_date: null, estimated_cost: null, actual_cost: null, notes: null, created_at: '2026-04-25T00:00:00.000Z', updated_at: '2026-04-25T00:00:00.000Z' },
];

const baseTransactions: Transaction[] = [
  {
    id: 1,
    date: '2026-04-20',
    amount: 2500,
    description: 'Monthly salary deposit',
    account_id: 1,
    category_id: 1,
    company_id: 1,
    project_id: null,
    trip_id: null,
    type: 'income',
    transaction_hash: 'abc123',
    created_at: '2026-04-20T00:00:00.000Z',
    updated_at: '2026-04-20T00:00:00.000Z',
    category_name: 'Salary',
    company_name: 'Employer Inc',
    account_name: 'Primary Checking',
  },
  {
    id: 2,
    date: '2026-04-22',
    amount: -82.35,
    description: 'Weekly grocery shopping',
    account_id: 1,
    category_id: 2,
    company_id: 2,
    project_id: 4,
    trip_id: null,
    type: 'expense',
    transaction_hash: 'def456',
    created_at: '2026-04-22T00:00:00.000Z',
    updated_at: '2026-04-22T00:00:00.000Z',
    category_name: 'Groceries',
    company_name: 'Fresh Market',
    account_name: 'Primary Checking',
    project_name: 'Kitchen Remodel',
  },
];

function createMockGetTransactionsPaginated(allTransactions: Transaction[]) {
  return vi.fn().mockImplementation(async (params: TransactionQueryParams) => {
    let filtered = allTransactions;
    if (params.search) {
      const s = params.search.toLowerCase();
      filtered = filtered.filter(t =>
        t.description.toLowerCase().includes(s) ||
        (t.category_name || '').toLowerCase().includes(s) ||
        (t.company_name || '').toLowerCase().includes(s)
      );
    }
    if (params.type) {
      filtered = filtered.filter(t => t.type === params.type);
    }
    const totalIncome = filtered.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const totalExpenses = filtered.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
    const start = params.page * params.pageSize;
    return { data: filtered.slice(start, start + params.pageSize), total: filtered.length, totalIncome, totalExpenses };
  });
}

function renderReport(transactions: Transaction[] = baseTransactions) {
  const getTransactionsPaginated = createMockGetTransactionsPaginated(transactions);
  const getTransactionsForExport = vi.fn().mockResolvedValue(transactions);

  mockedUseTransactionReportSlice.mockReturnValue({
    transactionVersion: 0,
    categories,
    companies,
    projects,
    accounts,
    getTransactionsPaginated,
    getTransactionsForExport,
  } as never);

  render(
    <ThemeProvider theme={createTheme()}>
      <TransactionReport />
    </ThemeProvider>
  );

  return { getTransactionsPaginated };
}

describe('TransactionReport', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockedUseTransactionReportSlice.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches and renders transactions on mount', async () => {
    const { getTransactionsPaginated } = renderReport();

    await waitFor(() => {
      expect(screen.getByText('Monthly salary deposit')).toBeInTheDocument();
    });

    expect(getTransactionsPaginated).toHaveBeenCalledWith(expect.objectContaining({ page: 0 }));
  });

  it('filters by search term and restores all rows when filters are cleared', async () => {
    renderReport();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });

    await waitFor(() => {
      expect(screen.getByText('Monthly salary deposit')).toBeInTheDocument();
    });

    expect(screen.getByText('Weekly grocery shopping')).toBeInTheDocument();
    expect(screen.getByText('Project: Kitchen Remodel')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Search' }), 'salary');
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      expect(screen.getByText('Monthly salary deposit')).toBeInTheDocument();
      expect(screen.queryByText('Weekly grocery shopping')).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Clear Filters' }));
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      expect(screen.getByText('Monthly salary deposit')).toBeInTheDocument();
      expect(screen.getByText('Weekly grocery shopping')).toBeInTheDocument();
    });
  });

  it('opens the label dialog for the selected transaction', async () => {
    renderReport();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });

    await waitFor(() => {
      expect(screen.getByText('Monthly salary deposit')).toBeInTheDocument();
    });

    const salaryRow = screen.getByText('Monthly salary deposit').closest('tr');
    if (!salaryRow) throw new Error('Salary transaction row was not rendered');

    await user.click(within(salaryRow).getByTitle('Label Transaction'));

    expect(await screen.findByTestId('transaction-label-dialog')).toHaveTextContent('Monthly salary deposit');
  });
});
