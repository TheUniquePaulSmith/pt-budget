// @vitest-environment jsdom

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CurrencySelect } from './CurrencySelect';

function openList() {
  fireEvent.mouseDown(screen.getByRole('combobox'));
  return within(screen.getByRole('listbox'));
}

describe('CurrencySelect', () => {
  it('shows each currency as "CODE – Name (symbol)" with the code first', () => {
    render(<CurrencySelect label="Currency" value="USD" onChange={() => {}} testId="cur" />);
    const list = openList();

    expect(list.getByRole('option', { name: 'USD – US Dollar ($)' })).toBeInTheDocument();
    expect(list.getByRole('option', { name: 'EUR – Euro (€)' })).toBeInTheDocument();
    expect(list.getByRole('option', { name: 'CAD – Canadian Dollar (CA$)' })).toBeInTheDocument();
    expect(list.getByRole('option', { name: 'CNY – Chinese Yuan (CN¥)' })).toBeInTheDocument();
    expect(list.getByRole('option', { name: 'SEK – Swedish Krona (kr)' })).toBeInTheDocument();
    // The e2e specs pick options by a leading-code match.
    expect(list.getByRole('option', { name: /^EUR/ })).toBeInTheDocument();
  });

  it('leaves the symbol off a currency that has none beyond its code', () => {
    render(<CurrencySelect label="Currency" value="USD" onChange={() => {}} />);
    const list = openList();

    expect(list.getByRole('option', { name: 'CHF – Swiss Franc' })).toBeInTheDocument();
  });

  it('lists an extra in-use code that is not in the supported list', () => {
    render(<CurrencySelect label="Currency" value="USD" extraCodes={['ARS']} onChange={() => {}} />);
    const list = openList();

    expect(list.getByRole('option', { name: /^ARS – Argentine Peso/ })).toBeInTheDocument();
  });

  it('reports the chosen code, not the label', () => {
    const onChange = vi.fn();
    render(<CurrencySelect label="Currency" value="USD" onChange={onChange} testId="cur" />);
    const list = openList();

    fireEvent.click(list.getByRole('option', { name: 'GBP – British Pound (£)' }));
    expect(onChange).toHaveBeenCalledWith('GBP');
  });
});
