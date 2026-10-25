// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import InternalDuplicatesResolver from './InternalDuplicatesResolver';

// The real grid needs the app theme and layout; this stub renders each column's cell
// content so the Include buttons and variation chips are still exercised.
vi.mock('@/components/common/DataGrid/AppDataGrid', () => ({
  AppDataGrid: ({ rows, columns }: any) => (
    <div role="grid">
      {rows.map((row: any) => (
        <div role="row" key={row.id}>
          {columns.map((column: any) => (
            <span key={column.field}>
              {column.renderCell ? column.renderCell({ row, value: row[column.field] }) : null}
            </span>
          ))}
        </div>
      ))}
    </div>
  ),
}));

const buildItem = (index: number, tempId: number) => ({
  index,
  tempId,
  csvAccountValue: 'Visa ending 1682',
  transaction: {
    date: '2026-04-26',
    amount: -18,
    description: 'Museum tickets',
    account_id: 7,
    card_id: null,
    category_id: null,
    company_id: null,
    project_id: null,
    trip_id: null,
    type: 'expense' as const,
    transaction_hash: 'hash-a',
  },
});

const duplicateGroups = [
  { hash: 'hash-a', transactions: [buildItem(0, 100), buildItem(1, 101), buildItem(2, 102)] },
  { hash: 'hash-b', transactions: [buildItem(3, 103), buildItem(4, 104)] },
];

const renderResolver = (onResolve = vi.fn()) => {
  render(
    <InternalDuplicatesResolver
      open
      onClose={vi.fn()}
      duplicateGroups={duplicateGroups}
      onResolve={onResolve}
    />
  );
  return onResolve;
};

describe('InternalDuplicatesResolver', () => {
  it('keeps only the first record of each set by default', () => {
    const onResolve = renderResolver();

    expect(screen.getByRole('checkbox', { name: 'Include all duplicates' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with 2 Transactions' }));

    expect(onResolve).toHaveBeenCalledWith(new Set([0, 3]));
  });

  it('includes every record in every set when "Include all duplicates" is on', () => {
    const onResolve = renderResolver();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include all duplicates' }));

    expect(screen.getByText('5 Selected')).toBeInTheDocument();
    expect(screen.getByText('0 Excluded')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with 5 Transactions' }));

    expect(onResolve).toHaveBeenCalledWith(new Set([0, 1, 2, 3, 4]));
  });

  it('disables the per-row include buttons while including all', () => {
    renderResolver();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include all duplicates' }));

    const toggles = screen.getAllByTitle('Exclude from import');
    expect(toggles).toHaveLength(5);
    toggles.forEach((toggle) => expect(toggle).toBeDisabled());
  });

  it('restores the manual selection when the toggle is turned back off', () => {
    const onResolve = renderResolver();

    // Also include the second record of the first set by hand.
    const firstSet = screen.getByText('Duplicate Set 1 (3 records)').parentElement as HTMLElement;
    fireEvent.click(within(firstSet).getAllByTitle('Include in import')[0]);
    expect(screen.getByText('3 Selected')).toBeInTheDocument();

    const toggle = screen.getByRole('checkbox', { name: 'Include all duplicates' });
    fireEvent.click(toggle);
    expect(screen.getByText('5 Selected')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(screen.getByText('3 Selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Continue with 3 Transactions' }));
    expect(onResolve).toHaveBeenCalledWith(new Set([0, 1, 3]));
  });
});
