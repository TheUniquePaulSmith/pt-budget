// @vitest-environment jsdom

import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';

import { AccountFormDialog } from './AccountFormDialog';
import type { User } from '@/types/database';

const users: User[] = [
  { id: 1, display_name: 'Pat Doe', is_primary: 1, created_at: '2026-01-01', updated_at: '2026-01-01' },
];

// The shared AccountOwnerField (frozen) does not wire a labelId, so the Owner
// combobox has no accessible name; it is the first select in add mode.
function ownerSelect(container: HTMLElement) {
  return within(container).getAllByRole('combobox')[0];
}

function renderDialog(overrides: Partial<React.ComponentProps<typeof AccountFormDialog>> = {}) {
  const props: React.ComponentProps<typeof AccountFormDialog> = {
    open: true,
    editingAccount: null,
    users,
    defaultOwnerUserId: 1,
    onClose: vi.fn(),
    onAdd: vi.fn().mockResolvedValue({ accountId: 42, cardId: 77 }),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  const view = render(
    <ThemeProvider theme={createTheme()}>
      <AccountFormDialog {...props} />
    </ThemeProvider>
  );
  return { ...view, props };
}

describe('AccountFormDialog', () => {
  it('prefills add mode from initialValues and reports the created ids through onCreated', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const { props } = renderDialog({
      initialValues: { name: 'Huntington Checking', institution: 'Huntington', cardNumberInput: '8801' },
      onCreated,
    });

    const dialog = screen.getByRole('dialog', { name: 'Add New Account' });
    expect(within(dialog).getByLabelText(/Account Name/)).toHaveValue('Huntington Checking');
    expect(within(dialog).getByLabelText(/Institution/)).toHaveValue('Huntington');
    expect(within(dialog).getByLabelText(/Card \/ Account Number/)).toHaveValue('8801');

    await user.click(within(dialog).getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ accountId: 42, cardId: 77 }));
    expect(props.onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Huntington Checking', institution: 'Huntington' }),
      1,
      expect.objectContaining({ last_four: '8801', full_number: null, user_id: 1 })
    );
    expect(props.onClose).toHaveBeenCalled();
  });

  it('does not call onCreated when onAdd resolves without ids', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    renderDialog({
      initialValues: { name: 'Savings', cardNumberInput: '1234' },
      onAdd: vi.fn().mockResolvedValue(undefined),
      onCreated,
    });

    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Saving...' })).not.toBeInTheDocument());
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('offers "+ New person…" in the owner select and selects the person it creates', async () => {
    const user = userEvent.setup();
    const onAddUser = vi.fn(async () => 9);
    const { props, rerender } = renderDialog({ defaultOwnerUserId: null, onAddUser });

    const dialog = screen.getByRole('dialog', { name: 'Add New Account' });
    await user.click(ownerSelect(dialog));
    await user.click(await screen.findByRole('option', { name: '+ New person…' }));

    const personDialog = await screen.findByRole('dialog', { name: 'Add New User' });
    await user.type(within(personDialog).getByLabelText(/Display Name/), 'Sam Lee');
    await user.click(within(personDialog).getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(onAddUser).toHaveBeenCalledWith('Sam Lee'));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add New User' })).not.toBeInTheDocument());

    // The caller refreshes `users` once the person exists; the new id is now the selected owner.
    const refreshedUsers: User[] = [
      ...users,
      { id: 9, display_name: 'Sam Lee', is_primary: 0, created_at: '2026-01-02', updated_at: '2026-01-02' },
    ];
    rerender(
      <ThemeProvider theme={createTheme()}>
        <AccountFormDialog {...props} users={refreshedUsers} />
      </ThemeProvider>
    );
    expect(ownerSelect(dialog)).toHaveTextContent('Sam Lee');
  });

  it('hides "+ New person…" when onAddUser is not provided', async () => {
    const user = userEvent.setup();
    renderDialog({ defaultOwnerUserId: null });

    await user.click(ownerSelect(screen.getByRole('dialog', { name: 'Add New Account' })));
    expect(await screen.findByRole('option', { name: 'Pat Doe' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: '+ New person…' })).not.toBeInTheDocument();
  });
});
