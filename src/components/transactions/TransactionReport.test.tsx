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
  useTransactionQuickActionsSlice: vi.fn(),
}));

vi.mock('@/components/common/DataGrid/AppDataGrid', () => ({
  AppDataGrid: ({
    rows,
    columns,
    checkboxSelection,
    rowSelectionModel,
    onRowSelectionModelChange,
  }: {
    rows: any[];
    columns: Array<any>;
    checkboxSelection?: boolean;
    rowSelectionModel?: { type: 'include' | 'exclude'; ids: Set<number> };
    onRowSelectionModelChange?: (model: { type: 'include'; ids: Set<number> }) => void;
  }) => (
    <table role="grid">
      <thead>
        <tr role="row">
          {checkboxSelection && <th role="columnheader">Select</th>}
          {columns.map((column) => (
            <th role="columnheader" key={column.field}>{column.headerName ?? column.field}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr role="row" key={row.id}>
            {checkboxSelection && (
              <td role="gridcell">
                <input
                  type="checkbox"
                  aria-label={`Select row ${row.id}`}
                  checked={rowSelectionModel?.ids?.has(row.id) ?? false}
                  onChange={(event) => {
                    const next = new Set(rowSelectionModel?.ids ?? []);
                    if (event.target.checked) next.add(row.id);
                    else next.delete(row.id);
                    onRowSelectionModelChange?.({ type: 'include', ids: next });
                  }}
                />
              </td>
            )}
            {columns.map((column) => (
              <td role="gridcell" key={column.field}>
                {column.renderCell
                  ? column.renderCell({ row, value: row[column.field] })
                  : String(row[column.field] ?? '')}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
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
    FilterList: createIcon('filter-list-icon'),
    ClearAll: createIcon('clear-all-icon'),
    Download: createIcon('download-icon'),
    EditNote: createIcon('edit-note-icon'),
    MoreVert: createIcon('more-vert-icon'),
    Receipt: createIcon('receipt-icon'),
    ViewColumn: createIcon('view-column-icon'),
    ExpandMore: createIcon('expand-more-icon'),
    ExpandLess: createIcon('expand-less-icon'),
    Label: createIcon('label-icon'),
    CalendarMonth: createIcon('calendar-month-icon'),
    CreditCard: createIcon('credit-card-icon'),
    Flag: createIcon('flag-icon'),
    Savings: createIcon('savings-icon'),
    Work: createIcon('work-icon'),
    Autorenew: createIcon('autorenew-icon'),
    Business: createIcon('business-icon'),
    Category: createIcon('category-icon'),
    Clear: createIcon('clear-icon'),
    Assignment: createIcon('assignment-icon'),
    Close: createIcon('close-icon'),
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
import {
  useTransactionQuickActionsSlice,
  useTransactionReportSlice,
} from '@/contexts/useDatabaseSlices';
import type { Account, Category, Company, Project, Transaction, TransactionQueryParams } from '@/types/database';

const mockedUseTransactionReportSlice = vi.mocked(useTransactionReportSlice);
const mockedUseTransactionQuickActionsSlice = vi.mocked(useTransactionQuickActionsSlice);

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

const users = [
  { id: 1, display_name: 'Pat', is_primary: 1, created_at: '2026-04-25T00:00:00.000Z', updated_at: '2026-04-25T00:00:00.000Z' },
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
    card_id: null,
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
    service_name: 'Payroll',
  },
  {
    id: 2,
    date: '2026-04-22',
    amount: -82.35,
    description: 'Weekly grocery shopping',
    account_id: 1,
    card_id: null,
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
    service_name: 'Grocery Delivery',
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
  const setTransactionComment = vi.fn().mockResolvedValue(undefined);
  const applyTransactionClassifications = vi.fn().mockResolvedValue({ appliedCount: 0, transactionIds: [] });
  const bulkLinkTransactionsToSeries = vi.fn().mockResolvedValue({ appliedCount: 0 });

  mockedUseTransactionReportSlice.mockReturnValue({
    transactionVersion: 0,
    budgetVersion: 0,
    categories,
    companies,
    projects,
    accounts,
    users,
    recurringSeries: [],
    getTransactionsPaginated,
    getTransactionsForExport,
    setTransactionComment,
    getEffectiveBudgetPlan: vi.fn().mockResolvedValue(null),
    applyTransactionClassifications,
    bulkLinkTransactionsToSeries,
  } as never);

  mockedUseTransactionQuickActionsSlice.mockReturnValue({
    categories,
    companies,
    trips: [],
    recurringSeries: [],
    setTransactionCategory: vi.fn().mockResolvedValue(undefined),
    setTransactionCompany: vi.fn().mockResolvedValue(undefined),
    linkTransactionToSeries: vi.fn().mockResolvedValue(undefined),
    unlinkTransactionFromSeries: vi.fn().mockResolvedValue(undefined),
    updateTransactionLabels: vi.fn().mockResolvedValue(undefined),
    addCompany: vi.fn().mockResolvedValue(undefined),
    updateCompany: vi.fn().mockResolvedValue(undefined),
  } as never);

  render(
    <ThemeProvider theme={createTheme()}>
      <TransactionReport />
    </ThemeProvider>
  );

  return { getTransactionsPaginated, setTransactionComment, applyTransactionClassifications, bulkLinkTransactionsToSeries };
}

describe('TransactionReport', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockedUseTransactionReportSlice.mockReset();
    mockedUseTransactionQuickActionsSlice.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fetches and renders transactions on mount', async () => {
    const { getTransactionsPaginated } = renderReport();

    await waitFor(() => {
      expect(screen.getByText('Monthly salary deposit')).toBeInTheDocument();
    });
    expect(screen.getByText('Payroll')).toBeInTheDocument();

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

  it('opens and saves the comment dialog for the selected transaction', async () => {
    const { setTransactionComment } = renderReport();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });

    await waitFor(() => {
      expect(screen.getByText('Monthly salary deposit')).toBeInTheDocument();
    });

    const salaryRow = screen.getByText('Monthly salary deposit').closest('tr');
    if (!salaryRow) throw new Error('Salary transaction row was not rendered');

    await user.click(within(salaryRow).getByTitle('Edit Comment'));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Comment' });
    const input = within(dialog).getByLabelText('Comment');
    await user.clear(input);
    await user.type(input, 'Updated salary memo');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(setTransactionComment).toHaveBeenCalledWith(1, 'Updated salary memo');
    });
  });

  it('shows the bulk actions bar once a row is selected and clears it on demand', async () => {
    renderReport();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });

    await waitFor(() => {
      expect(screen.getByText('Monthly salary deposit')).toBeInTheDocument();
    });

    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }));

    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set Category/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set Company/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set Project/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Subscription Link/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Clear Selection/ }));

    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
  });

  it('applies a bulk category to every selected transaction', async () => {
    const { applyTransactionClassifications } = renderReport();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });

    await waitFor(() => {
      expect(screen.getByText('Monthly salary deposit')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('checkbox', { name: 'Select row 1' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select row 2' }));
    await user.click(screen.getByRole('button', { name: /Set Category/ }));

    const dialog = await screen.findByRole('dialog', { name: /Set Category/ });
    await user.click(within(dialog).getByLabelText('Category'));
    await user.click(await screen.findByRole('option', { name: 'Groceries' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => {
      expect(applyTransactionClassifications).toHaveBeenCalledWith([
        { transactionId: 1, categoryId: 2 },
        { transactionId: 2, categoryId: 2 },
      ]);
    });
  });

  it('filters for transactions missing a category', async () => {
    const { getTransactionsPaginated } = renderReport();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime.bind(vi) });

    await waitFor(() => {
      expect(screen.getByText('Monthly salary deposit')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('checkbox', { name: 'Missing Category' }));

    await waitFor(() => {
      expect(getTransactionsPaginated).toHaveBeenLastCalledWith(
        expect.objectContaining({ missingCategory: true })
      );
    });
  });
});
