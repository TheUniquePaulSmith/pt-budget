// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/contexts/useDatabaseSlices', () => ({
  useTransactionComposerSlice: vi.fn(),
}));

vi.mock('@mui/x-date-pickers/LocalizationProvider', () => ({
  LocalizationProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@mui/x-date-pickers/AdapterDateFns', () => ({
  AdapterDateFns: class AdapterDateFnsMock {},
}));

vi.mock('@mui/x-date-pickers/DatePicker', () => ({
  DatePicker: ({ label }: { label: string }) => (
    <input aria-label={label} data-testid="transaction-date" defaultValue="2026-04-25" />
  ),
}));

import AddTransaction from './AddTransaction';
import { useTransactionComposerSlice } from '@/contexts/useDatabaseSlices';
import type { Account, Category, Company, Project } from '@/types/database';

const mockedUseTransactionComposerSlice = vi.mocked(useTransactionComposerSlice);

const defaultAccounts: Account[] = [
  {
    id: 1,
    name: 'Primary Checking',
    type: 'checking',
    owner_user_id: 1,
    created_at: '2026-04-25T00:00:00.000Z',
    updated_at: '2026-04-25T00:00:00.000Z',
  },
];

const defaultProjects: Project[] = [
  {
    id: 4,
    name: 'Kitchen Remodel',
    company_name: 'Acme Builders',
    contact_details: 'builder@example.com',
    project_category: 'other',
    status: 'in_progress',
    start_date: null,
    end_date: null,
    estimated_cost: null,
    actual_cost: null,
    notes: null,
    created_at: '2026-04-25T00:00:00.000Z',
    updated_at: '2026-04-25T00:00:00.000Z',
  },
];

function renderDialog() {
  const onClose = vi.fn();
  const onSuccess = vi.fn();

  render(
    <ThemeProvider theme={createTheme()}>
      <AddTransaction open={true} onClose={onClose} onSuccess={onSuccess} />
    </ThemeProvider>
  );

  return { onClose, onSuccess };
}

async function selectAccount(user: ReturnType<typeof userEvent.setup>, accountName: string) {
  const dialog = screen.getByRole('dialog');
  const comboboxes = Array.from(dialog.querySelectorAll('[role="combobox"]'));
  const accountSelect = comboboxes.at(-1) as HTMLElement | undefined;

  if (!accountSelect) {
    throw new Error('Account select was not rendered');
  }

  await user.click(accountSelect);
  await user.click(await screen.findByRole('option', { name: new RegExp(accountName, 'i') }));
}

describe('AddTransaction', () => {
  beforeEach(() => {
    mockedUseTransactionComposerSlice.mockReset();
  });

  it('submits an expense transaction with a normalized negative amount', async () => {
    const addTransaction = vi.fn().mockResolvedValue(undefined);

    mockedUseTransactionComposerSlice.mockReturnValue({
      addTransaction,
      addCategory: vi.fn(),
      addCompany: vi.fn(),
      categories: [] as Category[],
      companies: [] as Company[],
      accounts: defaultAccounts,
      projects: defaultProjects,
    } as never);

    const { onClose, onSuccess } = renderDialog();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/description/i), 'Monthly rent');
    await user.type(screen.getByLabelText(/amount/i), '1200');
    await selectAccount(user, 'Primary Checking');
    await user.click(screen.getByRole('button', { name: 'Add Transaction' }));

    await waitFor(() => {
      expect(addTransaction).toHaveBeenCalledTimes(1);
    });

    expect(addTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Monthly rent',
        amount: -1200,
        type: 'expense',
        category_id: null,
        company_id: null,
        project_id: null,
        account_id: 1,
        trip_id: null,
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      })
    );
    expect(onSuccess).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('creates free-text category and company entries before submitting', async () => {
    const addTransaction = vi.fn().mockResolvedValue(undefined);
    const addCategory = vi.fn().mockResolvedValue(11);
    const addCompany = vi.fn().mockResolvedValue(22);

    mockedUseTransactionComposerSlice.mockReturnValue({
      addTransaction,
      addCategory,
      addCompany,
      categories: [] as Category[],
      companies: [] as Company[],
      accounts: defaultAccounts,
      projects: defaultProjects,
    } as never);

    renderDialog();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/description/i), 'Plane tickets');
    await user.type(screen.getByLabelText(/amount/i), '350');
    await user.type(screen.getByLabelText(/category/i), 'Travel');
    await user.type(screen.getByLabelText(/company/i), 'Playwright Travel');
    await selectAccount(user, 'Primary Checking');
    await user.click(screen.getByRole('button', { name: 'Add Transaction' }));

    await waitFor(() => {
      expect(addCategory).toHaveBeenCalledTimes(1);
      expect(addCompany).toHaveBeenCalledTimes(1);
      expect(addTransaction).toHaveBeenCalledTimes(1);
    });

    expect(addCategory).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Travel',
        type: 'expense',
        color: expect.stringMatching(/^#/),
      })
    );
    expect(addCompany).toHaveBeenCalledWith('Playwright Travel');
    expect(addTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Plane tickets',
        amount: -350,
        category_id: 11,
        company_id: 22,
        account_id: 1,
      })
    );
  });
});