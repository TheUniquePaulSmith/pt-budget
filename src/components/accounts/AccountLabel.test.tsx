// @vitest-environment jsdom

import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildAccountLabels, type AccountLabelSource, type AccountLabelWords } from '@/lib/accountLabels';

import AccountDetailsButton from './AccountDetailsButton';
import AccountLabel from './AccountLabel';
import AccountOptionContent from './AccountOptionContent';

const words: AccountLabelWords = {
  typeLabel: (type) => (type === 'credit' ? 'Credit Card' : 'Checking'),
  jointOwner: (owner) => `${owner} (joint)`,
  joint: 'Joint',
  closed: 'Closed',
  moreCards: (count) => `+${count} more`,
};

const accounts: AccountLabelSource[] = [
  {
    id: 1,
    name: 'Household Checking',
    type: 'checking',
    ownership: 'joint',
    owner_user_id: 1,
    owner_display_name: 'Avery',
    institution: 'Cedar Valley Credit Union',
    currency: 'USD',
    cards: [
      { id: 11, last_four: '4821', nickname: 'Main Debit', user_id: 1, user_display_name: 'Avery' },
      { id: 12, last_four: '5519', nickname: null, user_id: 2, user_display_name: 'Jordan' },
    ],
  },
  { id: 2, name: 'Huntington', type: 'credit', owner_user_id: 1, owner_display_name: 'Avery', cards: [{ id: 21, last_four: '1111' }] },
  { id: 3, name: 'Huntington', type: 'credit', owner_user_id: 2, owner_display_name: 'Jordan', cards: [{ id: 31, last_four: '2222' }] },
  { id: 4, name: 'Old Card', type: 'credit', owner_display_name: 'Avery', is_active: 0, cards: [] },
];
const labels = buildAccountLabels(accounts, words);

function renderWithTheme(ui: React.ReactElement) {
  return render(<ThemeProvider theme={createTheme()}>{ui}</ThemeProvider>);
}

const queryCard = () => screen.queryByTestId('account-details-card');

