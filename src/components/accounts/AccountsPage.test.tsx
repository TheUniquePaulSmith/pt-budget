// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Account, AccountCard, User } from '@/types/database';

// The DataGrid virtualises rows against a zero-size jsdom viewport, so the
// grid variant is replaced by a plain list that exercises the same props.
vi.mock('@/components/common/DataGrid/AppDataGrid', () => ({
  AppDataGrid: ({ rows, onRowClick, rowSelectionModel }: any) => (
    <ul data-testid="accounts-grid-stub">
      {rows.map((row: any) => (
        <li
          key={row.id}
          data-testid={`grid-row-${row.id}`}
          data-selected={String(rowSelectionModel?.ids?.has(row.id) ?? false)}
          onClick={() => onRowClick?.({ row })}
        >
          {row.name} | {row.institution} | {row.owner} | {row.cards.map((card: AccountCard) => card.last_four).join(',')}
        </li>
      ))}
    </ul>
  ),
}));

const users: User[] = [
  { id: 1, display_name: 'Avery', is_primary: 1, created_at: '', updated_at: '' },
  { id: 2, display_name: 'Jordan', is_primary: 0, created_at: '', updated_at: '' },
];

const initialAccounts: Account[] = [
  {
    id: 10,
    name: 'Household Checking',
    type: 'checking',
    ownership: 'joint',
    owner_user_id: 1,
    institution: 'First Bank',
    opening_balance: 100,
    opening_balance_date: '2024-01-01',
    credit_limit: null,
    is_active: 1,
    include_in_net_worth: 1,
    created_at: '',
    updated_at: '',
  },
  {
    id: 11,
    name: 'Rewards Visa',
    type: 'credit',
    ownership: 'individual',
    owner_user_id: 2,
    institution: null,
    opening_balance: 0,
    opening_balance_date: null,
    credit_limit: 5000,
    is_active: 1,
    include_in_net_worth: 0,
    created_at: '',
    updated_at: '',
  },
];

const initialCards: Record<number, AccountCard[]> = {
  10: [{ id: 100, account_id: 10, last_four: '1111', nickname: 'Main', user_id: null, created_at: '' }],
  11: [
    { id: 110, account_id: 11, last_four: '2222', nickname: null, user_id: 2, created_at: '' },
    { id: 111, account_id: 11, last_four: '3333', nickname: 'Spouse', user_id: 1, created_at: '' },
  ],
};

// A tiny in-memory "database" behind the mocked slice so mutations refresh
// the collections the way the real provider does.
const store = {
  accounts: [] as Account[],
  cards: {} as Record<number, AccountCard[]>,
  listeners: new Set<() => void>(),
  notify() {
    this.listeners.forEach((listener) => listener());
  },
};

const updateAccount = vi.fn(async (id: number, updates: Partial<Account>) => {
  store.accounts = store.accounts.map((account) => (account.id === id ? { ...account, ...updates } : account));
  store.notify();
});
const addAccountCard = vi.fn(async (card: { account_id: number; last_four: string; full_number?: string | null; nickname?: string; user_id?: number }) => {
  const id = Date.now();
  store.cards[card.account_id] = [
    ...(store.cards[card.account_id] ?? []),
    { id, account_id: card.account_id, last_four: card.last_four, nickname: card.nickname ?? null, user_id: card.user_id ?? null, created_at: '' },
  ];
  return id;
});
const deleteAccountCard = vi.fn(async (id: number) => {
  for (const accountId of Object.keys(store.cards)) {
    store.cards[Number(accountId)] = store.cards[Number(accountId)].filter((card) => card.id !== id);
  }
});
const updateAccountCard = vi.fn(async () => undefined);
const getAccountCards = vi.fn(async (accountId: number) => store.cards[accountId] ?? []);
const deleteAccount = vi.fn(async (id: number) => {
  store.accounts = store.accounts.filter((account) => account.id !== id);
  store.notify();
});
const addUser = vi.fn(async () => 3);
const updateUser = vi.fn(async () => undefined);
const deleteUser = vi.fn(async () => undefined);
const addAccountWithCard = vi.fn(async () => ({ accountId: 12, cardId: 120 }));

vi.mock('@/contexts/useDatabaseSlices', () => ({
  useAccountManagementSlice: () => {
    const [, force] = React.useReducer((count: number) => count + 1, 0);
    React.useEffect(() => {
      store.listeners.add(force);
      return () => {
        store.listeners.delete(force);
      };
    }, []);
    return {
      accounts: store.accounts,
      users,
      addAccountWithCard,
      deleteAccount,
      updateAccount,
      addUser,
      updateUser,
      deleteUser,
      getAccountCards,
      addAccountCard,
      deleteAccountCard,
      updateAccountCard,
    };
  },
}));