/** Longer than the 400 ms a hover waits before it opens the card. */
const pastHoverDelay = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 600)));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AccountLabel', () => {
  it('shows just the name of an account whose name is unique', () => {
    renderWithTheme(<AccountLabel label={labels.get(1)} />);
    const label = screen.getByTestId('account-label');
    expect(label).toHaveTextContent(/^Household Checking$/);
    expect(label).toHaveAttribute('data-account-id', '1');
    expect(queryCard()).not.toBeInTheDocument();
  });

  it('adds the detail that tells two same-named accounts apart', () => {
    renderWithTheme(
      <>
        <AccountLabel label={labels.get(2)} />
        <AccountLabel label={labels.get(3)} />
      </>
    );
    const [mine, theirs] = screen.getAllByTestId('account-label');
    expect(mine).toHaveTextContent(/^Huntington · Avery$/);
    expect(theirs).toHaveTextContent(/^Huntington · Jordan$/);
  });

  it('adds the bank, type, owner and cards line in the two-line variant', () => {
    renderWithTheme(<AccountLabel label={labels.get(1)} variant="twoLine" />);
    expect(screen.getByTestId('account-detail-line')).toHaveTextContent('Cedar Valley Credit Union · Avery (joint) · ••4821 ••5519');
  });

  it('is plain text without a label', () => {
    renderWithTheme(<AccountLabel label={undefined} fallback="Deleted account" />);
    expect(screen.getByText('Deleted account')).toBeInTheDocument();
    expect(screen.queryByTestId('account-label')).not.toBeInTheDocument();
  });

  it('opens the details card on a click and closes it on a click elsewhere', async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <>
        <AccountLabel label={labels.get(1)} />
        <p>Elsewhere</p>
      </>
    );

    await user.click(screen.getByTestId('account-label'));

    const card = await screen.findByTestId('account-details-card');
    expect(card).toHaveTextContent('Household Checking');
    expect(card).toHaveTextContent('Checking');
    expect(card).toHaveTextContent('Cedar Valley Credit Union');
    expect(card).toHaveTextContent('Avery (joint)');
    expect(card).toHaveTextContent('••4821 Main Debit — Avery');
    expect(card).toHaveTextContent('••5519 — Jordan');
    expect(card).toHaveTextContent('USD');
    // The card describes the label; the label's name is still the account.
    expect(screen.getByRole('button', { name: 'Household Checking' })).toBe(screen.getByTestId('account-label'));

    await user.click(screen.getByText('Elsewhere'));
    await waitFor(() => expect(queryCard()).not.toBeInTheDocument());
  });

  it('closes a pinned card on a second click, and keeps it closed while the pointer rests on the label', async () => {
    const user = userEvent.setup();
    renderWithTheme(<AccountLabel label={labels.get(1)} />);
    const label = screen.getByTestId('account-label');

    await user.click(label);
    expect(await screen.findByTestId('account-details-card')).toBeInTheDocument();
    await user.click(label);
    await waitFor(() => expect(queryCard()).not.toBeInTheDocument());
    // The click arrived with a hover, whose delay is still running: it must not bring the card back.
    await pastHoverDelay();
    expect(queryCard()).not.toBeInTheDocument();

    // Hovering opens it again once the pointer has left.
    await user.unhover(label);
    await user.hover(label);
    expect(await screen.findByTestId('account-details-card')).toBeInTheDocument();
  });

  it('stays closed after Escape while the pointer is still on the label', async () => {
    const user = userEvent.setup();
    renderWithTheme(<AccountLabel label={labels.get(1)} />);
    const label = screen.getByTestId('account-label');

    await user.click(label);
    expect(await screen.findByTestId('account-details-card')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(queryCard()).not.toBeInTheDocument());
    await pastHoverDelay();
    expect(queryCard()).not.toBeInTheDocument();
  });

  it('opens on hover after a moment and closes when the pointer leaves', async () => {
    const user = userEvent.setup();
    renderWithTheme(<AccountLabel label={labels.get(3)} />);
    const label = screen.getByTestId('account-label');

    await user.hover(label);
    expect(queryCard()).not.toBeInTheDocument();
    const card = await screen.findByTestId('account-details-card');
    expect(within(card).getByText('Credit Card')).toBeInTheDocument();
    expect(card).toHaveTextContent('••2222');

    await user.unhover(label);
    await waitFor(() => expect(queryCard()).not.toBeInTheDocument());
  });

  it('opens from the keyboard and keeps Space, Enter and Escape away from what is around it', async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    renderWithTheme(
      // The stand-in for a data grid cell (Space, Enter) or a dialog (Escape) listening above the label.
      <div onKeyDown={onKeyDown}>
        <AccountLabel label={labels.get(1)} />
      </div>
    );

    await user.tab();
    expect(screen.getByTestId('account-label')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('account-details-card')).toBeInTheDocument();
    expect(onKeyDown).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(queryCard()).not.toBeInTheDocument());
    expect(onKeyDown).not.toHaveBeenCalled();

    await user.keyboard(' ');
    expect(await screen.findByTestId('account-details-card')).toBeInTheDocument();
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('lets Escape through when no card is open', async () => {
    const user = userEvent.setup();
    const onKeyDown = vi.fn();
    renderWithTheme(
      <div onKeyDown={onKeyDown}>
        <AccountLabel label={labels.get(1)} tabIndex={-1} />
      </div>
    );

    const label = screen.getByTestId('account-label');
    expect(label).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(label, { key: 'Escape' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('ignores the click that ends a long press, so a row menu opens alone', async () => {
    renderWithTheme(<AccountLabel label={labels.get(1)} />);
    const label = screen.getByTestId('account-label');
    const now = vi.spyOn(Date, 'now');

    now.mockReturnValue(1_000);
    fireEvent.touchStart(label);
    now.mockReturnValue(1_600);
    fireEvent.touchEnd(label);
    fireEvent.click(label);
    expect(queryCard()).not.toBeInTheDocument();

    // A tap is short: it opens the card.
    now.mockReturnValue(5_000);
    fireEvent.touchStart(label);
    now.mockReturnValue(5_080);
    fireEvent.touchEnd(label);
    fireEvent.click(label);
    expect(await screen.findByTestId('account-details-card')).toBeInTheDocument();
  });

  it('says when an account is closed and when it has no cards', async () => {
    const user = userEvent.setup();
    renderWithTheme(<AccountLabel label={labels.get(4)} />);

    await user.click(screen.getByTestId('account-label'));

    const card = await screen.findByTestId('account-details-card');
    expect(card).toHaveTextContent('Closed');
    expect(card).toHaveTextContent('No cards');
  });
});

describe('AccountOptionContent', () => {
  it('is two lines of plain text with nothing to click', () => {
    renderWithTheme(<AccountOptionContent label={labels.get(2)} />);
    expect(screen.getByText('Huntington', { exact: false })).toBeInTheDocument();
    // The owner is on the first line ("Huntington · Avery"): the second has the rest.
    expect(screen.getByTestId('account-detail-line')).toHaveTextContent(/^Credit Card · ••1111$/);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('falls back to the given text without a label', () => {
    renderWithTheme(<AccountOptionContent label={undefined} fallback="Rewards Visa" />);
    expect(screen.getByText('Rewards Visa')).toBeInTheDocument();
  });
});

describe('AccountDetailsButton', () => {
  it('names the account it is about and opens its details', async () => {
    const user = userEvent.setup();
    renderWithTheme(<AccountDetailsButton account={accounts[2]} data-testid="details" />);

    const button = screen.getByRole('button', { name: 'Account details: Huntington' });
    expect(button).toBe(screen.getByTestId('details'));
    await user.click(button);

    const card = await screen.findByTestId('account-details-card');
    expect(card).toHaveTextContent('Jordan');
    expect(card).toHaveTextContent('••2222');
  });
});