// The frozen dialogs are written for Next's automatic JSX runtime (no React
// import); Vitest's classic transform cannot render them, and the page test
// only needs their props contract.
vi.mock('./AccountFormDialog', () => ({
  AccountFormDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="account-form-dialog" /> : null),
}));
vi.mock('./UserFormDialog', () => ({
  UserFormDialog: ({ open }: { open: boolean }) => (open ? <div data-testid="user-form-dialog" /> : null),
}));
vi.mock('./DeleteConfirmDialog', () => ({
  DeleteConfirmDialog: ({ open, targetType, onConfirm }: { open: boolean; targetType: string | null; onConfirm: () => void }) =>
    open ? (
      <div role="dialog" data-testid="delete-dialog" data-target={targetType}>
        <button onClick={onConfirm}>Delete</button>
      </div>
    ) : null,
}));

import AccountsPage from './AccountsPage';

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

beforeEach(() => {
  window.localStorage.clear();
  installMatchMedia(false);
  store.accounts = initialAccounts.map((account) => ({ ...account }));
  store.cards = Object.fromEntries(Object.entries(initialCards).map(([id, cards]) => [id, cards.map((card) => ({ ...card }))]));
  store.listeners.clear();
});

describe('AccountsPage', () => {
  it('lists accounts with institution, owner and cards, and selects the first one on desktop', async () => {
    render(<AccountsPage />);

    expect(await screen.findByText(/Household Checking \| First Bank \| Avery/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('grid-row-11')).toHaveTextContent('2222,3333'));
    // Sorted by name: Household Checking comes first and is selected.
    expect(screen.getByTestId('grid-row-10')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('account-detail-title')).toHaveTextContent('Household Checking');
    expect(screen.getByTestId('accounts-summary')).toHaveTextContent('2 accounts • 2 people');
  });

  it('shows the People panel with the primary star and owned / cardholder counts', async () => {
    render(<AccountsPage />);

    const panel = screen.getByTestId('people-panel');
    const avery = within(panel).getByTestId('person-row-1');
    expect(within(avery).getByTestId('primary-user-star')).toBeInTheDocument();
    // Avery owns Household Checking and holds a card on Rewards Visa.
    await waitFor(() => expect(avery).toHaveTextContent('1 owned • 1 cardholder'));
    expect(within(avery).getByTitle('Delete User')).toBeDisabled();
    expect(within(within(panel).getByTestId('person-row-2')).getByTitle('Delete User')).toBeEnabled();
  });

  it('select → edit → save updates the account and the grid row', async () => {
    render(<AccountsPage />);

    fireEvent.click(await screen.findByTestId('grid-row-11'));
    expect(screen.getByTestId('account-detail-title')).toHaveTextContent('Rewards Visa');
    expect(screen.getByTestId('grid-row-11')).toHaveAttribute('data-selected', 'true');

    const saveButton = screen.getByTestId('account-save-button');
    expect(saveButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Institution (Optional)'), { target: { value: 'Credit Union' } });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() =>
      expect(updateAccount).toHaveBeenCalledWith(11, expect.objectContaining({ institution: 'Credit Union', credit_limit: 5000 }))
    );
    await waitFor(() => expect(screen.getByTestId('grid-row-11')).toHaveTextContent('Rewards Visa | Credit Union | Jordan'));
    expect(await screen.findByTestId('account-saved-alert')).toBeInTheDocument();
  });

  it('adds a card inline from the Cards sub-grid', async () => {
    render(<AccountsPage />);

    await screen.findByTestId('grid-row-10');
    fireEvent.click(screen.getByTestId('add-card-button'));
    fireEvent.change(screen.getByTestId('card-add-number'), { target: { value: '4444333322221234' } });
    fireEvent.change(screen.getByTestId('card-add-nickname'), { target: { value: 'Travel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save new card' }));

    await waitFor(() =>
      expect(addAccountCard).toHaveBeenCalledWith(
        expect.objectContaining({ account_id: 10, last_four: '1234', full_number: '4444333322221234', nickname: 'Travel' })
      )
    );
    await waitFor(() => expect(screen.getByTestId('account-cards-table')).toHaveTextContent('••••1234'));
    expect(screen.getByTestId('grid-row-10')).toHaveTextContent('1111,1234');
  });

  it('blocks deleting the last card and confirms deleting another', async () => {
    render(<AccountsPage />);

    await screen.findByTestId('grid-row-10');
    expect(screen.getByRole('button', { name: 'Delete card' })).toBeDisabled();

    fireEvent.click(screen.getByTestId('grid-row-11'));
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete card' });
    expect(deleteButtons).toHaveLength(2);
    fireEvent.click(deleteButtons[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteAccountCard).toHaveBeenCalledWith(110));
  });

  it('on phones shows the list first and opens the form full-screen with a back button', async () => {
    installMatchMedia(true);
    render(<AccountsPage />);

    const list = await screen.findByTestId('accounts-list');
    expect(screen.queryByTestId('account-detail-form')).not.toBeInTheDocument();

    fireEvent.click(within(list).getByTestId('account-row-11'));
    expect(await screen.findByTestId('account-detail-form')).toBeInTheDocument();
    expect(screen.queryByTestId('accounts-list')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }));
    expect(await screen.findByTestId('accounts-list')).toBeInTheDocument();
  });
});
